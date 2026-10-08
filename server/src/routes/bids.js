import { Router } from 'express';
import { db, newId, now, save } from '../db.js';
import { assertValid, badRequest, clean, conflict, notFound, ok, paginate, paging, rules, validate } from '../http.js';
import { allow, requireAuth } from '../auth.js';
import { publicBid } from '../serialize.js';

export const STAGES = ['Qualifying', 'Drafting', 'Review', 'Submitted', 'Won', 'Lost'];
const CLOSED = ['Won', 'Lost'];
const DAY = 864e5;

// Read-only users can browse the pipeline but not change it.
const write = allow('Owner', 'Admin', 'Engineer');

const router = Router();
router.use(requireAuth);

const inWorkspace = (req) => db.bids.filter((b) => b.workspaceId === req.workspace.id);

function findBid(req, id, { includeArchived = false } = {}) {
  const bid = inWorkspace(req).find((b) => b.id === id || b.reference === id);
  if (!bid || (!includeArchived && bid.deletedAt)) throw notFound('Bid not found');
  return bid;
}

/** Accepts ISO dates, "14 Aug 2026", or blank. Returns ISO or null; undefined means "invalid". */
function parseDate(value) {
  const v = clean(value);
  if (!v || v === 'TBC' || v === '—') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

const dateRule = (msg = 'Use a date like 14 Aug 2026') => (v) => (parseDate(v) === undefined ? msg : null);

const daysLeft = (bid) => (bid.dueAt ? Math.round((Date.parse(bid.dueAt) - Date.now()) / DAY) : null);

function nextReference(req) {
  const numbers = inWorkspace(req)
    .map((b) => Number.parseInt(String(b.reference).replace(/\D/g, ''), 10))
    .filter(Number.isFinite);
  return 'BID-' + (numbers.length ? Math.max(...numbers) + 1 : 1001);
}

const note = (text, author) => ({ text, author, at: now() });

const sorters = {
  due: (a, b) => (Date.parse(a.dueAt ?? '9999') || Infinity) - (Date.parse(b.dueAt ?? '9999') || Infinity),
  value: (a, b) => (b.value ?? 0) - (a.value ?? 0),
  probability: (a, b) => (b.probability ?? 0) - (a.probability ?? 0),
  client: (a, b) => a.client.localeCompare(b.client)
};

/* ---------------- reads ---------------- */

router.get('/', (req, res) => {
  const { q, stage, owner, sector, due, archived = 'exclude', sort = 'due' } = req.query;
  const needle = clean(q).toLowerCase();

  const rows = inWorkspace(req)
    .filter((b) => {
      if (archived === 'exclude' && b.deletedAt) return false;
      if (archived === 'only' && !b.deletedAt) return false;
      if (needle && ![b.title, b.client, b.reference, b.ownerName].some((v) => (v ?? '').toLowerCase().includes(needle))) return false;
      if (stage && b.stage !== stage) return false;
      if (owner && b.ownerName !== owner) return false;
      if (sector && b.sector !== sector) return false;

      const open = !CLOSED.includes(b.stage) && b.stage !== 'Submitted';
      const left = daysLeft(b);
      if (due === '7d' && !(open && left !== null && left >= 0 && left <= 7)) return false;
      if (due === '30d' && !(open && left !== null && left >= 0 && left <= 30)) return false;
      if (due === 'later' && !(open && (left === null || left > 30))) return false;
      if (due === 'awaiting' && b.stage !== 'Submitted') return false;
      if (due === 'closed' && !CLOSED.includes(b.stage)) return false;
      return true;
    })
    .sort(sorters[sort] ?? sorters.due);

  const { items, meta } = paginate(rows, paging(req.query));
  ok(res, items.map(publicBid), null, { meta });
});

router.get('/summary', (req, res) => {
  const live = inWorkspace(req).filter((b) => !b.deletedAt);
  const open = live.filter((b) => !CLOSED.includes(b.stage));
  const won = live.filter((b) => b.stage === 'Won').length;
  const decided = live.filter((b) => CLOSED.includes(b.stage)).length;

  ok(res, {
    openCount: open.length,
    pipeline: open.reduce((sum, b) => sum + (b.value ?? 0), 0),
    weighted: Math.round(open.reduce((sum, b) => sum + ((b.value ?? 0) * (b.probability ?? 0)) / 100, 0)),
    winRate: decided ? Math.round((won / decided) * 100) : 0,
    decidedCount: decided,
    dueWithin7Days: open.filter((b) => {
      const left = daysLeft(b);
      return b.stage !== 'Submitted' && left !== null && left >= 0 && left <= 7;
    }).length,
    byStage: STAGES.map((stage) => {
      const rows = live.filter((b) => b.stage === stage);
      return { stage, count: rows.length, value: rows.reduce((sum, b) => sum + (b.value ?? 0), 0) };
    })
  });
});

router.get('/:id', (req, res) => {
  ok(res, publicBid(findBid(req, req.params.id, { includeArchived: true })));
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
    out.dueAt = new Date(Date.now() + Number(body.daysLeft) * DAY).toISOString();
  }
  return out;
}

router.post('/', write, (req, res) => {
  const body = req.body ?? {};
  assertValid(validate(body, bidSchema(false)), 'Some bid details need fixing');

  const reference = clean(body.reference).toUpperCase() || nextReference(req);
  if (inWorkspace(req).some((b) => b.reference === reference)) {
    throw conflict('That reference is already used', { reference: 'Another bid already uses this reference' });
  }

  const fields = bidFields(body);
  const owner = fields.ownerName ?? req.user.name;
  const at = now();
  const bid = {
    id: newId(),
    workspaceId: req.workspace.id,
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
    createdBy: req.user.id,
    createdAt: at,
    updatedAt: at,
    deletedAt: null
  };
  if (bid.stage === 'Submitted') bid.submittedOn = at;

  db.bids.push(bid);
  save();
  ok(res, publicBid(bid), `${bid.reference} created — ${bid.title}`, { status: 201 });
});

router.patch('/:id', write, (req, res) => {
  const bid = findBid(req, req.params.id);
  const body = req.body ?? {};
  assertValid(validate(body, bidSchema(true)), 'Some bid details need fixing');

  const fields = bidFields(body);
  if (fields.title === null) delete fields.title;
  if (fields.client === null) delete fields.client;
  if (body.reference !== undefined) {
    const reference = clean(body.reference).toUpperCase();
    if (reference && reference !== bid.reference) {
      if (inWorkspace(req).some((b) => b.reference === reference)) {
        throw conflict('That reference is already used', { reference: 'Another bid already uses this reference' });
      }
      fields.reference = reference;
    }
  }
  Object.assign(bid, fields, { updatedAt: now() });
  save();
  ok(res, publicBid(bid), 'Bid updated');
});

router.patch('/:id/stage', write, (req, res) => {
  const bid = findBid(req, req.params.id);
  const { stage, note: text } = req.body ?? {};
  assertValid(validate({ stage }, { stage: [rules.required('Choose a stage'), rules.oneOf(STAGES, 'Unknown stage')] }));

  const from = bid.stage;
  if (from === stage) return ok(res, publicBid(bid), `${bid.reference} is already ${stage}`);

  bid.stage = stage;
  if (stage === 'Submitted' && !bid.submittedOn) bid.submittedOn = now();
  if (stage === 'Won') bid.probability = 100;
  if (stage === 'Lost') bid.probability = 0;
  bid.notes = [note(`Stage moved ${from} → ${stage} by ${req.user.name}.` + (clean(text) ? ' ' + clean(text) : ''), 'System'), ...(bid.notes ?? [])];
  bid.updatedAt = now();
  save();
  ok(res, publicBid(bid), `${bid.reference} moved to ${stage}`);
});

router.patch('/:id/tasks', write, (req, res) => {
  const bid = findBid(req, req.params.id);
  const index = Number(req.body?.index);
  if (!Number.isInteger(index) || !bid.tasks?.[index]) throw badRequest('Unknown task');
  bid.tasks[index].done = !!req.body?.done;
  bid.updatedAt = now();
  save();
  ok(res, publicBid(bid));
});

router.post('/:id/notes', write, (req, res) => {
  const bid = findBid(req, req.params.id);
  const text = clean(req.body?.text);
  assertValid(validate({ text }, { text: [rules.required('Write a note first'), rules.maxLen(2000)] }));
  bid.notes = [note(text, req.user.name), ...(bid.notes ?? [])];
  bid.updatedAt = now();
  save();
  ok(res, publicBid(bid), 'Note added', { status: 201 });
});

router.delete('/:id', allow('Owner', 'Admin'), (req, res) => {
  const bid = findBid(req, req.params.id);
  bid.deletedAt = now();
  save();
  ok(res, publicBid(bid), `${bid.reference} archived`);
});

router.post('/:id/restore', allow('Owner', 'Admin'), (req, res) => {
  const bid = findBid(req, req.params.id, { includeArchived: true });
  bid.deletedAt = null;
  bid.updatedAt = now();
  save();
  ok(res, publicBid(bid), `${bid.reference} restored`);
});

export default router;
