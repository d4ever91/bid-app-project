/**
 * Demo data — the fixtures the frontend shows offline (src/data.ts, src/bids.ts,
 * src/subscription.ts), in one place so `npm run seed` can load all of it into MongoDB.
 * Relative labels ("2h ago", daysLeft) are turned into real dates at seed time.
 */

export interface SeedUser { id: string; name: string; email: string; role: 'Owner' | 'Admin' | 'Engineer' | 'Read-only'; team: string; status: 'Active' | 'Invited' | 'Suspended'; seen: string; mfa: string; pwAge: string; sessions: string; joined: string; location: string }
export interface SeedBid { id: string; title: string; client: string; sector: string; value: number; stage: 'Qualifying' | 'Drafting' | 'Review' | 'Submitted' | 'Won' | 'Lost'; owner: string; due: string; daysLeft: number; probability: number; submittedOn: string; incumbent: string; tasks: Array<{ label: string; owner: string; done: boolean }>; notes: Array<{ time: string; text: string }> }
export interface SeedEvent { time: string; actor: string; text: string; kind: string }
export interface SeedSession { device: string; location: string; ip: string; lastSeen: string; current: boolean }
export interface SeedInvoice { id: string; date: string; period: string; amount: number; status: 'Paid' | 'Open' | 'Failed'; seats: number }

export const SEED_USERS: SeedUser[] = [
  {
    "id": "u_10428",
    "name": "Priya Raghunathan",
    "email": "p.raghunathan@ordinal.io",
    "role": "Owner",
    "team": "Platform",
    "status": "Active",
    "seen": "2m ago",
    "mfa": "Enrolled · TOTP",
    "pwAge": "31 days",
    "sessions": "3 devices",
    "joined": "Mar 2023",
    "location": "Bengaluru, IN"
  },
  {
    "id": "u_10517",
    "name": "Tomas Lindqvist",
    "email": "t.lindqvist@ordinal.io",
    "role": "Admin",
    "team": "Infrastructure",
    "status": "Active",
    "seen": "18m ago",
    "mfa": "Enrolled · WebAuthn",
    "pwAge": "12 days",
    "sessions": "2 devices",
    "joined": "Jun 2023",
    "location": "Stockholm, SE"
  },
  {
    "id": "u_10604",
    "name": "Marisol Quintero",
    "email": "m.quintero@ordinal.io",
    "role": "Engineer",
    "team": "Data",
    "status": "Active",
    "seen": "1h ago",
    "mfa": "Enrolled · TOTP",
    "pwAge": "88 days",
    "sessions": "1 device",
    "joined": "Sep 2023",
    "location": "Mexico City, MX"
  },
  {
    "id": "u_10712",
    "name": "Devon Ashworth",
    "email": "d.ashworth@ordinal.io",
    "role": "Engineer",
    "team": "Platform",
    "status": "Active",
    "seen": "3h ago",
    "mfa": "Not enrolled",
    "pwAge": "214 days",
    "sessions": "4 devices",
    "joined": "Nov 2023",
    "location": "Austin, US"
  },
  {
    "id": "u_10790",
    "name": "Nadia Beshara",
    "email": "n.beshara@ordinal.io",
    "role": "Admin",
    "team": "Security",
    "status": "Active",
    "seen": "5h ago",
    "mfa": "Enrolled · WebAuthn",
    "pwAge": "7 days",
    "sessions": "2 devices",
    "joined": "Jan 2024",
    "location": "Cairo, EG"
  },
  {
    "id": "u_10844",
    "name": "Ruben Castellanos",
    "email": "r.castellanos@ordinal.io",
    "role": "Read-only",
    "team": "IT Operations",
    "status": "Invited",
    "seen": "—",
    "mfa": "Pending",
    "pwAge": "—",
    "sessions": "0 devices",
    "joined": "Aug 2026",
    "location": "Madrid, ES"
  },
  {
    "id": "u_10902",
    "name": "Hana Kobayashi",
    "email": "h.kobayashi@ordinal.io",
    "role": "Engineer",
    "team": "Infrastructure",
    "status": "Active",
    "seen": "yesterday",
    "mfa": "Enrolled · TOTP",
    "pwAge": "44 days",
    "sessions": "1 device",
    "joined": "Feb 2024",
    "location": "Osaka, JP"
  },
  {
    "id": "u_11033",
    "name": "Gideon Mwangi",
    "email": "g.mwangi@ordinal.io",
    "role": "Engineer",
    "team": "Data",
    "status": "Suspended",
    "seen": "12 days ago",
    "mfa": "Enrolled · TOTP",
    "pwAge": "301 days",
    "sessions": "0 devices",
    "joined": "Apr 2024",
    "location": "Nairobi, KE"
  },
  {
    "id": "u_11108",
    "name": "Beatrix Vance",
    "email": "b.vance@ordinal.io",
    "role": "Read-only",
    "team": "Security",
    "status": "Active",
    "seen": "2 days ago",
    "mfa": "Enrolled · WebAuthn",
    "pwAge": "19 days",
    "sessions": "1 device",
    "joined": "Jul 2024",
    "location": "Toronto, CA"
  },
  {
    "id": "u_11216",
    "name": "Elias Fonseca",
    "email": "e.fonseca@ordinal.io",
    "role": "Engineer",
    "team": "Platform",
    "status": "Invited",
    "seen": "—",
    "mfa": "Pending",
    "pwAge": "—",
    "sessions": "0 devices",
    "joined": "Aug 2026",
    "location": "Lisbon, PT"
  },
  {
    "id": "u_11290",
    "name": "Wen Zhao",
    "email": "w.zhao@ordinal.io",
    "role": "Admin",
    "team": "IT Operations",
    "status": "Active",
    "seen": "4h ago",
    "mfa": "Enrolled · TOTP",
    "pwAge": "56 days",
    "sessions": "3 devices",
    "joined": "Oct 2024",
    "location": "Singapore, SG"
  },
  {
    "id": "u_11355",
    "name": "Solveig Haugen",
    "email": "s.haugen@ordinal.io",
    "role": "Engineer",
    "team": "Data",
    "status": "Active",
    "seen": "36m ago",
    "mfa": "Not enrolled",
    "pwAge": "129 days",
    "sessions": "2 devices",
    "joined": "Feb 2025",
    "location": "Oslo, NO"
  }
];

