import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import type { Filter, ObjectId, Sort } from 'mongodb';
import { config } from '../config.js';
import { db, escapeRegex, newId, now, toId } from '../db.js';
import {
  HttpError, assertValid, badRequest, bodyOf, clean, conflict, forbidden, notFound, ok, pageMeta, paging, q, rules, validate,
  type Schema
} from '../http.js';
import { allow, ctx, requireAuth, revokeUserSessions, roleRank, sha256 } from '../auth.js';
import { audit } from '../audit.js';
import { publicEvent, publicInvite, publicUser } from '../serialize.js';
import { createResetLink, defaultNotificationPrefs, findLiveUserByEmail } from './auth.js';
import { ROLES, STATUSES, type InviteDoc, type Role, type Status, type UserDoc } from '../types.js';

const INVITE_HOURS = 72;
const manage = allow('Owner', 'Admin');

const router = Router();
router.use(requireAuth);

/* ---------------- helpers ---------------- */

const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);
const isStatus = (v: unknown): v is Status => STATUSES.includes(v as Status);
const same = (a: ObjectId, b: ObjectId) => a.equals(b);

async function findUser(req: Request, id: unknown, { includeArchived = true } = {}): Promise<UserDoc> {
  const { workspace } = ctx(req);
  const _id = toId(id);
  const user = _id && (await db.users.findOne({ _id, workspaceId: workspace._id }));
  if (!user || (!includeArchived && user.deletedAt)) throw notFound('User not found');
  return user;
}

const otherActiveOwners = (req: Request, exceptId: ObjectId) =>
  db.users.countDocuments({
    workspaceId: ctx(req).workspace._id,
    _id: { $ne: exceptId },
    role: 'Owner',
    deletedAt: null,
    status: { $ne: 'Suspended' }
  });

/** Seats count every non-archived account, invited ones included. */
export const seatsUsed = (workspaceId: ObjectId) => db.users.countDocuments({ workspaceId, deletedAt: null });

async function assertSeatAvailable(req: Request): Promise<void> {
  const { workspace } = ctx(req);
  if ((await seatsUsed(workspace._id)) >= workspace.seatsLicensed) {
    throw new HttpError(
      409,
      'SEAT_LIMIT',
      `All ${workspace.seatsLicensed} licensed seats are in use. Add seats from Subscription, or archive an account first.`
    );
  }
}

/** Only an Owner may create, promote to, or demote from Owner. */
function assertCanAssignRole(req: Request, target: UserDoc | null, nextRole: Role): void {
  if ((nextRole === 'Owner' || target?.role === 'Owner') && ctx(req).user.role !== 'Owner') {
    throw forbidden('Only an Owner can grant or remove the Owner role');
  }
}

async function assertNotLastOwner(req: Request, target: UserDoc, message?: string): Promise<void> {
  if (target.role === 'Owner' && (await otherActiveOwners(req, target._id)) === 0) {
    throw conflict(message ?? 'The workspace needs at least one active Owner');
  }
}

async function assertEmailFree(email: string, exceptId?: ObjectId): Promise<void> {
  const existing = await findLiveUserByEmail(email);
  if (existing && !(exceptId && same(existing._id, exceptId))) {
    throw conflict('That email is already in use', { email: 'Another account already uses this email' });
  }
}

export async function createInviteFor(req: Request, user: UserDoc, expiresInHours = INVITE_HOURS) {
  const { user: me, workspace } = ctx(req);
  const token = crypto.randomBytes(32).toString('base64url');
  const invite: InviteDoc = {
    _id: newId(),
    workspaceId: workspace._id,
    userId: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    team: user.team,
    tokenHash: sha256(token),
    invitedBy: me._id,
    expiresAt: new Date(Date.now() + expiresInHours * 3600e3),
    acceptedAt: null,
    revokedAt: null,
    createdAt: now()
  };
  await db.invites.insertOne(invite);
  const link = `${config.appUrl}/?invite=${token}`;
  console.log(`[mail] Invite for ${user.email} (${workspace.name}): ${link}`);
  return { invite, token, link };
}

