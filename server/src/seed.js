/**
 * Seeds MongoDB with the demo data: the same people and bids the frontend's fixtures show,
 * the accounts listed in the README, their pending invites and the invoice history.
 *
 *   npm run seed            → wipes the app's collections and re-seeds
 *
 * The API also seeds automatically on start when the database has no workspaces yet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { connect, db, disconnect, dropAll, newId } from './db.js';
import { ensureSecret, roleRank } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(fs.readFileSync(path.join(here, 'seed-data.json'), 'utf8'));

export const DEMO_PASSWORD = 'ordinal-dev-password';
const DAY = 864e5;
const ago = (ms) => new Date(Date.now() - ms);
const ahead = (ms) => new Date(Date.now() + ms);

/** "2m ago", "5h ago", "yesterday", "12 days ago", "3 weeks ago" → ms in the past. */
function parseAgo(label) {
  const s = String(label ?? '').toLowerCase();
  if (!s || s === '—') return null;
  if (s.includes('just') || s.includes('now')) return 0;
  if (s === 'yesterday') return DAY;
  const m = s.match(/(\d+)\s*(m|min|h|day|days|week|weeks|month|months)\b/);
  if (!m) return null;
  const unit = { m: 60e3, min: 60e3, h: 3600e3, day: DAY, days: DAY, week: 7 * DAY, weeks: 7 * DAY, month: 30 * DAY, months: 30 * DAY }[m[2]];
  return Number(m[1]) * unit;
}

/** "Mar 2023" / "14 Aug 2026" → Date. */
const parseDate = (label) => {
  const t = Date.parse(label);
  return Number.isNaN(t) ? null : new Date(t);
};

/** Wipes the app's collections and inserts the demo data. Expects an open connection. */
export async function seed() {
  await dropAll();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const created = new Date();

  /* ---------- workspaces ---------- */

  const ordinal = {
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
    renewsAt: ahead(120 * DAY),
    billingEmail: 'accounts-payable@ordinal.io',
    createdAt: ago(900 * DAY)
  };
  const acme = {
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
    createdAt: ago(5 * DAY)
  };
  const workspaces = [ordinal, acme];

  /* ---------- users ---------- */

  const person = (workspace, u) => {
    const invited = u.status === 'Invited';
    const pwDays = Number.parseInt(u.pwAge, 10);
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
      manager: u.manager ?? null,
      location: u.location ?? null,
      mfaEnrolledAt: String(u.mfa ?? '').startsWith('Enrolled') ? ago(200 * DAY) : null,
      passwordChangedAt: invited ? null : ago((Number.isFinite(pwDays) ? pwDays : 30) * DAY),
      lastSeenAt: invited ? null : ago(parseAgo(u.seen) ?? 3 * DAY),
      createdAt: parseDate(u.joined) ?? created,
      deletedAt: null
    };
  };

  const avery = person(ordinal, {
    name: 'Avery Mercer', email: 'a.mercer@ordinal.io', role: 'Owner', team: 'Leadership', status: 'Active',
    seen: '2m ago', mfa: 'Enrolled · WebAuthn', pwAge: '22 days', joined: 'Jan 2023', location: 'Exeter, UK'
  });
  const rosa = person(acme, {
    name: 'Rosa Delgado', email: 'rosa@acme-survey.com', role: 'Owner', team: 'Leadership', status: 'Active',
    seen: '1h ago', mfa: 'Not enrolled', pwAge: '5 days', joined: created.toISOString(), location: 'Pune, IN'
  });
  const users = [avery, ...fixtures.users.map((u) => person(ordinal, u)), rosa];

  /* ---------- invites for the invited accounts ---------- */

  const invites = users
    .filter((u) => u.status === 'Invited')
    .map((u) => ({
      _id: newId(),
      workspaceId: u.workspaceId,
      userId: u._id,
      email: u.email,
      name: u.name,
      role: u.role,
      team: u.team,
      // Not a real token hash: these demo invites can be resent from the UI to get a working link.
      tokenHash: 'seed-' + String(u._id),
      invitedBy: avery._id,
      expiresAt: ahead(2 * DAY),
      acceptedAt: null,
      revokedAt: null,
      createdAt: ago(DAY)
    }));

  /* ---------- bids (due dates relative to today, so the "due soon" views stay meaningful) ---------- */

  const bids = fixtures.bids.map((b) => {
    const dueAt = ahead(b.daysLeft * DAY);
    const receivedOn = new Date(dueAt.getTime() - 40 * DAY);
    return {
      _id: newId(),
      workspaceId: ordinal._id,
      reference: b.id,
      title: b.title,
      client: b.client,
      sector: b.sector,
      contactName: b.contactName ?? null,
      contact: b.contact ?? null,
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

  const invoice = (number, issuedDaysAgo, period, amount, status = 'Paid') => ({
    _id: newId(), workspaceId: ordinal._id, number, issued: ago(issuedDaysAgo * DAY), period, amount, status, pdf: null
  });
  const invoices = [
    invoice('INV-2026-0142', 245, 'Annual · 50 seats', 12000),
    invoice('INV-2025-0118', 610, 'Annual · 40 seats', 9600),
    invoice('INV-2025-0074', 420, 'Seat true-up · 10 seats', 1600)
  ];

  await db.workspaces.insertMany(workspaces);
  await db.users.insertMany(users);
  if (invites.length) await db.invites.insertMany(invites);
  await db.bids.insertMany(bids);
  await db.invoices.insertMany(invoices);
  await ensureSecret();

  return { workspaces: workspaces.length, users: users.length, invites: invites.length, bids: bids.length, invoices: invoices.length };
}

// `npm run seed`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const redact = (uri) => uri.replace(/\/\/([^@/]+)@/, '//***@');
  try {
    await connect();
    const counts = await seed();
    console.log(`[seed] Seeded ${redact(config.mongoUri)}`);
    console.log(
      `[seed] ${counts.workspaces} workspaces, ${counts.users} users, ${counts.invites} invites, ${counts.bids} bids, ${counts.invoices} invoices.`
    );
    console.log(`[seed] Password for every demo login: ${DEMO_PASSWORD}`);
  } catch (err) {
    console.error(`[seed] Failed: ${err.message}`);
    console.error('[seed] Is MongoDB running? Start it with `docker compose up -d mongo`, or set MONGODB_URI in server/.env.');
    process.exitCode = 1;
  } finally {
    await disconnect();
  }
}
