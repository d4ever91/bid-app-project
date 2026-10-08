/**
 * Email → AI → bid.
 *
 * Each email is stored once in `mailItems` (keyed by Message-ID) with the AI's extraction and
 * an outcome:
 *   bid_created   — a bid opportunity at or above the confidence threshold; a bid was created
 *   needs_review  — looks like an opportunity but the AI is unsure (or details are missing)
 *   not_a_bid     — not an opportunity
 *   failed        — the AI call failed (e.g. bad key); can be reprocessed from the inbox
 *   ignored       — dismissed by a person
 */
import crypto from 'node:crypto';
import type { ObjectId } from 'mongodb';
import { audit } from '../audit.js';
import { db, isDuplicate, newId, now } from '../db.js';
import { HttpError } from '../http.js';
import type { Request } from 'express';
import type { AutomationSettingsDoc, BidDoc, BidExtraction, MailItemDoc, UserDoc, WorkspaceDoc } from '../types.js';
import { extractBid, type CompanyContext } from './ai.js';
import { fetchNewEmails, type IncomingEmail } from './mailbox.js';
import { apiKeyFor, loadSettings, mailboxPassword, modelFor } from './settings.js';

const DAY = 864e5;

export const companyContext = (w: WorkspaceDoc): CompanyContext => ({
  name: w.name,
  companyType: w.company?.companyType ?? w.companyType ?? null,
  sectors: w.company?.sectors ?? [],
  country: w.company?.country ?? null
});

const messageKey = (email: IncomingEmail): string =>
  email.messageId?.trim() ||
  'sha256:' + crypto.createHash('sha256').update([email.from, email.subject, email.receivedAt.toISOString(), email.text.slice(0, 2000)].join('\n')).digest('hex');

/** Records an automation event in the audit log without needing a request. */
async function systemEvent(workspaceId: ObjectId, text: string, actor: Pick<UserDoc, '_id' | 'name'> | null, bidId: ObjectId | null = null) {
  await db.auditEvents.insertOne({
    _id: newId(),
    workspaceId,
    at: now(),
    kind: 'automation',
    actorId: actor?._id ?? null,
    actorName: actor?.name ?? 'Bid automation',
    text,
    userId: null,
    bidId,
    ip: null
  });
}

async function nextReference(workspaceId: ObjectId): Promise<string> {
  const refs = await db.bids.find({ workspaceId }, { projection: { reference: 1 } }).toArray();
  // Only our own BID-#### references count — a client's "RBC-2026-114" must not skew numbering.
  const numbers = refs
    .map((b) => /^BID-(\d{1,7})$/.exec(String(b.reference))?.[1])
    .filter((n): n is string => !!n)
    .map(Number);
  return 'BID-' + (numbers.length ? Math.max(...numbers) + 1 : 1001);
}

/** The person new automated bids are assigned to: the workspace's first Owner. */
async function defaultOwner(workspaceId: ObjectId): Promise<string> {
  const owner = await db.users.findOne({ workspaceId, role: 'Owner', deletedAt: null }, { sort: { createdAt: 1 } });
  return owner?.name ?? 'Unassigned';
}

export interface BidOverrides {
  title?: string;
  client?: string;
  reference?: string;
  sector?: string;
  value?: number;
  dueDate?: string;
  ownerName?: string;
}

