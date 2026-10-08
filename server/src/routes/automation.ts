/**
 * Bid automation API: settings (API keys, mailbox), test buttons, "check now", paste an email,
 * and the bid inbox (review queue).
 *
 * Keys and passwords are write-only: send a new value to set it, "" to remove it, or leave the
 * field out to keep the current one. Responses only ever say whether a key is set.
 */
import { Router, type Request } from 'express';
import type { Filter } from 'mongodb';
import { db, now, toId } from '../db.js';
import {
  assertValid, badRequest, bodyOf, clean, notFound, ok, pageMeta, paging, q, rules, validate
} from '../http.js';
import { allow, ctx, requireAuth } from '../auth.js';
import { audit } from '../audit.js';
import { encryptSecret } from '../secrets.js';
import { publicBid } from '../serialize.js';
import { AI_PROVIDERS, MAIL_STATUSES, type AiProvider, type AutomationSettingsDoc, type MailItemDoc, type MailStatus } from '../types.js';
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_MODELS, testAnthropic, testProvider } from '../automation/ai.js';
import { parseRawEmail, testMailbox, type IncomingEmail } from '../automation/mailbox.js';
import { companyContext, createBidFromMail, pollWorkspace, processEmail, type BidOverrides } from '../automation/pipeline.js';
import { anthropicFor, apiKeyFor, defaultSettings, loadSettings, mailboxPassword, modelFor, publicSettings } from '../automation/settings.js';

const router = Router();
router.use(requireAuth);

const admins = allow('Owner', 'Admin');
const bidWriters = allow('Owner', 'Admin', 'Engineer');
const isProvider = (v: unknown): v is AiProvider => AI_PROVIDERS.includes(v as AiProvider);

/* ---------------- settings ---------------- */

router.get('/settings', admins, async (req, res) => {
  ok(res, publicSettings(await loadSettings(ctx(req).workspace._id)));
});

