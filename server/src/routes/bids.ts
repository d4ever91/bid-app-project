import { Router, type Request } from 'express';
import type { Filter, Sort, UpdateFilter } from 'mongodb';
import { db, escapeRegex, isDuplicate, newId, now, toId } from '../db.js';
import {
  assertValid, badRequest, bodyOf, clean, conflict, notFound, ok, pageMeta, paging, q, rules, validate, type Rule, type Schema
} from '../http.js';
import { allow, ctx, requireAuth } from '../auth.js';
import { audit } from '../audit.js';
import { publicBid } from '../serialize.js';
import { STAGES, type BidDoc, type BidNote, type BidStage } from '../types.js';

const CLOSED: BidStage[] = ['Won', 'Lost'];
const DAY = 864e5;
const isStage = (v: unknown): v is BidStage => STAGES.includes(v as BidStage);

// Read-only users can browse the pipeline but not change it.
const write = allow('Owner', 'Admin', 'Engineer');

const router = Router();
router.use(requireAuth);

async function findBid(req: Request, id: unknown, { includeArchived = false } = {}): Promise<BidDoc> {
  const _id = toId(id);
  const bid = await db.bids.findOne({
    workspaceId: ctx(req).workspace._id,
    ...(_id ? { _id } : { reference: String(id).toUpperCase() })
  });
  if (!bid || (!includeArchived && bid.deletedAt)) throw notFound('Bid not found');
  return bid;
}

/** Accepts ISO dates, "14 Aug 2026", or blank. Returns a Date or null; undefined means "invalid". */
function parseDate(value: unknown): Date | null | undefined {
  const v = clean(value);
  if (!v || v === 'TBC' || v === '—') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t);
}

const dateRule = (msg = 'Use a date like 14 Aug 2026'): Rule => (v) => (parseDate(v) === undefined ? msg : null);

/** Due-date window matching the UI's rounded "days left": day 0 through day N. */
const dueWithin = (days: number) => ({ $gte: new Date(Date.now() - DAY / 2), $lte: new Date(Date.now() + (days + 0.5) * DAY) });

async function nextReference(req: Request): Promise<string> {
  const refs = await db.bids.find({ workspaceId: ctx(req).workspace._id }, { projection: { reference: 1 } }).toArray();
  // Only our own BID-#### references count — a client's "RBC-2026-114" must not skew numbering.
  const numbers = refs
    .map((b) => /^BID-(\d{1,7})$/.exec(String(b.reference))?.[1])
    .filter((n): n is string => !!n)
    .map(Number);
  return 'BID-' + (numbers.length ? Math.max(...numbers) + 1 : 1001);
}

const note = (text: string, author: string): BidNote => ({ text, author, at: now() });

/** Applies an update (always bumping updatedAt) and returns the updated document. */
async function updateBid(bid: BidDoc, update: UpdateFilter<BidDoc>): Promise<BidDoc> {
  const updated = await db.bids.findOneAndUpdate(
    { _id: bid._id },
    { ...update, $set: { ...(update.$set ?? {}), updatedAt: now() } },
    { returnDocument: 'after' }
  );
  if (!updated) throw notFound('Bid not found');
  return updated;
}

const SORTS: Record<string, Sort> = {
  // Bids without a due date ("TBC") go last.
  due: { _noDue: 1, dueAt: 1, _id: 1 },
  value: { value: -1, _id: 1 },
  probability: { probability: -1, _id: 1 },
  client: { client: 1, _id: 1 }
};

/* ---------------- reads ---------------- */

router.get('/', async (req, res) => {
  const { workspace } = ctx(req);
  const and: Filter<BidDoc>[] = [{ workspaceId: workspace._id }];
  const archived = q(req.query.archived) || 'exclude';

  if (archived === 'exclude') and.push({ deletedAt: null });
  if (archived === 'only') and.push({ deletedAt: { $ne: null } });
  const needle = q(req.query.q);
  if (needle) {
    const re = { $regex: escapeRegex(needle), $options: 'i' };
    and.push({ $or: [{ title: re }, { client: re }, { reference: re }, { ownerName: re }] });
  }
  const stage = q(req.query.stage);
  if (isStage(stage)) and.push({ stage });
  if (q(req.query.owner)) and.push({ ownerName: q(req.query.owner) });
  if (q(req.query.sector)) and.push({ sector: q(req.query.sector) });

  const open: Filter<BidDoc> = { stage: { $nin: [...CLOSED, 'Submitted'] } };
  const due = q(req.query.due);
  if (due === '7d') and.push(open, { dueAt: dueWithin(7) });
  if (due === '30d') and.push(open, { dueAt: dueWithin(30) });
  if (due === 'later') and.push(open, { $or: [{ dueAt: null }, { dueAt: { $gt: new Date(Date.now() + 30.5 * DAY) } }] });
  if (due === 'awaiting') and.push({ stage: 'Submitted' });
  if (due === 'closed') and.push({ stage: { $in: CLOSED } });

  const filter: Filter<BidDoc> = { $and: and };
  const { page, limit } = paging(req.query);
  const [total, rows] = await Promise.all([
    db.bids.countDocuments(filter),
    db.bids
      .aggregate<BidDoc>([
        { $match: filter },
        { $addFields: { _noDue: { $cond: [{ $ifNull: ['$dueAt', false] }, 0, 1] } } },
        { $sort: SORTS[q(req.query.sort)] ?? SORTS.due },
        { $skip: (page - 1) * limit },
        { $limit: limit }
      ])
      .toArray()
  ]);
  ok(res, rows.map(publicBid), null, { meta: pageMeta(page, limit, total) });
});