/** Creates a bid from an email's extraction (plus any edits made in the review screen). */
export async function createBidFromMail(
  item: MailItemDoc,
  actor: Pick<UserDoc, '_id' | 'name'> | null,
  overrides: BidOverrides = {}
): Promise<BidDoc> {
  const x: Partial<BidExtraction> = item.ai?.extraction ?? {};
  const at = now();
  const owner = overrides.ownerName?.trim() || actor?.name || (await defaultOwner(item.workspaceId));
  const due = overrides.dueDate ?? x.dueDate ?? null;
  const dueAt = due && !Number.isNaN(Date.parse(due)) ? new Date(Date.parse(due) + DAY / 2) : null;
  const sender = item.fromName ? `${item.fromName} <${item.from}>` : item.from;
  const confidence = item.ai ? Math.round(item.ai.extraction.confidence * 100) : null;

  let reference = (overrides.reference ?? x.reference ?? '').toString().trim().toUpperCase().replace(/\s+/g, '-').slice(0, 30);
  if (!reference || (await db.bids.findOne({ workspaceId: item.workspaceId, reference }))) reference = await nextReference(item.workspaceId);

  const bid: BidDoc = {
    _id: newId(),
    workspaceId: item.workspaceId,
    reference,
    title: (overrides.title ?? x.title ?? item.subject).slice(0, 140),
    client: (overrides.client ?? x.client ?? item.fromName ?? item.from.split('@')[1] ?? 'Unknown client').slice(0, 120),
    sector: overrides.sector ?? x.sector ?? null,
    contactName: x.contactName ?? item.fromName ?? null,
    contact: x.contactEmail ?? item.from,
    value: Math.max(0, Math.round(overrides.value ?? x.value ?? 0)),
    stage: 'Qualifying',
    ownerName: owner,
    probability: 25,
    incumbent: x.incumbent ?? null,
    dueAt,
    receivedOn: item.receivedAt,
    submittedOn: null,
    tasks: [
      { label: 'Bid/no-bid decision', owner, done: false },
      ...(x.requirements ?? []).map((label) => ({ label: label.slice(0, 200), owner, done: false }))
    ],
    notes: [
      ...(x.summary ? [{ text: x.summary, author: 'AI summary', at }] : []),
      {
        text:
          `Created from the email “${item.subject}” from ${sender}` +
          (item.ai ? ` — read by ${item.ai.provider === 'openai' ? 'OpenAI' : 'Gemini'} (${item.ai.model}), ${confidence}% confident.` : '.') +
          (x.currency && x.currency !== 'GBP' && x.value ? ` Value stated in ${x.currency}.` : ''),
        author: actor ? actor.name : 'Bid automation',
        at
      }
    ],
    createdBy: actor?._id ?? null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null
  };

  try {
    await db.bids.insertOne(bid);
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    bid.reference = await nextReference(item.workspaceId);
    await db.bids.insertOne(bid);
  }
  await db.mailItems.updateOne({ _id: item._id }, { $set: { status: 'bid_created', bidId: bid._id, updatedAt: now() } });
  await systemEvent(item.workspaceId, `Created ${bid.reference} — ${bid.title} from an email from ${item.from}`, actor, bid._id);
  return bid;
}

/** Decides the outcome for an extraction. */
function outcome(x: BidExtraction, threshold: number): MailItemDoc['status'] {
  if (!x.isBid) return 'not_a_bid';
  if (x.confidence >= threshold && (x.title || x.client)) return 'bid_created';
  return 'needs_review';
}

/**
 * Runs one email through the AI and stores the result. Returns the stored item, or the
 * existing one if this email was already processed.
 */
export async function processEmail(
  workspace: WorkspaceDoc,
  settings: AutomationSettingsDoc,
  email: IncomingEmail,
  source: MailItemDoc['source'],
  existing?: MailItemDoc
): Promise<{ item: MailItemDoc; duplicate: boolean; bid: BidDoc | null }> {
  const messageId = existing?.messageId ?? messageKey(email);
  if (!existing) {
    const seen = await db.mailItems.findOne({ workspaceId: workspace._id, messageId });
    if (seen) return { item: seen, duplicate: true, bid: null };
  }

  const provider = settings.provider;
  const apiKey = apiKeyFor(settings);
  const model = modelFor(settings);
  const base: Omit<MailItemDoc, 'status' | 'ai' | 'error'> = {
    _id: existing?._id ?? newId(),
    workspaceId: workspace._id,
    messageId,
    source,
    from: email.from,
    fromName: email.fromName,
    subject: email.subject.slice(0, 500),
    receivedAt: email.receivedAt,
    text: email.text.slice(0, 60000),
    attachments: email.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size, sentToAi: false })),
    bidId: null,
    processedAt: now(),
    updatedAt: now()
  };

  let item: MailItemDoc;
  if (!apiKey) {
    item = { ...base, status: 'failed', ai: null, error: `Add a ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key in Bid automation → Settings.` };
  } else {
    try {
      const result = await extractBid({
        provider,
        apiKey,
        model,
        email,
        company: companyContext(workspace),
        readAttachments: settings.readAttachments
      });
      const sent = new Set(result.attachmentsSent);
      item = {
        ...base,
        attachments: base.attachments.map((a) => ({ ...a, sentToAi: sent.has(a.filename) })),
        status: outcome(result.extraction, settings.autoCreateThreshold),
        ai: { provider, model: result.model, extraction: result.extraction, ms: result.ms },
        error: null
      };
    } catch (err) {
      item = { ...base, status: 'failed', ai: null, error: err instanceof HttpError ? err.message : `AI error: ${(err as Error).message}` };
    }
  }

  // Store first (the unique index stops two pollers processing the same email), then act.
  const autoCreate = item.status === 'bid_created';
  if (autoCreate) item.status = 'needs_review';
  if (existing) {
    await db.mailItems.replaceOne({ _id: existing._id }, item);
  } else {
    try {
      await db.mailItems.insertOne(item);
    } catch (err) {
      if (isDuplicate(err)) {
        const seen = await db.mailItems.findOne({ workspaceId: workspace._id, messageId });
        if (seen) return { item: seen, duplicate: true, bid: null };
      }
      throw err;
    }
  }

  let bid: BidDoc | null = null;
  if (autoCreate) {
    bid = await createBidFromMail(item, null);
    item = { ...item, status: 'bid_created', bidId: bid._id };
  } else if (item.status === 'needs_review') {
    await systemEvent(workspace._id, `Flagged “${item.subject}” from ${item.from} for review (${Math.round((item.ai?.extraction.confidence ?? 0) * 100)}% confident)`, null);
  }
  return { item, duplicate: false, bid };
}

