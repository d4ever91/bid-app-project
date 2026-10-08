/**
 * Seeds MongoDB with all the demo data the app shows: workspaces, users (with profiles and
 * notification preferences), invites, bids (tasks + notes), invoices, billing details and
 * usage, signed-in devices, and the audit log (access events, user activity and 30 days of
 * sign-ins for the Overview chart).
 *
 *   npm run seed            → wipes the app's collections and re-seeds
 *
 * The API also seeds automatically on start when the database has no workspaces yet.
 */
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { connect, db, disconnect, dropAll, newId } from './db.js';
import { ensureSecret, roleRank, sha256 } from './auth.js';
import { defaultNotificationPrefs } from './routes/auth.js';
import {
  SEED_ACTIVITY, SEED_BIDS, SEED_BILLING, SEED_EVENTS, SEED_INVOICES, SEED_SESSIONS, SEED_SIGNINS_PER_DAY, SEED_USAGE,
  SEED_USERS, type SeedUser
} from './seed-data.js';
import type {
  AuditEventDoc, AuditKind, BidDoc, InviteDoc, InvoiceDoc, SessionDoc, UserDoc, WorkspaceDoc
} from './types.js';
import { AUDIT_KINDS } from './types.js';

export const DEMO_PASSWORD = 'ordinal-dev-password';
const DAY = 864e5;
const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

/** "2m ago", "5h ago", "yesterday", "12 days ago", "3 weeks ago" → ms in the past. */
function parseAgo(label: string | undefined): number | null {
  const s = String(label ?? '').toLowerCase();
  if (!s || s === '—') return null;
  if (s.includes('just') || s.includes('now')) return 0;
  if (s === 'yesterday') return DAY;
  const m = s.match(/(\d+)\s*(m|min|h|day|days|week|weeks|month|months)\b/);
  if (!m) return null;
  const units: Record<string, number> = { m: 60e3, min: 60e3, h: 3600e3, day: DAY, days: DAY, week: 7 * DAY, weeks: 7 * DAY, month: 30 * DAY, months: 30 * DAY };
  return Number(m[1]) * units[m[2]];
}

/** "Mar 2023" / "14 Aug 2026" → Date. */
function parseDate(label: string): Date | null {
  const t = Date.parse(label);
  return Number.isNaN(t) ? null : new Date(t);
}

/** "14:02:11" today (or yesterday, if that time hasn't happened yet today). */
function todayAt(hms: string): Date {
  const [h, m, s] = hms.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, s || 0, 0);
  return d > new Date() ? new Date(d.getTime() - DAY) : d;
}