router.get('/summary', async (req, res) => {
  const live = await db.bids
    .find({ workspaceId: ctx(req).workspace._id, deletedAt: null }, { projection: { stage: 1, value: 1, probability: 1, dueAt: 1 } })
    .toArray();
  const open = live.filter((b) => !CLOSED.includes(b.stage));
  const won = live.filter((b) => b.stage === 'Won').length;
  const decided = live.filter((b) => CLOSED.includes(b.stage)).length;
  const window = dueWithin(7);

  ok(res, {
    openCount: open.length,
    pipeline: open.reduce((sum, b) => sum + (b.value ?? 0), 0),
    weighted: Math.round(open.reduce((sum, b) => sum + ((b.value ?? 0) * (b.probability ?? 0)) / 100, 0)),
    winRate: decided ? Math.round((won / decided) * 100) : 0,
    decidedCount: decided,
    dueWithin7Days: open.filter((b) => b.stage !== 'Submitted' && b.dueAt && b.dueAt >= window.$gte && b.dueAt <= window.$lte).length,
    byStage: STAGES.map((stage) => {
      const rows = live.filter((b) => b.stage === stage);
      return { stage, count: rows.length, value: rows.reduce((sum, b) => sum + (b.value ?? 0), 0) };
    })
  });
});

router.get('/:id', async (req, res) => {
  ok(res, publicBid(await findBid(req, req.params.id, { includeArchived: true })));
});

/* ---------------- writes ---------------- */

const bidSchema = (partial: boolean): Schema => ({
  title: [...(partial ? [] : [rules.required('Give the bid a title')]), rules.minLen(3), rules.maxLen(140)],
  client: [...(partial ? [] : [rules.required('Who is the client?')]), rules.maxLen(120)],
  reference: [rules.maxLen(30)],
  sector: [rules.maxLen(60)],
  contactName: [rules.maxLen(80)],
  contact: [rules.maxLen(120)],
  // Accepts "250000", "250,000" or "£250,000" — the form field is free text.
  value: [(v) => rules.number(0, 1e11, 'Enter a contract value of 0 or more')(typeof v === 'string' ? v.replace(/[£$€,\s]/g, '') : v)],
  stage: [rules.oneOf(STAGES, 'Unknown stage')],
  ownerName: [rules.maxLen(80)],
  probability: [rules.int(0, 100, 'Probability is a whole number from 0 to 100')],
  incumbent: [rules.maxLen(120)],
  dueAt: [dateRule()],
  due: [dateRule()],
  receivedOn: [dateRule()],
  daysLeft: [rules.int(0, 3650)]
});

/** Pulls the editable fields out of a request body into stored form. */
function bidFields(body: Record<string, unknown>): Partial<BidDoc> {
  const out: Partial<BidDoc> = {};
  for (const key of ['title', 'client', 'sector', 'contactName', 'contact', 'ownerName', 'incumbent'] as const) {
    if (body[key] !== undefined) (out as Record<string, unknown>)[key] = clean(body[key]) || null;
  }
  if (body.value !== undefined) out.value = Math.max(0, Math.round(Number(String(body.value).replace(/[^\d.]/g, '')) || 0));
  if (body.probability !== undefined) out.probability = Math.round(Number(body.probability));
  if (isStage(body.stage)) out.stage = body.stage;
  if (body.receivedOn !== undefined) out.receivedOn = parseDate(body.receivedOn) ?? null;

  const due = body.dueAt ?? body.due;
  if (due !== undefined) out.dueAt = parseDate(due) ?? null;
  else if (body.daysLeft !== undefined && body.daysLeft !== '') out.dueAt = new Date(Date.now() + Number(body.daysLeft) * DAY);
  return out;
}

const referenceTaken = () => conflict('That reference is already used', { reference: 'Another bid already uses this reference' });

