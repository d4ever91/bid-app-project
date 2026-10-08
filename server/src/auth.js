/**
 * Sessions.
 *
 * - Access token: short-lived JWT, returned in the response body, kept in memory by the
 *   frontend and sent as `Authorization: Bearer …`.
 * - Refresh token: random 48-byte value in an httpOnly cookie scoped to /api/auth. Only
 *   its SHA-256 hash is stored (refreshTokens collection, TTL-indexed), and it rotates on
 *   every refresh, so a replayed old token is rejected.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config, isProd } from './config.js';
import { db, newId, now, toId } from './db.js';
import { forbidden, unauthorized } from './http.js';

export const REFRESH_COOKIE = 'ordinal_rt';
const COOKIE_PATH = '/api/auth';

let secret = config.jwtSecret;

/** Dev convenience: without JWT_SECRET, generate one once and keep it in the database. */
export async function ensureSecret() {
  if (config.jwtSecret) {
    secret = config.jwtSecret;
    return;
  }
  const generated = crypto.randomBytes(48).toString('hex');
  await db.settings.updateOne({ _id: 'jwt' }, { $setOnInsert: { secret: generated } }, { upsert: true });
  secret = (await db.settings.findOne({ _id: 'jwt' })).secret;
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function signAccessToken(user) {
  return jwt.sign({ sub: String(user._id), wid: String(user.workspaceId), role: user.role }, secret, {
    expiresIn: config.accessTtlSeconds
  });
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: config.refreshTtlDays * 864e5
  };
}

export async function issueRefreshToken(res, user) {
  const token = crypto.randomBytes(48).toString('base64url');
  await db.refreshTokens.insertOne({
    _id: newId(),
    userId: user._id,
    hash: sha256(token),
    createdAt: now(),
    expiresAt: new Date(Date.now() + config.refreshTtlDays * 864e5)
  });
  res.cookie(REFRESH_COOKIE, token, cookieOptions());
}

export function clearRefreshCookie(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(REFRESH_COOKIE, opts);
}

/** Atomically finds and deletes a refresh token. Returns the row, or null if invalid/expired. */
export async function consumeRefreshToken(token) {
  if (!token) return null;
  const row = await db.refreshTokens.findOneAndDelete({ hash: sha256(token) });
  return row && row.expiresAt > new Date() ? row : null;
}

export async function revokeUserSessions(userId) {
  await db.refreshTokens.deleteMany({ userId });
}

/** Starts a session: sets the refresh cookie and returns a fresh access token. */
export async function startSession(res, user) {
  await issueRefreshToken(res, user);
  return signAccessToken(user);
}

/* ---------------- middleware ---------------- */

export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());

  let claims;
  try {
    claims = jwt.verify(token, secret);
  } catch {
    return next(unauthorized('Your session has expired'));
  }

  const user = await db.users.findOne({ _id: toId(claims.sub), deletedAt: null });
  if (!user || user.status === 'Suspended') return next(unauthorized('This account is no longer active'));
  const workspace = await db.workspaces.findOne({ _id: user.workspaceId });
  if (!workspace) return next(unauthorized());

  req.user = user;
  req.workspace = workspace;
  next();
}

export const ROLES = ['Owner', 'Admin', 'Engineer', 'Read-only'];
/** Stored on each user so "sort by role" can be done by MongoDB (Owner first). */
export const roleRank = (role) => Math.max(0, ROLES.indexOf(role));

/** Allows the listed roles only. */
export const allow =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user.role) ? next() : next(forbidden(`Only ${roles.join(' or ')} can do that`));
