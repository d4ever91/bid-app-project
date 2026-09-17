/**
 * API client.
 *
 * One place that knows the envelope the server sends — `{ success, data, message, error }` —
 * so components deal in plain values and a single `ApiError`. Access tokens are held in
 * memory only; the refresh token is an httpOnly cookie the browser handles, which is why
 * every call sets `credentials: 'include'`.
 */
import type { Bid, BidStage, BillingCycle, CompanyType, Plan, PlanId, Role, Status, User } from './types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  code: string;
  status: number;
  /** Field-keyed messages from the server's validator, ready to merge into form errors. */
  fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  team?: string;
  status?: Status;
}

export interface SessionWorkspace {
  id: string;
  name: string;
  domain?: string;
  companyType?: CompanyType;
  plan: PlanId;
  seatsLicensed?: number;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
}

let accessToken: string | null = null;
export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};
export const getAccessToken = (): string | null => accessToken;

interface Envelope<T> {
  success: boolean;
  data: T;
  message: string | null;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: { fields?: Record<string, string[]> } };
}

/** Flattens the server's `{ email: ['...'] }` into `{ email: '...' }`. */
const flattenFields = (details?: { fields?: Record<string, string[]> }): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, messages] of Object.entries(details?.fields ?? {})) {
    if (messages?.[0]) out[key] = messages[0];
  }
  return out;
};

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<Envelope<T>> {
  let res: Response;

  try {
    res = await fetch(BASE + path, {
      ...init,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: 'Bearer ' + accessToken } : {}),
        ...(init.headers ?? {})
      }
    });
  } catch {
    // Network-level failure — the API isn't running or CORS blocked it.
    throw new ApiError(0, 'network', 'Cannot reach the API. Is it running on ' + BASE + '?');
  }

  // An expired access token is recoverable: rotate once, then replay.
  if (res.status === 401 && retry && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await refresh().catch(() => null);
    if (refreshed) return request<T>(path, init, false);
  }

  if (res.status === 204) return { success: true, data: null as T, message: null };

  const body = (await res.json().catch(() => null)) as Envelope<T> | null;

  if (!res.ok || !body?.success) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'unknown',
      body?.error?.message ?? body?.message ?? 'Request failed',
      flattenFields(body?.error?.details)
    );
  }

  return body;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: 'DELETE' });

/** Drops empty values so they don't become `?role=` and over-filter server-side. */
const qs = (params: Record<string, string | number | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== 'All') search.set(key, String(value));
  }
  const out = search.toString();
  return out ? '?' + out : '';
};

/** Paging travels in `meta`, rows in `data` — this keeps callers from unpacking twice. */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const asPage = <T,>(body: Envelope<T[]>): Page<T> => ({
  items: body.data ?? [],
  page: Number(body.meta?.page ?? 1),
  limit: Number(body.meta?.limit ?? 25),
  total: Number(body.meta?.total ?? body.data?.length ?? 0),
  pages: Number(body.meta?.pages ?? 1)
});

/* ---------------- auth ---------------- */

export interface SessionResult {
  user: SessionUser;
  workspace?: SessionWorkspace;
  /** Non-null when a paid signup must be redirected to Stripe before the workspace activates. */
  checkoutUrl?: string | null;
  message: string | null;
}

export async function login(email: string, password: string): Promise<SessionResult> {
  const body = await post<{ accessToken: string; user: SessionUser }>('/auth/login', { email, password });
  setAccessToken(body.data.accessToken);
  return { user: body.data.user, message: body.message };
}

export interface SignupPayload {
  workspace: string;
  domain: string;
  name: string;
  email: string;
  password: string;
  size?: string;
  companyType?: CompanyType;
  plan: PlanId;
  cycle: BillingCycle;
  seats: number;
  /** 'trial' starts the 14-day window; 'paid' returns a Stripe Checkout URL. */
  billing: 'trial' | 'paid';
}

export async function signup(payload: SignupPayload): Promise<SessionResult> {
  const body = await post<{
    accessToken: string;
    user: SessionUser;
    workspace: SessionWorkspace;
    checkoutUrl?: string | null;
  }>('/auth/signup', payload);

  setAccessToken(body.data.accessToken);
  return {
    user: body.data.user,
    workspace: body.data.workspace,
    checkoutUrl: body.data.checkoutUrl ?? null,
    message: body.message
  };
}

/* ---------------- plans & billing ---------------- */

/** Public endpoint — the pricing table loads before there is a session. */
export async function fetchPlans(): Promise<Plan[]> {
  const body = await get<Plan[]>('/subscription/plans');
  return body.data;
}

export interface SubscriptionState {
  plan: Plan;
  cycle: BillingCycle;
  status: string;
  seatsLicensed: number;
  seatsUsed: number;
  seatsFree: number;
  seatPrice: number;
  contractTotal: number;
  renewsAt: string | null;
  trialEndsAt: string | null;
  billingEmail?: string;
}

