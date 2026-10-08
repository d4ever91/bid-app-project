import { Router } from 'express';
import { db, now, save } from '../db.js';
import { assertValid, ok, rules, validate } from '../http.js';
import { allow, requireAuth } from '../auth.js';
import { CYCLES, PLANS, PLAN_IDS, planById, seatCeiling, seatPrice } from '../plans.js';
import { seatsUsed } from './users.js';

const router = Router();

/** Public — the signup pricing table loads before there is a session. */
router.get('/plans', (_req, res) => ok(res, PLANS));

router.use(requireAuth);

function state(workspace) {
  const plan = planById(workspace.plan);
  const used = seatsUsed(workspace.id);
  const unit = seatPrice(plan, workspace.cycle);
  return {
    plan,
    cycle: workspace.cycle,
    status: workspace.subscriptionStatus,
    seatsLicensed: workspace.seatsLicensed,
    seatsUsed: used,
    seatsFree: Math.max(0, workspace.seatsLicensed - used),
    seatPrice: unit,
    contractTotal: unit * workspace.seatsLicensed,
    renewsAt: workspace.renewsAt ?? null,
    trialEndsAt: workspace.trialEndsAt ?? null,
    billingEmail: workspace.billingEmail
  };
}

router.get('/', (req, res) => ok(res, state(req.workspace)));

// Billing is Owner-only, matching the `billing:write` scope in the role matrix.
router.post('/', allow('Owner'), (req, res) => {
  const body = req.body ?? {};
  const plan = planById(body.plan);
  const used = seatsUsed(req.workspace.id);
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

  const w = req.workspace;
  const before = `${planById(w.plan).name} (${w.cycle})`;
  w.plan = plan.id;
  w.cycle = body.cycle;
  w.seatsLicensed = Number(body.seats);
  w.updatedAt = now();
  save();

  const after = `${plan.name} (${w.cycle})`;
  ok(res, state(w), before === after ? `Seats updated to ${w.seatsLicensed}` : `Moved from ${before} to ${after} · ${w.seatsLicensed} seats`);
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

router.get('/invoices', (req, res) => {
  const rows = db.invoices
    .filter((i) => i.workspaceId === req.workspace.id)
    .sort((a, b) => Date.parse(b.issued) - Date.parse(a.issued))
    .map(({ id, period, issued, amount, status, pdf }) => ({ id, period, issued, amount, status, pdf: pdf ?? null }));
  ok(res, rows, rows.length ? null : 'No invoices yet');
});

export default router;
