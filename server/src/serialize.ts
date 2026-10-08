/**
 * Public shapes. ObjectIds become hex strings and Dates become ISO strings, which is what
 * the frontend expects. Secrets such as password and token hashes never leave this file.
 */
import type { ObjectId } from 'mongodb';
import { NOTIFICATION_PREFS, type AuditEventDoc, type BidDoc, type InviteDoc, type SessionDoc, type UserDoc, type WorkspaceDoc } from './types.js';

const id = (v: ObjectId | string | null | undefined): string | null => (v == null ? null : String(v));
const iso = (v: Date | string | null | undefined): string | null => (v instanceof Date ? v.toISOString() : v ?? null);

export const publicUser = (u: UserDoc) => ({
  _id: id(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  team: u.team ?? '',
  status: u.status,
  manager: u.manager ?? null,
  location: u.location ?? null,
  jobTitle: u.jobTitle ?? null,
  mfaEnrolledAt: iso(u.mfaEnrolledAt),
  mfaMethod: u.mfaMethod ?? null,
  passwordChangedAt: iso(u.passwordChangedAt),
  lastSeenAt: iso(u.lastSeenAt),
  createdAt: iso(u.createdAt),
  deletedAt: iso(u.deletedAt)
});

/** The small user object stored in the frontend session. */
export const sessionUser = (u: UserDoc) => ({
  id: id(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  team: u.team ?? '',
  status: u.status
});

export const sessionWorkspace = (w: WorkspaceDoc) => ({
  id: id(w._id),
  name: w.name,
  domain: w.domain,
  companyType: w.companyType,
  plan: w.plan,
  seatsLicensed: w.seatsLicensed,
  subscriptionStatus: w.subscriptionStatus,
  trialEndsAt: iso(w.trialEndsAt)
});

/** The signed-in user's own profile page. */
export const profile = (u: UserDoc, w: WorkspaceDoc, sessionsActive: number) => ({
  id: id(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  team: u.team,
  jobTitle: u.jobTitle ?? '',
  timezone: u.timezone,
  workspace: { name: w.name, domain: w.domain },
  notifications: NOTIFICATION_PREFS.map((p) => ({ key: p.key, title: p.title, note: p.note, on: u.notificationPrefs?.[p.key] ?? p.default })),
  security: {
    passwordChangedAt: iso(u.passwordChangedAt),
    mfaEnrolledAt: iso(u.mfaEnrolledAt),
    mfaMethod: u.mfaMethod ?? null,
    recoveryCodesLeft: u.recoveryCodesLeft ?? null,
    sessionsActive
  }
});

export const publicSession = (s: SessionDoc, currentHash: string | null) => ({
  id: id(s._id),
  device: s.device,
  ip: s.ip,
  location: s.location,
  startedAt: iso(s.startedAt),
  lastUsedAt: iso(s.lastUsedAt),
  current: currentHash !== null && s.hash === currentHash
});

export const publicInvite = (i: InviteDoc) => ({
  _id: id(i._id),
  email: i.email,
  name: i.name,
  role: i.role,
  team: i.team ?? '',
  expiresAt: iso(i.expiresAt),
  acceptedAt: iso(i.acceptedAt),
  createdAt: iso(i.createdAt)
});

export const publicBid = (b: BidDoc) => ({
  _id: id(b._id),
  reference: b.reference,
  title: b.title,
  client: b.client,
  sector: b.sector ?? null,
  contactName: b.contactName ?? null,
  contact: b.contact ?? null,
  value: b.value ?? 0,
  stage: b.stage,
  ownerName: b.ownerName ?? null,
  probability: b.probability ?? 0,
  incumbent: b.incumbent ?? null,
  dueAt: iso(b.dueAt),
  receivedOn: iso(b.receivedOn),
  submittedOn: iso(b.submittedOn),
  tasks: b.tasks ?? [],
  notes: (b.notes ?? []).map((n) => ({ text: n.text, author: n.author ?? null, at: iso(n.at) })),
  createdAt: iso(b.createdAt),
  updatedAt: iso(b.updatedAt),
  deletedAt: iso(b.deletedAt)
});

export const publicEvent = (e: AuditEventDoc) => ({
  id: id(e._id),
  at: iso(e.at),
  kind: e.kind,
  actor: e.actorName,
  text: e.text
});