export async function fetchSubscription(): Promise<SubscriptionState> {
  const body = await get<SubscriptionState>('/subscription');
  return body.data;
}

export async function changePlan(plan: PlanId, cycle: BillingCycle, seats: number): Promise<string | null> {
  const body = await post<unknown>('/subscription', { plan, cycle, seats });
  return body.message;
}

/** Returns a Stripe Checkout URL for an existing workspace to upgrade through. */
export async function startCheckout(plan: PlanId, cycle: BillingCycle, seats: number): Promise<string | null> {
  const body = await post<{ url: string | null }>('/subscription/checkout-session', { plan, cycle, seats });
  return body.data.url;
}

/** Stripe-hosted portal for cards, invoices and cancellation. */
export async function openBillingPortal(): Promise<string | null> {
  const body = await post<{ url: string | null }>('/subscription/portal-session');
  return body.data.url;
}

/* ---------------- users ---------------- */

export interface UserQuery {
  q?: string;
  role?: string;
  team?: string;
  status?: string;
  mfa?: 'enrolled' | 'pending' | 'missing';
  archived?: 'exclude' | 'only' | 'include';
  sort?: 'name' | 'role' | 'team' | 'passwordAge';
  page?: number;
  limit?: number;
}

/** Server-shaped user record — `_id` rather than the fixtures' `id`. */
export interface ApiUser extends Omit<User, 'id'> {
  _id: string;
  deletedAt?: string | null;
}

export const fetchUsers = async (query: UserQuery = {}): Promise<Page<ApiUser>> =>
  asPage(await get<ApiUser[]>('/users' + qs(query as Record<string, string | number | undefined>)));

export interface UserFacets {
  teams: string[];
  roles: Array<{ value: Role; count: number }>;
  statuses: Array<{ value: Status; count: number }>;
  total: number;
  mfaMissing: number;
  archived: number;
}

/** Dropdown options for the filter panel — derived from the whole workspace, not one page. */
export const fetchUserFacets = async (): Promise<UserFacets> => (await get<UserFacets>('/users/facets')).data;

export const fetchUser = async (id: string): Promise<ApiUser> => (await get<ApiUser>('/users/' + id)).data;

export interface CreateUserPayload {
  name: string;
  email: string;
  role: Role;
  team: string;
  manager?: string;
  location?: string;
  requireMfa?: boolean;
  sendInvite?: boolean;
}

export const createUser = async (
  payload: CreateUserPayload
): Promise<{ user: ApiUser; inviteToken?: string; message: string | null }> => {
  const body = await post<{ user: ApiUser; inviteToken?: string }>('/users', payload);
  return { user: body.data.user, inviteToken: body.data.inviteToken, message: body.message };
};

export const updateUser = async (id: string, patchBody: Partial<CreateUserPayload>): Promise<ApiUser> =>
  (await patch<ApiUser>('/users/' + id, patchBody)).data;

export const changeUserRole = async (id: string, role: Role): Promise<{ user: ApiUser; message: string | null }> => {
  const body = await patch<ApiUser>('/users/' + id + '/role', { role });
  return { user: body.data, message: body.message };
};

export const changeUserStatus = async (id: string, status: Status): Promise<{ user: ApiUser; message: string | null }> => {
  const body = await patch<ApiUser>('/users/' + id + '/status', { status });
  return { user: body.data, message: body.message };
};

export const resetUserPassword = async (id: string): Promise<string | null> =>
  (await post<{ sentTo: string }>('/users/' + id + '/reset-password')).message;

export const archiveUser = async (id: string): Promise<string | null> => (await del<ApiUser>('/users/' + id)).message;
export const restoreUser = async (id: string): Promise<string | null> =>
  (await post<ApiUser>('/users/' + id + '/restore')).message;
export const purgeUser = async (id: string): Promise<void> => {
  await del('/users/' + id + '/purge');
};

export type BulkAction = 'role' | 'status' | 'archive' | 'reset-password';

export interface BulkResult {
  action: BulkAction;
  applied: string[];
  skipped: Array<{ id: string; reason: string }>;
  message: string | null;
}

/** Partial success is normal — `skipped` explains each id the server declined. */
export const bulkUsers = async (
  ids: string[],
  action: BulkAction,
  extra: { role?: Role; status?: Status } = {}
): Promise<BulkResult> => {
  const body = await post<Omit<BulkResult, 'message'>>('/users/bulk', { ids, action, ...extra });
  return { ...body.data, message: body.message };
};

/* ---------------- invites ---------------- */

export interface ApiInvite {
  _id: string;
  email: string;
  name: string;
  role: Role;
  team: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  createdAt: string | null;
}

export const fetchInvites = async (
  state: 'pending' | 'expiring' | 'accepted' | 'all' = 'pending',
  query: { q?: string; role?: string } = {}
): Promise<ApiInvite[]> => (await get<ApiInvite[]>('/invites' + qs({ state, ...query }))).data;

