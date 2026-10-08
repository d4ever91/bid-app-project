/**
 * Sessions and access control.
 *
 * - Access token: short-lived JWT, returned in the response body, kept in memory by the
 *   frontend and sent as `Authorization: Bearer …`.
 * - Refresh token: random 48-byte value in an httpOnly cookie scoped to /api/auth. Each
 *   signed-in device is one document in `sessions` (device, IP, last used). Only the token's
 *   SHA-256 hash is stored, and it rotates on every refresh, so a replayed token is rejected.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { ObjectId } from 'mongodb';
import { config, isProd } from './config.js';
import { db, newId, now, toId } from './db.js';
import { forbidden, unauthorized } from './http.js';
import { ROLES, type Role, type SessionDoc, type UserDoc, type WorkspaceDoc } from './types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
      workspace?: WorkspaceDoc;
    }
  }
}

export const REFRESH_COOKIE = 'ordinal_rt';
const COOKIE_PATH = '/api/auth';

let secret = config.jwtSecret;

/** Dev convenience: without JWT_SECRET, generate one once and keep it in the database. */
export async function ensureSecret(): Promise<void> {
  if (config.jwtSecret) {
    secret = config.jwtSecret;
    return;
  }
  const generated = crypto.randomBytes(48).toString('hex');
  await db.settings.updateOne({ _id: 'jwt' }, { $setOnInsert: { secret: generated } }, { upsert: true });
  secret = (await db.settings.findOne({ _id: 'jwt' }))?.secret ?? generated;
}

export const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

export function signAccessToken(user: UserDoc): string {
  return jwt.sign({ sub: String(user._id), wid: String(user.workspaceId), role: user.role }, secret, {
    expiresIn: config.accessTtlSeconds
  });
}

function cookieOptions() {
  return { httpOnly: true, secure: isProd, sameSite: 'lax' as const, path: COOKIE_PATH, maxAge: config.refreshTtlDays * 864e5 };
}

export function clearRefreshCookie(res: Response): void {
  const { maxAge: _ignored, ...opts } = cookieOptions();
  res.clearCookie(REFRESH_COOKIE, opts);
}

/** "Chrome 129 · macOS" from a user-agent string. */
export function deviceLabel(ua: string | undefined): string {
  const s = ua ?? '';
  const version = (re: RegExp) => s.match(re)?.[1];
  const browser =
    (version(/Edg\/(\d+)/) && `Edge ${version(/Edg\/(\d+)/)}`) ||
    (version(/Firefox\/(\d+)/) && `Firefox ${version(/Firefox\/(\d+)/)}`) ||
    (version(/Chrome\/(\d+)/) && `Chrome ${version(/Chrome\/(\d+)/)}`) ||
    (/Safari\//.test(s) && version(/Version\/(\d+)/) && `Safari ${version(/Version\/(\d+)/)}`) ||
    (/curl|node|undici/i.test(s) ? 'API client' : 'Browser');
  const os =
    (/iPhone/.test(s) && 'iPhone') ||
    (/iPad/.test(s) && 'iPad') ||
    (/Android/.test(s) && 'Android') ||
    (/Mac OS X|Macintosh/.test(s) && 'macOS') ||
    (/Windows NT 10/.test(s) && 'Windows') ||
    (/Windows/.test(s) && 'Windows') ||
    (/Linux/.test(s) && 'Linux') ||
    null;
  return os ? `${browser} · ${os}` : browser;
}

export const clientIp = (req: Request): string | null => (req.ip ?? '').replace(/^::ffff:/, '') || null;

const newToken = () => crypto.randomBytes(48).toString('base64url');

/** Starts a new device session: sets the refresh cookie and returns an access token. */
export async function startSession(req: Request, res: Response, user: UserDoc): Promise<string> {
  const token = newToken();
  const at = now();
  await db.sessions.insertOne({
    _id: newId(),
    userId: user._id,
    workspaceId: user.workspaceId,
    hash: sha256(token),
    device: deviceLabel(req.get('user-agent')),
    ip: clientIp(req),
    location: null,
    startedAt: at,
    lastUsedAt: at,
    expiresAt: new Date(Date.now() + config.refreshTtlDays * 864e5)
  });
  res.cookie(REFRESH_COOKIE, token, cookieOptions());
  return signAccessToken(user);
}

/**
 * Rotates the refresh token of the session that presented `token`. Returns the session,
 * or null if the token is unknown/expired (e.g. a replay of an already-rotated token).
 */
export async function rotateSession(req: Request, res: Response, token: string | undefined): Promise<SessionDoc | null> {
  if (!token) return null;
  const next = newToken();
  const session = await db.sessions.findOneAndUpdate(
    { hash: sha256(token), expiresAt: { $gt: now() } },
    {
      $set: {
        hash: sha256(next),
        lastUsedAt: now(),
        ip: clientIp(req),
        expiresAt: new Date(Date.now() + config.refreshTtlDays * 864e5)
      }
    },
    { returnDocument: 'after' }
  );
  if (session) res.cookie(REFRESH_COOKIE, next, cookieOptions());
  return session;
}

export async function endSession(token: string | undefined): Promise<void> {
  if (token) await db.sessions.deleteOne({ hash: sha256(token) });
}

export async function revokeUserSessions(userId: ObjectId): Promise<void> {
  await db.sessions.deleteMany({ userId });
}

/* ---------------- middleware ---------------- */

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());

  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(token, secret) as jwt.JwtPayload;
  } catch {
    return next(unauthorized('Your session has expired'));
  }

  const userId = toId(claims.sub);
  const user = userId && (await db.users.findOne({ _id: userId, deletedAt: null }));
  if (!user || user.status === 'Suspended') return next(unauthorized('This account is no longer active'));
  const workspace = await db.workspaces.findOne({ _id: user.workspaceId });
  if (!workspace) return next(unauthorized());

  req.user = user;
  req.workspace = workspace;
  next();
}

/** The signed-in user and workspace. Only valid after requireAuth. */
export function ctx(req: Request): { user: UserDoc; workspace: WorkspaceDoc } {
  if (!req.user || !req.workspace) throw unauthorized();
  return { user: req.user, workspace: req.workspace };
}

/** Stored on each user so "sort by role" can be done by MongoDB (Owner first). */
export const roleRank = (role: Role): number => Math.max(0, ROLES.indexOf(role));

/** Allows the listed roles only. */
export const allow =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void =>
    req.user && roles.includes(req.user.role) ? next() : next(forbidden(`Only ${roles.join(' or ')} can do that`));
