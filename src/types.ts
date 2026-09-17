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

export interface SignupDraft {
  workspace: string;
  domain: string;
  name: string;
  email: string;
  password: string;
  size: string;
  companyType: CompanyType;
  plan: PlanId;
  accept: boolean;
}
