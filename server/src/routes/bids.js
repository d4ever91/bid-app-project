import { Router } from 'express';
import { db, escapeRegex, isDuplicate, newId, now, toId } from '../db.js';
import { assertValid, badRequest, clean, conflict, notFound, ok, paging, rules, validate } from '../http.js';
import { allow, requireAuth } from '../auth.js';
import { publicBid } from '../serialize.js';

export const STAGES = ['Qualifying', 'Drafting', 'Review', 'Submitted', 'Won', 'Lost'];
const CLOSED = ['Won', 'Lost'];
const DAY = 864e5;

// Read-only users can browse the pipeline but not change it.
const write = allow('Owner', 'Admin', 'Engineer');

const router = Router();
router.use(requireAuth);

async function findBid(req, id, { includeArchived = false } = {}) {
  const _id = toId(id);
  const bid = await db.bids.findOne({
    workspaceId: req.workspace._id,
    ...(_id ? { _id } : { reference: String(id).toUpperCase() })
  });
  if (!bid || (!includeArchived && bid.deletedAt)) throw notFound('Bid not found');
  return bid;
}

/** Accepts ISO dates, "14 Aug 2026", or blank. Returns a Date or null; undefined means "invalid". */
function parseDate(value) {
  const v = clean(value);
  if (!v || v === 'TBC' || v === '—') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t);
}

const dateRule = (msg = 'Use a date like 14 Aug 2026') => (v) => (parseDate(v) === undefined ? msg : null);

/** Due-date window matching the UI's rounded "days left": day 0 through day N. */
const dueWithin = (days) => ({ $gte: new Date(Date.now() - DAY / 2), $lte: new Date(Date.now() + (days + 0.5) * DAY) });

async function nextReference(req) {
  const refs = await db.bids.find({ workspaceId: req.workspace._id }, { projection: { reference: 1 } }).toArray();
  const numbers = refs.map((b) => Number.parseInt(String(b.reference).replace(/\D/g, ''), 10)).filter(Number.isFinite);
  return 'BID-' + (numbers.length ? Math.max(...numbers) + 1 : 1001);
}

const note = (text, author) => ({ text, author, at: now() });

/** Applies an update and returns the updated document. */
const updateBid = (bid, update) =>
  db.bids.findOneAndUpdate(
    { _id: bid._id },
    { ...update, $set: { ...(update.$set ?? {}), updatedAt: now() } },
    { returnDocument: 'after' }
  );

const SORTS = {
  // Bids without a due date ("TBC") go last.
  due: { _noDue: 1, dueAt: 1, _id: 1 },
  value: { value: -1, _id: 1 },
  probability: { probability: -1, _id: 1 },
  client: { client: 1, _id: 1 }
};

/* ---------------- reads ---------------- */

