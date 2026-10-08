/**
 * Audit log. Every sign-in and every change an admin makes is appended to `auditEvents`;
 * the Overview (events + sign-ins chart) and each user's activity feed read from it.
 */
import type { Request } from 'express';
import type { ObjectId } from 'mongodb';
import { clientIp, deviceLabel } from './auth.js';
import { db, newId, now } from './db.js';
import type { AuditKind, UserDoc } from './types.js';

interface EventInput {
  kind: AuditKind;
  text: string;
  /** Who did it. Defaults to the signed-in user. */
  actor?: Pick<UserDoc, '_id' | 'name'> | null;
  actorName?: string;
  /** The account the event is about. */
  userId?: ObjectId | null;
  bidId?: ObjectId | null;
  workspaceId?: ObjectId;
}

export async function audit(req: Request, input: EventInput): Promise<void> {
  const actor = input.actor === undefined ? req.user ?? null : input.actor;
  const workspaceId = input.workspaceId ?? req.workspace?._id ?? (req.user?.workspaceId as ObjectId | undefined);
  if (!workspaceId) return;
  try {
    await db.auditEvents.insertOne({
      _id: newId(),
      workspaceId,
      at: now(),
      kind: input.kind,
      actorId: actor?._id ?? null,
      actorName: input.actorName ?? actor?.name ?? 'System',
      text: input.text,
      userId: input.userId ?? null,
      bidId: input.bidId ?? null,
      ip: clientIp(req)
    });
  } catch (err) {
    // The audit trail must never break the action it records.
    console.error('[audit] failed to record event', err);
  }
}

/** Records a successful sign-in (feeds the sign-ins chart and the user's activity). */
export const auditSignIn = (req: Request, user: UserDoc) =>
  audit(req, {
    kind: 'signin',
    text: `Signed in from ${clientIp(req) ?? 'unknown IP'} · ${deviceLabel(req.get('user-agent'))}`,
    actor: user,
    userId: user._id,
    workspaceId: user.workspaceId
  });
