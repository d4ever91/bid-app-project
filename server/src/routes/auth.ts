import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, isDuplicate, newId, now, toId } from '../db.js';
import {
  HttpError, assertValid, badRequest, bodyOf, clean, conflict, notFound, ok, rules, unauthorized, validate
} from '../http.js';
import {
  REFRESH_COOKIE, clearRefreshCookie, ctx, endSession, requireAuth, revokeUserSessions, roleRank, rotateSession, sha256,
  signAccessToken, startSession
} from '../auth.js';
import { audit, auditSignIn } from '../audit.js';
import { CYCLES, PLAN_IDS, TRIAL_DAYS, planById, seatCeiling } from '../plans.js';
import { profile, publicSession, sessionUser, sessionWorkspace } from '../serialize.js';
import {
  BID_VOLUMES, COMPANY_SIZES, COMPANY_TYPES, NOTIFICATION_PREFS, type NotificationKey, type UserDoc, type WorkspaceDoc
} from '../types.js';

const router = Router();

/* ---------------- tiny rate limiter for credential endpoints ---------------- */

const attempts = new Map<string, number[]>();
function limit(maxPerWindow: number, windowMs: number) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = req.path + '|' + (req.ip ?? 'unknown');
    const nowMs = Date.now();
    const hits = (attempts.get(key) ?? []).filter((t) => nowMs - t < windowMs);
    hits.push(nowMs);
    attempts.set(key, hits);
    if (hits.length > maxPerWindow) {
      return next(new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.'));
    }
    next();
  };
}
const credentialLimit = limit(20, 15 * 60 * 1000);

/** Live (non-archived) account using this email, in any workspace. */
export const findLiveUserByEmail = (email: string) => db.users.findOne({ email, deletedAt: null });

export const defaultNotificationPrefs = (): Record<NotificationKey, boolean> =>
  Object.fromEntries(NOTIFICATION_PREFS.map((p) => [p.key, p.default])) as Record<NotificationKey, boolean>;

const passwordRules = [rules.required('Choose a password'), rules.minLen(12, 'At least 12 characters'), rules.maxLen(128)];
const cookieToken = (req: Request): string | undefined => req.cookies?.[REFRESH_COOKIE];

/* ---------------- signup ---------------- */