function newInvitedUser(req: Request, body: Record<string, unknown>): UserDoc {
  const role = body.role as Role;
  return {
    _id: newId(),
    workspaceId: ctx(req).workspace._id,
    name: clean(body.name),
    email: clean(body.email).toLowerCase(),
    passwordHash: null,
    role,
    roleRank: roleRank(role),
    team: clean(body.team),
    status: 'Invited',
    manager: clean(body.manager) || null,
    location: clean(body.location) || null,
    jobTitle: null,
    timezone: 'Europe/London',
    notificationPrefs: defaultNotificationPrefs(),
    requireMfa: body.requireMfa !== false,
    mfaEnrolledAt: null,
    mfaMethod: null,
    recoveryCodesLeft: null,
    passwordChangedAt: null,
    lastSeenAt: null,
    createdAt: now(),
    deletedAt: null
  };
}

/** Applies $set and returns the updated document. */
async function setUser(user: UserDoc, set: Partial<UserDoc>): Promise<UserDoc> {
  const updated = await db.users.findOneAndUpdate({ _id: user._id }, { $set: { ...set, updatedAt: now() } }, { returnDocument: 'after' });
  if (!updated) throw notFound('User not found');
  return updated;
}

const SORTS: Record<string, Sort> = {
  name: { name: 1, _id: 1 },
  role: { roleRank: 1, name: 1, _id: 1 },
  team: { team: 1, name: 1, _id: 1 },
  // Oldest password first — the audit view wants the stalest credentials on top.
  passwordAge: { passwordChangedAt: 1, name: 1, _id: 1 }
};

/* ---------------- reads ---------------- */

router.get('/', async (req, res) => {
  const { workspace } = ctx(req);
  const role = q(req.query.role);
  const team = q(req.query.team);
  const status = q(req.query.status);
  const mfa = q(req.query.mfa);
  const archived = q(req.query.archived) || 'exclude';
  const filter: Filter<UserDoc> = { workspaceId: workspace._id };

  if (archived === 'exclude') filter.deletedAt = null;
  if (archived === 'only') filter.deletedAt = { $ne: null };
  const needle = q(req.query.q);
  if (needle) {
    const re = { $regex: escapeRegex(needle), $options: 'i' };
    filter.$or = [{ name: re }, { email: re }, { team: re }, { location: re }];
  }
  if (isRole(role)) filter.role = role;
  if (team) filter.team = team;
  if (isStatus(status)) filter.status = status;
  if (mfa === 'enrolled') filter.mfaEnrolledAt = { $ne: null };
  if (mfa === 'pending') Object.assign(filter, { mfaEnrolledAt: null, status: 'Invited' });
  if (mfa === 'missing') Object.assign(filter, { mfaEnrolledAt: null, status: isStatus(status) && status !== 'Invited' ? status : { $ne: 'Invited' } });

  const { page, limit } = paging(req.query);
  const [total, rows] = await Promise.all([
    db.users.countDocuments(filter),
    db.users.find(filter).sort(SORTS[q(req.query.sort)] ?? SORTS.name).skip((page - 1) * limit).limit(limit).toArray()
  ]);
  ok(res, rows.map(publicUser), null, { meta: pageMeta(page, limit, total) });
});

router.get('/facets', async (req, res) => {
  const { workspace } = ctx(req);
  const live: Filter<UserDoc> = { workspaceId: workspace._id, deletedAt: null };
  const [teams, roles, statuses, total, mfaMissing, archived] = await Promise.all([
    db.users.distinct('team', live),
    Promise.all(ROLES.map(async (value) => ({ value, count: await db.users.countDocuments({ ...live, role: value }) }))),
    Promise.all(STATUSES.map(async (value) => ({ value, count: await db.users.countDocuments({ ...live, status: value }) }))),
    db.users.countDocuments(live),
    db.users.countDocuments({ ...live, mfaEnrolledAt: null, status: { $ne: 'Invited' } }),
    db.users.countDocuments({ workspaceId: workspace._id, deletedAt: { $ne: null } })
  ]);
  ok(res, { teams: (teams as string[]).filter(Boolean).sort(), roles, statuses, total, mfaMissing, archived });
});

router.get('/:id', async (req, res) => {
  ok(res, publicUser(await findUser(req, req.params.id)));
});

/**
 * Recent audit events about this account, or done by it. Sign-ins are frequent, so only the
 * latest one is included — otherwise they would crowd out the changes that matter.
 */
router.get('/:id/activity', async (req, res) => {
  const target = await findUser(req, req.params.id);
  const limit = Math.min(50, Number(q(req.query.limit)) || 10);
  const mine = { workspaceId: target.workspaceId, $or: [{ userId: target._id }, { actorId: target._id }] };
  const [lastSignIn, changes] = await Promise.all([
    db.auditEvents.find({ ...mine, kind: 'signin' }).sort({ at: -1 }).limit(1).toArray(),
    db.auditEvents.find({ ...mine, kind: { $ne: 'signin' } }).sort({ at: -1 }).limit(limit).toArray()
  ]);
  const rows = [...lastSignIn, ...changes].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
  ok(res, rows.map(publicEvent));
});

