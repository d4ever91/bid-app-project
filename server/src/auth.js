/**
 * Sessions.
 *
 * - Access token: short-lived JWT, returned in the response body, kept in memory by the
 *   frontend and sent as `Authorization: Bearer …`.
 * - Refresh token: random 48-byte value in an httpOnly cookie scoped to /api/auth. Only
 *   its SHA-256 hash is stored, and it rotates on every refresh, so a replayed old token
 *   is rejected.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config, isProd } from './config.js';
import { db, newId, now, save } from './db.js';
import { forbidden, unauthorized } from './http.js';

export const REFRESH_COOKIE = 'ordinal_rt';
const COOKIE_PATH = '/api/auth';

let secret = config.jwtSecret;

/** Dev convenience: without JWT_SECRET, generate one once and keep it in the data file. */
export function ensureSecret() {
  if (secret) return;
  db.meta.devJwtSecret ??= crypto.randomBytes(48).toString('hex');
  secret = db.meta.devJwtSecret;
  save();
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, wid: user.workspaceId, role: user.role }, secret, {
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

export function issueRefreshToken(res, user) {
  const token = crypto.randomBytes(48).toString('base64url');
  db.refreshTokens.push({
    id: newId(),
    userId: user.id,
    hash: sha256(token),
    createdAt: now(),
    expiresAt: new Date(Date.now() + config.refreshTtlDays * 864e5).toISOString()
  });
  save();
  res.cookie(REFRESH_COOKIE, token, cookieOptions());
}

export function clearRefreshCookie(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(REFRESH_COOKIE, opts);
}

/** Finds and consumes a refresh token. Returns the stored row, or null if invalid/expired. */
export function consumeRefreshToken(token) {
  if (!token) return null;
  const hash = sha256(token);
  const row = db.refreshTokens.find((t) => t.hash === hash);
  if (!row) return null;
  db.refreshTokens = db.refreshTokens.filter((t) => t !== row);
  save();
  return Date.parse(row.expiresAt) > Date.now() ? row : null;
}

export function revokeUserSessions(userId) {
  db.refreshTokens = db.refreshTokens.filter((t) => t.userId !== userId);
}

/** Starts a session: sets the refresh cookie and returns a fresh access token. */
export function startSession(res, user) {
  issueRefreshToken(res, user);
  return signAccessToken(user);
}

/* ---------------- middleware ---------------- */

export function requireAuth(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());

  let claims;
  try {
    claims = jwt.verify(token, secret);
  } catch {
    return next(unauthorized('Your session has expired'));
  }

  const user = db.users.find((u) => u.id === claims.sub && !u.deletedAt);
  if (!user || user.status === 'Suspended') return next(unauthorized('This account is no longer active'));
  const workspace = db.workspaces.find((w) => w.id === user.workspaceId);
  if (!workspace) return next(unauthorized());

  req.user = user;
  req.workspace = workspace;
  next();
}

const RANK = { Owner: 4, Admin: 3, Engineer: 2, 'Read-only': 1 };
export const ROLES = Object.keys(RANK);

/** Allows the listed roles only. */
export const allow =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user.role) ? next() : next(forbidden(`Only ${roles.join(' or ')} can do that`));

export const outranksOrEqual = (a, b) => RANK[a] >= RANK[b];
