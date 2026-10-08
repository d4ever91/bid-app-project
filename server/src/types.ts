/**
 * Document shapes for every MongoDB collection, plus the shared enums. Collections in
 * db.ts are typed with these, so every query and update is checked by the compiler.
 */
import type { ObjectId } from 'mongodb';

export const ROLES = ['Owner', 'Admin', 'Engineer', 'Read-only'] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = ['Active', 'Invited', 'Suspended'] as const;
export type Status = (typeof STATUSES)[number];

export const STAGES = ['Qualifying', 'Drafting', 'Review', 'Submitted', 'Won', 'Lost'] as const;
export type BidStage = (typeof STAGES)[number];

export type PlanId = 'team' | 'business' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';

export const COMPANY_TYPES = ['Consultancy', 'Contractor', 'Agency', 'Public sector', 'Other'] as const;
export const COMPANY_SIZES = ['1–50', '51–200', '201–500', '500+'] as const;
export const BID_VOLUMES = ['1–10', '11–50', '51–200', '200+'] as const;

/** Answers from the signup "About your company" step. */
export interface CompanyProfile {
  companyType: string | null;
  size: string | null;
  role: string;
  country: string;
  sectors: string[];
  bidVolume: string;
}

export interface BillingDetails {
  cardLabel: string | null;
  cardExpiry: string | null;
  address: string | null;
  vatNumber: string | null;
}

/** Metered usage for the current billing period (reset monthly). */
export interface UsageCounters {
  periodStart: Date;
  aiQueries: number;
  scimRuns: number;
}

export interface WorkspaceDoc {
  _id: ObjectId;
  name: string;
  domain: string;
  companyType: string;
  size: string | null;
  company: CompanyProfile | null;
  plan: PlanId;
  cycle: BillingCycle;
  seatsLicensed: number;
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'cancelled';
  trialEndsAt: Date | null;
  renewsAt: Date | null;
  billingEmail: string;
  billing: BillingDetails;
  usage: UsageCounters;
  createdAt: Date;
  updatedAt?: Date;
}

export const NOTIFICATION_PREFS = [
  { key: 'weeklyDigest', title: 'Weekly access digest', note: 'Monday summary of role changes and MFA gaps.', default: true },
  { key: 'riskAlerts', title: 'Risk alerts', note: 'Immediate email when an admin account loses MFA.', default: true },
  { key: 'bidReminders', title: 'Bid deadline reminders', note: 'Three days before any bid you own is due.', default: true },
  { key: 'productNews', title: 'Product news', note: 'Occasional release notes. No more than monthly.', default: false }
] as const;
export type NotificationKey = (typeof NOTIFICATION_PREFS)[number]['key'];

export interface UserDoc {
  _id: ObjectId;
  workspaceId: ObjectId;
  name: string;
  email: string;
  passwordHash: string | null;
  role: Role;
  /** Position in ROLES, stored so MongoDB can sort by role (Owner first). */
  roleRank: number;
  team: string;
  status: Status;
  manager: string | null;
  location: string | null;
  jobTitle: string | null;
  timezone: string;
  notificationPrefs: Record<NotificationKey, boolean>;
  requireMfa: boolean;
  mfaEnrolledAt: Date | null;
  mfaMethod: string | null;
  recoveryCodesLeft: number | null;
  passwordChangedAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
  deletedAt: Date | null;
}

export interface InviteDoc {
  _id: ObjectId;
  workspaceId: ObjectId;
  userId: ObjectId;
  email: string;
  name: string;
  role: Role;
  team: string;
  tokenHash: string;
  invitedBy: ObjectId;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface BidTask {
  label: string;
  owner: string;
  done: boolean;
}

export interface BidNote {
  text: string;
  author: string | null;
  at: Date;
}

export interface BidDoc {
  _id: ObjectId;
  workspaceId: ObjectId;
  reference: string;
  title: string;
  client: string;
  sector: string | null;
  contactName: string | null;
  contact: string | null;
  value: number;
  stage: BidStage;
  ownerName: string;
  probability: number;
  incumbent: string | null;
  dueAt: Date | null;
  receivedOn: Date | null;
  submittedOn: Date | null;
  tasks: BidTask[];
  notes: BidNote[];
  createdBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface InvoiceDoc {
  _id: ObjectId;
  workspaceId: ObjectId;
  number: string;
  issued: Date;
  period: string;
  seats: number;
  amount: number;
  status: 'Paid' | 'Open' | 'Failed';
  pdf: string | null;
}

/** One document per signed-in device. The token hash rotates; the session id stays. */
export interface SessionDoc {
  _id: ObjectId;
  userId: ObjectId;
  workspaceId: ObjectId;
  hash: string;
  device: string;
  ip: string | null;
  location: string | null;
  startedAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
}

export interface ResetTokenDoc {
  _id: ObjectId;
  userId: ObjectId;
  hash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

export const AUDIT_KINDS = ['signin', 'auth', 'role', 'status', 'invite', 'user', 'bid', 'billing', 'sync'] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

/** Append-only audit log: powers Overview events, the sign-ins chart and user activity. */
export interface AuditEventDoc {
  _id: ObjectId;
  workspaceId: ObjectId;
  at: Date;
  kind: AuditKind;
  actorId: ObjectId | null;
  actorName: string;
  text: string;
  /** The account this event is about (for per-user activity). */
  userId: ObjectId | null;
  bidId: ObjectId | null;
  ip: string | null;
}

export interface SettingDoc {
  _id: string;
  secret?: string;
}