/* ---------------- writes ---------------- */

const userSchema = (partial: boolean): Schema => ({
  name: [...(partial ? [] : [rules.required('Enter a name')]), rules.minLen(2), rules.maxLen(80)],
  email: [...(partial ? [] : [rules.required('Enter an email address')]), rules.email()],
  role: [...(partial ? [] : [rules.required('Choose a role')]), rules.oneOf(ROLES, 'Unknown role')],
  team: [...(partial ? [] : [rules.required('Choose a team')]), rules.maxLen(60)],
  manager: [rules.maxLen(80)],
  location: [rules.maxLen(80)]
});

router.post('/', manage, async (req, res) => {
  const body = bodyOf(req.body);
  assertValid(validate(body, userSchema(false)));
  const user = newInvitedUser(req, body);
  await assertEmailFree(user.email);
  assertCanAssignRole(req, null, user.role);
  await assertSeatAvailable(req);

  await db.users.insertOne(user);
  // Every new account needs a way in; "sendInvite: false" just means the admin shares the link.
  const { token } = await createInviteFor(req, user);
  await audit(req, { kind: 'invite', text: `Invited ${user.email} as ${user.role} (${user.team})`, userId: user._id });

  ok(
    res,
    { user: publicUser(user), inviteToken: config.env === 'production' ? undefined : token },
    body.sendInvite === false ? `${user.name} added — share their set-up link` : `Invite sent to ${user.email} · role ${user.role}`,
    { status: 201 }
  );
});

router.patch('/:id', async (req, res) => {
  const { user: me } = ctx(req);
  const target = await findUser(req, req.params.id, { includeArchived: false });
  const self = same(target._id, me._id);
  if (!self && !['Owner', 'Admin'].includes(me.role)) throw forbidden('You can only edit your own profile');

  const body = bodyOf(req.body);
  const allowed = ['name', 'email', 'team', 'manager', 'location'];
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  assertValid(validate(patch, userSchema(true)));

  const set: Partial<UserDoc> = {};
  if (patch.email !== undefined) {
    set.email = clean(patch.email).toLowerCase();
    await assertEmailFree(set.email, target._id);
  }
  if (patch.name !== undefined) set.name = clean(patch.name) || target.name;
  if (patch.team !== undefined) set.team = clean(patch.team) || target.team;
  if (patch.manager !== undefined) set.manager = clean(patch.manager) || null;
  if (patch.location !== undefined) set.location = clean(patch.location) || null;

  const updated = await setUser(target, set);
  await audit(req, { kind: 'user', text: self ? 'Updated their profile' : `Updated profile for ${target.email}`, userId: target._id });
  ok(res, publicUser(updated), 'Profile updated');
});

router.patch('/:id/role', manage, async (req, res) => {
  const { user: me } = ctx(req);
  const target = await findUser(req, req.params.id, { includeArchived: false });
  const role = bodyOf(req.body).role;
  assertValid(validate({ role }, { role: [rules.required('Choose a role'), rules.oneOf(ROLES, 'Unknown role')] }));
  if (!isRole(role)) throw badRequest('Unknown role');
  if (same(target._id, me._id)) throw forbidden("You can't change your own role — ask another Owner");
  assertCanAssignRole(req, target, role);
  if (role !== 'Owner') await assertNotLastOwner(req, target);

  const from = target.role;
  const updated = await setUser(target, { role, roleRank: roleRank(role) });
  if (from !== role) await audit(req, { kind: 'role', text: `Changed role for ${target.email} from ${from} to ${role}`, userId: target._id });
  ok(res, publicUser(updated), from === role ? `${target.name} is already ${role}` : `${target.name}: ${from} → ${role}`);
});