/** Small deterministic PRNG so every seed produces the same demo data. */
function prng(seed = 42) {
  let x = seed;
  return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const DEVICES = ['Chrome 129 · macOS', 'Safari 18 · iPhone', 'Edge 128 · Windows', 'Firefox 131 · Linux', 'Chrome 129 · Windows'];

/** Wipes the app's collections and inserts the demo data. Expects an open connection. */
export async function seed(): Promise<Record<string, number>> {
  await dropAll();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const created = new Date();
  const random = prng();

  /* ---------- workspaces ---------- */

  const ordinal: WorkspaceDoc = {
    _id: newId(),
    name: 'Ordinal',
    domain: 'ordinal.io',
    companyType: 'Consultancy',
    size: '201–500',
    company: {
      companyType: 'Consultancy', size: '201–500', role: 'Founder / director', country: 'United Kingdom',
      sectors: ['Healthcare', 'Transport', 'Utilities', 'Financial services', 'Education'], bidVolume: '51–200'
    },
    plan: 'business',
    cycle: 'annual',
    seatsLicensed: 50,
    subscriptionStatus: 'active',
    trialEndsAt: null,
    renewsAt: ahead(116 * DAY),
    billingEmail: SEED_BILLING.email,
    billing: { cardLabel: SEED_BILLING.cardLabel, cardExpiry: SEED_BILLING.cardExpiry, address: SEED_BILLING.address, vatNumber: SEED_BILLING.vatNumber },
    usage: { periodStart: new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), 1)), ...SEED_USAGE },
    createdAt: ago(900 * DAY)
  };
  const acme: WorkspaceDoc = {
    _id: newId(),
    name: 'Acme Survey Co',
    domain: 'acme-survey.com',
    companyType: 'Agency',
    size: '1–50',
    company: { companyType: 'Agency', size: '1–50', role: 'Sales or BD lead', country: 'India', sectors: ['Public sector', 'Education'], bidVolume: '11–50' },
    plan: 'team',
    cycle: 'monthly',
    seatsLicensed: 10,
    subscriptionStatus: 'trialing',
    trialEndsAt: ahead(9 * DAY),
    renewsAt: ahead(9 * DAY),
    billingEmail: 'rosa@acme-survey.com',
    billing: { cardLabel: null, cardExpiry: null, address: 'Baner Road, Pune 411045, India', vatNumber: null },
    usage: { periodStart: new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), 1)), aiQueries: 12, scimRuns: 0 },
    createdAt: ago(5 * DAY)
  };
  const workspaces = [ordinal, acme];

  /* ---------- users ---------- */

  type Extra = Partial<Pick<UserDoc, 'jobTitle' | 'timezone' | 'recoveryCodesLeft'>> & { mfaMethod?: string | null };
  const person = (workspace: WorkspaceDoc, u: Omit<SeedUser, 'id' | 'sessions'>, extra: Extra = {}): UserDoc => {
    const invited = u.status === 'Invited';
    const pwDays = Number.parseInt(u.pwAge, 10);
    const enrolled = u.mfa.startsWith('Enrolled');
    return {
      _id: newId(),
      workspaceId: workspace._id,
      name: u.name,
      email: u.email,
      passwordHash: invited ? null : hash,
      role: u.role,
      roleRank: roleRank(u.role),
      team: u.team,
      status: u.status,
      manager: null,
      location: u.location ?? null,
      jobTitle: extra.jobTitle ?? null,
      timezone: extra.timezone ?? 'Europe/London',
      notificationPrefs: defaultNotificationPrefs(),
      requireMfa: true,
      mfaEnrolledAt: enrolled ? ago(200 * DAY) : null,
      mfaMethod: extra.mfaMethod ?? (enrolled ? u.mfa.split('·')[1]?.trim() ?? 'TOTP' : null),
      recoveryCodesLeft: extra.recoveryCodesLeft ?? (enrolled ? 10 : null),
      passwordChangedAt: invited ? null : ago((Number.isFinite(pwDays) ? pwDays : 30) * DAY),
      lastSeenAt: invited ? null : ago(parseAgo(u.seen) ?? 3 * DAY),
      createdAt: parseDate(u.joined) ?? created,
      deletedAt: null
    };
  };

  const avery = person(
    ordinal,
    { name: 'Avery Mercer', email: 'a.mercer@ordinal.io', role: 'Owner', team: 'Leadership', status: 'Active', seen: '2m ago', mfa: 'Enrolled · WebAuthn', pwAge: '31 days', joined: 'Jan 2023', location: 'Exeter, UK' },
    { jobTitle: 'Head of Platform Engineering', timezone: 'Europe/London', mfaMethod: 'WebAuthn + TOTP', recoveryCodesLeft: 8 }
  );
  const rosa = person(
    acme,
    { name: 'Rosa Delgado', email: 'rosa@acme-survey.com', role: 'Owner', team: 'Leadership', status: 'Active', seen: '1h ago', mfa: 'Not enrolled', pwAge: '5 days', joined: created.toISOString(), location: 'Pune, IN' },
    { jobTitle: 'Sales & Operations Lead', timezone: 'Asia/Kolkata' }
  );
  const ordinalUsers = [avery, ...SEED_USERS.map((u) => person(ordinal, u))];
  const users = [...ordinalUsers, rosa];
  const byName = new Map(users.map((u) => [u.name, u]));

  /* ---------- invites for the invited accounts ---------- */

  const invites: InviteDoc[] = users
    .filter((u) => u.status === 'Invited')
    .map((u, i) => ({
      _id: newId(),
      workspaceId: u.workspaceId,
      userId: u._id,
      email: u.email,
      name: u.name,
      role: u.role,
      team: u.team,
      // Unusable placeholder: resend from the UI to get a working invite link.
      tokenHash: sha256('seed-' + crypto.randomBytes(16).toString('hex')),
      invitedBy: avery._id,
      expiresAt: ahead((i === 0 ? 1.5 : 5) * DAY),
      acceptedAt: null,
      revokedAt: null,
      createdAt: ago(2 * DAY)
    }));

  /* ---------- bids (due dates relative to today, so "due soon" stays meaningful) ---------- */

  const bids: BidDoc[] = SEED_BIDS.map((b) => {
    const dueAt = ahead(b.daysLeft * DAY);
    const receivedOn = new Date(dueAt.getTime() - 40 * DAY);
    return {
      _id: newId(),
      workspaceId: ordinal._id,
      reference: b.id,
      title: b.title,
      client: b.client,
      sector: b.sector,
      contactName: null,
      contact: null,
      value: b.value,
      stage: b.stage,
      ownerName: b.owner,
      probability: b.probability,
      incumbent: b.incumbent,
      dueAt,
      receivedOn,
      submittedOn: b.submittedOn && b.submittedOn !== '—' ? new Date(dueAt.getTime() - DAY) : null,
      tasks: b.tasks.map((t) => ({ label: t.label, owner: t.owner, done: t.done })),
      notes: b.notes.map((n) => ({ text: n.text, author: b.owner, at: ago(parseAgo(n.time) ?? DAY) })),
      createdBy: avery._id,
      createdAt: receivedOn,
      updatedAt: created,
      deletedAt: null
    };
  });

  /* ---------- invoices ---------- */

  const invoices: InvoiceDoc[] = SEED_INVOICES.map((inv) => ({
    _id: newId(),
    workspaceId: ordinal._id,
    number: inv.id,
    issued: parseDate(inv.date) ?? created,
    period: inv.period,
    seats: inv.seats,
    amount: inv.amount,
    status: inv.status,
    pdf: null
  }));

  /* ---------- signed-in devices for the owner (the current one is created at login) ---------- */

  const sessions: SessionDoc[] = SEED_SESSIONS.map((s) => {
    const lastUsedAt = ago(parseAgo(s.lastSeen) ?? DAY);
    return {
      _id: newId(),
      userId: avery._id,
      workspaceId: ordinal._id,
      hash: sha256('seed-session-' + crypto.randomBytes(16).toString('hex')),
      device: s.device,
      ip: s.ip,
      location: s.location,
      startedAt: new Date(lastUsedAt.getTime() - 5 * DAY),
      lastUsedAt,
      expiresAt: ahead(25 * DAY)
    };
  });

  /* ---------- audit log ---------- */

  const event = (e: Omit<AuditEventDoc, '_id' | 'workspaceId' | 'bidId' | 'ip'> & { ip?: string | null; workspaceId?: WorkspaceDoc['_id'] }): AuditEventDoc => ({
    _id: newId(),
    workspaceId: e.workspaceId ?? ordinal._id,
    bidId: null,
    ip: e.ip ?? null,
    ...e
  });
  const kindOf = (k: string): AuditKind => ((AUDIT_KINDS as readonly string[]).includes(k) ? (k as AuditKind) : 'auth');

  // Recent access events (Overview).
  const accessEvents = SEED_EVENTS.map((e) => {
    const actor = byName.get(e.actor) ?? null;
    const email = e.text.match(/[\w.+-]+@[\w.-]+/)?.[0];
    const subject = email ? users.find((u) => u.email === email) : undefined;
    return event({ at: todayAt(e.time), kind: kindOf(e.kind), actorId: actor?._id ?? null, actorName: e.actor, text: e.text, userId: subject?._id ?? null });
  });

  // The owner's own activity feed.
  const activity = SEED_ACTIVITY.map((a) => {
    const kind: AuditKind = a.text.startsWith('Signed in') ? 'signin' : a.text.startsWith('Role changed') ? 'role' : 'auth';
    return event({
      at: ago(parseAgo(a.time) ?? DAY),
      kind,
      actorId: avery._id,
      actorName: avery.name,
      text: a.text,
      userId: avery._id,
      ip: kind === 'signin' ? '51.15.44.2' : null
    });
  });

  // 30 days of sign-ins (oldest first) spread across the active Ordinal accounts.
  const signers = ordinalUsers.filter((u) => u.status === 'Active');
  const today = new Date();
  const signIns: AuditEventDoc[] = [];
  SEED_SIGNINS_PER_DAY.forEach((count, i) => {
    const daysBack = SEED_SIGNINS_PER_DAY.length - 1 - i;
    const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysBack);
    const span = daysBack === 0 ? Math.max(60e3, Date.now() - dayStart) : DAY;
    for (let n = 0; n < count; n++) {
      const user = signers[Math.floor(random() * signers.length)];
      const ip = `51.${15 + Math.floor(random() * 80)}.${Math.floor(random() * 255)}.${1 + Math.floor(random() * 250)}`;
      const device = DEVICES[Math.floor(random() * DEVICES.length)];
      signIns.push(
        event({ at: new Date(dayStart + Math.floor(random() * span)), kind: 'signin', actorId: user._id, actorName: user.name, text: `Signed in from ${ip} · ${device}`, userId: user._id, ip })
      );
    }
  });

  // A couple of entries for the second workspace so it isn't empty.
  const acmeEvents = [
    event({ workspaceId: acme._id, at: ago(5 * DAY), kind: 'auth', actorId: rosa._id, actorName: rosa.name, text: 'Created workspace Acme Survey Co (Team trial)', userId: rosa._id }),
    event({ workspaceId: acme._id, at: ago(3600e3), kind: 'signin', actorId: rosa._id, actorName: rosa.name, text: 'Signed in from 49.36.12.8 · Chrome 129 · Windows', userId: rosa._id, ip: '49.36.12.8' })
  ];

  const auditEvents = [...accessEvents, ...activity, ...signIns, ...acmeEvents];

  await db.workspaces.insertMany(workspaces);
  await db.users.insertMany(users);
  if (invites.length) await db.invites.insertMany(invites);
  await db.bids.insertMany(bids);
  await db.invoices.insertMany(invoices);
  await db.sessions.insertMany(sessions);
  await db.auditEvents.insertMany(auditEvents);
  await ensureSecret();

  return {
    workspaces: workspaces.length,
    users: users.length,
    invites: invites.length,
    bids: bids.length,
    invoices: invoices.length,
    sessions: sessions.length,
    auditEvents: auditEvents.length
  };
}

// `npm run seed`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const redact = (uri: string) => uri.replace(/\/\/([^@/]+)@/, '//***@');
  try {
    await connect();
    const counts = await seed();
    console.log(`[seed] Seeded ${redact(config.mongoUri)}`);
    console.log(`[seed] ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
    console.log(`[seed] Password for every demo login: ${DEMO_PASSWORD}`);
  } catch (err) {
    console.error(`[seed] Failed: ${(err as Error).message}`);
    console.error('[seed] Is MongoDB running? Start it with `npm run db:up`, or set MONGODB_URI in server/.env.');
    process.exitCode = 1;
  } finally {
    await disconnect();
  }
}