router.put('/settings', admins, async (req, res) => {
  const { workspace } = ctx(req);
  const body = bodyOf(req.body);
  const openai = bodyOf(body.openai);
  const gemini = bodyOf(body.gemini);
  const anthropic = bodyOf(body.anthropic);
  const mailbox = bodyOf(body.mailbox);

  assertValid(
    {
      ...validate(body, {
        provider: [rules.oneOf(AI_PROVIDERS, 'Choose OpenAI or Gemini')],
        enabled: [rules.boolean()],
        readAttachments: [rules.boolean()],
        autoCreateThreshold: [rules.number(0.3, 1, 'Pick a confidence between 30% and 100%')],
        pollMinutes: [rules.int(1, 1440, 'Check every 1 to 1440 minutes')]
      }),
      ...validate(openai, { apiKey: [rules.maxLen(400)], model: [rules.maxLen(80)] }, 'openai.'),
      ...validate(gemini, { apiKey: [rules.maxLen(400)], model: [rules.maxLen(80)] }, 'gemini.'),
      ...validate(anthropic, { apiKey: [rules.maxLen(400)], model: [rules.maxLen(80)] }, 'anthropic.'),
      ...validate(
        mailbox,
        {
          user: [rules.email('Enter the full Gmail address, e.g. bids@yourcompany.com')],
          password: [rules.maxLen(200)],
          host: [rules.maxLen(200)],
          port: [rules.int(1, 65535)],
          secure: [rules.boolean()],
          folder: [rules.maxLen(200)]
        },
        'mailbox.'
      )
    },
    'Some settings need fixing'
  );

  const current = await loadSettings(workspace._id);
  const set: Record<string, unknown> = { updatedAt: now() };
  if (body.enabled !== undefined) set.enabled = body.enabled === true;
  if (body.provider !== undefined) set.provider = body.provider;
  if (body.readAttachments !== undefined) set.readAttachments = body.readAttachments === true;
  if (body.autoCreateThreshold !== undefined) set.autoCreateThreshold = Number(body.autoCreateThreshold);
  if (body.pollMinutes !== undefined) set.pollMinutes = Number(body.pollMinutes);

  const changes: string[] = [];
  const names = { openai: 'OpenAI', gemini: 'Gemini', anthropic: 'Anthropic' } as const;
  for (const [provider, input] of [['openai', openai], ['gemini', gemini], ['anthropic', anthropic]] as const) {
    if (input.apiKey !== undefined) {
      const key = clean(input.apiKey);
      set[`${provider}.apiKey`] = key ? encryptSecret(key) : null;
      changes.push(`${key ? 'set' : 'removed'} the ${names[provider]} API key`);
    }
    if (input.model !== undefined) {
      set[`${provider}.model`] = clean(input.model) || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_MODELS[provider]);
    }
  }

  const newUser = mailbox.user !== undefined ? clean(mailbox.user).toLowerCase() : undefined;
  if (newUser !== undefined) set['mailbox.user'] = newUser;
  if (mailbox.password !== undefined) {
    // Google shows app passwords in groups of four ("abcd efgh ijkl mnop"); spaces aren't part of it.
    const pw = String(mailbox.password).replace(/\s+/g, '');
    set['mailbox.password'] = pw ? encryptSecret(pw) : null;
    changes.push(pw ? 'set the mailbox password' : 'removed the mailbox password');
  }
  if (mailbox.host !== undefined) set['mailbox.host'] = clean(mailbox.host) || 'imap.gmail.com';
  if (mailbox.port !== undefined) set['mailbox.port'] = Number(mailbox.port) || 993;
  if (mailbox.secure !== undefined) set['mailbox.secure'] = mailbox.secure !== false;
  if (mailbox.folder !== undefined) set['mailbox.folder'] = clean(mailbox.folder) || 'INBOX';

  // A different mailbox or folder starts reading afresh (last 7 days).
  const mailboxChanged =
    (newUser !== undefined && newUser !== current.mailbox.user) ||
    (mailbox.host !== undefined && clean(mailbox.host) !== current.mailbox.host) ||
    (mailbox.folder !== undefined && clean(mailbox.folder) !== current.mailbox.folder);
  if (mailboxChanged) Object.assign(set, { 'mailbox.lastUid': 0, 'mailbox.uidValidity': null, 'mailbox.since': null, 'mailbox.lastError': null });

  const defaults = defaultSettings(workspace._id);
  const { _id, workspaceId, createdAt, updatedAt: _u, ...rest } = defaults;
  const insertDefaults = Object.fromEntries(
    Object.entries(flatten(rest)).filter(([k]) => !Object.keys(set).some((s) => s === k || s.startsWith(k + '.') || k.startsWith(s + '.')))
  );
  const saved = await db.automationSettings.findOneAndUpdate(
    { workspaceId: workspace._id },
    { $set: set, $setOnInsert: { _id, workspaceId, createdAt, ...insertDefaults } },
    { upsert: true, returnDocument: 'after' }
  );
  if (!saved) throw notFound('Settings not found');

  const summary = [
    ...changes,
    set.enabled !== undefined && set.enabled !== current.enabled ? (set.enabled ? 'turned automation on' : 'turned automation off') : null,
    set.provider && set.provider !== current.provider ? `switched AI to ${set.provider === 'openai' ? 'OpenAI' : 'Gemini'}` : null,
    mailboxChanged ? `connected mailbox ${saved.mailbox.user}` : null
  ].filter(Boolean);
  await audit(req, { kind: 'automation', text: summary.length ? `Bid automation: ${summary.join(', ')}` : 'Updated bid automation settings' });
  ok(res, publicSettings(saved), 'Settings saved');
});

/** Flattens nested defaults into dotted paths for $setOnInsert (so it never clashes with $set). */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix + k;
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, path + '.'));
    else out[path] = v;
  }
  return out;
}

/** "Test" next to a key: makes one small real request with the saved (or just-typed) key. */
router.post('/test-ai', admins, async (req, res) => {
  const { workspace } = ctx(req);
  const body = bodyOf(req.body);
  const settings = await loadSettings(workspace._id);

  if (body.provider === 'anthropic') {
    const saved = anthropicFor(settings);
    const apiKey = clean(body.apiKey) || saved.apiKey;
    if (!apiKey) throw badRequest('Enter an Anthropic API key first', { 'anthropic.apiKey': 'Enter an API key' });
    const model = clean(body.model) || settings.anthropic.model;
    const { ms } = await testAnthropic(apiKey, model);
    return ok(res, { provider: 'anthropic', model, ms }, `Anthropic (${model}) works — answered in ${(ms / 1000).toFixed(1)}s`);
  }

  const provider = isProvider(body.provider) ? body.provider : settings.provider;
  const apiKey = clean(body.apiKey) || apiKeyFor(settings, provider);
  if (!apiKey) throw badRequest(`Enter a ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key first`, { [`${provider}.apiKey`]: 'Enter an API key' });
  const model = clean(body.model) || modelFor(settings, provider);

  const result = await testProvider(provider, apiKey, model, companyContext(workspace));
  const x = result.extraction;
  ok(
    res,
    { provider, model, ms: result.ms, sample: { isBid: x.isBid, confidence: x.confidence, title: x.title, client: x.client, dueDate: x.dueDate, value: x.value } },
    `${provider === 'openai' ? 'OpenAI' : 'Gemini'} (${model}) works — answered in ${(result.ms / 1000).toFixed(1)}s`
  );
});

