/**
 * End-to-end tests: a real API server on a random port, backed by a throwaway MongoDB database.
 * Run: npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Uses a throwaway database on the MongoDB from TEST_MONGODB_URI (default: local MongoDB),
// dropped again when the run finishes.
const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const dbName = `ordinal_test_${Date.now()}_${process.pid}`;
process.env.ANTHROPIC_API_KEY = '';

const { connect, disconnect, dropDatabase } = await import('../src/db.js');
const { seed, DEMO_PASSWORD } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');

let server;
let base;

before(async () => {
  try {
    await connect(uri, dbName);
  } catch (err) {
    throw new Error(`Tests need MongoDB at ${uri} (set TEST_MONGODB_URI). ${err.message}`);
  }
  await seed();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server?.close();
  await dropDatabase().catch(() => undefined);
  await disconnect();
});

/** Minimal client that keeps the refresh cookie and access token like the browser does. */
function client() {
  let cookie = '';
  let token = null;
  const call = async (method, url, body, extra = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(cookie ? { cookie } : {}),
        ...extra
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) cookie = c.split(';')[0];
    const json = res.status === 204 ? null : await res.json();
    if (json?.data?.accessToken) token = json.data.accessToken;
    return { status: res.status, body: json, headers: res.headers };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b),
    patch: (u, b) => call('PATCH', u, b),
    del: (u) => call('DELETE', u),
    raw: call,
    set token(v) { token = v; },
    get cookie() { return cookie; }
  };
}