router.patch('/:id/status', manage, async (req, res) => {
  const { user: me } = ctx(req);
  const target = await findUser(req, req.params.id, { includeArchived: false });
  const status = bodyOf(req.body).status;
  assertValid(validate({ status }, { status: [rules.required('Choose a status'), rules.oneOf(STATUSES, 'Unknown status')] }));
  if (!isStatus(status)) throw badRequest('Unknown status');
  if (same(target._id, me._id)) throw forbidden("You can't change your own status");
  assertCanAssignRole(req, target, target.role);
  if (status === 'Suspended') {
    await assertNotLastOwner(req, target, "You can't suspend the last active Owner");
    await revokeUserSessions(target._id);
  }
  if (status === 'Active' && !target.passwordHash) {
    throw badRequest(`${target.name} hasn't accepted their invite yet — resend it instead`);
  }
  const updated = await setUser(target, { status });
  if (target.status !== status) {
    const verb = status === 'Suspended' ? 'Suspended' : status === 'Active' ? 'Reactivated' : 'Set to invited:';
    await audit(req, { kind: 'status', text: `${verb} ${target.email}`, userId: target._id });
  }
  ok(res, publicUser(updated), `${target.name} is now ${status.toLowerCase()}`);
});

router.post('/:id/reset-password', manage, async (req, res) => {
  const target = await findUser(req, req.params.id, { includeArchived: false });
  assertCanAssignRole(req, target, target.role);
  await createResetLink(target);
  await audit(req, { kind: 'auth', text: `Sent password reset to ${target.email}`, userId: target._id });
  ok(res, { sentTo: target.email }, `Password reset link sent to ${target.email}`);
});

router.delete('/:id', manage, async (req, res) => {
  const { user: me } = ctx(req);
  const target = await findUser(req, req.params.id, { includeArchived: false });
  if (same(target._id, me._id)) throw forbidden("You can't archive your own account");
  assertCanAssignRole(req, target, target.role);
  await assertNotLastOwner(req, target, "You can't archive the last active Owner");

  const updated = await setUser(target, { deletedAt: now() });
  await revokeUserSessions(target._id);
  await db.invites.updateMany({ userId: target._id, acceptedAt: null, revokedAt: null }, { $set: { revokedAt: now() } });
  await audit(req, { kind: 'status', text: `Archived ${target.email}`, userId: target._id });
  ok(res, publicUser(updated), `${target.name} archived — restore them any time from Archived`);
});

router.post('/:id/restore', manage, async (req, res) => {
  const target = await findUser(req, req.params.id);
  if (!target.deletedAt) return ok(res, publicUser(target), `${target.name} isn't archived`);
  await assertEmailFree(target.email, target._id);
  await assertSeatAvailable(req);
  const updated = await setUser(target, { deletedAt: null });
  await audit(req, { kind: 'status', text: `Restored ${target.email}`, userId: target._id });
  ok(res, publicUser(updated), `${target.name} restored`);
});

router.delete('/:id/purge', allow('Owner'), async (req, res) => {
  const target = await findUser(req, req.params.id);
  if (!target.deletedAt) throw badRequest('Archive the account before deleting it permanently');
  await db.users.deleteOne({ _id: target._id });
  await db.invites.deleteMany({ userId: target._id });
  await db.resetTokens.deleteMany({ userId: target._id });
  await revokeUserSessions(target._id);
  await audit(req, { kind: 'status', text: `Permanently deleted ${target.email}` });
  res.status(204).end();
});

/* ---------------- bulk ---------------- */

router.post('/bulk', manage, async (req, res) => {
  const { user: me, workspace } = ctx(req);
  const { ids, action, role, status } = bodyOf(req.body);
  if (!Array.isArray(ids) || !ids.length) throw badRequest('Select at least one account', { ids: 'Select at least one account' });
  if (!['role', 'status', 'archive', 'reset-password'].includes(String(action))) throw badRequest('Unknown bulk action');
  if (action === 'role' && !isRole(role)) throw badRequest('Choose a role', { role: 'Choose a role' });
  if (action === 'status' && !isStatus(status)) throw badRequest('Choose a status', { status: 'Choose a status' });

  const applied: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  // Sequential on purpose: each change can affect the "last Owner" check for the next.
  for (const id of [...new Set(ids.map(String))].slice(0, 500)) {
    try {
      const _id = toId(id);
      const target = _id && (await db.users.findOne({ _id, workspaceId: workspace._id, deletedAt: null }));
      if (!target) throw notFound('Not found');
      if (same(target._id, me._id) && action !== 'reset-password') throw forbidden("Can't apply to your own account");

      if (action === 'role' && isRole(role)) {
        assertCanAssignRole(req, target, role);
        if (role !== 'Owner') await assertNotLastOwner(req, target);
        await setUser(target, { role, roleRank: roleRank(role) });
        await audit(req, { kind: 'role', text: `Changed role for ${target.email} from ${target.role} to ${role}`, userId: target._id });
      } else if (action === 'status' && isStatus(status)) {
        assertCanAssignRole(req, target, target.role);
        if (status === 'Suspended') {
          await assertNotLastOwner(req, target);
          await revokeUserSessions(target._id);
        }
        if (status === 'Active' && !target.passwordHash) throw badRequest('Invite not accepted yet');
        await setUser(target, { status });
        await audit(req, { kind: 'status', text: `${status === 'Suspended' ? 'Suspended' : 'Set status of'} ${target.email}${status === 'Suspended' ? '' : ' to ' + status}`, userId: target._id });
      } else if (action === 'archive') {
        assertCanAssignRole(req, target, target.role);
        await assertNotLastOwner(req, target);
        await setUser(target, { deletedAt: now() });
        await revokeUserSessions(target._id);
        await audit(req, { kind: 'status', text: `Archived ${target.email}`, userId: target._id });
      } else {
        assertCanAssignRole(req, target, target.role);
        await createResetLink(target);
        await audit(req, { kind: 'auth', text: `Sent password reset to ${target.email}`, userId: target._id });
      }
      applied.push(id);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      skipped.push({ id, reason: err.message });
    }
  }

  const verbs: Record<string, string> = { role: `set to ${role}`, status: `set to ${status}`, archive: 'archived', 'reset-password': 'sent a reset link' };
  const message =
    `${applied.length} account${applied.length === 1 ? '' : 's'} ${verbs[String(action)]}` + (skipped.length ? ` · ${skipped.length} skipped` : '');
  ok(res, { action, applied, skipped }, message);
});