/** "Test mailbox": logs in and opens the folder (read-only). */
router.post('/test-mailbox', admins, async (req, res) => {
  const body = bodyOf(req.body);
  const settings = await loadSettings(ctx(req).workspace._id);
  const cfg = {
    host: clean(body.host) || settings.mailbox.host,
    port: Number(body.port) || settings.mailbox.port,
    secure: body.secure === undefined ? settings.mailbox.secure : body.secure !== false,
    user: clean(body.user).toLowerCase() || settings.mailbox.user,
    password: String(body.password ?? '').replace(/\s+/g, '') || mailboxPassword(settings) || '',
    folder: clean(body.folder) || settings.mailbox.folder
  };
  if (!cfg.user || !cfg.password) throw badRequest('Enter the Gmail address and app password first', { 'mailbox.password': 'Enter the app password' });
  const result = await testMailbox(cfg);
  ok(res, result, `Connected to ${cfg.user} — ${result.folder} has ${result.messages.toLocaleString('en-GB')} email${result.messages === 1 ? '' : 's'}`);
});

/** "Check now": polls the mailbox immediately. */
router.post('/run', admins, async (req, res) => {
  const summary = await pollWorkspace(ctx(req).workspace._id, req);
  const message = summary.checked
    ? `Read ${summary.checked} new email${summary.checked === 1 ? '' : 's'}: ${summary.created} bid${summary.created === 1 ? '' : 's'} created, ${summary.review} to review, ${summary.notBid} not bids` +
      (summary.failed ? `, ${summary.failed} failed` : '') +
      (summary.more ? ' — more waiting, check again' : '')
    : 'No new emails since the last check';
  ok(res, summary, message);
});

/** Paste an email (raw .eml source, or from/subject/body) to run it through the AI. */
router.post('/ingest', bidWriters, async (req, res) => {
  const { workspace } = ctx(req);
  const body = bodyOf(req.body);
  let email: IncomingEmail;
  if (clean(body.raw)) {
    email = await parseRawEmail(String(body.raw));
  } else {
    assertValid(
      validate(body, {
        subject: [rules.required('Add the email subject'), rules.maxLen(500)],
        text: [rules.required('Paste the email text'), rules.maxLen(60000)],
        from: [rules.email()]
      })
    );
    email = {
      uid: null,
      messageId: null,
      from: clean(body.from).toLowerCase() || 'pasted@manual',
      fromName: clean(body.fromName) || null,
      subject: clean(body.subject),
      receivedAt: new Date(),
      text: String(body.text),
      attachments: []
    };
  }
  const settings = await loadSettings(workspace._id);
  const { item, duplicate, bid } = await processEmail(workspace, settings, email, 'manual');
  ok(
    res,
    { item: publicItem(item), bid: bid ? publicBid(bid) : null },
    duplicate ? 'This email was already processed' : outcomeMessage(item, bid?.reference),
    { status: duplicate ? 200 : 201 }
  );
});

/* ---------------- inbox ---------------- */

function publicItem(m: MailItemDoc) {
  return {
    id: String(m._id),
    source: m.source,
    from: m.from,
    fromName: m.fromName,
    subject: m.subject,
    receivedAt: m.receivedAt.toISOString(),
    preview: m.text.replace(/\s+/g, ' ').slice(0, 280),
    text: m.text.slice(0, 20000),
    attachments: m.attachments,
    status: m.status,
    ai: m.ai ? { provider: m.ai.provider, model: m.ai.model, ms: m.ai.ms, ...m.ai.extraction } : null,
    error: m.error,
    bidId: m.bidId ? String(m.bidId) : null,
    processedAt: m.processedAt.toISOString()
  };
}