router.get('/', async (req, res) => {
  const { q, stage, owner, sector, due, archived = 'exclude', sort = 'due' } = req.query;
  const and = [{ workspaceId: req.workspace._id }];

  if (archived === 'exclude') and.push({ deletedAt: null });
  if (archived === 'only') and.push({ deletedAt: { $ne: null } });
  const needle = clean(q);
  if (needle) {
    const re = { $regex: escapeRegex(needle), $options: 'i' };
    and.push({ $or: [{ title: re }, { client: re }, { reference: re }, { ownerName: re }] });
  }
  if (stage) and.push({ stage: String(stage) });
  if (owner) and.push({ ownerName: String(owner) });
  if (sector) and.push({ sector: String(sector) });

  const open = { stage: { $nin: [...CLOSED, 'Submitted'] } };
  if (due === '7d') and.push(open, { dueAt: dueWithin(7) });
  if (due === '30d') and.push(open, { dueAt: dueWithin(30) });
  if (due === 'later') and.push(open, { $or: [{ dueAt: null }, { dueAt: { $gt: new Date(Date.now() + 30.5 * DAY) } }] });
  if (due === 'awaiting') and.push({ stage: 'Submitted' });
  if (due === 'closed') and.push({ stage: { $in: CLOSED } });

  const filter = { $and: and };
  const { page, limit } = paging(req.query);
  const [total, rows] = await Promise.all([
    db.bids.countDocuments(filter),
    db.bids
      .aggregate([
        { $match: filter },
        { $addFields: { _noDue: { $cond: [{ $ifNull: ['$dueAt', false] }, 0, 1] } } },
        { $sort: SORTS[sort] ?? SORTS.due },
        { $skip: (page - 1) * limit },
        { $limit: limit }
      ])
      .toArray()
  ]);
  ok(res, rows.map(publicBid), null, { meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
});

router.get('/summary', async (req, res) => {
  const live = await db.bids
    .find(
      { workspaceId: req.workspace._id, deletedAt: null },
      { projection: { stage: 1, value: 1, probability: 1, dueAt: 1 } }
    )
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

const bidSchema = (partial) => ({
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
function bidFields(body) {
  const out = {};
  for (const key of ['title', 'client', 'sector', 'contactName', 'contact', 'ownerName', 'incumbent']) {
    if (body[key] !== undefined) out[key] = clean(body[key]) || null;
  }
  if (body.value !== undefined) out.value = Math.max(0, Math.round(Number(String(body.value).replace(/[^\d.]/g, '')) || 0));
  if (body.probability !== undefined) out.probability = Math.round(Number(body.probability));
  if (body.stage !== undefined) out.stage = body.stage;
  if (body.receivedOn !== undefined) out.receivedOn = parseDate(body.receivedOn) ?? null;

  const due = body.dueAt ?? body.due;
  if (due !== undefined) out.dueAt = parseDate(due) ?? null;
  else if (body.daysLeft !== undefined && body.daysLeft !== '') {
    out.dueAt = new Date(Date.now() + Number(body.daysLeft) * DAY);
  }
  return out;
}

const referenceTaken = () => conflict('That reference is already used', { reference: 'Another bid already uses this reference' });

router.post('/', write, async (req, res) => {
  const body = req.body ?? {};
  assertValid(validate(body, bidSchema(false)), 'Some bid details need fixing');

  const reference = clean(body.reference).toUpperCase() || (await nextReference(req));
  const fields = bidFields(body);
  const owner = fields.ownerName ?? req.user.name;
  const at = now();
  const bid = {
    _id: newId(),
    workspaceId: req.workspace._id,
    reference,
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
    tasks: Array.isArray(body.tasks) && body.tasks.length
      ? body.tasks.slice(0, 50).map((t) => ({ label: clean(t.label), owner: clean(t.owner) || owner, done: !!t.done })).filter((t) => t.label)
      : [
          { label: 'Bid/no-bid scoring', owner, done: false },
          { label: 'Draft technical response', owner, done: false },
          { label: 'Pricing sign-off', owner, done: false }
        ],
    notes: [note(`Bid created by ${req.user.name}.`, 'System')],
    createdBy: req.user._id,
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
  ok(res, publicBid(bid), `${bid.reference} created — ${bid.title}`, { status: 201 });
});

router.patch('/:id', write, async (req, res) => {
  const bid = await findBid(req, req.params.id);
  const body = req.body ?? {};
  assertValid(validate(body, bidSchema(true)), 'Some bid details need fixing');

  const fields = bidFields(body);
  if (fields.title === null) delete fields.title;
  if (fields.client === null) delete fields.client;
  if (body.reference !== undefined) {
    const reference = clean(body.reference).toUpperCase();
    if (reference && reference !== bid.reference) fields.reference = reference;
  }
  try {
    ok(res, publicBid(await updateBid(bid, { $set: fields })), 'Bid updated');
  } catch (err) {
    if (isDuplicate(err)) throw referenceTaken();
    throw err;
  }
});

router.patch('/:id/stage', write, async (req, res) => {
  const bid = await findBid(req, req.params.id);
  const { stage, note: text } = req.body ?? {};
  assertValid(validate({ stage }, { stage: [rules.required('Choose a stage'), rules.oneOf(STAGES, 'Unknown stage')] }));

  const from = bid.stage;
  if (from === stage) return ok(res, publicBid(bid), `${bid.reference} is already ${stage}`);

  const set = { stage };
  if (stage === 'Submitted' && !bid.submittedOn) set.submittedOn = now();
  if (stage === 'Won') set.probability = 100;
  if (stage === 'Lost') set.probability = 0;
  const entry = note(`Stage moved ${from} → ${stage} by ${req.user.name}.` + (clean(text) ? ' ' + clean(text) : ''), 'System');

  const updated = await updateBid(bid, { $set: set, $push: { notes: { $each: [entry], $position: 0 } } });
  ok(res, publicBid(updated), `${bid.reference} moved to ${stage}`);
});

router.patch('/:id/tasks', write, async (req, res) => {
  const bid = await findBid(req, req.params.id);
  const index = Number(req.body?.index);
  if (!Number.isInteger(index) || !bid.tasks?.[index]) throw badRequest('Unknown task');
  ok(res, publicBid(await updateBid(bid, { $set: { [`tasks.${index}.done`]: !!req.body?.done } })));
});

router.post('/:id/notes', write, async (req, res) => {
  const bid = await findBid(req, req.params.id);
  const text = clean(req.body?.text);
  assertValid(validate({ text }, { text: [rules.required('Write a note first'), rules.maxLen(2000)] }));
  const updated = await updateBid(bid, { $push: { notes: { $each: [note(text, req.user.name)], $position: 0 } } });
  ok(res, publicBid(updated), 'Note added', { status: 201 });
});

router.delete('/:id', allow('Owner', 'Admin'), async (req, res) => {
  const bid = await findBid(req, req.params.id);
  ok(res, publicBid(await updateBid(bid, { $set: { deletedAt: now() } })), `${bid.reference} archived`);
});

router.post('/:id/restore', allow('Owner', 'Admin'), async (req, res) => {
  const bid = await findBid(req, req.params.id, { includeArchived: true });
  ok(res, publicBid(await updateBid(bid, { $set: { deletedAt: null } })), `${bid.reference} restored`);
});

export default router;
