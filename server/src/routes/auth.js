import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, newId, now, save } from '../db.js';
import {
  HttpError, assertValid, badRequest, clean, ok, rules, unauthorized, validate
} from '../http.js';
import {
  REFRESH_COOKIE, clearRefreshCookie, consumeRefreshToken, requireAuth, revokeUserSessions, sha256, signAccessToken,
  issueRefreshToken, startSession
} from '../auth.js';
import { CYCLES, PLAN_IDS, TRIAL_DAYS, planById, seatCeiling } from '../plans.js';
import { sessionUser, sessionWorkspace } from '../serialize.js';

export const COMPANY_TYPES = ['Consultancy', 'Contractor', 'Agency', 'Public sector', 'Other'];
export const COMPANY_SIZES = ['1–50', '51–200', '201–500', '500+'];
export const BID_VOLUMES = ['1–10', '11–50', '51–200', '200+'];

const router = Router();

/* ---------------- tiny rate limiter for credential endpoints ---------------- */

const attempts = new Map();
function limit(maxPerWindow, windowMs) {
  return (req, _res, next) => {
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

const emailTaken = (email) => db.users.some((u) => u.email === email && !u.deletedAt);

/* ---------------- signup ---------------- */

router.post('/signup', credentialLimit, async (req, res) => {
  const body = req.body ?? {};
  const plan = planById(body.plan);

  const fields = validate(body, {
    workspace: [rules.required('Name your workspace'), rules.minLen(2), rules.maxLen(40)],
    domain: [rules.required('Your company domain is required'), rules.domain()],
    name: [rules.required('Enter your full name'), rules.minLen(2), rules.maxLen(80)],
    email: [rules.required('A work email is required'), rules.email()],
    password: [rules.required('Choose a password'), rules.minLen(12, 'At least 12 characters'), rules.maxLen(128)],
    plan: [rules.required('Choose a plan'), rules.oneOf(PLAN_IDS, 'Unknown plan')],
    cycle: [rules.oneOf(CYCLES, 'Choose monthly or annual')],
    seats: [rules.int(1, seatCeiling(plan), `${plan.name} allows 1 to ${seatCeiling(plan)} seats`)],
    billing: [rules.oneOf(['trial', 'paid'])],
    companyType: [rules.oneOf(COMPANY_TYPES)],
    size: [rules.oneOf(COMPANY_SIZES)]
  });

  // Answers from the "About your company" step. Optional as a whole (older clients don't
  // send it), but when present the starred questions are required.
  const company = body.company && typeof body.company === 'object' ? body.company : null;
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
  if (!fields.email && emailTaken(email)) fields.email = 'An account with this email already exists — sign in instead';
  if (!fields.domain && db.workspaces.some((w) => w.domain === domain)) {
    fields.domain = 'A workspace for this domain already exists — ask its owner for an invite';
  }
  assertValid(fields, 'Some details need fixing before we can create your workspace');

  const createdAt = now();
  const cycle = body.cycle ?? 'annual';
  const seats = Number(body.seats ?? 10);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 864e5).toISOString();
  const paidRequested = body.billing === 'paid';

  const workspace = {
    id: newId(),
    name: clean(body.workspace),
    domain,
    companyType: company?.companyType ?? body.companyType ?? 'Other',
    size: company?.size ?? body.size ?? null,
    company: company
      ? {
          companyType: company.companyType ?? body.companyType ?? null,
          size: company.size ?? body.size ?? null,
          role: clean(company.role),
          country: clean(company.country),
          sectors: (company.sectors ?? []).map(clean).filter(Boolean).slice(0, 20),
          bidVolume: company.bidVolume
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
    createdAt
  };

  const user = {
    id: newId(),
    workspaceId: workspace.id,
    name: clean(body.name),
    email,
    passwordHash: await bcrypt.hash(String(body.password), 10),
    role: 'Owner',
    team: 'Leadership',
    status: 'Active',
    location: company?.country ? clean(company.country) : null,
    manager: null,
    mfaEnrolledAt: null,
    passwordChangedAt: createdAt,
    lastSeenAt: createdAt,
    createdAt,
    deletedAt: null
  };

  db.workspaces.push(workspace);
  db.users.push(user);
  save();

  const accessToken = startSession(res, user);
  ok(
    res,
    { accessToken, user: sessionUser(user), workspace: sessionWorkspace(workspace), checkoutUrl: null },
    paidRequested
      ? `Workspace created. Online payment isn't set up yet, so ${workspace.name} starts on a ${TRIAL_DAYS}-day ${plan.name} trial.`
      : `Workspace created — ${TRIAL_DAYS}-day ${plan.name} trial started`,
    { status: 201 }
  );
});

/* ---------------- login / session ---------------- */

router.post('/login', credentialLimit, async (req, res) => {
  const body = req.body ?? {};
  assertValid(
    validate(body, {
      email: [rules.required('Enter your work email'), rules.email()],
      password: [rules.required('Enter your password')]
    })
  );

  const email = clean(body.email).toLowerCase();
  const user = db.users.find((u) => u.email === email && !u.deletedAt);
  const valid = user?.passwordHash ? await bcrypt.compare(String(body.password), user.passwordHash) : false;

  if (!valid) {
    if (user && !user.passwordHash && user.status === 'Invited') {
      throw new HttpError(403, 'INVITE_PENDING', 'This account has a pending invite — use the link in your invite email to set a password.');
    }
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  if (user.status === 'Suspended') {
    throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact your workspace admin.');
  }

  user.lastSeenAt = now();
  save();

  const accessToken = startSession(res, user);
  ok(res, { accessToken, user: sessionUser(user) }, 'Signed in');
});

router.post('/refresh', (req, res) => {
  const row = consumeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  const user = row && db.users.find((u) => u.id === row.userId && !u.deletedAt && u.status !== 'Suspended');
  if (!user) {
    clearRefreshCookie(res);
    throw unauthorized('No active session');
  }
  user.lastSeenAt = now();
  issueRefreshToken(res, user);
  ok(res, { accessToken: signAccessToken(user) });
});

router.post('/logout', (req, res) => {
  consumeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  ok(res, null, 'Signed out');
});

router.get('/me', requireAuth, (req, res) => {
  ok(res, { user: sessionUser(req.user), workspace: sessionWorkspace(req.workspace) });
});

/* ---------------- invites & password reset (token links) ---------------- */

/** Sets a password for an invited user and signs them in. */
router.post('/accept-invite', credentialLimit, async (req, res) => {
  const body = req.body ?? {};
  assertValid(
    validate(body, {
      token: [rules.required('Invite token is missing')],
      password: [rules.required('Choose a password'), rules.minLen(12, 'At least 12 characters'), rules.maxLen(128)]
    })
  );

  const invite = db.invites.find((i) => i.tokenHash === sha256(String(body.token)) && !i.revokedAt);
  if (!invite || invite.acceptedAt) throw badRequest('This invite link is invalid or has already been used');
  if (Date.parse(invite.expiresAt) < Date.now()) throw badRequest('This invite has expired — ask an admin to resend it');

  const user = db.users.find((u) => u.id === invite.userId && !u.deletedAt);
  if (!user) throw badRequest('This invite is no longer valid');

  const at = now();
  user.passwordHash = await bcrypt.hash(String(body.password), 10);
  user.passwordChangedAt = at;
  user.status = 'Active';
  user.lastSeenAt = at;
  if (clean(body.name)) user.name = clean(body.name);
  invite.acceptedAt = at;
  save();

  const accessToken = startSession(res, user);
  ok(res, { accessToken, user: sessionUser(user) }, 'Welcome to ' + (db.workspaces.find((w) => w.id === user.workspaceId)?.name ?? 'the workspace'));
});

router.post('/reset-password', credentialLimit, async (req, res) => {
  const body = req.body ?? {};
  assertValid(
    validate(body, {
      token: [rules.required('Reset token is missing')],
      password: [rules.required('Choose a password'), rules.minLen(12, 'At least 12 characters'), rules.maxLen(128)]
    })
  );

  const row = db.resetTokens.find((t) => t.hash === sha256(String(body.token)));
  if (!row || row.usedAt || Date.parse(row.expiresAt) < Date.now()) {
    throw badRequest('This reset link is invalid or has expired');
  }
  const user = db.users.find((u) => u.id === row.userId && !u.deletedAt);
  if (!user) throw badRequest('This reset link is no longer valid');

  user.passwordHash = await bcrypt.hash(String(body.password), 10);
  user.passwordChangedAt = now();
  if (user.status === 'Invited') user.status = 'Active';
  row.usedAt = now();
  revokeUserSessions(user.id);
  save();
  ok(res, null, 'Password updated — sign in with your new password');
});

export default router;

/* ---------------- helpers shared with the users/invites routes ---------------- */

export function createResetLink(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.resetTokens.push({
    id: newId(),
    userId: user.id,
    hash: sha256(token),
    createdAt: now(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    usedAt: null
  });
  save();
  const link = `${config.appUrl}/?reset=${token}`;
  // No mail provider is configured — log the link so it can be used locally.
  console.log(`[mail] Password reset for ${user.email}: ${link}`);
  return { token, link };
}