export const SEED_BIDS: SeedBid[] = [
  {
    "id": "BID-2418",
    "title": "Identity platform consolidation",
    "client": "Halden Regional Health",
    "sector": "Healthcare",
    "value": 1840000,
    "stage": "Review",
    "owner": "Nadia Beshara",
    "due": "14 Aug 2026",
    "daysLeft": 4,
    "probability": 62,
    "submittedOn": "—",
    "incumbent": "Vessel Systems",
    "tasks": [
      {
        "label": "Technical response — SSO & SCIM",
        "owner": "Tomas Lindqvist",
        "done": true
      },
      {
        "label": "Security questionnaire (SIG Lite)",
        "owner": "Nadia Beshara",
        "done": true
      },
      {
        "label": "Pricing schedule sign-off",
        "owner": "Avery Mercer",
        "done": false
      },
      {
        "label": "Two client references",
        "owner": "Priya Raghunathan",
        "done": false
      }
    ],
    "notes": [
      {
        "time": "2h ago",
        "text": "Client moved the deadline forward by three days — confirmed by email."
      },
      {
        "time": "yesterday",
        "text": "Pricing model switched to per-seat banding after margin review."
      },
      {
        "time": "4 days ago",
        "text": "Clarification received: SCIM 2.0 is mandatory, not optional."
      }
    ]
  },
  {
    "id": "BID-2407",
    "title": "Directory migration & managed service",
    "client": "Northmark Logistics",
    "sector": "Transport",
    "value": 940000,
    "stage": "Drafting",
    "owner": "Wen Zhao",
    "due": "28 Aug 2026",
    "daysLeft": 18,
    "probability": 45,
    "submittedOn": "—",
    "incumbent": "None — first outsourcing",
    "tasks": [
      {
        "label": "Discovery workshop notes",
        "owner": "Wen Zhao",
        "done": true
      },
      {
        "label": "Migration runbook draft",
        "owner": "Hana Kobayashi",
        "done": false
      },
      {
        "label": "Transition timeline",
        "owner": "Wen Zhao",
        "done": false
      },
      {
        "label": "Commercial model options",
        "owner": "Avery Mercer",
        "done": false
      }
    ],
    "notes": [
      {
        "time": "3h ago",
        "text": "Buyer confirmed a 90-day transition window is acceptable."
      },
      {
        "time": "2 days ago",
        "text": "Incumbent-free account — emphasise change management support."
      }
    ]
  },
  {
    "id": "BID-2399",
    "title": "Privileged access review programme",
    "client": "Caldera Energy",
    "sector": "Utilities",
    "value": 2260000,
    "stage": "Submitted",
    "owner": "Priya Raghunathan",
    "due": "02 Aug 2026",
    "daysLeft": -8,
    "probability": 55,
    "submittedOn": "01 Aug 2026",
    "incumbent": "Ridgeline Advisory",
    "tasks": [
      {
        "label": "Full technical response",
        "owner": "Priya Raghunathan",
        "done": true
      },
      {
        "label": "Named team CVs",
        "owner": "Marisol Quintero",
        "done": true
      },
      {
        "label": "Insurance certificates",
        "owner": "Avery Mercer",
        "done": true
      },
      {
        "label": "Await clarification round",
        "owner": "Priya Raghunathan",
        "done": false
      }
    ],
    "notes": [
      {
        "time": "yesterday",
        "text": "Procurement acknowledged receipt; shortlist expected 21 Aug."
      },
      {
        "time": "9 days ago",
        "text": "Submitted 26 hours ahead of the portal deadline."
      }
    ]
  },
  {
    "id": "BID-2386",
    "title": "Zero-trust network rollout",
    "client": "Aster Municipal Bank",
    "sector": "Financial services",
    "value": 3120000,
    "stage": "Qualifying",
    "owner": "Tomas Lindqvist",
    "due": "05 Sep 2026",
    "daysLeft": 26,
    "probability": 30,
    "submittedOn": "—",
    "incumbent": "Vessel Systems",
    "tasks": [
      {
        "label": "Bid/no-bid scoring",
        "owner": "Tomas Lindqvist",
        "done": true
      },
      {
        "label": "Capacity check with delivery",
        "owner": "Avery Mercer",
        "done": false
      },
      {
        "label": "Partner agreement for hardware",
        "owner": "Wen Zhao",
        "done": false
      }
    ],
    "notes": [
      {
        "time": "5h ago",
        "text": "Delivery flagged a resourcing clash with the Caldera programme."
      },
      {
        "time": "3 days ago",
        "text": "Regulated buyer — expect a formal ITT with fixed scoring weights."
      }
    ]
  },
  {
    "id": "BID-2371",
    "title": "Endpoint compliance monitoring",
    "client": "Brightwell Schools Trust",
    "sector": "Education",
    "value": 410000,
    "stage": "Won",
    "owner": "Beatrix Vance",
    "due": "17 Jul 2026",
    "daysLeft": -24,
    "probability": 100,
    "submittedOn": "15 Jul 2026",
    "incumbent": "Self-managed",
    "tasks": [
      {
        "label": "Technical response",
        "owner": "Beatrix Vance",
        "done": true
      },
      {
        "label": "Framework compliance evidence",
        "owner": "Nadia Beshara",
        "done": true
      },
      {
        "label": "Contract signature",
        "owner": "Avery Mercer",
        "done": true
      }
    ],
    "notes": [
      {
        "time": "6 days ago",
        "text": "Award confirmed — three-year term with a two-year extension option."
      },
      {
        "time": "2 weeks ago",
        "text": "Scored highest on both technical and social value."
      }
    ]
  },
  {
    "id": "BID-2354",
    "title": "Service desk co-sourcing",
    "client": "Pelham Water",
    "sector": "Utilities",
    "value": 1180000,
    "stage": "Lost",
    "owner": "Marisol Quintero",
    "due": "26 Jun 2026",
    "daysLeft": -45,
    "probability": 0,
    "submittedOn": "24 Jun 2026",
    "incumbent": "Ridgeline Advisory",
    "tasks": [
      {
        "label": "Technical response",
        "owner": "Marisol Quintero",
        "done": true
      },
      {
        "label": "Pricing schedule",
        "owner": "Avery Mercer",
        "done": true
      },
      {
        "label": "Debrief with procurement",
        "owner": "Marisol Quintero",
        "done": true
      }
    ],
    "notes": [
      {
        "time": "3 weeks ago",
        "text": "Lost on price — 14% above the winning bid at equal technical score."
      },
      {
        "time": "4 weeks ago",
        "text": "Debrief booked to review the pricing assumptions."
      }
    ]
  }
];

