import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, newId, now, save } from '../db.js';
import {
  HttpError, assertValid, badRequest, clean, conflict, forbidden, notFound, ok, paginate, paging, rules, validate
} from '../http.js';
import { ROLES, allow, requireAuth, revokeUserSessions, sha256 } from '../auth.js';
import { publicInvite, publicUser } from '../serialize.js';
import { createResetLink } from './auth.js';

const STATUSES = ['Active', 'Invited', 'Suspended'];
const INVITE_HOURS = 72;
const manage = allow('Owner', 'Admin');

const router = Router();
router.use(requireAuth);

/* ---------------- helpers ---------------- */

const inWorkspace = (req) => db.users.filter((u) => u.workspaceId === req.workspace.id);

function findUser(req, id, { includeArchived = true } = {}) {
  const user = inWorkspace(req).find((u) => u.id === id);
  if (!user || (!includeArchived && user.deletedAt)) throw notFound('User not found');
  return user;
}

const activeOwners = (req) => inWorkspace(req).filter((u) => u.role === 'Owner' && !u.deletedAt && u.status !== 'Suspended');

/** Seats count every non-archived account, invited ones included. */
export const seatsUsed = (workspaceId) => db.users.filter((u) => u.workspaceId === workspaceId && !u.deletedAt).length;

function assertSeatAvailable(req) {
  if (seatsUsed(req.workspace.id) >= req.workspace.seatsLicensed) {
    throw new HttpError(
      409,
      'SEAT_LIMIT',
      `All ${req.workspace.seatsLicensed} licensed seats are in use. Add seats from Subscription, or archive an account first.`
    );
  }
}

/** Only an Owner may create, promote to, or demote from Owner. */
function assertCanAssignRole(req, target, nextRole) {
  if ((nextRole === 'Owner' || target?.role === 'Owner') && req.user.role !== 'Owner') {
    throw forbidden('Only an Owner can grant or remove the Owner role');
  }
}

function assertNotLastOwner(req, target, message) {
  if (target.role === 'Owner' && activeOwners(req).filter((u) => u.id !== target.id).length === 0) {
    throw conflict(message ?? 'The workspace needs at least one active Owner');
  }
}

export function createInviteFor(req, user, expiresInHours = INVITE_HOURS) {
  const token = crypto.randomBytes(32).toString('base64url');
  const invite = {
    id: newId(),
    workspaceId: req.workspace.id,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    team: user.team,
    tokenHash: sha256(token),
    invitedBy: req.user.id,
    expiresAt: new Date(Date.now() + expiresInHours * 3600e3).toISOString(),
    acceptedAt: null,
    revokedAt: null,
    createdAt: now()
  };
  db.invites.push(invite);
  const link = `${config.appUrl}/?invite=${token}`;
  console.log(`[mail] Invite for ${user.email} (${req.workspace.name}): ${link}`);
  return { invite, token, link };
}

const sorters = {
  name: (a, b) => a.name.localeCompare(b.name),
  role: (a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name),
  team: (a, b) => (a.team ?? '').localeCompare(b.team ?? '') || a.name.localeCompare(b.name),
  // Oldest password first — the audit view wants the stalest credentials on top.
  passwordAge: (a, b) => (Date.parse(a.passwordChangedAt ?? 0) || 0) - (Date.parse(b.passwordChangedAt ?? 0) || 0)
};

/* ---------------- reads ---------------- */

router.get('/', (req, res) => {
  const { q, role, team, status, mfa, archived = 'exclude', sort = 'name' } = req.query;
  const needle = clean(q).toLowerCase();

  let rows = inWorkspace(req).filter((u) => {
    if (archived === 'exclude' && u.deletedAt) return false;
    if (archived === 'only' && !u.deletedAt) return false;
    if (needle && ![u.name, u.email, u.team, u.location].some((v) => (v ?? '').toLowerCase().includes(needle))) return false;
    if (role && u.role !== role) return false;
    if (team && u.team !== team) return false;
    if (status && u.status !== status) return false;
    if (mfa === 'enrolled' && !u.mfaEnrolledAt) return false;
    if (mfa === 'pending' && (u.mfaEnrolledAt || u.status !== 'Invited')) return false;
    if (mfa === 'missing' && (u.mfaEnrolledAt || u.status === 'Invited')) return false;
    return true;
  });

  rows = rows.sort(sorters[sort] ?? sorters.name);
  const { items, meta } = paginate(rows, paging(req.query));
  ok(res, items.map(publicUser), null, { meta });
});

