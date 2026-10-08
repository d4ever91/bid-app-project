/**
 * Demo data: the same people and bids the frontend's fixtures show, plus the accounts
 * listed in the README. Run `npm run seed` to reset; the server also seeds itself on
 * first start when no data file exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { db, newId, reset, save } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(fs.readFileSync(path.join(here, 'seed-data.json'), 'utf8'));

export const DEMO_PASSWORD = 'ordinal-dev-password';
const DAY = 864e5;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/** "2m ago", "5h ago", "yesterday", "12 days ago", "3 weeks ago" → ms in the past. */
function ago(label) {
  const s = String(label ?? '').toLowerCase();
  if (!s || s === '—') return null;
  if (s.includes('just') || s.includes('now')) return 0;
  if (s === 'yesterday') return DAY;
  const m = s.match(/(\d+)\s*(m|min|h|day|days|week|weeks|month|months)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { m: 60e3, min: 60e3, h: 3600e3, day: DAY, days: DAY, week: 7 * DAY, weeks: 7 * DAY, month: 30 * DAY, months: 30 * DAY }[m[2]];
  return n * unit;
}

/** "Mar 2023" / "14 Aug 2026" → ISO. */
const parse = (label) => {
  const t = Date.parse(label);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export async function seed() {
  reset();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const created = new Date().toISOString();

  const ordinal = {
    id: newId(),
    name: 'Ordinal',
    domain: 'ordinal.io',
    companyType: 'Consultancy',
    size: '201–500',
    company: { companyType: 'Consultancy', size: '201–500', role: 'Founder / director', country: 'United Kingdom', sectors: ['Healthcare', 'Transport', 'Utilities', 'Financial services', 'Education'], bidVolume: '51–200' },
    plan: 'business',
    cycle: 'annual',
    seatsLicensed: 50,
    subscriptionStatus: 'active',
    trialEndsAt: null,
    renewsAt: new Date(Date.now() + 120 * DAY).toISOString(),
    billingEmail: 'accounts-payable@ordinal.io',
    createdAt: iso(900 * DAY)
  };
  const acme = {
    id: newId(),
    name: 'Acme Survey Co',
    domain: 'acme-survey.com',
    companyType: 'Agency',
    size: '1–50',
    company: { companyType: 'Agency', size: '1–50', role: 'Sales or BD lead', country: 'India', sectors: ['Public sector', 'Education'], bidVolume: '11–50' },
    plan: 'team',
    cycle: 'monthly',
    seatsLicensed: 10,
    subscriptionStatus: 'trialing',
    trialEndsAt: new Date(Date.now() + 9 * DAY).toISOString(),
    renewsAt: new Date(Date.now() + 9 * DAY).toISOString(),
    billingEmail: 'rosa@acme-survey.com',
    createdAt: iso(5 * DAY)
  };
  db.workspaces.push(ordinal, acme);

  const person = (workspace, u) => {
    const invited = u.status === 'Invited';
    const pwDays = Number.parseInt(u.pwAge, 10);
    return {
      id: newId(),
      workspaceId: workspace.id,
      name: u.name,
      email: u.email,
      passwordHash: invited ? null : hash,
      role: u.role,
      team: u.team,
      status: u.status,
      manager: u.manager ?? null,
      location: u.location ?? null,
      mfaEnrolledAt: String(u.mfa ?? '').startsWith('Enrolled') ? iso(200 * DAY) : null,
      passwordChangedAt: invited ? null : iso((Number.isFinite(pwDays) ? pwDays : 30) * DAY),
      lastSeenAt: invited ? null : iso(ago(u.seen) ?? 3 * DAY),
      createdAt: parse(u.joined) ?? created,
      deletedAt: null
    };
  };

  // README demo login, plus the fixture roster.
  db.users.push(
    person(ordinal, {
      name: 'Avery Mercer', email: 'a.mercer@ordinal.io', role: 'Owner', team: 'Leadership', status: 'Active',
      seen: '2m ago', mfa: 'Enrolled · WebAuthn', pwAge: '22 days', joined: 'Jan 2023', location: 'Exeter, UK'
    })
  );
  for (const u of fixtures.users) db.users.push(person(ordinal, u));
  db.users.push(
    person(acme, {
      name: 'Rosa Delgado', email: 'rosa@acme-survey.com', role: 'Owner', team: 'Leadership', status: 'Active',
      seen: '1h ago', mfa: 'Not enrolled', pwAge: '5 days', joined: created, location: 'Pune, IN'
    })
  );

  // Invited fixture users get a (logged, unusable-until-shared) pending invite record.
  for (const u of db.users.filter((x) => x.status === 'Invited')) {
    db.invites.push({
      id: newId(), workspaceId: u.workspaceId, userId: u.id, email: u.email, name: u.name, role: u.role, team: u.team,
      tokenHash: newId(), invitedBy: db.users[0].id, expiresAt: new Date(Date.now() + 2 * DAY).toISOString(),
      acceptedAt: null, revokedAt: null, createdAt: iso(DAY)
    });
  }

  for (const b of fixtures.bids) {
    const dueAt = new Date(Date.now() + b.daysLeft * DAY).toISOString();
    db.bids.push({
      id: newId(),
      workspaceId: ordinal.id,
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
      receivedOn: new Date(Date.parse(dueAt) - 40 * DAY).toISOString(),
      submittedOn: b.submittedOn && b.submittedOn !== '—' ? new Date(Date.parse(dueAt) - DAY).toISOString() : null,
      tasks: b.tasks.map((t) => ({ label: t.label, owner: t.owner, done: t.done })),
      notes: b.notes.map((n) => ({ text: n.text, author: b.owner, at: iso(ago(n.time) ?? DAY) })),
      createdBy: null,
      createdAt: new Date(Date.parse(dueAt) - 40 * DAY).toISOString(),
      updatedAt: created,
      deletedAt: null
    });
  }

  const invoice = (id, issuedDaysAgo, period, amount, status = 'Paid') => ({
    id, workspaceId: ordinal.id, issued: iso(issuedDaysAgo * DAY), period, amount, status, pdf: null
  });
  db.invoices.push(
    invoice('INV-2026-0142', 245, 'Annual · 50 seats', 12000),
    invoice('INV-2025-0118', 610, 'Annual · 40 seats', 9600),
    invoice('INV-2025-0074', 420, 'Seat true-up · 10 seats', 1600)
  );

  save();
  return { workspaces: db.workspaces.length, users: db.users.length, bids: db.bids.length };
}

// `npm run seed`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const counts = await seed();
  console.log(`[seed] ${counts.workspaces} workspaces, ${counts.users} users, ${counts.bids} bids. Password for every demo login: ${DEMO_PASSWORD}`);
}