const owner = async () => {
  const c = client();
  const r = await c.post('/auth/login', { email: 'a.mercer@ordinal.io', password: DEMO_PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
};

test('health and unknown routes use the envelope', async () => {
  const c = client();
  assert.equal((await c.get('/health')).body.success, true);
  const nf = await c.post('/nope');
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error.code, 'NOT_FOUND');
});

test('CORS allows http://localhost:5173 with credentials, and rejects other origins', async () => {
  const c = client();
  const ok = await c.raw('OPTIONS', '/auth/login', undefined, {
    origin: 'http://localhost:5173',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type,authorization'
  });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');

  const bad = await c.raw('GET', '/health', undefined, { origin: 'http://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('login: wrong password, success, me, refresh rotation, logout', async () => {
  const c = client();
  const wrong = await c.post('/auth/login', { email: 'a.mercer@ordinal.io', password: 'nope-nope-nope' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');

  const missing = await c.post('/auth/login', { email: 'not-an-email', password: '' });
  assert.equal(missing.status, 400);
  assert.ok(missing.body.error.details.fields.email);

  const r = await c.post('/auth/login', { email: 'A.Mercer@ordinal.io', password: DEMO_PASSWORD });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.user.role, 'Owner');
  assert.match(c.cookie, /^ordinal_rt=/);

  const me = await c.get('/auth/me');
  assert.equal(me.body.data.workspace.name, 'Ordinal');

  const oldCookie = c.cookie;
  const refreshed = await c.post('/auth/refresh');
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.data.accessToken);
  assert.notEqual(c.cookie, oldCookie, 'refresh token rotates');

  // Replaying the old refresh token is rejected.
  const replay = await client().raw('POST', '/auth/refresh', undefined, { cookie: oldCookie });
  assert.equal(replay.status, 401);

  await c.post('/auth/logout');
  c.token = null;
  assert.equal((await c.get('/auth/me')).status, 401);
});

test('suspended and invited users cannot log in', async () => {
  const c = client();
  const s = await c.post('/auth/login', { email: 'g.mwangi@ordinal.io', password: DEMO_PASSWORD });
  assert.equal(s.status, 403);
  const i = await c.post('/auth/login', { email: 'r.castellanos@ordinal.io', password: DEMO_PASSWORD });
  assert.equal(i.status, 403);
  assert.equal(i.body.error.code, 'INVITE_PENDING');
});

test('signup with company questions creates an isolated workspace', async () => {
  const c = client();
  const plans = await c.get('/subscription/plans');
  assert.equal(plans.body.data.length, 3);

  const bad = await c.post('/auth/signup', {
    workspace: 'W', domain: 'nope', name: 'A', email: 'x', password: 'short', plan: 'business',
    company: { role: '', country: '', sectors: [], bidVolume: '' }
  });
  assert.equal(bad.status, 400);
  const f = bad.body.error.details.fields;
  for (const key of ['workspace', 'domain', 'email', 'password', 'company.role', 'company.country', 'company.sectors', 'company.bidVolume']) {
    assert.ok(f[key], 'expected field error for ' + key);
  }

  const payload = {
    workspace: 'Wolf Insights', domain: 'wolfinsights.test', name: 'Ayaansh Sharma', email: 'owner@wolfinsights.test',
    password: 'a-long-enough-password', size: '51–200', companyType: 'Consultancy', plan: 'business', cycle: 'annual',
    seats: 10, billing: 'trial',
    company: { companyType: 'Consultancy', size: '51–200', role: 'Sales or BD lead', country: 'India', sectors: ['Healthcare', 'Technology'], bidVolume: '11–50' }
  };
  const r = await c.post('/auth/signup', payload);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.user.role, 'Owner');
  assert.equal(r.body.data.workspace.plan, 'business');
  assert.equal(r.body.data.checkoutUrl, null);

  // New workspace starts empty — nothing leaks from Ordinal.
  assert.equal((await c.get('/users')).body.meta.total, 1);
  assert.equal((await c.get('/bids')).body.meta.total, 0);

  const dupe = await client().post('/auth/signup', { ...payload, domain: 'other.test' });
  assert.equal(dupe.status, 400);
  assert.ok(dupe.body.error.details.fields.email);
});

test('users: list, filter, facets, create, edit, role, status, reset, archive, restore, purge, bulk', async () => {
  const c = await owner();

  const all = await c.get('/users?limit=100');
  assert.equal(all.body.meta.total, 13);
  assert.ok(all.body.data[0]._id);
  assert.equal(all.body.data[0].passwordHash, undefined);

  assert.ok((await c.get('/users?role=Admin')).body.data.every((u) => u.role === 'Admin'));
  assert.ok((await c.get('/users?q=quintero')).body.data.length === 1);
  assert.ok((await c.get('/users?mfa=missing')).body.data.every((u) => !u.mfaEnrolledAt));

  const facets = (await c.get('/users/facets')).body.data;
  assert.ok(facets.teams.includes('Platform'));
  assert.equal(facets.total, 13);

  const created = await c.post('/users', { name: 'Test Person', email: 'test.person@ordinal.io', role: 'Engineer', team: 'Data', sendInvite: true });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.user.status, 'Invited');
  assert.ok(created.body.data.inviteToken);
  const id = created.body.data.user._id;

  const dup = await c.post('/users', { name: 'Again', email: 'test.person@ordinal.io', role: 'Engineer', team: 'Data' });
  assert.equal(dup.status, 409);
  assert.ok(dup.body.error.details.fields.email);

  // The invitee accepts and can sign in.
  const invitee = client();
  const accepted = await invitee.post('/auth/accept-invite', { token: created.body.data.inviteToken, password: 'another-long-password' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal((await invitee.get('/auth/me')).body.data.user.status, 'Active');

  assert.equal((await c.patch('/users/' + id, { team: 'Platform' })).body.data.team, 'Platform');
  assert.equal((await c.patch('/users/' + id + '/role', { role: 'Admin' })).body.data.role, 'Admin');
  assert.equal((await c.patch('/users/' + id + '/status', { status: 'Suspended' })).body.data.status, 'Suspended');
  assert.equal((await invitee.get('/auth/me')).status, 401, 'suspended user loses access');
  assert.equal((await c.post('/users/' + id + '/reset-password')).status, 200);

  assert.equal((await c.del('/users/' + id)).status, 200);
  assert.equal((await c.get('/users?archived=only')).body.data.length, 1);
  assert.equal((await c.post('/users/' + id + '/restore')).status, 200);
  assert.equal((await c.del('/users/' + id + '/purge')).status, 400, 'must archive before purge');
  await c.del('/users/' + id);
  assert.equal((await c.del('/users/' + id + '/purge')).status, 204);

  const me = (await c.get('/auth/me')).body.data.user;
  assert.equal((await c.patch('/users/' + me.id + '/role', { role: 'Admin' })).status, 403, 'cannot demote self');

  const engineers = (await c.get('/users?role=Engineer')).body.data.map((u) => u._id);
  const bulk = await c.post('/users/bulk', { ids: [...engineers, me.id, 'missing'], action: 'reset-password' });
  assert.equal(bulk.status, 200);
  assert.ok(bulk.body.data.applied.length >= engineers.length);
  assert.ok(bulk.body.data.skipped.some((s) => s.id === 'missing'));
});

test('roles are enforced', async () => {
  const ro = client();
  await ro.post('/auth/login', { email: 'b.vance@ordinal.io', password: DEMO_PASSWORD });
  assert.equal((await ro.get('/users')).status, 200);
  assert.equal((await ro.post('/users', { name: 'X Y', email: 'x@y.io', role: 'Engineer', team: 'Data' })).status, 403);
  assert.equal((await ro.post('/bids', { title: 'Nope bid', client: 'Nobody' })).status, 403);

  const admin = client();
  await admin.post('/auth/login', { email: 'n.beshara@ordinal.io', password: DEMO_PASSWORD });
  const owners = (await admin.get('/users?role=Owner')).body.data;
  assert.equal((await admin.patch('/users/' + owners[0]._id + '/role', { role: 'Engineer' })).status, 403, 'admin cannot demote an owner');
  assert.equal((await admin.post('/subscription', { plan: 'team', cycle: 'monthly', seats: 50 })).status, 403, 'billing is owner-only');
});

test('invites: create, list, resend, revoke', async () => {
  const c = await owner();
  const r = await c.post('/invites', { name: 'Ivy Invite', email: 'ivy@ordinal.io', role: 'Read-only', team: 'Security' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.data.invite._id;
  assert.ok((await c.get('/invites')).body.data.some((i) => i._id === id));
  assert.equal((await c.post('/invites/' + id + '/resend')).status, 200);
  const pending = (await c.get('/invites?q=ivy')).body.data;
  assert.equal(pending.length, 1);
  assert.equal((await c.del('/invites/' + pending[0]._id)).status, 204);
  assert.equal((await c.get('/invites?q=ivy')).body.data.length, 0);
});

test('bids: list, filters, summary, create, update, stage, tasks, notes, archive, restore', async () => {
  const c = await owner();
  const list = await c.get('/bids?limit=100');
  assert.equal(list.body.meta.total, 6);
  assert.ok(list.body.data[0].reference.startsWith('BID-'));

  assert.ok((await c.get('/bids?stage=Won')).body.data.every((b) => b.stage === 'Won'));
  assert.ok((await c.get('/bids?due=7d')).body.data.some((b) => b.reference === 'BID-2418'));
  assert.ok((await c.get('/bids?due=closed')).body.data.every((b) => ['Won', 'Lost'].includes(b.stage)));
  const paged = await c.get('/bids?limit=2&page=2&sort=value');
  assert.equal(paged.body.meta.pages, 3);
  assert.equal(paged.body.data.length, 2);

  const summary = (await c.get('/bids/summary')).body.data;
  assert.equal(summary.openCount, 4);
  assert.equal(summary.winRate, 50);
  assert.equal(summary.byStage.length, 6);

  const bad = await c.post('/bids', { title: '', client: '', probability: 140 });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.fields.title && bad.body.error.details.fields.probability);

  const created = await c.post('/bids', {
    reference: 'bid-9001', title: 'Survey platform tender', client: 'City Council', sector: 'Public sector',
    value: '250,000', stage: 'Qualifying', ownerName: 'Avery Mercer', probability: 40, due: '2030-01-15'
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const bid = created.body.data;
  assert.equal(bid.reference, 'BID-9001');
  assert.equal(bid.value, 250000);
  assert.ok(bid.dueAt.startsWith('2030-01-15'));
  assert.equal(bid.tasks.length, 3);

  assert.equal((await c.post('/bids', { reference: 'BID-9001', title: 'Dup ref', client: 'X' })).status, 409);
  assert.equal((await c.patch('/bids/' + bid._id, { value: 300000 })).body.data.value, 300000);

  const staged = await c.patch('/bids/' + bid._id + '/stage', { stage: 'Submitted', note: 'Sent via portal.' });
  assert.equal(staged.body.data.stage, 'Submitted');
  assert.ok(staged.body.data.submittedOn);
  assert.match(staged.body.data.notes[0].text, /Qualifying → Submitted/);

  assert.equal((await c.patch('/bids/' + bid._id + '/tasks', { index: 0, done: true })).body.data.tasks[0].done, true);
  assert.equal((await c.post('/bids/' + bid._id + '/notes', { text: 'Clarification answered.' })).body.data.notes[0].author, 'Avery Mercer');

  assert.equal((await c.del('/bids/' + bid._id)).status, 200);
  assert.equal((await c.get('/bids?limit=100')).body.meta.total, 6);
  assert.equal((await c.post('/bids/' + bid._id + '/restore')).status, 200);
  assert.equal((await c.get('/bids/' + bid._id)).body.data.deletedAt, null);
});

test('subscription: state, change plan, seat rules, checkout/portal, invoices', async () => {
  const c = await owner();
  const s = (await c.get('/subscription')).body.data;
  assert.equal(s.plan.id, 'business');
  assert.equal(s.seatsUsed + s.seatsFree, s.seatsLicensed);

  const tooFew = await c.post('/subscription', { plan: 'business', cycle: 'annual', seats: 1 });
  assert.equal(tooFew.status, 400);
  assert.ok(tooFew.body.error.details.fields.seats);
  const tooMany = await c.post('/subscription', { plan: 'team', cycle: 'annual', seats: 260 });
  assert.equal(tooMany.status, 400);

  const changed = await c.post('/subscription', { plan: 'enterprise', cycle: 'monthly', seats: 60 });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.match(changed.body.message, /Enterprise/);

  assert.equal((await c.post('/subscription/checkout-session', { plan: 'team', cycle: 'annual', seats: 20 })).body.data.url, null);
  assert.equal((await c.post('/subscription/portal-session')).body.data.url, null);
  assert.equal((await c.get('/subscription/invoices')).body.data.length, 3);
});

test('assistant: suggestions and grounded local answers', async () => {
  const c = await owner();
  assert.ok((await c.get('/assistant/suggestions')).body.data.length >= 3);
  const mfa = await c.post('/assistant/chat', { messages: [{ role: 'user', content: 'Who has MFA off?' }] });
  assert.match(mfa.body.data.reply, /Devon Ashworth/);
  const bids = await c.post('/assistant/chat', { messages: [{ role: 'user', content: 'What bids are due this week?' }] });
  assert.match(bids.body.data.reply, /BID-2418/);
  assert.equal((await c.post('/assistant/chat', { messages: [] })).status, 400);
});

test('data is persisted in MongoDB with real types, indexes and DB-side sorting', async () => {
  const { db, ObjectId } = await import('../src/db.js');
  const c = await owner();

  // Stored documents use ObjectIds and Dates, and never expose hashes through the API.
  const avery = await db.users.findOne({ email: 'a.mercer@ordinal.io' });
  assert.ok(avery._id instanceof ObjectId);
  assert.ok(avery.workspaceId instanceof ObjectId);
  assert.ok(avery.createdAt instanceof Date);
  assert.ok(avery.passwordHash.startsWith('$2'));

  const created = await c.post('/bids', { title: 'Persisted bid', client: 'Mongo Council', due: '2031-03-01' });
  const stored = await db.bids.findOne({ _id: new ObjectId(created.body.data._id) });
  assert.equal(stored.title, 'Persisted bid');
  assert.ok(stored.dueAt instanceof Date);
  assert.equal(stored.workspaceId.toString(), avery.workspaceId.toString());

  // Unique index on (workspaceId, reference).
  await assert.rejects(db.bids.insertOne({ workspaceId: avery.workspaceId, reference: stored.reference }), (e) => e.code === 11000);

  // Role sort comes from MongoDB via the stored roleRank: Owners first, Read-only last.
  const byRole = (await c.get('/users?sort=role&limit=100')).body.data.map((u) => u.role);
  assert.equal(byRole[0], 'Owner');
  assert.equal(byRole.at(-1), 'Read-only');

  // Due-date sort puts bids without a due date last.
  await c.post('/bids', { title: 'No due date yet', client: 'TBC Ltd' });
  const byDue = (await c.get('/bids?sort=due&limit=100')).body.data;
  assert.equal(byDue.at(-1).title, 'No due date yet');

  // Refresh tokens are stored hashed, never in plain text.
  const tokens = await db.refreshTokens.find({ userId: avery._id }).toArray();
  assert.ok(tokens.length >= 1);
  assert.ok(tokens.every((t) => /^[a-f0-9]{64}$/.test(t.hash) && t.expiresAt instanceof Date));
});

test('API answers 503 with a clear message while MongoDB is unreachable', async () => {
  const { disconnect, connect } = await import('../src/db.js');
  await disconnect();
  try {
    const r = await client().post('/auth/login', { email: 'a.mercer@ordinal.io', password: DEMO_PASSWORD });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'DB_UNAVAILABLE');
    assert.match(r.body.message, /MongoDB/);
    assert.equal((await client().get('/health')).body.data.database, 'disconnected');
  } finally {
    await connect(uri, dbName);
  }
});