/* ---------------- mailbox polling ---------------- */

export interface PollSummary {
  checked: number;
  created: number;
  review: number;
  notBid: number;
  failed: number;
  skipped: number;
  more: boolean;
  error: string | null;
}

const running = new Set<string>();

/** Checks one workspace's mailbox now. Concurrent calls for the same workspace are refused. */
export async function pollWorkspace(workspaceId: ObjectId, req?: Request): Promise<PollSummary> {
  const key = String(workspaceId);
  if (running.has(key)) throw new HttpError(409, 'ALREADY_RUNNING', 'The mailbox is already being checked — try again in a moment.');
  running.add(key);
  const summary: PollSummary = { checked: 0, created: 0, review: 0, notBid: 0, failed: 0, skipped: 0, more: false, error: null };

  try {
    const [settings, workspace] = await Promise.all([loadSettings(workspaceId), db.workspaces.findOne({ _id: workspaceId })]);
    if (!workspace) throw new HttpError(404, 'NOT_FOUND', 'Workspace not found');
    const password = mailboxPassword(settings);
    if (!settings.mailbox.user || !password) throw new HttpError(400, 'MAILBOX_NOT_SET', 'Connect a mailbox in Bid automation → Settings first.');
    if (!apiKeyFor(settings)) throw new HttpError(400, 'AI_NOT_SET', 'Add an API key for the selected AI provider first.');

    try {
      const { emails, lastUid, uidValidity, more } = await fetchNewEmails(
        { ...settings.mailbox, password },
        { lastUid: settings.mailbox.lastUid, uidValidity: settings.mailbox.uidValidity, since: settings.mailbox.since }
      );
      summary.more = more;
      let cursor = settings.mailbox.lastUid;
      for (const email of emails) {
        const { item, duplicate } = await processEmail(workspace, settings, email, 'imap');
        summary.checked++;
        if (duplicate) summary.skipped++;
        else if (item.status === 'bid_created') summary.created++;
        else if (item.status === 'needs_review') summary.review++;
        else if (item.status === 'not_a_bid') summary.notBid++;
        else summary.failed++;
        cursor = Math.max(cursor, email.uid ?? cursor);
        // Save progress as we go, so a crash mid-batch doesn't re-read finished emails.
        await db.automationSettings.updateOne({ workspaceId }, { $set: { 'mailbox.lastUid': cursor, 'mailbox.uidValidity': uidValidity } });
      }
      await db.automationSettings.updateOne(
        { workspaceId },
        { $set: { 'mailbox.lastUid': Math.max(cursor, lastUid), 'mailbox.uidValidity': uidValidity, 'mailbox.lastCheckedAt': now(), 'mailbox.lastError': null } }
      );
    } catch (err) {
      summary.error = err instanceof HttpError ? err.message : (err as Error).message;
      await db.automationSettings.updateOne({ workspaceId }, { $set: { 'mailbox.lastCheckedAt': now(), 'mailbox.lastError': summary.error } });
      throw err;
    }

    if (summary.checked && req) {
      await audit(req, {
        kind: 'automation',
        text: `Checked the bid mailbox: ${summary.checked} email${summary.checked === 1 ? '' : 's'}, ${summary.created} bid${summary.created === 1 ? '' : 's'} created, ${summary.review} for review`
      });
    }
    return summary;
  } finally {
    running.delete(key);
  }
}

let timer: NodeJS.Timeout | null = null;

/** Background poller: every minute, checks each enabled workspace whose interval has elapsed. */
export function startMailPoller(): void {
  if (timer) return;
  const tick = async () => {
    try {
      const due = await db.automationSettings
        .find({ enabled: true, 'mailbox.user': { $ne: '' }, 'mailbox.password': { $ne: null } })
        .toArray();
      for (const s of due) {
        const last = s.mailbox.lastCheckedAt?.getTime() ?? 0;
        if (Date.now() - last < Math.max(1, s.pollMinutes) * 60_000) continue;
        if (running.has(String(s.workspaceId))) continue;
        const result = await pollWorkspace(s.workspaceId).catch((err: Error) => ({ error: err.message }) as Partial<PollSummary>);
        if (result.error) console.error(`[automation] ${s.mailbox.user}: ${result.error}`);
        else if (result.checked) console.log(`[automation] ${s.mailbox.user}: ${result.checked} new, ${result.created} bids created, ${result.review} for review`);
      }
    } catch (err) {
      // Database briefly unavailable — try again next tick.
      if ((err as { code?: string }).code !== 'DB_NOT_CONNECTED') console.error('[automation] poller error', (err as Error).message);
    }
  };
  timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  setTimeout(() => void tick(), 5_000).unref();
}

export function stopMailPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
