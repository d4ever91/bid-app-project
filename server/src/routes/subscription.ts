import { Router } from 'express';
import { db, now } from '../db.js';
import { assertValid, bodyOf, notFound, ok, rules, validate } from '../http.js';
import { allow, ctx, requireAuth } from '../auth.js';
import { audit } from '../audit.js';
import { CYCLES, PLANS, PLAN_IDS, planById, seatCeiling, seatPrice } from '../plans.js';
import { seatsUsed } from './users.js';
import type { WorkspaceDoc } from '../types.js';

const router = Router();

/** Public — the signup pricing table loads before there is a session. */
router.get('/plans', (_req, res) => ok(res, PLANS));

router.use(requireAuth);

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextMonthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

/** Metered counters reset at the start of each calendar month. */
export async function currentUsage(workspace: WorkspaceDoc): Promise<WorkspaceDoc['usage']> {
  const start = monthStart();
  if (workspace.usage?.periodStart && workspace.usage.periodStart >= start) return workspace.usage;
  const usage = { periodStart: start, aiQueries: 0, scimRuns: 0 };
  await db.workspaces.updateOne({ _id: workspace._id }, { $set: { usage } });
  return usage;
}

async function state(workspace: WorkspaceDoc) {
  const plan = planById(workspace.plan);
  const [used, usage] = await Promise.all([seatsUsed(workspace._id), currentUsage(workspace)]);
  const unit = seatPrice(plan, workspace.cycle);
  const monthsOfAudit = Math.max(1, Math.ceil((Date.now() - workspace.createdAt.getTime()) / (30 * 864e5)));

  return {
    plan,
    cycle: workspace.cycle,
    status: workspace.subscriptionStatus,
    seatsLicensed: workspace.seatsLicensed,
    seatsUsed: used,
    seatsFree: Math.max(0, workspace.seatsLicensed - used),
    seatPrice: unit,
    contractTotal: unit * workspace.seatsLicensed,
    renewsAt: workspace.renewsAt?.toISOString() ?? null,
    trialEndsAt: workspace.trialEndsAt?.toISOString() ?? null,
    billingEmail: workspace.billingEmail,
    billing: workspace.billing ?? { cardLabel: null, cardExpiry: null, address: null, vatNumber: null },
    usageResetsAt: nextMonthStart().toISOString(),
    usage: [
      { label: 'Licensed seats', used, limit: workspace.seatsLicensed, unit: 'seats' },
      { label: 'SCIM sync runs', used: usage.scimRuns, limit: plan.limits.scimRuns, unit: 'runs / mo' },
      {
        label: 'Audit log retention',
        used: Math.min(monthsOfAudit, plan.limits.auditRetentionMonths),
        limit: plan.limits.auditRetentionMonths,
        unit: 'months'
      },
      { label: 'AI assistant queries', used: usage.aiQueries, limit: plan.limits.aiQueries, unit: 'queries / mo' }
    ]
  };
}

router.get('/', async (req, res) => ok(res, await state(ctx(req).workspace)));

// Billing is Owner-only, matching the `billing:write` scope in the role matrix.
router.post('/', allow('Owner'), async (req, res) => {
  const { workspace } = ctx(req);
  const body = bodyOf(req.body);
  const plan = planById(body.plan);
  const used = await seatsUsed(workspace._id);
  const ceiling = seatCeiling(plan);

  assertValid(
    validate(body, {
      plan: [rules.required('Choose a plan'), rules.oneOf(PLAN_IDS, 'Unknown plan')],
      cycle: [rules.required('Choose monthly or annual'), rules.oneOf(CYCLES)],
      seats: [
        rules.required('Enter a seat count'),
        rules.int(1, ceiling, `${plan.name} allows up to ${ceiling} seats`),
        (v) => (Number(v) < used ? `You have ${used} accounts — archive some before going below ${used} seats` : null)
      ]
    }),
    'That plan change needs adjusting'
  );

  const before = `${planById(workspace.plan).name} (${workspace.cycle})`;
  const w = await db.workspaces.findOneAndUpdate(
    { _id: workspace._id },
    { $set: { plan: plan.id, cycle: body.cycle === 'monthly' ? 'monthly' : 'annual', seatsLicensed: Number(body.seats), updatedAt: now() } },
    { returnDocument: 'after' }
  );
  if (!w) throw notFound('Workspace not found');

  const after = `${plan.name} (${w.cycle})`;
  const message = before === after ? `Seats updated to ${w.seatsLicensed}` : `Moved from ${before} to ${after} · ${w.seatsLicensed} seats`;
  await audit(req, { kind: 'billing', text: message });
  ok(res, await state(w), message);
});

const billingSchema = {
  billingEmail: [rules.email()],
  address: [rules.maxLen(200)],
  vatNumber: [rules.maxLen(40)]
};

/** Billing contact details shown on the Subscription screen. */
router.patch('/billing', allow('Owner'), async (req, res) => {
  const { workspace } = ctx(req);
  const body = bodyOf(req.body);
  assertValid(validate(body, billingSchema));
  const set: Record<string, unknown> = { updatedAt: now() };
  if (body.billingEmail !== undefined) set.billingEmail = String(body.billingEmail).trim().toLowerCase();
  if (body.address !== undefined) set['billing.address'] = String(body.address).trim() || null;
  if (body.vatNumber !== undefined) set['billing.vatNumber'] = String(body.vatNumber).trim() || null;
  const w = await db.workspaces.findOneAndUpdate({ _id: workspace._id }, { $set: set }, { returnDocument: 'after' });
  if (!w) throw notFound('Workspace not found');
  await audit(req, { kind: 'billing', text: 'Updated billing details' });
  ok(res, await state(w), 'Billing details saved');
});

/**
 * No payment provider is configured on this server, so there is no hosted checkout or
 * billing portal to redirect to. The frontend treats a null URL as "stay on this page".
 */
router.post('/checkout-session', allow('Owner'), (_req, res) => {
  ok(res, { url: null }, "Online payment isn't set up on this server yet — use the plan picker to change plan.");
});

router.post('/portal-session', allow('Owner'), (_req, res) => {
  ok(res, { url: null }, "The billing portal isn't set up on this server yet.");
});

router.get('/invoices', async (req, res) => {
  const rows = await db.invoices.find({ workspaceId: ctx(req).workspace._id }).sort({ issued: -1 }).toArray();
  ok(
    res,
    rows.map((i) => ({ id: i.number, period: i.period, issued: i.issued.toISOString(), seats: i.seats, amount: i.amount, status: i.status, pdf: i.pdf })),
    rows.length ? null : 'No invoices yet'
  );
});

export default router;
