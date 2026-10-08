export type Role = 'Owner' | 'Admin' | 'Engineer' | 'Read-only';
export type RoleFilter = Role | 'All';
export type Status = 'Active' | 'Invited' | 'Suspended';
export type Screen = 'login' | 'signup' | 'overview' | 'users' | 'detail' | 'invite' | 'newbid' | 'assistant' | 'bids' | 'bid' | 'profile' | 'billing';
export type Density = 'Dense' | 'Balanced' | 'Roomy';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  team: string;
  status: Status;
  seen: string;
  mfa: string;
  pwAge: string;
  sessions: string;
  joined: string;
  location: string;
}

export interface RoleInfo {
  desc: string;
  scopes: string[];
}

export interface AuditEvent {
  time: string;
  actor: string;
  text: string;
  kind: string;
  fg: string;
  bd: string;
}

export interface ActivityItem {
  time: string;
  text: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  local?: boolean;
}

export type UserPatch = Partial<Pick<User, 'name' | 'email' | 'team' | 'role' | 'status'>>;

export interface ProfileDraft {
  name: string;
  email: string;
  team: string;
}

export type BidStage = 'Qualifying' | 'Drafting' | 'Review' | 'Submitted' | 'Won' | 'Lost';
export type BidStageFilter = BidStage | 'All';

export interface BidTask {
  label: string;
  owner: string;
  done: boolean;
}

export interface Bid {
  id: string;
  /** Human reference (BID-2418). Live data uses the database id for `id`; fixtures use the reference. */
  ref?: string;
  title: string;
  client: string;
  sector: string;
  value: number;
  stage: BidStage;
  owner: string;
  due: string;
  daysLeft: number;
  probability: number;
  submittedOn: string;
  incumbent: string;
  tasks: BidTask[];
  notes: ActivityItem[];
}

export type PlanId = 'team' | 'business' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type InvoiceStatus = 'Paid' | 'Open' | 'Failed';

export interface Plan {
  id: PlanId;
  name: string;
  blurb: string;
  monthly: number;
  annual: number;
  seatCap: number | null;
  features: string[];
}

export interface Invoice {
  id: string;
  date: string;
  period: string;
  amount: number;
  status: InvoiceStatus;
  seats: number;
}

export interface UsageMetric {
  label: string;
  used: number;
  limit: number;
  unit: string;
}

export interface Session {
  device: string;
  location: string;
  ip: string;
  lastSeen: string;
  current: boolean;
}

export interface NewUserDraft {
  name: string;
  email: string;
  team: string;
  manager: string;
  location: string;
  role: Role;
  requireMfa: boolean;
}

export interface NewBidDraft {
  title: string;
  ref: string;
  client: string;
  sector: string;
  contactName: string;
  contact: string;
  receivedOn: string;
  value: string;
  stage: BidStage;
  owner: string;
  due: string;
  daysLeft: string;
  probability: string;
  incumbent: string;
}

export const COMPANY_TYPES = ['Consultancy', 'Contractor', 'Agency', 'Public sector', 'Other'] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

/* ---- Signup company questionnaire ---- */

export const COMPANY_SIZES = ['1–50', '51–200', '201–500', '500+'] as const;
export const SIGNUP_ROLES = ['Bid / proposal manager', 'Sales or BD lead', 'Operations', 'Founder / director', 'Other'] as const;
export const BID_SECTORS = ['Healthcare', 'Transport', 'Utilities', 'Financial services', 'Education', 'Public sector', 'Construction', 'Technology', 'Other'] as const;
export const BID_VOLUMES = ['1–10', '11–50', '51–200', '200+'] as const;

export type SignupRole = (typeof SIGNUP_ROLES)[number];
export type BidVolume = (typeof BID_VOLUMES)[number];

/** Answers from the "About your company" step — sent to the API as `company`. */
export interface CompanyProfile {
  companyType: CompanyType;
  size: string;
  role: SignupRole | '';
  country: string;
  sectors: string[];
  bidVolume: BidVolume | '';
}

export interface SignupDraft extends CompanyProfile {
  workspace: string;
  domain: string;
  name: string;
  email: string;
  password: string;
  plan: PlanId;
  accept: boolean;
}