router.post('/signup', credentialLimit, async (req, res) => {
  const body = bodyOf(req.body);
  const plan = planById(body.plan);

  const fields = validate(body, {
    workspace: [rules.required('Name your workspace'), rules.minLen(2), rules.maxLen(40)],
    domain: [rules.required('Your company domain is required'), rules.domain()],
    name: [rules.required('Enter your full name'), rules.minLen(2), rules.maxLen(80)],
    email: [rules.required('A work email is required'), rules.email()],
    password: passwordRules,
    plan: [rules.required('Choose a plan'), rules.oneOf(PLAN_IDS, 'Unknown plan')],
    cycle: [rules.oneOf(CYCLES, 'Choose monthly or annual')],
    seats: [rules.int(1, seatCeiling(plan), `${plan.name} allows 1 to ${seatCeiling(plan)} seats`)],
    billing: [rules.oneOf(['trial', 'paid'])],
    companyType: [rules.oneOf(COMPANY_TYPES)],
    size: [rules.oneOf(COMPANY_SIZES)]
  });

  // Answers from the "About your company" step. Optional as a whole (older clients don't
  // send it), but when present the starred questions are required.
  const company = body.company && typeof body.company === 'object' ? bodyOf(body.company) : null;
  if (company) {
    Object.assign(
      fields,
      validate(
        company,
        {
          role: [rules.required('Tell us your role'), rules.maxLen(60)],
          country: [rules.required('Where is your company based?'), rules.maxLen(60)],
          sectors: [rules.array(), rules.required('Pick at least one sector')],
          bidVolume: [rules.required('Pick a range'), rules.oneOf(BID_VOLUMES)],
          companyType: [rules.oneOf(COMPANY_TYPES)],
          size: [rules.oneOf(COMPANY_SIZES)]
        },
        'company.'
      )
    );
  }

  const email = clean(body.email).toLowerCase();
  const domain = clean(body.domain).toLowerCase();
  if (!fields.email && (await findLiveUserByEmail(email))) {
    fields.email = 'An account with this email already exists — sign in instead';
  }
  const domainTaken = 'A workspace for this domain already exists — ask its owner for an invite';
  if (!fields.domain && (await db.workspaces.findOne({ domain }))) fields.domain = domainTaken;
  assertValid(fields, 'Some details need fixing before we can create your workspace');

  const createdAt = now();
  const cycle = body.cycle === 'monthly' ? 'monthly' : 'annual';
  const seats = Number(body.seats ?? 10);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 864e5);
  const companyType = clean(company?.companyType ?? body.companyType) || 'Other';
  const size = clean(company?.size ?? body.size) || null;

  const workspace: WorkspaceDoc = {
    _id: newId(),
    name: clean(body.workspace),
    domain,
    companyType,
    size,
    company: company
      ? {
          companyType,
          size,
          role: clean(company.role),
          country: clean(company.country),
          sectors: (Array.isArray(company.sectors) ? company.sectors : []).map(clean).filter(Boolean).slice(0, 20),
          bidVolume: clean(company.bidVolume)
        }
      : null,
    plan: plan.id,
    cycle,
    seatsLicensed: seats,
    // No payment provider is wired up, so a "paid" signup also starts on the trial.
    subscriptionStatus: 'trialing',
    trialEndsAt,
    renewsAt: trialEndsAt,
    billingEmail: email,
    billing: { cardLabel: null, cardExpiry: null, address: null, vatNumber: null },
    usage: { periodStart: createdAt, aiQueries: 0, scimRuns: 0 },
    createdAt
  };

  const user: UserDoc = {
    _id: newId(),
    workspaceId: workspace._id,
    name: clean(body.name),
    email,
    passwordHash: await bcrypt.hash(String(body.password), 10),
    role: 'Owner',
    roleRank: roleRank('Owner'),
    team: 'Leadership',
    status: 'Active',
    location: company?.country ? clean(company.country) : null,
    manager: null,
    jobTitle: company?.role ? clean(company.role) : null,
    timezone: 'Europe/London',
    notificationPrefs: defaultNotificationPrefs(),
    requireMfa: true,
    mfaEnrolledAt: null,
    mfaMethod: null,
    recoveryCodesLeft: null,
    passwordChangedAt: createdAt,
    lastSeenAt: createdAt,
    createdAt,
    deletedAt: null
  };

  try {
    await db.workspaces.insertOne(workspace);
  } catch (err) {
    // Two signups for the same domain at once — the unique index decides.
    if (isDuplicate(err)) throw badRequest('Some details need fixing before we can create your workspace', { domain: domainTaken });
    throw err;
  }
  await db.users.insertOne(user);

  const accessToken = await startSession(req, res, user);
  await audit(req, { kind: 'auth', text: `Created workspace ${workspace.name} (${plan.name} trial)`, actor: user, userId: user._id, workspaceId: workspace._id });
  await auditSignIn(req, user);

  ok(
    res,
    { accessToken, user: sessionUser(user), workspace: sessionWorkspace(workspace), checkoutUrl: null },
    body.billing === 'paid'
      ? `Workspace created. Online payment isn't set up yet, so ${workspace.name} starts on a ${TRIAL_DAYS}-day ${plan.name} trial.`
      : `Workspace created — ${TRIAL_DAYS}-day ${plan.name} trial started`,
    { status: 201 }
  );
});

/* ---------------- login / session ---------------- */

