/**
 * Public shapes. ObjectIds become hex strings and Dates become ISO strings, which is what
 * the frontend expects. Secrets such as password hashes never leave this file.
 */

const id = (v) => (v == null ? null : String(v));
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

export const publicUser = (u) => ({
  _id: id(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  team: u.team ?? '',
  status: u.status,
  manager: u.manager ?? null,
  location: u.location ?? null,
  mfaEnrolledAt: iso(u.mfaEnrolledAt),
  passwordChangedAt: iso(u.passwordChangedAt),
  lastSeenAt: iso(u.lastSeenAt),
  createdAt: iso(u.createdAt),
  deletedAt: iso(u.deletedAt)
});

/** The small user object stored in the frontend session. */
export const sessionUser = (u) => ({
  id: id(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  team: u.team ?? '',
  status: u.status
});

export const sessionWorkspace = (w) => ({
  id: id(w._id),
  name: w.name,
  domain: w.domain,
  companyType: w.companyType,
  plan: w.plan,
  seatsLicensed: w.seatsLicensed,
  subscriptionStatus: w.subscriptionStatus,
  trialEndsAt: iso(w.trialEndsAt)
});

export const publicInvite = (i) => ({
  _id: id(i._id),
  email: i.email,
  name: i.name,
  role: i.role,
  team: i.team ?? '',
  expiresAt: iso(i.expiresAt),
  acceptedAt: iso(i.acceptedAt),
  createdAt: iso(i.createdAt)
});

export const publicBid = (b) => ({
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
