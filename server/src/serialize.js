/**
 * Public shapes. Records are stored with `id`; the frontend expects `_id` (it was written
 * against a Mongo-style API). Secrets such as password hashes never leave this file.
 */

export const publicUser = (u) => ({
  _id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  team: u.team ?? '',
  status: u.status,
  manager: u.manager ?? null,
  location: u.location ?? null,
  mfaEnrolledAt: u.mfaEnrolledAt ?? null,
  passwordChangedAt: u.passwordChangedAt ?? null,
  lastSeenAt: u.lastSeenAt ?? null,
  createdAt: u.createdAt ?? null,
  deletedAt: u.deletedAt ?? null
});

/** The small user object stored in the frontend session. */
export const sessionUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  team: u.team ?? '',
  status: u.status
});

export const sessionWorkspace = (w) => ({
  id: w.id,
  name: w.name,
  domain: w.domain,
  companyType: w.companyType,
  plan: w.plan,
  seatsLicensed: w.seatsLicensed,
  subscriptionStatus: w.subscriptionStatus,
  trialEndsAt: w.trialEndsAt ?? null
});

export const publicInvite = (i) => ({
  _id: i.id,
  email: i.email,
  name: i.name,
  role: i.role,
  team: i.team ?? '',
  expiresAt: i.expiresAt ?? null,
  acceptedAt: i.acceptedAt ?? null,
  createdAt: i.createdAt ?? null
});

export const publicBid = (b) => ({
  _id: b.id,
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
  dueAt: b.dueAt ?? null,
  receivedOn: b.receivedOn ?? null,
  submittedOn: b.submittedOn ?? null,
  tasks: b.tasks ?? [],
  notes: b.notes ?? [],
  createdAt: b.createdAt ?? null,
  updatedAt: b.updatedAt ?? null,
  deletedAt: b.deletedAt ?? null
});