export const createInvite = async (payload: {
  email: string;
  name: string;
  role: Role;
  team: string;
  expiresInHours?: number;
}): Promise<{ invite: ApiInvite; inviteToken?: string; message: string | null }> => {
  const body = await post<{ invite: ApiInvite; inviteToken?: string }>('/invites', payload);
  return { invite: body.data.invite, inviteToken: body.data.inviteToken, message: body.message };
};

export const resendInvite = async (id: string): Promise<string | null> =>
  (await post<{ sentTo: string }>('/invites/' + id + '/resend')).message;

export const revokeInvite = async (id: string): Promise<void> => {
  await del('/invites/' + id);
};

/* ---------------- bids ---------------- */

export interface BidQuery {
  q?: string;
  stage?: string;
  owner?: string;
  sector?: string;
  due?: '7d' | '30d' | 'later' | 'awaiting' | 'closed';
  archived?: 'exclude' | 'only' | 'include';
  sort?: 'due' | 'value' | 'probability' | 'client';
  page?: number;
  limit?: number;
}

export interface ApiBid extends Omit<Bid, 'id' | 'ref' | 'owner'> {
  _id: string;
  reference: string;
  ownerName?: string;
  dueAt?: string | null;
  deletedAt?: string | null;
}

export const fetchBids = async (query: BidQuery = {}): Promise<Page<ApiBid>> =>
  asPage(await get<ApiBid[]>('/bids' + qs(query as Record<string, string | number | undefined>)));

export interface BidSummary {
  openCount: number;
  pipeline: number;
  weighted: number;
  winRate: number;
  decidedCount: number;
  dueWithin7Days: number;
  byStage: Array<{ stage: BidStage; count: number; value: number }>;
}

export const fetchBidSummary = async (): Promise<BidSummary> => (await get<BidSummary>('/bids/summary')).data;
export const fetchBid = async (id: string): Promise<ApiBid> => (await get<ApiBid>('/bids/' + id)).data;

export const createBid = async (payload: Record<string, unknown>): Promise<{ bid: ApiBid; message: string | null }> => {
  const body = await post<ApiBid>('/bids', payload);
  return { bid: body.data, message: body.message };
};

export const updateBid = async (id: string, patchBody: Record<string, unknown>): Promise<ApiBid> =>
  (await patch<ApiBid>('/bids/' + id, patchBody)).data;

export const changeBidStage = async (
  id: string,
  stage: BidStage,
  note?: string
): Promise<{ bid: ApiBid; message: string | null }> => {
  const body = await patch<ApiBid>('/bids/' + id + '/stage', { stage, note });
  return { bid: body.data, message: body.message };
};

export const toggleBidTask = async (id: string, index: number, done: boolean): Promise<ApiBid> =>
  (await patch<ApiBid>('/bids/' + id + '/tasks', { index, done })).data;

export const addBidNote = async (id: string, text: string): Promise<ApiBid> =>
  (await post<ApiBid>('/bids/' + id + '/notes', { text })).data;

export const archiveBid = async (id: string): Promise<string | null> => (await del<ApiBid>('/bids/' + id)).message;
export const restoreBid = async (id: string): Promise<string | null> =>
  (await post<ApiBid>('/bids/' + id + '/restore')).message;

/* ---------------- invoices & assistant ---------------- */

export interface ApiInvoice {
  id: string;
  period: string | null;
  issued: string | null;
  amount: number;
  status: string | null;
  pdf: string | null;
}

export const fetchInvoices = async (): Promise<{ items: ApiInvoice[]; message: string | null }> => {
  const body = await get<ApiInvoice[]>('/subscription/invoices');
  return { items: body.data ?? [], message: body.message };
};

export const assistantSuggestions = async (): Promise<string[]> =>
  (await get<string[]>('/assistant/suggestions')).data;

export const assistantChat = async (
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> => (await post<{ reply: string }>('/assistant/chat', { messages })).data.reply;

/** Exchanges the refresh cookie for a new access token. Returns false when there's no session. */
export async function refresh(): Promise<boolean> {
  try {
    const body = await request<{ accessToken: string }>('/auth/refresh', { method: 'POST' }, false);
    setAccessToken(body.data.accessToken);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
}

export async function logout(): Promise<void> {
  await post('/auth/logout').catch(() => undefined);
  setAccessToken(null);
}

export async function me(): Promise<{ user: SessionUser; workspace: SessionWorkspace }> {
  const body = await get<{ user: SessionUser; workspace: SessionWorkspace }>('/auth/me');
  return body.data;
}

/** Restores a session on page load, if the refresh cookie is still valid. */
export async function restoreSession(): Promise<{ user: SessionUser; workspace: SessionWorkspace } | null> {
  if (!(await refresh())) return null;
  return me().catch(() => null);
}