function outcomeMessage(m: MailItemDoc, reference?: string): string {
  const pct = m.ai ? Math.round(m.ai.extraction.confidence * 100) + '% confident' : '';
  switch (m.status) {
    case 'bid_created':
      return `Bid ${reference ?? ''} created from “${m.subject}” (${pct})`.replace('  ', ' ');
    case 'needs_review':
      return `Looks like a bid but needs review (${pct})`;
    case 'not_a_bid':
      return `Not a bid opportunity (${pct})`;
    case 'failed':
      return m.error ?? 'Processing failed';
    default:
      return 'Done';
  }
}

router.get('/inbox', bidWriters, async (req, res) => {
  const { workspace } = ctx(req);
  const filter: Filter<MailItemDoc> = { workspaceId: workspace._id };
  const status = q(req.query.status);
  if (MAIL_STATUSES.includes(status as MailStatus)) filter.status = status as MailStatus;
  const { page, limit } = paging(req.query);
  const [total, rows, counts] = await Promise.all([
    db.mailItems.countDocuments(filter),
    db.mailItems.find(filter).sort({ receivedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    db.mailItems.aggregate<{ _id: MailStatus; n: number }>([{ $match: { workspaceId: workspace._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray()
  ]);
  const byStatus = Object.fromEntries(MAIL_STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.n ?? 0]));
  res.status(200).json({ success: true, data: rows.map(publicItem), message: null, meta: { ...pageMeta(page, limit, total), counts: byStatus } });
});

async function findItem(req: Request) {
  const _id = toId(req.params.id);
  const item = _id && (await db.mailItems.findOne({ _id, workspaceId: ctx(req).workspace._id }));
  if (!item) throw notFound('Email not found');
  return item;
}

router.get('/inbox/:id', bidWriters, async (req, res) => ok(res, publicItem(await findItem(req))));

/** Creates a bid from a reviewed email, with any corrections made on screen. */
router.post('/inbox/:id/create-bid', bidWriters, async (req, res) => {
  const { user } = ctx(req);
  const item = await findItem(req);
  if (item.bidId && (await db.bids.findOne({ _id: item.bidId, deletedAt: null }))) throw badRequest('A bid was already created from this email');
  const body = bodyOf(req.body);
  assertValid(
    validate(body, {
      title: [rules.maxLen(140)],
      client: [rules.maxLen(120)],
      reference: [rules.maxLen(30)],
      sector: [rules.maxLen(60)],
      value: [rules.number(0, 1e11)],
      dueDate: [(v) => (v === undefined || v === '' || !Number.isNaN(Date.parse(String(v))) ? null : 'Use a date like 2026-11-30')],
      ownerName: [rules.maxLen(80)]
    })
  );
  const overrides: BidOverrides = {};
  for (const k of ['title', 'client', 'reference', 'sector', 'dueDate', 'ownerName'] as const) if (clean(body[k])) overrides[k] = clean(body[k]);
  if (body.value !== undefined && body.value !== '') overrides.value = Number(body.value);

  const bid = await createBidFromMail(item, user, overrides);
  ok(res, { bid: publicBid(bid), item: publicItem({ ...item, status: 'bid_created', bidId: bid._id }) }, `${bid.reference} created — ${bid.title}`, { status: 201 });
});

router.post('/inbox/:id/ignore', bidWriters, async (req, res) => {
  const item = await findItem(req);
  await db.mailItems.updateOne({ _id: item._id }, { $set: { status: 'ignored', updatedAt: now() } });
  ok(res, publicItem({ ...item, status: 'ignored' }), 'Email dismissed');
});

/** Runs the email through the AI again (e.g. after fixing a key or switching provider). */
router.post('/inbox/:id/reprocess', bidWriters, async (req, res) => {
  const { workspace } = ctx(req);
  const item = await findItem(req);
  if (item.status === 'bid_created') throw badRequest('A bid was already created from this email');
  const settings: AutomationSettingsDoc = await loadSettings(workspace._id);
  const email: IncomingEmail = {
    uid: null,
    messageId: item.messageId,
    from: item.from,
    fromName: item.fromName,
    subject: item.subject,
    receivedAt: item.receivedAt,
    text: item.text,
    // Attachment contents aren't stored, so a re-run reads the email text only.
    attachments: []
  };
  const { item: updated, bid } = await processEmail(workspace, settings, email, item.source, item);
  ok(res, { item: publicItem({ ...updated, attachments: item.attachments }), bid: bid ? publicBid(bid) : null }, outcomeMessage(updated, bid?.reference));
});

export default router;
