/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON */
/**
 * Bid automation end to end: settings with encrypted keys, OpenAI + Gemini (fake servers that
 * check the request shape and answer like the real APIs), a real IMAP server (Hoodiecrow)
 * standing in for Gmail, the review inbox, and pasted emails.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const hoodiecrow = require('hoodiecrow-imap');

/* ---------------- fake AI providers ---------------- */

const OPENAI_KEY = 'sk-test-openai-123456';
const GEMINI_KEY = 'AIza-test-gemini-987654';
const ANTHROPIC_KEY = 'sk-ant-test-claude-555777';
const claudeCalls: Array<{ model: string; system: string; question: string }> = [];
const calls: Array<{ provider: string; model: string; files: number; strict?: boolean; text: string }> = [];

function answerFor(text: string) {
  const future = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  if (/invitation to tender/i.test(text)) {
    return {
      isBid: true, confidence: 0.93, reason: 'Formal invitation to tender with a deadline.',
      title: 'Customer survey programme 2027', client: 'Riverside Council', reference: 'RC-2026-114', sector: 'Public sector',
      value: 450000, currency: 'GBP', dueDate: future, contactName: 'Priya Shah', contactEmail: 'p.shah@riverside.gov.uk',
      incumbent: null, summary: 'Riverside Council wants a three-year resident survey programme.',
      requirements: ['Complete the selection questionnaire', 'Submit pricing schedule', 'Attend clarification call']
    };
  }
  if (/possible opportunity/i.test(text)) {
    return {
      isBid: true, confidence: 0.55, reason: 'Informal enquiry that may lead to an RFP.', title: 'Panel research enquiry', client: null,
      reference: null, sector: null, value: null, currency: null, dueDate: null, contactName: null, contactEmail: null, incumbent: null,
      summary: 'Asks whether we could run a research panel.', requirements: []
    };
  }
  return {
    isBid: false, confidence: 0.96, reason: 'Newsletter.', title: null, client: null, reference: null, sector: null, value: null,
    currency: null, dueDate: null, contactName: null, contactEmail: null, incumbent: null, summary: null, requirements: []
  };
}

let aiServer: Server;
let aiBase = '';

function startFakeAi(): Promise<void> {
  aiServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.url === '/openai/chat/completions') {
        if (req.headers.authorization !== `Bearer ${OPENAI_KEY}`) return send(401, { error: { message: 'Incorrect API key provided' } });
        const parts = json.messages[1].content as any[];
        const text = parts.find((p) => p.type === 'text').text as string;
        calls.push({ provider: 'openai', model: json.model, files: parts.filter((p) => p.type === 'file').length, strict: json.response_format?.json_schema?.strict, text });
        return send(200, { choices: [{ message: { role: 'assistant', content: JSON.stringify(answerFor(text)) } }] });
      }
      if (req.url === '/anthropic/messages') {
        if (req.headers['x-api-key'] !== ANTHROPIC_KEY) return send(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
        assert.equal(req.headers['anthropic-version'], '2023-06-01');
        const question = json.messages[json.messages.length - 1].content as string;
        claudeCalls.push({ model: json.model, system: json.system, question });
        return send(200, { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Claude says: ' + question }], stop_reason: 'end_turn' });
      }
      const m = req.url?.match(/^\/gemini\/models\/([^:]+):generateContent$/);
      if (m) {
        if (req.headers['x-goog-api-key'] !== GEMINI_KEY) return send(403, { error: { message: 'API key not valid' } });
        const model = decodeURIComponent(m[1]);
        if (model === 'missing-model') return send(404, { error: { message: 'models/missing-model is not found' } });
        const parts = json.contents[0].parts as any[];
        const text = parts.find((p) => p.text).text as string;
        assert.equal(json.generationConfig.responseMimeType, 'application/json');
        calls.push({ provider: 'gemini', model, files: parts.filter((p) => p.inlineData).length, text });
        return send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(answerFor(text)) }] }, finishReason: 'STOP' }] });
      }
      send(404, { error: { message: 'unknown route ' + req.url } });
    });
  });
  return new Promise((r) => aiServer.listen(0, '127.0.0.1', () => r()));
}

/* ---------------- fake Gmail (real IMAP server) ---------------- */