router.get('/facets', (req, res) => {
  const live = inWorkspace(req).filter((u) => !u.deletedAt);
  const count = (key, values) => values.map((value) => ({ value, count: live.filter((u) => u[key] === value).length }));
  ok(res, {
    teams: [...new Set(live.map((u) => u.team).filter(Boolean))].sort(),
    roles: count('role', ROLES),
    statuses: count('status', STATUSES),
    total: live.length,
    mfaMissing: live.filter((u) => !u.mfaEnrolledAt && u.status !== 'Invited').length,
    archived: inWorkspace(req).filter((u) => u.deletedAt).length
  });
});

router.get('/:id', (req, res) => {
  ok(res, publicUser(findUser(req, req.params.id)));
});

/* ---------------- writes ---------------- */

const userSchema = (partial) => ({
  name: [...(partial ? [] : [rules.required('Enter a name')]), rules.minLen(2), rules.maxLen(80)],
  email: [...(partial ? [] : [rules.required('Enter an email address')]), rules.email()],
  role: [...(partial ? [] : [rules.required('Choose a role')]), rules.oneOf(ROLES, 'Unknown role')],
  team: [...(partial ? [] : [rules.required('Choose a team')]), rules.maxLen(60)],
  manager: [rules.maxLen(80)],
  location: [rules.maxLen(80)]
});

function assertEmailFree(email, exceptId) {
  if (db.users.some((u) => u.email === email && u.id !== exceptId && !u.deletedAt)) {
    throw conflict('That email is already in use', { email: 'Another account already uses this email' });
  }
}

router.post('/', manage, (req, res) => {
  const body = req.body ?? {};
  assertValid(validate(body, userSchema(false)));
  const email = clean(body.email).toLowerCase();
  assertEmailFree(email);
  assertCanAssignRole(req, null, body.role);
  assertSeatAvailable(req);

  const user = {
    id: newId(),
    workspaceId: req.workspace.id,
    name: clean(body.name),
    email,
    passwordHash: null,
    role: body.role,
    team: clean(body.team),
    status: 'Invited',
    manager: clean(body.manager) || null,
    location: clean(body.location) || null,
    requireMfa: body.requireMfa !== false,
    mfaEnrolledAt: null,
    passwordChangedAt: null,
    lastSeenAt: null,
    createdAt: now(),
    deletedAt: null
  };
  db.users.push(user);

  // Every new account needs a way in; "sendInvite: false" just means the admin shares the link.
  const { token } = createInviteFor(req, user);
  save();

  ok(
    res,
    { user: publicUser(user), inviteToken: config.env === 'production' ? undefined : token },
    body.sendInvite === false ? `${user.name} added — share their set-up link` : `Invite sent to ${user.email} · role ${user.role}`,
    { status: 201 }
  );
});

router.patch('/:id', (req, res) => {
  const target = findUser(req, req.params.id, { includeArchived: false });
  const self = target.id === req.user.id;
  if (!self && !['Owner', 'Admin'].includes(req.user.role)) throw forbidden('You can only edit your own profile');

  const body = req.body ?? {};
  const allowed = ['name', 'email', 'team', 'manager', 'location'];
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  assertValid(validate(patch, userSchema(true)));

  if (patch.email !== undefined) {
    patch.email = clean(patch.email).toLowerCase();
    assertEmailFree(patch.email, target.id);
  }
  for (const key of ['name', 'team', 'manager', 'location']) {
    if (patch[key] !== undefined) patch[key] = clean(patch[key]) || (key === 'name' ? target.name : null);
  }
  Object.assign(target, patch, { updatedAt: now() });
  save();
  ok(res, publicUser(target), 'Profile updated');
});