/** Recent access events shown on the Overview (times are today). */
export const SEED_EVENTS: SeedEvent[] = [
  {
    "time": "14:02:11",
    "actor": "Avery Mercer",
    "text": "Changed role for w.zhao@ordinal.io from Engineer to Admin",
    "kind": "role"
  },
  {
    "time": "13:47:52",
    "actor": "System",
    "text": "Invite expired for legacy-svc@ordinal.io after 72h",
    "kind": "invite"
  },
  {
    "time": "13:12:08",
    "actor": "Nadia Beshara",
    "text": "Suspended g.mwangi@ordinal.io — offboarding ticket IT-4417",
    "kind": "status"
  },
  {
    "time": "12:55:30",
    "actor": "Avery Mercer",
    "text": "Sent password reset to d.ashworth@ordinal.io",
    "kind": "auth"
  },
  {
    "time": "11:38:44",
    "actor": "Directory sync",
    "text": "Provisioned 3 accounts from Okta group eng-platform",
    "kind": "sync"
  }
];

/** Activity for the README owner account (a.mercer@ordinal.io). */
export const SEED_ACTIVITY: Array<{ time: string; text: string }> = [
  {
    "time": "2m ago",
    "text": "Signed in from 51.15.44.2 · Chrome 129 on macOS"
  },
  {
    "time": "4h ago",
    "text": "Rotated personal API token pat_9f2c…a11"
  },
  {
    "time": "yesterday",
    "text": "Approved access request for Marisol Quintero"
  },
  {
    "time": "3 days ago",
    "text": "Enrolled a new WebAuthn security key"
  },
  {
    "time": "11 days ago",
    "text": "Role changed from Admin to Owner by Avery Mercer"
  }
];