router.post('/', write, async (req, res) => {
  const { user, workspace } = ctx(req);
  const body = bodyOf(req.body);
  assertValid(validate(body, bidSchema(false)), 'Some bid details need fixing');

  const reference = clean(body.reference).toUpperCase() || (await nextReference(req));
  const fields = bidFields(body);
  const owner = fields.ownerName ?? user.name;
  const at = now();
  const bid: BidDoc = {
    _id: newId(),
    workspaceId: workspace._id,
    reference,
    title: '',
    client: '',
    sector: null,
    contactName: null,
    contact: null,
    value: 0,
    stage: 'Qualifying',
    probability: 25,
    incumbent: null,
    dueAt: null,
    receivedOn: at,
    submittedOn: null,
    ...fields,
    ownerName: owner,
    tasks:
      Array.isArray(body.tasks) && body.tasks.length
        ? body.tasks
            .slice(0, 50)
            .map((t) => bodyOf(t))
            .map((t) => ({ label: clean(t.label), owner: clean(t.owner) || owner, done: !!t.done }))
            .filter((t) => t.label)
        : [
            { label: 'Bid/no-bid scoring', owner, done: false },
            { label: 'Draft technical response', owner, done: false },
            { label: 'Pricing sign-off', owner, done: false }
          ],
    notes: [note(`Bid created by ${user.name}.`, 'System')],
    createdBy: user._id,
    createdAt: at,
    updatedAt: at,
    deletedAt: null
  };
  if (bid.stage === 'Submitted') bid.submittedOn = at;

  try {
    await db.bids.insertOne(bid);
  } catch (err) {
    if (isDuplicate(err)) throw referenceTaken();
    throw err;
  }
  await audit(req, { kind: 'bid', text: `Created ${bid.reference} — ${bid.title} (${bid.client})`, bidId: bid._id });
  ok(res, publicBid(bid), `${bid.reference} created — ${bid.title}`, { status: 201 });
});

router.patch('/:id', write, async (req, res) => {
  const bid = await findBid(req, req.params.id);
  const body = bodyOf(req.body);
  assertValid(validate(body, bidSchema(true)), 'Some bid details need fixing');

  const fields = bidFields(body);
  if (fields.title === null) delete fields.title;
  if (fields.client === null) delete fields.client;
  if (body.reference !== undefined) {
    const reference = clean(body.reference).toUpperCase();
    if (reference && reference !== bid.reference) fields.reference = reference;
  }
  try {
    const updated = await updateBid(bid, { $set: fields });
    await audit(req, { kind: 'bid', text: `Updated ${updated.reference} — ${Object.keys(fields).join(', ') || 'no changes'}`, bidId: bid._id });
    ok(res, publicBid(updated), 'Bid updated');
  } catch (err) {
    if (isDuplicate(err)) throw referenceTaken();
    throw err;
  }
});

router.patch('/:id/stage', write, async (req, res) => {
  const { user } = ctx(req);
  const bid = await findBid(req, req.params.id);
  const { stage, note: text } = bodyOf(req.body);
  assertValid(validate({ stage }, { stage: [rules.required('Choose a stage'), rules.oneOf(STAGES, 'Unknown stage')] }));
  if (!isStage(stage)) throw badRequest('Unknown stage');

  const from = bid.stage;
  if (from === stage) return ok(res, publicBid(bid), `${bid.reference} is already ${stage}`);

  const set: Partial<BidDoc> = { stage };
  if (stage === 'Submitted' && !bid.submittedOn) set.submittedOn = now();
  if (stage === 'Won') set.probability = 100;
  if (stage === 'Lost') set.probability = 0;
  const entry = note(`Stage moved ${from} → ${stage} by ${user.name}.` + (clean(text) ? ' ' + clean(text) : ''), 'System');

  const updated = await updateBid(bid, { $set: set, $push: { notes: { $each: [entry], $position: 0 } } });
  await audit(req, { kind: 'bid', text: `Moved ${bid.reference} from ${from} to ${stage}`, bidId: bid._id });
  ok(res, publicBid(updated), `${bid.reference} moved to ${stage}`);
});

router.patch('/:id/tasks', write, async (req, res) => {
  const bid = await findBid(req, req.params.id);
  const body = bodyOf(req.body);
  const index = Number(body.index);
  if (!Number.isInteger(index) || !bid.tasks?.[index]) throw badRequest('Unknown task');
  ok(res, publicBid(await updateBid(bid, { $set: { [`tasks.${index}.done`]: !!body.done } })));
});

router.post('/:id/notes', write, async (req, res) => {
  const { user } = ctx(req);
  const bid = await findBid(req, req.params.id);
  const text = clean(bodyOf(req.body).text);
  assertValid(validate({ text }, { text: [rules.required('Write a note first'), rules.maxLen(2000)] }));
  const updated = await updateBid(bid, { $push: { notes: { $each: [note(text, user.name)], $position: 0 } } });
  ok(res, publicBid(updated), 'Note added', { status: 201 });
});

router.delete('/:id', allow('Owner', 'Admin'), async (req, res) => {
  const bid = await findBid(req, req.params.id);
  const updated = await updateBid(bid, { $set: { deletedAt: now() } });
  await audit(req, { kind: 'bid', text: `Archived ${bid.reference} — ${bid.title}`, bidId: bid._id });
  ok(res, publicBid(updated), `${bid.reference} archived`);
});

router.post('/:id/restore', allow('Owner', 'Admin'), async (req, res) => {
  const bid = await findBid(req, req.params.id, { includeArchived: true });
  const updated = await updateBid(bid, { $set: { deletedAt: null } });
  await audit(req, { kind: 'bid', text: `Restored ${bid.reference} — ${bid.title}`, bidId: bid._id });
  ok(res, publicBid(updated), `${bid.reference} restored`);
});

export default router;