router.patch('/:id/role', manage, (req, res) => {
  const target = findUser(req, req.params.id, { includeArchived: false });
  const role = req.body?.role;
  assertValid(validate({ role }, { role: [rules.required('Choose a role'), rules.oneOf(ROLES, 'Unknown role')] }));
  if (target.id === req.user.id) throw forbidden("You can't change your own role — ask another Owner");
  assertCanAssignRole(req, target, role);
  if (role !== 'Owner') assertNotLastOwner(req, target);

  const from = target.role;
  target.role = role;
  target.updatedAt = now();
  save();
  ok(res, publicUser(target), from === role ? `${target.name} is already ${role}` : `${target.name}: ${from} → ${role}`);
});

router.patch('/:id/status', manage, (req, res) => {
  const target = findUser(req, req.params.id, { includeArchived: false });
  const status = req.body?.status;
  assertValid(validate({ status }, { status: [rules.required('Choose a status'), rules.oneOf(STATUSES, 'Unknown status')] }));
  if (target.id === req.user.id) throw forbidden("You can't change your own status");
  assertCanAssignRole(req, target, target.role);
  if (status === 'Suspended') {
    assertNotLastOwner(req, target, "You can't suspend the last active Owner");
    revokeUserSessions(target.id);
  }
  if (status === 'Active' && !target.passwordHash) {
    throw badRequest(`${target.name} hasn't accepted their invite yet — resend it instead`);
  }

  target.status = status;
  target.updatedAt = now();
  save();
  ok(res, publicUser(target), `${target.name} is now ${status.toLowerCase()}`);
});

router.post('/:id/reset-password', manage, (req, res) => {
  const target = findUser(req, req.params.id, { includeArchived: false });
  assertCanAssignRole(req, target, target.role);
  createResetLink(target);
  ok(res, { sentTo: target.email }, `Password reset link sent to ${target.email}`);
});

router.delete('/:id', manage, (req, res) => {
  const target = findUser(req, req.params.id, { includeArchived: false });
  if (target.id === req.user.id) throw forbidden("You can't archive your own account");
  assertCanAssignRole(req, target, target.role);
  assertNotLastOwner(req, target, "You can't archive the last active Owner");

  target.deletedAt = now();
  revokeUserSessions(target.id);
  for (const invite of db.invites) if (invite.userId === target.id && !invite.acceptedAt) invite.revokedAt = now();
  save();
  ok(res, publicUser(target), `${target.name} archived — restore them any time from Archived`);
});

router.post('/:id/restore', manage, (req, res) => {
  const target = findUser(req, req.params.id);
  if (!target.deletedAt) return ok(res, publicUser(target), `${target.name} isn't archived`);
  assertEmailFree(target.email, target.id);
  assertSeatAvailable(req);
  target.deletedAt = null;
  target.updatedAt = now();
  save();
  ok(res, publicUser(target), `${target.name} restored`);
});

router.delete('/:id/purge', allow('Owner'), (req, res) => {
  const target = findUser(req, req.params.id);
  if (!target.deletedAt) throw badRequest('Archive the account before deleting it permanently');
  db.users = db.users.filter((u) => u.id !== target.id);
  db.invites = db.invites.filter((i) => i.userId !== target.id);
  db.resetTokens = db.resetTokens.filter((t) => t.userId !== target.id);
  revokeUserSessions(target.id);
  save();
  res.status(204).end();
});

/* ---------------- bulk ---------------- */

router.post('/bulk', manage, (req, res) => {
  const { ids, action, role, status } = req.body ?? {};
  if (!Array.isArray(ids) || !ids.length) throw badRequest('Select at least one account', { ids: 'Select at least one account' });
  if (!['role', 'status', 'archive', 'reset-password'].includes(action)) throw badRequest('Unknown bulk action');
  if (action === 'role' && !ROLES.includes(role)) throw badRequest('Choose a role', { role: 'Choose a role' });
  if (action === 'status' && !STATUSES.includes(status)) throw badRequest('Choose a status', { status: 'Choose a status' });

  const applied = [];
  const skipped = [];

  for (const id of [...new Set(ids)].slice(0, 500)) {
    const target = inWorkspace(req).find((u) => u.id === id && !u.deletedAt);
    try {
      if (!target) throw notFound('Not found');
      if (target.id === req.user.id && action !== 'reset-password') throw forbidden("Can't apply to your own account");
      assertCanAssignRole(req, target, action === 'role' ? role : target.role);

      if (action === 'role') {
        if (role !== 'Owner') assertNotLastOwner(req, target);
        target.role = role;
      } else if (action === 'status') {
        if (status === 'Suspended') {
          assertNotLastOwner(req, target);
          revokeUserSessions(target.id);
        }
        if (status === 'Active' && !target.passwordHash) throw badRequest('Invite not accepted yet');
        target.status = status;
      } else if (action === 'archive') {
        assertNotLastOwner(req, target);
        target.deletedAt = now();
        revokeUserSessions(target.id);
      } else {
        createResetLink(target);
      }
      target.updatedAt = now();
      applied.push(id);
    } catch (err) {
      skipped.push({ id, reason: err.message });
    }
  }
  save();

  const verb = { role: `set to ${role}`, status: `set to ${status}`, archive: 'archived', 'reset-password': 'sent a reset link' }[action];
  const message =
    `${applied.length} account${applied.length === 1 ? '' : 's'} ${verb}` + (skipped.length ? ` · ${skipped.length} skipped` : '');
  ok(res, { action, applied, skipped }, message);
});

