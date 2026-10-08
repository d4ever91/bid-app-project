import type { BillingCycle, PlanId } from './types.js';

export interface Plan {
  id: PlanId;
  name: string;
  blurb: string;
  monthly: number;
  annual: number;
  seatCap: number | null;
  features: string[];
  /** Metered allowances per billing period. */
  limits: { scimRuns: number; aiQueries: number; auditRetentionMonths: number };
}

/** Plan catalogue — authoritative copy (the frontend's src/subscription.ts is its offline fallback). */
export const PLANS: Plan[] = [
  {
    id: 'team',
    name: 'Team',
    blurb: 'For a single IT function getting access under control.',
    monthly: 14,
    annual: 140,
    seatCap: 100,
    features: ['SSO via SAML', 'Directory sync (daily)', 'Role-based access', '30-day audit retention', 'Email support'],
    limits: { scimRuns: 3000, aiQueries: 500, auditRetentionMonths: 1 }
  },
  {
    id: 'business',
    name: 'Business',
    blurb: 'For multi-team organisations with compliance obligations.',
    monthly: 24,
    annual: 240,
    seatCap: 500,
    features: ['Everything in Team', 'SCIM provisioning (real-time)', 'Bid management workspace', 'AI assistant', '1-year audit retention', 'Priority support, 4h response'],
    limits: { scimRuns: 15000, aiQueries: 5000, auditRetentionMonths: 12 }
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    blurb: 'For regulated estates that need contractual guarantees.',
    monthly: 38,
    annual: 380,
    seatCap: null,
    features: ['Everything in Business', 'Private tenancy option', 'Custom data residency', '7-year audit retention', '99.95% uptime SLA', 'Named technical account manager'],
    limits: { scimRuns: 100000, aiQueries: 25000, auditRetentionMonths: 84 }
  }
];

export const PLAN_IDS: PlanId[] = PLANS.map((p) => p.id);
export const CYCLES: BillingCycle[] = ['monthly', 'annual'];
export const TRIAL_DAYS = 14;

export const planById = (id: unknown): Plan => PLANS.find((p) => p.id === id) ?? PLANS[1];
export const seatPrice = (plan: Plan, cycle: BillingCycle): number => (cycle === 'annual' ? plan.annual : plan.monthly);
export const seatCeiling = (plan: Plan): number => plan.seatCap ?? 5000;
