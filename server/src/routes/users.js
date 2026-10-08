import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, escapeRegex, newId, now, toId } from '../db.js';
import {
  HttpError, assertValid, badRequest, clean, conflict, forbidden, notFound, ok, paging, rules, validate
} from '../http.js';
import { ROLES, allow, requireAuth, revokeUserSessions, roleRank, sha256 } from '../auth.js';
import { publicInvite, publicUser } from '../serialize.js';
import { createResetLink, findLiveUserByEmail } from './auth.js';

const STATUSES = ['Active', 'Invited', 'Suspended'];
const INVITE_HOURS = 72;
const manage = allow('Owner', 'Admin');

const router = Router();
router.use(requireAuth);

/* ---------------- helpers ---------------- */

async function findUser(req, id, { includeArchived = true } = {}) {
  const _id = toId(id);
  const user = _id && (await db.users.findOne({ _id, workspaceId: req.workspace._id }));
  if (!user || (!includeArchived && user.deletedAt)) throw notFound('User not found');
  return user;
}

const otherActiveOwners = (req, exceptId) =>
  db.users.countDocuments({
    workspaceId: req.workspace._id,
    _id: { $ne: exceptId },
    role: 'Owner',
    deletedAt: null,
    status: { $ne: 'Suspended' }
  });

/** Seats count every non-archived account, invited ones included. */
export const seatsUsed = (workspaceId) => db.users.countDocuments({ workspaceId, deletedAt: null });

