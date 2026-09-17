/**
 * Bridge between the API's records and the shapes the components already render.
 *
 * The screens were built against `src/data.ts` fixtures, which use `id`, `ref`, `owner`
 * and pre-formatted strings like "2 days ago". Rather than rewrite every component to
 * speak the server's schema, everything crossing the boundary is adapted here — so the
 * app runs identically on live data or fixtures, and demo mode stays a real fallback.
 */
import type { ApiBid, ApiUser } from './api';
import type { Bid, BidStage, Role, Status, User } from './types';

/** "2m ago", "yesterday", "12 days ago" — the table's `seen` column. */
export function relative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';

  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';

  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';

  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 31) return days + ' days ago';

  const months = Math.round(days / 30);
  return months + (months === 1 ? ' month ago' : ' months ago');
}

/** "14 Aug 2026" — matches the fixtures' date formatting. */
export const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const daysBetween = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const target = Date.parse(iso);
  return Number.isNaN(target) ? 0 : Math.round((target - Date.now()) / 864e5);
};

/** Password age in the "31 days" form the detail panel shows. */
const passwordAge = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const days = Math.abs(daysBetween(iso));
  return days + (days === 1 ? ' day' : ' days');
};

const mfaLabel = (user: ApiUser & { mfaEnrolledAt?: string | null; status: Status }): string => {
  if (user.mfaEnrolledAt) return 'Enrolled';
  return user.status === 'Invited' ? 'Pending' : 'Not enrolled';
};

export function toUser(row: ApiUser): User {
  const source = row as ApiUser & {
    mfaEnrolledAt?: string | null;
    passwordChangedAt?: string | null;
    lastSeenAt?: string | null;
    createdAt?: string | null;
  };

  return {
    id: row._id,
    name: row.name,
    email: row.email,
    role: row.role as Role,
    team: row.team,
    status: row.status as Status,
    seen: relative(source.lastSeenAt),
    mfa: mfaLabel(source),
    pwAge: passwordAge(source.passwordChangedAt),
    sessions: row.status === 'Active' ? '1 device' : '0 devices',
    joined: source.createdAt ? shortDate(source.createdAt) : '—',
    location: row.location ?? '—'
  };
}

export function toBid(row: ApiBid): Bid {
  const source = row as ApiBid & {
    receivedOn?: string | null;
    submittedOn?: string | null;
    tasks?: Array<{ label: string; owner?: string; done: boolean }>;
    notes?: Array<{ text: string; author?: string; at?: string | null }>;
  };

  return {
    id: row._id,
    ref: row.reference,
    title: row.title,
    client: row.client,
    sector: row.sector ?? '—',
    contactName: row.contactName ?? '—',
    contact: row.contact ?? '—',
    receivedOn: shortDate(source.receivedOn),
    value: row.value ?? 0,
    stage: row.stage as BidStage,
    owner: row.ownerName ?? '—',
    due: shortDate(row.dueAt),
    daysLeft: daysBetween(row.dueAt),
    probability: row.probability ?? 0,
    incumbent: row.incumbent ?? '—',
    submittedOn: source.submittedOn ? shortDate(source.submittedOn) : undefined,
    tasks: (source.tasks ?? []).map((t) => ({ label: t.label, owner: t.owner ?? '—', done: t.done })),
    notes: (source.notes ?? []).map((n) => ({
      text: n.text,
      author: n.author ?? 'System',
      at: relative(n.at)
    }))
  };
}

/** Maps the UI's filter state onto the server's query parameters. */
export const userQueryFrom = (state: {
  query: string;
  role: string;
  team: string;
  status: string;
  mfa: string;
  sort: string;
}): Record<string, string> => {
  const mfa: Record<string, string> = { Enrolled: 'enrolled', Pending: 'pending', 'Not enrolled': 'missing' };
  const sort: Record<string, string> = { Name: 'name', Role: 'role', Team: 'team', 'Password age': 'passwordAge' };

  return {
    q: state.query.trim(),
    role: state.role,
    team: state.team,
    status: state.status,
    mfa: mfa[state.mfa] ?? '',
    sort: sort[state.sort] ?? 'name'
  };
};

export const bidQueryFrom = (state: {
  query: string;
  stage: string;
  owner: string;
  sector: string;
  due: string;
  sort: string;
}): Record<string, string> => {
  const due: Record<string, string> = {
    'Next 7 days': '7d',
    'Next 30 days': '30d',
    Later: 'later',
    'Awaiting outcome': 'awaiting',
    Closed: 'closed'
  };
  const sort: Record<string, string> = {
    'Due date': 'due',
    Value: 'value',
    'Win probability': 'probability',
    Client: 'client'
  };

  return {
    q: state.query.trim(),
    stage: state.stage,
    owner: state.owner,
    sector: state.sector,
    due: due[state.due] ?? '',
    sort: sort[state.sort] ?? 'due'
  };
};
