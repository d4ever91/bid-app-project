import type { Bid, BidStage } from './types';

export const BID_STAGES: BidStage[] = ['Qualifying', 'Drafting', 'Review', 'Submitted', 'Won', 'Lost'];

export const STAGE_COLOR: Record<BidStage, string> = {
  Qualifying: '#8a8f93',
  Drafting: '#8a5a10',
  Review: '#7c5cb8',
  Submitted: '#0d7a6a',
  Won: '#0d5a4e',
  Lost: '#b23a3a'
};

export const BIDS: Bid[] = [
  {
    id: 'BID-2418',
    title: 'Identity platform consolidation',
    client: 'Halden Regional Health',
    sector: 'Healthcare',
    value: 1840000,
    stage: 'Review',
    owner: 'Nadia Beshara',
    due: '14 Aug 2026',
    daysLeft: 4,
    probability: 62,
    submittedOn: '—',
    incumbent: 'Vessel Systems',
    tasks: [
      { label: 'Technical response — SSO & SCIM', owner: 'Tomas Lindqvist', done: true },
      { label: 'Security questionnaire (SIG Lite)', owner: 'Nadia Beshara', done: true },
      { label: 'Pricing schedule sign-off', owner: 'Avery Mercer', done: false },
      { label: 'Two client references', owner: 'Priya Raghunathan', done: false }
    ],
    notes: [
      { time: '2h ago', text: 'Client moved the deadline forward by three days — confirmed by email.' },
      { time: 'yesterday', text: 'Pricing model switched to per-seat banding after margin review.' },
      { time: '4 days ago', text: 'Clarification received: SCIM 2.0 is mandatory, not optional.' }
    ]
  },
  {
    id: 'BID-2407',
    title: 'Directory migration & managed service',
    client: 'Northmark Logistics',
    sector: 'Transport',
    value: 940000,
    stage: 'Drafting',
    owner: 'Wen Zhao',
    due: '28 Aug 2026',
    daysLeft: 18,
    probability: 45,
    submittedOn: '—',
    incumbent: 'None — first outsourcing',
    tasks: [
      { label: 'Discovery workshop notes', owner: 'Wen Zhao', done: true },
      { label: 'Migration runbook draft', owner: 'Hana Kobayashi', done: false },
      { label: 'Transition timeline', owner: 'Wen Zhao', done: false },
      { label: 'Commercial model options', owner: 'Avery Mercer', done: false }
    ],
    notes: [
      { time: '3h ago', text: 'Buyer confirmed a 90-day transition window is acceptable.' },
      { time: '2 days ago', text: 'Incumbent-free account — emphasise change management support.' }
    ]
  },
  {
    id: 'BID-2399',
    title: 'Privileged access review programme',
    client: 'Caldera Energy',
    sector: 'Utilities',
    value: 2260000,
    stage: 'Submitted',
    owner: 'Priya Raghunathan',
    due: '02 Aug 2026',
    daysLeft: -8,
    probability: 55,
    submittedOn: '01 Aug 2026',
    incumbent: 'Ridgeline Advisory',
    tasks: [
      { label: 'Full technical response', owner: 'Priya Raghunathan', done: true },
      { label: 'Named team CVs', owner: 'Marisol Quintero', done: true },
      { label: 'Insurance certificates', owner: 'Avery Mercer', done: true },
      { label: 'Await clarification round', owner: 'Priya Raghunathan', done: false }
    ],
    notes: [
      { time: 'yesterday', text: 'Procurement acknowledged receipt; shortlist expected 21 Aug.' },
      { time: '9 days ago', text: 'Submitted 26 hours ahead of the portal deadline.' }
    ]
  },
  {
    id: 'BID-2386',
    title: 'Zero-trust network rollout',
    client: 'Aster Municipal Bank',
    sector: 'Financial services',
    value: 3120000,
    stage: 'Qualifying',
    owner: 'Tomas Lindqvist',
    due: '05 Sep 2026',
    daysLeft: 26,
    probability: 30,
    submittedOn: '—',
    incumbent: 'Vessel Systems',
    tasks: [
      { label: 'Bid/no-bid scoring', owner: 'Tomas Lindqvist', done: true },
      { label: 'Capacity check with delivery', owner: 'Avery Mercer', done: false },
      { label: 'Partner agreement for hardware', owner: 'Wen Zhao', done: false }
    ],
    notes: [
      { time: '5h ago', text: 'Delivery flagged a resourcing clash with the Caldera programme.' },
      { time: '3 days ago', text: 'Regulated buyer — expect a formal ITT with fixed scoring weights.' }
    ]
  },
  {
    id: 'BID-2371',
    title: 'Endpoint compliance monitoring',
    client: 'Brightwell Schools Trust',
    sector: 'Education',
    value: 410000,
    stage: 'Won',
    owner: 'Beatrix Vance',
    due: '17 Jul 2026',
    daysLeft: -24,
    probability: 100,
    submittedOn: '15 Jul 2026',
    incumbent: 'Self-managed',
    tasks: [
      { label: 'Technical response', owner: 'Beatrix Vance', done: true },
      { label: 'Framework compliance evidence', owner: 'Nadia Beshara', done: true },
      { label: 'Contract signature', owner: 'Avery Mercer', done: true }
    ],
    notes: [
      { time: '6 days ago', text: 'Award confirmed — three-year term with a two-year extension option.' },
      { time: '2 weeks ago', text: 'Scored highest on both technical and social value.' }
    ]
  },
  {
    id: 'BID-2354',
    title: 'Service desk co-sourcing',
    client: 'Pelham Water',
    sector: 'Utilities',
    value: 1180000,
    stage: 'Lost',
    owner: 'Marisol Quintero',
    due: '26 Jun 2026',
    daysLeft: -45,
    probability: 0,
    submittedOn: '24 Jun 2026',
    incumbent: 'Ridgeline Advisory',
    tasks: [
      { label: 'Technical response', owner: 'Marisol Quintero', done: true },
      { label: 'Pricing schedule', owner: 'Avery Mercer', done: true },
      { label: 'Debrief with procurement', owner: 'Marisol Quintero', done: true }
    ],
    notes: [
      { time: '3 weeks ago', text: 'Lost on price — 14% above the winning bid at equal technical score.' },
      { time: '4 weeks ago', text: 'Debrief booked to review the pricing assumptions.' }
    ]
  }
];

export const money = (v: number): string =>
  v >= 1000000 ? '£' + (v / 1000000).toFixed(2) + 'm' : '£' + Math.round(v / 1000) + 'k';

export const dueLabel = (b: Bid): string => {
  if (b.stage === 'Won' || b.stage === 'Lost') return b.submittedOn;
  if (b.daysLeft < 0) return 'submitted';
  if (b.daysLeft === 0) return 'today';
  return b.daysLeft + 'd left';
};

export const dueColor = (b: Bid): string => {
  if (b.stage === 'Won' || b.stage === 'Lost' || b.daysLeft < 0) return 'var(--muted)';
  if (b.daysLeft <= 5) return '#b23a3a';
  if (b.daysLeft <= 14) return '#8a5a10';
  return 'var(--muted)';
};