async function assertSeatAvailable(req) {
  if ((await seatsUsed(req.workspace._id)) >= req.workspace.seatsLicensed) {
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

async function assertNotLastOwner(req, target, message) {
  if (target.role === 'Owner' && (await otherActiveOwners(req, target._id)) === 0) {
    throw conflict(message ?? 'The workspace needs at least one active Owner');
  }
}

async function assertEmailFree(email, exceptId) {
  const existing = await findLiveUserByEmail(email);
  if (existing && String(existing._id) !== String(exceptId)) {
    throw conflict('That email is already in use', { email: 'Another account already uses this email' });
  }
}

export async function createInviteFor(req, user, expiresInHours = INVITE_HOURS) {
  const token = crypto.randomBytes(32).toString('base64url');
  const invite = {
    _id: newId(),
    workspaceId: req.workspace._id,
    userId: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    team: user.team,
    tokenHash: sha256(token),
    invitedBy: req.user._id,
    expiresAt: new Date(Date.now() + expiresInHours * 3600e3),
    acceptedAt: null,
    revokedAt: null,
    createdAt: now()
  };
  await db.invites.insertOne(invite);
  const link = `${config.appUrl}/?invite=${token}`;
  console.log(`[mail] Invite for ${user.email} (${req.workspace.name}): ${link}`);
  return { invite, token, link };
}

function newInvitedUser(req, body) {
  return {
    _id: newId(),
    workspaceId: req.workspace._id,
    name: clean(body.name),
    email: clean(body.email).toLowerCase(),
    passwordHash: null,
    role: body.role,
    roleRank: roleRank(body.role),
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
}

/** Applies $set and returns the updated document. */
const setUser = (user, set) =>
  db.users.findOneAndUpdate({ _id: user._id }, { $set: { ...set, updatedAt: now() } }, { returnDocument: 'after' });

const SORTS = {
  name: { name: 1, _id: 1 },
  role: { roleRank: 1, name: 1, _id: 1 },
  team: { team: 1, name: 1, _id: 1 },
  // Oldest password first — the audit view wants the stalest credentials on top.
  passwordAge: { passwordChangedAt: 1, name: 1, _id: 1 }
};

/* ---------------- reads ---------------- */

router.get('/', async (req, res) => {
  const { q, role, team, status, mfa, archived = 'exclude', sort = 'name' } = req.query;
  const filter = { workspaceId: req.workspace._id };

  if (archived === 'exclude') filter.deletedAt = null;
  if (archived === 'only') filter.deletedAt = { $ne: null };
  const needle = clean(q);
  if (needle) {
    const re = { $regex: escapeRegex(needle), $options: 'i' };
    filter.$or = [{ name: re }, { email: re }, { team: re }, { location: re }];
  }
  if (role) filter.role = String(role);
  if (team) filter.team = String(team);
  if (status) filter.status = String(status);
  if (mfa === 'enrolled') filter.mfaEnrolledAt = { $ne: null };
  if (mfa === 'pending') Object.assign(filter, { mfaEnrolledAt: null, status: 'Invited' });
  if (mfa === 'missing') Object.assign(filter, { mfaEnrolledAt: null, status: status && status !== 'Invited' ? String(status) : { $ne: 'Invited' } });

  const { page, limit } = paging(req.query);
  const [total, rows] = await Promise.all([
    db.users.countDocuments(filter),
    db.users.find(filter).sort(SORTS[sort] ?? SORTS.name).skip((page - 1) * limit).limit(limit).toArray()
  ]);
  ok(res, rows.map(publicUser), null, { meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
});

router.get('/facets', async (req, res) => {
  const live = { workspaceId: req.workspace._id, deletedAt: null };
  const [teams, roles, statuses, total, mfaMissing, archived] = await Promise.all([
    db.users.distinct('team', live),
    Promise.all(ROLES.map(async (value) => ({ value, count: await db.users.countDocuments({ ...live, role: value }) }))),
    Promise.all(STATUSES.map(async (value) => ({ value, count: await db.users.countDocuments({ ...live, status: value }) }))),
    db.users.countDocuments(live),
    db.users.countDocuments({ ...live, mfaEnrolledAt: null, status: { $ne: 'Invited' } }),
    db.users.countDocuments({ workspaceId: req.workspace._id, deletedAt: { $ne: null } })
  ]);
  ok(res, { teams: teams.filter(Boolean).sort(), roles, statuses, total, mfaMissing, archived });
});

router.get('/:id', async (req, res) => {
  ok(res, publicUser(await findUser(req, req.params.id)));
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

router.post('/', manage, async (req, res) => {
  const body = req.body ?? {};
  assertValid(validate(body, userSchema(false)));
  const user = newInvitedUser(req, body);
  await assertEmailFree(user.email);
  assertCanAssignRole(req, null, body.role);
  await assertSeatAvailable(req);

  await db.users.insertOne(user);
  // Every new account needs a way in; "sendInvite: false" just means the admin shares the link.
  const { token } = await createInviteFor(req, user);

  ok(
    res,
    { user: publicUser(user), inviteToken: config.env === 'production' ? undefined : token },
    body.sendInvite === false ? `${user.name} added — share their set-up link` : `Invite sent to ${user.email} · role ${user.role}`,
    { status: 201 }
  );
});

router.patch('/:id', async (req, res) => {
  const target = await findUser(req, req.params.id, { includeArchived: false });
  const self = String(target._id) === String(req.user._id);
  if (!self && !['Owner', 'Admin'].includes(req.user.role)) throw forbidden('You can only edit your own profile');

  const body = req.body ?? {};
  const allowed = ['name', 'email', 'team', 'manager', 'location'];
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  assertValid(validate(patch, userSchema(true)));

  if (patch.email !== undefined) {
    patch.email = clean(patch.email).toLowerCase();
    await assertEmailFree(patch.email, target._id);
  }
  for (const key of ['name', 'team', 'manager', 'location']) {
    if (patch[key] !== undefined) patch[key] = clean(patch[key]) || (key === 'name' ? target.name : null);
  }
  ok(res, publicUser(await setUser(target, patch)), 'Profile updated');
});

router.patch('/:id/role', manage, async (req, res) => {
  const target = await findUser(req, req.params.id, { includeArchived: false });
  const role = req.body?.role;
  assertValid(validate({ role }, { role: [rules.required('Choose a role'), rules.oneOf(ROLES, 'Unknown role')] }));
  if (String(target._id) === String(req.user._id)) throw forbidden("You can't change your own role — ask another Owner");
  assertCanAssignRole(req, target, role);
  if (role !== 'Owner') await assertNotLastOwner(req, target);

  const from = target.role;
  const updated = await setUser(target, { role, roleRank: roleRank(role) });
  ok(res, publicUser(updated), from === role ? `${target.name} is already ${role}` : `${target.name}: ${from} → ${role}`);
});

router.patch('/:id/status', manage, async (req, res) => {
  const target = await findUser(req, req.params.id, { includeArchived: false });
  const status = req.body?.status;
  assertValid(validate({ status }, { status: [rules.required('Choose a status'), rules.oneOf(STATUSES, 'Unknown status')] }));
  if (String(target._id) === String(req.user._id)) throw forbidden("You can't change your own status");
  assertCanAssignRole(req, target, target.role);
  if (status === 'Suspended') {
    await assertNotLastOwner(req, target, "You can't suspend the last active Owner");
    await revokeUserSessions(target._id);
  }
  if (status === 'Active' && !target.passwordHash) {
    throw badRequest(`${target.name} hasn't accepted their invite yet — resend it instead`);
  }
  ok(res, publicUser(await setUser(target, { status })), `${target.name} is now ${status.toLowerCase()}`);
});

router.post('/:id/reset-password', manage, async (req, res) => {
  const target = await findUser(req, req.params.id, { includeArchived: false });
  assertCanAssignRole(req, target, target.role);
  await createResetLink(target);
  ok(res, { sentTo: target.email }, `Password reset link sent to ${target.email}`);
});

router.delete('/:id', manage, async (req, res) => {
  const target = await findUser(req, req.params.id, { includeArchived: false });
  if (String(target._id) === String(req.user._id)) throw forbidden("You can't archive your own account");
  assertCanAssignRole(req, target, target.role);
  await assertNotLastOwner(req, target, "You can't archive the last active Owner");

  const updated = await setUser(target, { deletedAt: now() });
  await revokeUserSessions(target._id);
  await db.invites.updateMany({ userId: target._id, acceptedAt: null, revokedAt: null }, { $set: { revokedAt: now() } });
  ok(res, publicUser(updated), `${target.name} archived — restore them any time from Archived`);
});

router.post('/:id/restore', manage, async (req, res) => {
  const target = await findUser(req, req.params.id);
  if (!target.deletedAt) return ok(res, publicUser(target), `${target.name} isn't archived`);
  await assertEmailFree(target.email, target._id);
  await assertSeatAvailable(req);
  ok(res, publicUser(await setUser(target, { deletedAt: null })), `${target.name} restored`);
});

router.delete('/:id/purge', allow('Owner'), async (req, res) => {
  const target = await findUser(req, req.params.id);
  if (!target.deletedAt) throw badRequest('Archive the account before deleting it permanently');
  await db.users.deleteOne({ _id: target._id });
  await db.invites.deleteMany({ userId: target._id });
  await db.resetTokens.deleteMany({ userId: target._id });
  await revokeUserSessions(target._id);
  res.status(204).end();
});

/* ---------------- bulk ---------------- */

router.post('/bulk', manage, async (req, res) => {
  const { ids, action, role, status } = req.body ?? {};
  if (!Array.isArray(ids) || !ids.length) throw badRequest('Select at least one account', { ids: 'Select at least one account' });
  if (!['role', 'status', 'archive', 'reset-password'].includes(action)) throw badRequest('Unknown bulk action');
  if (action === 'role' && !ROLES.includes(role)) throw badRequest('Choose a role', { role: 'Choose a role' });
  if (action === 'status' && !STATUSES.includes(status)) throw badRequest('Choose a status', { status: 'Choose a status' });

  const applied = [];
  const skipped = [];

  // Sequential on purpose: each change can affect the "last Owner" check for the next.
  for (const id of [...new Set(ids.map(String))].slice(0, 500)) {
    try {
      const _id = toId(id);
      const target = _id && (await db.users.findOne({ _id, workspaceId: req.workspace._id, deletedAt: null }));
      if (!target) throw notFound('Not found');
      const self = String(target._id) === String(req.user._id);
      if (self && action !== 'reset-password') throw forbidden("Can't apply to your own account");
      assertCanAssignRole(req, target, action === 'role' ? role : target.role);

      if (action === 'role') {
        if (role !== 'Owner') await assertNotLastOwner(req, target);
        await setUser(target, { role, roleRank: roleRank(role) });
      } else if (action === 'status') {
        if (status === 'Suspended') {
          await assertNotLastOwner(req, target);
          await revokeUserSessions(target._id);
        }
        if (status === 'Active' && !target.passwordHash) throw badRequest('Invite not accepted yet');
        await setUser(target, { status });
      } else if (action === 'archive') {
        await assertNotLastOwner(req, target);
        await setUser(target, { deletedAt: now() });
        await revokeUserSessions(target._id);
      } else {
        await createResetLink(target);
      }
      applied.push(id);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      skipped.push({ id, reason: err.message });
    }
  }

  const verb = { role: `set to ${role}`, status: `set to ${status}`, archive: 'archived', 'reset-password': 'sent a reset link' }[action];
  const message =
    `${applied.length} account${applied.length === 1 ? '' : 's'} ${verb}` + (skipped.length ? ` · ${skipped.length} skipped` : '');
  ok(res, { action, applied, skipped }, message);
});

export default router;

/* ---------------- invites router ---------------- */

export const invites = Router();
invites.use(requireAuth);

invites.get('/', async (req, res) => {
  const { state = 'pending', q, role } = req.query;
  const at = new Date();
  const filter = { workspaceId: req.workspace._id, revokedAt: null };

  if (state === 'pending') Object.assign(filter, { acceptedAt: null, expiresAt: { $gte: at } });
  if (state === 'expiring') Object.assign(filter, { acceptedAt: null, expiresAt: { $gte: at, $lte: new Date(at.getTime() + 24 * 3600e3) } });
  if (state === 'accepted') filter.acceptedAt = { $ne: null };
  const needle = clean(q);
  if (needle) {
    const re = { $regex: escapeRegex(needle), $options: 'i' };
    filter.$or = [{ name: re }, { email: re }];
  }
  if (role) filter.role = String(role);

  const rows = await db.invites.find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  ok(res, rows.map(publicInvite));
});

invites.post('/', manage, async (req, res) => {
  const body = req.body ?? {};
  assertValid(
    validate(body, {
      ...userSchema(false),
      expiresInHours: [rules.int(1, 24 * 30, 'Expiry must be between 1 hour and 30 days')]
    })
  );
  const user = newInvitedUser(req, { ...body, manager: null, location: null });
  await assertEmailFree(user.email);
  assertCanAssignRole(req, null, body.role);
  await assertSeatAvailable(req);

  await db.users.insertOne(user);
  const { invite, token } = await createInviteFor(req, user, Number(body.expiresInHours) || INVITE_HOURS);

  ok(
    res,
    { invite: publicInvite(invite), inviteToken: config.env === 'production' ? undefined : token },
    `Invite sent to ${user.email}`,
    { status: 201 }
  );
});

async function findInvite(req) {
  const _id = toId(req.params.id);
  const invite = _id && (await db.invites.findOne({ _id, workspaceId: req.workspace._id, revokedAt: null }));
  if (!invite) throw notFound('Invite not found');
  return invite;
}

invites.post('/:id/resend', manage, async (req, res) => {
  const old = await findInvite(req);
  if (old.acceptedAt) throw badRequest('This invite has already been accepted');
  const user = await db.users.findOne({ _id: old.userId, deletedAt: null });
  if (!user) throw notFound('The invited account no longer exists');

  await db.invites.updateOne({ _id: old._id }, { $set: { revokedAt: now() } });
  await createInviteFor(req, user);
  ok(res, { sentTo: user.email }, `Invite re-sent to ${user.email}`);
});

invites.delete('/:id', manage, async (req, res) => {
  const invite = await findInvite(req);
  await db.invites.updateOne({ _id: invite._id }, { $set: { revokedAt: now() } });

  // An invite that was never accepted shouldn't leave a placeholder account behind.
  if (!invite.acceptedAt) {
    await db.users.updateOne({ _id: invite.userId, passwordHash: null, deletedAt: null }, { $set: { deletedAt: now() } });
  }
  res.status(204).end();
});
