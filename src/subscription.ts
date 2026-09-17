import type { BillingCycle, Invoice, Plan, PlanId, Session, UsageMetric } from './types';

export const PLANS: Plan[] = [
  {
    id: 'team',
    name: 'Team',
    blurb: 'For a single IT function getting access under control.',
    monthly: 14,
    annual: 140,
    seatCap: 100,
    features: ['SSO via SAML', 'Directory sync (daily)', 'Role-based access', '30-day audit retention', 'Email support']
  },
  {
    id: 'business',
    name: 'Business',
    blurb: 'For multi-team organisations with compliance obligations.',
    monthly: 24,
    annual: 240,
    seatCap: 500,
    features: ['Everything in Team', 'SCIM provisioning (real-time)', 'Bid management workspace', 'AI assistant', '1-year audit retention', 'Priority support, 4h response'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    blurb: 'For regulated estates that need contractual guarantees.',
    monthly: 38,
    annual: 380,
    seatCap: null,
    features: ['Everything in Business', 'Private tenancy option', 'Custom data residency', '7-year audit retention', '99.95% uptime SLA', 'Named technical account manager']
  }
];

export const CURRENT_PLAN: PlanId = 'business';
export const CURRENT_CYCLE: BillingCycle = 'annual';
export const SEATS_LICENSED = 260;
export const SEATS_USED = 248;
export const RENEWAL_DATE = '01 Feb 2027';
export const CARD_LABEL = 'Visa ending 4417';
export const CARD_EXPIRY = '09 / 2028';
export const BILLING_EMAIL = 'accounts-payable@ordinal.io';
export const BILLING_ADDRESS = '4 Cathedral Yard, Exeter EX1 1HB, United Kingdom';
export const VAT_NUMBER = 'GB 418 2290 71';

export const USAGE: UsageMetric[] = [
  { label: 'Licensed seats', used: SEATS_USED, limit: SEATS_LICENSED, unit: 'seats' },
  { label: 'SCIM sync runs', used: 8420, limit: 15000, unit: 'runs / mo' },
  { label: 'Audit log retention', used: 12, limit: 12, unit: 'months' },
  { label: 'AI assistant queries', used: 1360, limit: 5000, unit: 'queries / mo' }
];

export const INVOICES: Invoice[] = [
  { id: 'INV-2026-0142', date: '01 Feb 2026', period: 'Feb 2026 — Jan 2027', amount: 62400, status: 'Paid', seats: 260 },
  { id: 'INV-2025-0118', date: '01 Feb 2025', period: 'Feb 2025 — Jan 2026', amount: 52800, status: 'Paid', seats: 220 },
  { id: 'INV-2025-0074', date: '14 Aug 2025', period: 'Seat true-up, 40 seats', amount: 6400, status: 'Paid', seats: 40 },
  { id: 'INV-2024-0091', date: '01 Feb 2024', period: 'Feb 2024 — Jan 2025', amount: 43200, status: 'Paid', seats: 180 }
];

export const SESSIONS: Session[] = [
  { device: 'MacBook Pro · Chrome 129', location: 'Exeter, UK', ip: '51.15.44.2', lastSeen: 'active now', current: true },
  { device: 'iPhone 16 · Safari', location: 'Exeter, UK', ip: '82.16.190.44', lastSeen: '2h ago', current: false },
  { device: 'Windows 11 · Edge 128', location: 'London, UK', ip: '141.98.22.7', lastSeen: '3 days ago', current: false }
];

export const money = (v: number): string => '£' + v.toLocaleString('en-GB');

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id) ?? PLANS[0];

export const seatPrice = (plan: Plan, cycle: BillingCycle): number =>
  cycle === 'annual' ? plan.annual : plan.monthly;

export const contractTotal = (plan: Plan, cycle: BillingCycle, seats: number): number =>
  seatPrice(plan, cycle) * seats;