/** Sign-ins per day for the last 30 days, oldest first (feeds the Overview chart). */
export const SEED_SIGNINS_PER_DAY: number[] = [42,58,61,47,96,121,133,118,104,149,162,141,88,71,155,168,174,159,132,97,84,178,191,186,172,145,102,91,197,214];

/** Other signed-in devices for the owner account (the current one is created at login). */
export const SEED_SESSIONS: SeedSession[] = [
  {
    "device": "iPhone 16 · Safari",
    "location": "Exeter, UK",
    "ip": "82.16.190.44",
    "lastSeen": "2h ago",
    "current": false
  },
  {
    "device": "Windows 11 · Edge 128",
    "location": "London, UK",
    "ip": "141.98.22.7",
    "lastSeen": "3 days ago",
    "current": false
  }
];

export const SEED_INVOICES: SeedInvoice[] = [
  {
    "id": "INV-2026-0142",
    "date": "01 Feb 2026",
    "period": "Feb 2026 — Jan 2027",
    "amount": 62400,
    "status": "Paid",
    "seats": 260
  },
  {
    "id": "INV-2025-0118",
    "date": "01 Feb 2025",
    "period": "Feb 2025 — Jan 2026",
    "amount": 52800,
    "status": "Paid",
    "seats": 220
  },
  {
    "id": "INV-2025-0074",
    "date": "14 Aug 2025",
    "period": "Seat true-up, 40 seats",
    "amount": 6400,
    "status": "Paid",
    "seats": 40
  },
  {
    "id": "INV-2024-0091",
    "date": "01 Feb 2024",
    "period": "Feb 2024 — Jan 2025",
    "amount": 43200,
    "status": "Paid",
    "seats": 180
  }
];

export const SEED_BILLING = {
  "cardLabel": "Visa ending 4417",
  "cardExpiry": "09 / 2028",
  "email": "accounts-payable@ordinal.io",
  "address": "4 Cathedral Yard, Exeter EX1 1HB, United Kingdom",
  "vatNumber": "GB 418 2290 71",
  "seatsLicensed": 260
};

/** Metered usage this period (SCIM runs, AI queries). */
export const SEED_USAGE = {"scimRuns":8420,"aiQueries":1360};