export default router;

/* ---------------- invites router ---------------- */

export const invites = Router();
invites.use(requireAuth);

invites.get('/', async (req, res) => {
  const { workspace } = ctx(req);
  const state = q(req.query.state) || 'pending';
  const at = now();
  const filter: Filter<InviteDoc> = { workspaceId: workspace._id, revokedAt: null };

  if (state === 'pending') Object.assign(filter, { acceptedAt: null, expiresAt: { $gte: at } });
  if (state === 'expiring') Object.assign(filter, { acceptedAt: null, expiresAt: { $gte: at, $lte: new Date(at.getTime() + 24 * 3600e3) } });
  if (state === 'accepted') filter.acceptedAt = { $ne: null };
  const needle = q(req.query.q);
  if (needle) {
    const re = { $regex: escapeRegex(needle), $options: 'i' };
    filter.$or = [{ name: re }, { email: re }];
  }
  const role = q(req.query.role);
  if (isRole(role)) filter.role = role;

  const rows = await db.invites.find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  ok(res, rows.map(publicInvite));
});

invites.post('/', manage, async (req, res) => {
  const body = bodyOf(req.body);
  assertValid(
    validate(body, {
      ...userSchema(false),
      expiresInHours: [rules.int(1, 24 * 30, 'Expiry must be between 1 hour and 30 days')]
    })
  );
  const user = newInvitedUser(req, { ...body, manager: null, location: null });
  await assertEmailFree(user.email);
  assertCanAssignRole(req, null, user.role);
  await assertSeatAvailable(req);

  await db.users.insertOne(user);
  const { invite, token } = await createInviteFor(req, user, Number(body.expiresInHours) || INVITE_HOURS);
  await audit(req, { kind: 'invite', text: `Invited ${user.email} as ${user.role} (${user.team})`, userId: user._id });

  ok(
    res,
    { invite: publicInvite(invite), inviteToken: config.env === 'production' ? undefined : token },
    `Invite sent to ${user.email}`,
    { status: 201 }
  );
});

async function findInvite(req: Request): Promise<InviteDoc> {
  const _id = toId(req.params.id);
  const invite = _id && (await db.invites.findOne({ _id, workspaceId: ctx(req).workspace._id, revokedAt: null }));
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
  await audit(req, { kind: 'invite', text: `Re-sent invite to ${user.email}`, userId: user._id });
  ok(res, { sentTo: user.email }, `Invite re-sent to ${user.email}`);
});

invites.delete('/:id', manage, async (req, res) => {
  const invite = await findInvite(req);
  await db.invites.updateOne({ _id: invite._id }, { $set: { revokedAt: now() } });

  // An invite that was never accepted shouldn't leave a placeholder account behind.
  if (!invite.acceptedAt) {
    await db.users.updateOne({ _id: invite.userId, passwordHash: null, deletedAt: null }, { $set: { deletedAt: now() } });
  }
  await audit(req, { kind: 'invite', text: `Revoked invite for ${invite.email}`, userId: invite.userId });
  res.status(204).end();
});