router.post('/login', credentialLimit, async (req, res) => {
  const body = bodyOf(req.body);
  assertValid(
    validate(body, {
      email: [rules.required('Enter your work email'), rules.email()],
      password: [rules.required('Enter your password')]
    })
  );

  const email = clean(body.email).toLowerCase();
  const user = await findLiveUserByEmail(email);
  const valid = user?.passwordHash ? await bcrypt.compare(String(body.password), user.passwordHash) : false;

  if (!user || !valid) {
    if (user && !user.passwordHash && user.status === 'Invited') {
      throw new HttpError(403, 'INVITE_PENDING', 'This account has a pending invite — use the link in your invite email to set a password.');
    }
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  if (user.status === 'Suspended') {
    throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact your workspace admin.');
  }

  await db.users.updateOne({ _id: user._id }, { $set: { lastSeenAt: now() } });
  const accessToken = await startSession(req, res, user);
  await auditSignIn(req, user);
  ok(res, { accessToken, user: sessionUser(user) }, 'Signed in');
});

router.post('/refresh', async (req, res) => {
  const session = await rotateSession(req, res, cookieToken(req));
  const user = session && (await db.users.findOne({ _id: session.userId, deletedAt: null, status: { $ne: 'Suspended' } }));
  if (!user) {
    if (session) await db.sessions.deleteOne({ _id: session._id });
    clearRefreshCookie(res);
    throw unauthorized('No active session');
  }
  await db.users.updateOne({ _id: user._id }, { $set: { lastSeenAt: now() } });
  ok(res, { accessToken: signAccessToken(user) });
});

router.post('/logout', async (req, res) => {
  await endSession(cookieToken(req));
  clearRefreshCookie(res);
  ok(res, null, 'Signed out');
});

router.get('/me', requireAuth, (req, res) => {
  const { user, workspace } = ctx(req);
  ok(res, { user: sessionUser(user), workspace: sessionWorkspace(workspace) });
});

/* ---------------- your profile ---------------- */

const activeSessions = (user: UserDoc) => db.sessions.countDocuments({ userId: user._id, expiresAt: { $gt: now() } });

router.get('/profile', requireAuth, async (req, res) => {
  const { user, workspace } = ctx(req);
  ok(res, profile(user, workspace, await activeSessions(user)));
});

const TIMEZONES = ['Europe/London', 'Europe/Stockholm', 'America/New_York', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai', 'Australia/Sydney'];

router.patch('/profile', requireAuth, async (req, res) => {
  const { user, workspace } = ctx(req);
  const body = bodyOf(req.body);
  assertValid(
    validate(body, {
      name: [rules.minLen(2), rules.maxLen(80)],
      email: [rules.email()],
      jobTitle: [rules.maxLen(80)],
      timezone: [rules.oneOf(TIMEZONES, 'Choose a timezone from the list')]
    })
  );

  const set: Partial<UserDoc> = {};
  if (clean(body.name)) set.name = clean(body.name);
  if (body.jobTitle !== undefined) set.jobTitle = clean(body.jobTitle) || null;
  if (clean(body.timezone)) set.timezone = clean(body.timezone);
  if (clean(body.email) && clean(body.email).toLowerCase() !== user.email) {
    const email = clean(body.email).toLowerCase();
    if (await findLiveUserByEmail(email)) throw conflict('That email is already in use', { email: 'Another account already uses this email' });
    set.email = email;
  }

  const updated = await db.users.findOneAndUpdate({ _id: user._id }, { $set: { ...set, updatedAt: now() } }, { returnDocument: 'after' });
  if (!updated) throw notFound('Account not found');
  if (Object.keys(set).length) await audit(req, { kind: 'user', text: 'Updated their profile', userId: user._id });
  ok(res, profile(updated, workspace, await activeSessions(updated)), 'Profile saved');
});

router.patch('/profile/notifications', requireAuth, async (req, res) => {
  const { user, workspace } = ctx(req);
  const body = bodyOf(req.body);
  const keys = NOTIFICATION_PREFS.map((p) => p.key) as string[];
  assertValid(
    validate(body, {
      key: [rules.required('Which notification?'), rules.oneOf(keys, 'Unknown notification')],
      on: [rules.boolean()]
    })
  );
  const updated = await db.users.findOneAndUpdate(
    { _id: user._id },
    { $set: { [`notificationPrefs.${String(body.key)}`]: body.on === true, updatedAt: now() } },
    { returnDocument: 'after' }
  );
  if (!updated) throw notFound('Account not found');
  ok(res, profile(updated, workspace, await activeSessions(updated)), 'Notification preferences saved');
});

/** Sends the signed-in user a password reset link (the "Change password" button). */
router.post('/profile/password-reset', requireAuth, async (req, res) => {
  const { user } = ctx(req);
  await createResetLink(user);
  await audit(req, { kind: 'auth', text: 'Requested a password reset link', userId: user._id });
  ok(res, { sentTo: user.email }, `Password reset link sent to ${user.email}`);
});

/* ---------------- your sessions (devices) ---------------- */

router.get('/sessions', requireAuth, async (req, res) => {
  const { user } = ctx(req);
  const token = cookieToken(req);
  const rows = await db.sessions.find({ userId: user._id, expiresAt: { $gt: now() } }).sort({ lastUsedAt: -1 }).limit(50).toArray();
  ok(res, rows.map((s) => publicSession(s, token ? sha256(token) : null)));
});

router.delete('/sessions/others', requireAuth, async (req, res) => {
  const { user } = ctx(req);
  const token = cookieToken(req);
  const { deletedCount } = await db.sessions.deleteMany({ userId: user._id, ...(token ? { hash: { $ne: sha256(token) } } : {}) });
  if (deletedCount) await audit(req, { kind: 'auth', text: `Signed out of ${deletedCount} other session${deletedCount === 1 ? '' : 's'}`, userId: user._id });
  ok(res, { signedOut: deletedCount }, deletedCount ? `Signed out of ${deletedCount} other session${deletedCount === 1 ? '' : 's'}` : 'No other sessions to sign out');
});

router.delete('/sessions/:id', requireAuth, async (req, res) => {
  const { user } = ctx(req);
  const _id = toId(req.params.id);
  const removed = _id && (await db.sessions.findOneAndDelete({ _id, userId: user._id }));
  if (!removed) throw notFound('Session not found');
  await audit(req, { kind: 'auth', text: `Signed out ${removed.device}`, userId: user._id });
  ok(res, null, `Signed out ${removed.device}`);
});

/* ---------------- invites & password reset (token links) ---------------- */

/** Sets a password for an invited user and signs them in. */
router.post('/accept-invite', credentialLimit, async (req, res) => {
  const body = bodyOf(req.body);
  assertValid(validate(body, { token: [rules.required('Invite token is missing')], password: passwordRules }));

  const invite = await db.invites.findOne({ tokenHash: sha256(String(body.token)), revokedAt: null });
  if (!invite || invite.acceptedAt) throw badRequest('This invite link is invalid or has already been used');
  if (invite.expiresAt < now()) throw badRequest('This invite has expired — ask an admin to resend it');

  const user = await db.users.findOne({ _id: invite.userId, deletedAt: null });
  if (!user) throw badRequest('This invite is no longer valid');

  const at = now();
  const set: Partial<UserDoc> = {
    passwordHash: await bcrypt.hash(String(body.password), 10),
    passwordChangedAt: at,
    status: 'Active',
    lastSeenAt: at,
    ...(clean(body.name) ? { name: clean(body.name) } : {})
  };
  await db.users.updateOne({ _id: user._id }, { $set: set });
  await db.invites.updateOne({ _id: invite._id }, { $set: { acceptedAt: at } });
  const updated: UserDoc = { ...user, ...set };

  const workspace = await db.workspaces.findOne({ _id: user.workspaceId });
  const accessToken = await startSession(req, res, updated);
  await audit(req, { kind: 'invite', text: 'Accepted their invite', actor: updated, userId: updated._id, workspaceId: updated.workspaceId });
  await auditSignIn(req, updated);
  ok(res, { accessToken, user: sessionUser(updated) }, 'Welcome to ' + (workspace?.name ?? 'the workspace'));
});

router.post('/reset-password', credentialLimit, async (req, res) => {
  const body = bodyOf(req.body);
  assertValid(validate(body, { token: [rules.required('Reset token is missing')], password: passwordRules }));

  // Single use: claim the token atomically before changing anything.
  const row = await db.resetTokens.findOneAndUpdate(
    { hash: sha256(String(body.token)), usedAt: null, expiresAt: { $gt: now() } },
    { $set: { usedAt: now() } }
  );
  if (!row) throw badRequest('This reset link is invalid or has expired');
  const user = await db.users.findOne({ _id: row.userId, deletedAt: null });
  if (!user) throw badRequest('This reset link is no longer valid');

  await db.users.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await bcrypt.hash(String(body.password), 10),
        passwordChangedAt: now(),
        ...(user.status === 'Invited' ? { status: 'Active' as const } : {})
      }
    }
  );
  await revokeUserSessions(user._id);
  await audit(req, { kind: 'auth', text: 'Reset their password', actor: user, userId: user._id, workspaceId: user.workspaceId });
  ok(res, null, 'Password updated — sign in with your new password');
});

export default router;

/* ---------------- helpers shared with the users/invites routes ---------------- */

export async function createResetLink(user: UserDoc): Promise<{ token: string; link: string }> {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.resetTokens.insertOne({
    _id: newId(),
    userId: user._id,
    hash: sha256(token),
    createdAt: now(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    usedAt: null
  });
  const link = `${config.appUrl}/?reset=${token}`;
  // No mail provider is configured — log the link so it can be used locally.
  console.log(`[mail] Password reset for ${user.email}: ${link}`);
  return { token, link };
}