export default router;

/* ---------------- invites router ---------------- */

export const invites = Router();
invites.use(requireAuth);

invites.get('/', (req, res) => {
  const { state = 'pending', q, role } = req.query;
  const needle = clean(q).toLowerCase();
  const soon = Date.now() + 24 * 3600e3;

  const rows = db.invites
    .filter((i) => i.workspaceId === req.workspace.id && !i.revokedAt)
    .filter((i) => {
      const expired = Date.parse(i.expiresAt) < Date.now();
      if (state === 'pending' && (i.acceptedAt || expired)) return false;
      if (state === 'expiring' && (i.acceptedAt || expired || Date.parse(i.expiresAt) > soon)) return false;
      if (state === 'accepted' && !i.acceptedAt) return false;
      if (needle && ![i.name, i.email].some((v) => (v ?? '').toLowerCase().includes(needle))) return false;
      if (role && i.role !== role) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  ok(res, rows.map(publicInvite));
});

invites.post('/', manage, (req, res) => {
  const body = req.body ?? {};
  assertValid(
    validate(body, {
      ...userSchema(false),
      expiresInHours: [rules.int(1, 24 * 30, 'Expiry must be between 1 hour and 30 days')]
    })
  );
  const email = clean(body.email).toLowerCase();
  assertEmailFree(email);
  assertCanAssignRole(req, null, body.role);
  assertSeatAvailable(req);

  const user = {
    id: newId(),
    workspaceId: req.workspace.id,
    name: clean(body.name),
    email,
    passwordHash: null,
    role: body.role,
    team: clean(body.team),
    status: 'Invited',
    manager: null,
    location: null,
    mfaEnrolledAt: null,
    passwordChangedAt: null,
    lastSeenAt: null,
    createdAt: now(),
    deletedAt: null
  };
  db.users.push(user);
  const { invite, token } = createInviteFor(req, user, Number(body.expiresInHours) || INVITE_HOURS);
  save();

  ok(
    res,
    { invite: publicInvite(invite), inviteToken: config.env === 'production' ? undefined : token },
    `Invite sent to ${email}`,
    { status: 201 }
  );
});

invites.post('/:id/resend', manage, (req, res) => {
  const old = db.invites.find((i) => i.id === req.params.id && i.workspaceId === req.workspace.id && !i.revokedAt);
  if (!old) throw notFound('Invite not found');
  if (old.acceptedAt) throw badRequest('This invite has already been accepted');
  const user = db.users.find((u) => u.id === old.userId && !u.deletedAt);
  if (!user) throw notFound('The invited account no longer exists');

  old.revokedAt = now();
  createInviteFor(req, user);
  save();
  ok(res, { sentTo: user.email }, `Invite re-sent to ${user.email}`);
});

invites.delete('/:id', manage, (req, res) => {
  const invite = db.invites.find((i) => i.id === req.params.id && i.workspaceId === req.workspace.id && !i.revokedAt);
  if (!invite) throw notFound('Invite not found');
  invite.revokedAt = now();

  // An invite that was never accepted shouldn't leave a placeholder account behind.
  const user = db.users.find((u) => u.id === invite.userId);
  if (user && !invite.acceptedAt && !user.passwordHash) user.deletedAt = now();
  save();
  res.status(204).end();
});