const email = (subject: string, from: string, body: string, id: string) =>
  [`From: ${from}`, 'To: bids@wolfinsights.test', `Subject: ${subject}`, `Message-ID: <${id}@test>`, `Date: ${new Date().toUTCString()}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n');

let imap: any;
let imapPort = 0;

function startImap(): Promise<void> {
  imap = hoodiecrow({
    users: { 'testuser@wolfinsights.test': { password: 'testpass' } },
    storage: {
      INBOX: {
        messages: [
          { raw: email('Invitation to tender: survey programme', 'Priya Shah <p.shah@riverside.gov.uk>', 'Invitation to tender RC-2026-114. Deadline in three weeks.', 'tender-1'), internaldate: new Date() },
          { raw: email('Weekly research newsletter', 'news@research-digest.test', 'Top stories this week.', 'news-1'), internaldate: new Date() },
          { raw: email('Quick question', 'Sam <sam@northwind.test>', 'This is a possible opportunity: could you run a panel for us?', 'maybe-1'), internaldate: new Date() }
        ]
      }
    }
  });
  return new Promise((r) => {
    imap.listen(0, '127.0.0.1', () => {
      imapPort = (imap.server.address() as AddressInfo).port;
      r();
    });
  });
}

/* ---------------- app + database ---------------- */

const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const dbName = `ordinal_auto_test_${Date.now()}_${process.pid}`;
let server: Server | undefined;
let base = '';
let mod: { db: any; disconnect: () => Promise<void>; dropDatabase: () => Promise<void> };

before(async () => {
  await startFakeAi();
  aiBase = `http://127.0.0.1:${(aiServer.address() as AddressInfo).port}`;
  process.env.OPENAI_BASE_URL = aiBase + '/openai';
  process.env.GEMINI_BASE_URL = aiBase + '/gemini';
  process.env.ANTHROPIC_BASE_URL = aiBase + '/anthropic';
  delete process.env.ANTHROPIC_API_KEY;
  await startImap();

  const dbm = await import('../src/db.js');
  const { seed } = await import('../src/seed.js');
  const { createApp } = await import('../src/app.js');
  await dbm.connect(uri, dbName);
  await seed();
  mod = dbm as any;
  server = createApp().listen(0);
  await new Promise((r) => server!.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  server?.close();
  aiServer?.close();
  await new Promise((r) => imap?.close(r));
  await mod?.dropDatabase().catch(() => undefined);
  await mod?.disconnect();
});

async function login(emailAddr = 'a.mercer@ordinal.io') {
  const r = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emailAddr, password: 'ordinal-dev-password' })
  });
  const token = ((await r.json()) as any).data.accessToken as string;
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: (res.status === 204 ? null : await res.json()) as any };
  };
}

/* ---------------- tests ---------------- */

test('IMAP test server is up', () => assert.ok(imapPort > 0, 'imap port ' + imapPort));

test('settings: keys are encrypted, masked, and admin-only', async () => {
  const api = await login();
  const empty = (await api('GET', '/automation/settings')).body.data;
  assert.equal(empty.openai.hasKey, false);
  assert.equal(empty.mailbox.host, 'imap.gmail.com');
  assert.equal(empty.ready.polling, false);

  const bad = await api('PUT', '/automation/settings', { mailbox: { user: 'not-an-email' }, autoCreateThreshold: 5 });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.fields['mailbox.user']);

  const saved = await api('PUT', '/automation/settings', {
    provider: 'openai',
    enabled: true,
    openai: { apiKey: OPENAI_KEY },
    gemini: { apiKey: GEMINI_KEY, model: 'gemini-3.5-flash' },
    mailbox: { user: 'testuser@wolfinsights.test', password: 'test pass', host: '127.0.0.1', port: imapPort, secure: false },
    autoCreateThreshold: 0.75
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const s = saved.body.data;
  assert.equal(s.openai.hasKey, true);
  assert.equal(s.openai.keyHint, 'sk-…3456');
  assert.equal(s.gemini.keyHint, 'AIz…7654');
  assert.equal(s.ready.polling, true);
  assert.ok(!JSON.stringify(saved.body).includes(OPENAI_KEY), 'raw key never returned');

  const stored = await mod.db.automationSettings.findOne({});
  assert.match(stored.openai.apiKey, /^v1:/);
  assert.ok(!stored.openai.apiKey.includes('openai-123456'));
  assert.match(stored.mailbox.password, /^v1:/);

  // Omitting a key keeps it; Engineers and Read-only can't see settings.
  const again = await api('PUT', '/automation/settings', { pollMinutes: 10 });
  assert.equal(again.body.data.openai.hasKey, true);
  const engineer = await login('m.quintero@ordinal.io');
  assert.equal((await engineer('GET', '/automation/settings')).status, 403);
});

test('test buttons: OpenAI, Gemini and the mailbox', async () => {
  const api = await login();
  const okAi = await api('POST', '/automation/test-ai', { provider: 'openai' });
  assert.equal(okAi.status, 200, JSON.stringify(okAi.body));
  assert.match(okAi.body.message, /OpenAI \(gpt-6-luna\) works/);
  assert.equal(calls.at(-1)?.strict, true, 'OpenAI request uses strict structured outputs');

  const badKey = await api('POST', '/automation/test-ai', { provider: 'openai', apiKey: 'sk-wrong-key-000000' });
  assert.equal(badKey.status, 502);
  assert.match(badKey.body.message, /rejected the API key/);

  const badModel = await api('POST', '/automation/test-ai', { provider: 'gemini', model: 'missing-model' });
  assert.match(badModel.body.message, /doesn't know the model "missing-model"/);

  const box = await api('POST', '/automation/test-mailbox', {});
  assert.equal(box.status, 200, JSON.stringify(box.body));
  assert.equal(box.body.data.messages, 3);

  const wrong = await api('POST', '/automation/test-mailbox', { password: 'nope' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.message, /rejected the login/);
});

test('checking the mailbox creates confident bids and queues unsure ones', async () => {
  const api = await login();
  const run = await api('POST', '/automation/run');
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.deepEqual(
    { checked: run.body.data.checked, created: run.body.data.created, review: run.body.data.review, notBid: run.body.data.notBid },
    { checked: 3, created: 1, review: 1, notBid: 1 }
  );

  const bids = (await api('GET', '/bids?q=RC-2026-114')).body.data;
  assert.equal(bids.length, 1);
  const bid = bids[0];
  assert.equal(bid.client, 'Riverside Council');
  assert.equal(bid.value, 450000);
  assert.equal(bid.stage, 'Qualifying');
  assert.ok(bid.dueAt);
  assert.equal(bid.contact, 'p.shah@riverside.gov.uk');
  assert.deepEqual(bid.tasks.map((t: any) => t.label).slice(1), ['Complete the selection questionnaire', 'Submit pricing schedule', 'Attend clarification call']);
  assert.ok(bid.notes.some((n: any) => /Created from the email/.test(n.text) && /93% confident/.test(n.text)));

  // Nothing new → nothing re-read; a new email arriving is picked up on the next check.
  assert.match((await api('POST', '/automation/run')).body.message, /No new emails/);
  imap.appendMessage('INBOX', [], new Date(), email('Invitation to tender: data platform', 'buyer@harbour.test', 'Invitation to tender HB-77.', 'tender-2'));
  const next = await api('POST', '/automation/run');
  assert.equal(next.body.data.checked, 1);
  assert.equal(next.body.data.created, 1);

  // The mailbox was opened read-only: nothing was marked as read.
  const flags = imap.getMailbox('INBOX').messages.map((m: any) => m.flags);
  assert.ok(flags.every((f: string[]) => !f.includes('\\Seen')));
});

test('review inbox: counts, create with corrections, ignore', async () => {
  const api = await login();
  const list = await api('GET', '/automation/inbox');
  assert.equal(list.status, 200);
  assert.equal(list.body.meta.counts.bid_created, 2);
  assert.equal(list.body.meta.counts.needs_review, 1);
  assert.equal(list.body.meta.counts.not_a_bid, 1);

  const review = (await api('GET', '/automation/inbox?status=needs_review')).body.data[0];
  assert.equal(review.ai.confidence, 0.55);
  const created = await api('POST', `/automation/inbox/${review.id}/create-bid`, { title: 'Northwind research panel', client: 'Northwind', value: 30000 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.bid.title, 'Northwind research panel');
  assert.equal(created.body.data.bid.value, 30000);
  // Numbering continues our BID-#### series; a client's "RC-2026-114" doesn't skew it.
  assert.match(created.body.data.bid.reference, /^BID-24\d\d$/);
  assert.equal((await api('POST', `/automation/inbox/${review.id}/create-bid`, {})).status, 400, 'no double creation');

  const newsletter = (await api('GET', '/automation/inbox?status=not_a_bid')).body.data[0];
  assert.equal((await api('POST', `/automation/inbox/${newsletter.id}/ignore`)).body.data.status, 'ignored');

  const events = (await api('GET', '/overview?events=20')).body.data.events;
  assert.ok(events.some((e: any) => e.kind === 'automation' && /Created RC-2026-114/.test(e.text)));
});

test('pasted emails: Gemini, duplicates, PDF attachments, missing key → failed then reprocess', async () => {
  const api = await login();
  await api('PUT', '/automation/settings', { provider: 'gemini' });
  const pasted = await api('POST', '/automation/ingest', {
    from: 'tenders@cityhealth.test',
    subject: 'Invitation to tender: patient feedback survey',
    text: 'Invitation to tender CH-9. Please respond by the deadline.'
  });
  assert.equal(pasted.status, 201, JSON.stringify(pasted.body));
  assert.equal(pasted.body.data.item.status, 'bid_created');
  assert.equal(pasted.body.data.item.ai.provider, 'gemini');
  assert.equal(calls.at(-1)?.provider, 'gemini');

  // A raw .eml with a PDF: the PDF is sent to the model.
  const pdf = Buffer.from('%PDF-1.4\n% fake tender pack\n').toString('base64');
  const raw = [
    'From: buyer@portal.test', 'Subject: Invitation to tender with documents', 'Message-ID: <pdf-1@test>', 'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"', '', '--b1', 'Content-Type: text/plain', '', 'Invitation to tender — see the attached pack.',
    '--b1', 'Content-Type: application/pdf; name="tender-pack.pdf"', 'Content-Disposition: attachment; filename="tender-pack.pdf"',
    'Content-Transfer-Encoding: base64', '', pdf, '--b1--', ''
  ].join('\r\n');
  const withPdf = await api('POST', '/automation/ingest', { raw });
  assert.equal(withPdf.status, 201, JSON.stringify(withPdf.body));
  assert.equal(calls.at(-1)?.files, 1);
  assert.equal(withPdf.body.data.item.attachments[0].sentToAi, true);

  const dup = await api('POST', '/automation/ingest', { raw });
  assert.equal(dup.body.message, 'This email was already processed');

  // Remove the key: processing fails with a clear message; add it back and reprocess.
  await api('PUT', '/automation/settings', { gemini: { apiKey: '' } });
  const failed = await api('POST', '/automation/ingest', { subject: 'Invitation to tender: archive', text: 'Invitation to tender AR-1.' });
  assert.equal(failed.body.data.item.status, 'failed');
  assert.match(failed.body.data.item.error, /Add a Gemini API key/);

  await api('PUT', '/automation/settings', { gemini: { apiKey: GEMINI_KEY } });
  const again = await api('POST', `/automation/inbox/${failed.body.data.item.id}/reprocess`);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.data.item.status, 'bid_created');
});

test('integrations: Anthropic key powers the assistant, then falls back when removed', async () => {
  const api = await login();
  const ask = async () => (await api('POST', '/assistant/chat', { messages: [{ role: 'user', content: 'Which bids are due in the next 7 days?' }] })).body.data.reply as string;

  // No key anywhere: built-in answers, no call to Claude.
  let r = await api('GET', '/automation/settings');
  assert.equal(r.body.data.anthropic.hasKey, false);
  assert.equal(r.body.data.anthropic.serverKey, false);
  assert.equal(r.body.data.anthropic.model, 'claude-sonnet-5-5');
  assert.ok(r.body.data.anthropic.suggestions.length > 0);
  const before = claudeCalls.length;
  assert.doesNotMatch(await ask(), /^Claude says/);
  assert.equal(claudeCalls.length, before);

  // Test with a wrong key, then the right one (not yet saved).
  r = await api('POST', '/automation/test-ai', { provider: 'anthropic' });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.details.fields['anthropic.apiKey']);
  r = await api('POST', '/automation/test-ai', { provider: 'anthropic', apiKey: 'sk-ant-wrong' });
  assert.equal(r.status, 502);
  r = await api('POST', '/automation/test-ai', { provider: 'anthropic', apiKey: ANTHROPIC_KEY });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.message, /^Anthropic \(claude-sonnet-5-5\) works/);

  // Save it: encrypted at rest, masked in the API, used by the assistant with the chosen model.
  r = await api('PUT', '/automation/settings', { anthropic: { apiKey: ANTHROPIC_KEY, model: 'claude-haiku-5-5' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.anthropic.hasKey, true);
  assert.equal(r.body.data.anthropic.model, 'claude-haiku-5-5');
  assert.ok(!JSON.stringify(r.body).includes(ANTHROPIC_KEY));
  assert.match(r.body.data.anthropic.keyHint, /5777$/);
  const doc = await mod.db.automationSettings.findOne({});
  assert.ok(doc.anthropic.apiKey && !JSON.stringify(doc.anthropic).includes(ANTHROPIC_KEY));

  assert.equal(await ask(), 'Claude says: Which bids are due in the next 7 days?');
  const last = claudeCalls[claudeCalls.length - 1];
  assert.equal(last.model, 'claude-haiku-5-5');
  assert.match(last.system, /Bids:/);

  // Saving other settings keeps the key; removing it falls back to built-in answers.
  r = await api('PUT', '/automation/settings', { pollMinutes: 10 });
  assert.equal(r.body.data.anthropic.hasKey, true);
  r = await api('PUT', '/automation/settings', { anthropic: { apiKey: '' } });
  assert.equal(r.body.data.anthropic.hasKey, false);
  const n = claudeCalls.length;
  assert.doesNotMatch(await ask(), /^Claude says/);
  assert.equal(claudeCalls.length, n);
});

test('integrations: only Owners and Admins can set the Anthropic key', async () => {
  const users = await mod.db.users.find({ role: 'Engineer' }).toArray();
  if (!users.length) return;
  const api = await login(users[0].email);
  const r = await api('PUT', '/automation/settings', { anthropic: { apiKey: ANTHROPIC_KEY } });
  assert.equal(r.status, 403);
});
