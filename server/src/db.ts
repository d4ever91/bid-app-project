/**
 * MongoDB connection and typed collections.
 *
 * `db.users` etc. return the driver's `Collection<UserDoc>`, so route code reads like plain
 * MongoDB and every filter/update is type-checked against the document shapes in types.ts.
 */
import { MongoClient, ObjectId, type Collection, type Db, type Document } from 'mongodb';
import { config } from './config.js';
import type {
  AuditEventDoc, AutomationSettingsDoc, BidDoc, InviteDoc, InvoiceDoc, MailItemDoc, ResetTokenDoc, SessionDoc, SettingDoc,
  UserDoc, WorkspaceDoc
} from './types.js';

interface Collections {
  workspaces: Collection<WorkspaceDoc>;
  users: Collection<UserDoc>;
  invites: Collection<InviteDoc>;
  bids: Collection<BidDoc>;
  invoices: Collection<InvoiceDoc>;
  sessions: Collection<SessionDoc>;
  resetTokens: Collection<ResetTokenDoc>;
  auditEvents: Collection<AuditEventDoc>;
  settings: Collection<SettingDoc>;
  automationSettings: Collection<AutomationSettingsDoc>;
  mailItems: Collection<MailItemDoc>;
}

export const COLLECTIONS: Array<keyof Collections> = [
  'workspaces', 'users', 'invites', 'bids', 'invoices', 'sessions', 'resetTokens', 'auditEvents', 'settings',
  'automationSettings', 'mailItems'
];

let client: MongoClient | null = null;
let database: Db | null = null;

class DbNotConnectedError extends Error {
  code = 'DB_NOT_CONNECTED';
  constructor() {
    super('Database not connected');
  }
}

function collection<T extends Document>(name: string): Collection<T> {
  if (!database) throw new DbNotConnectedError();
  return database.collection<T>(name);
}

export const db = {} as Collections;
for (const name of COLLECTIONS) {
  Object.defineProperty(db, name, { get: () => collection(name), enumerable: true });
}

export const isConnected = (): boolean => database !== null;

export async function connect(uri: string = config.mongoUri, dbName: string = config.mongoDb): Promise<Db> {
  const next = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, appName: 'ordinal-bid-api' });
  await next.connect();
  const nextDb = next.db(dbName || undefined);
  await nextDb.command({ ping: 1 });
  client = next;
  database = nextDb;
  await ensureIndexes();
  return nextDb;
}

export async function disconnect(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}

/** Drops the whole database — tests use this to clean up their throwaway database. */
export async function dropDatabase(): Promise<void> {
  await database?.dropDatabase();
}

/** Drops every app collection, then recreates the indexes — used by the seed. */
export async function dropAll(): Promise<void> {
  if (!database) throw new DbNotConnectedError();
  const existing = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of COLLECTIONS) if (existing.has(name)) await database.collection(name).drop();
  // Collections from earlier versions of the API.
  if (existing.has('refreshTokens')) await database.collection('refreshTokens').drop();
  await ensureIndexes();
}

async function ensureIndexes(): Promise<void> {
  await db.workspaces.createIndex({ domain: 1 }, { unique: true, name: 'domain_unique' });
  await db.users.createIndex({ email: 1 }, { name: 'email' });
  await db.users.createIndex({ workspaceId: 1, deletedAt: 1, name: 1 }, { name: 'workspace_name' });
  await db.invites.createIndex({ workspaceId: 1, createdAt: -1 }, { name: 'workspace_created' });
  await db.invites.createIndex({ tokenHash: 1 }, { name: 'token' });
  await db.bids.createIndex({ workspaceId: 1, reference: 1 }, { unique: true, name: 'workspace_reference_unique' });
  await db.bids.createIndex({ workspaceId: 1, deletedAt: 1, dueAt: 1 }, { name: 'workspace_due' });
  await db.invoices.createIndex({ workspaceId: 1, issued: -1 }, { name: 'workspace_issued' });
  await db.sessions.createIndex({ hash: 1 }, { unique: true, name: 'hash_unique' });
  await db.sessions.createIndex({ userId: 1, lastUsedAt: -1 }, { name: 'user_recent' });
  await db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiry_ttl' });
  await db.resetTokens.createIndex({ hash: 1 }, { unique: true, name: 'hash_unique' });
  await db.resetTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiry_ttl' });
  await db.auditEvents.createIndex({ workspaceId: 1, at: -1 }, { name: 'workspace_recent' });
  await db.auditEvents.createIndex({ workspaceId: 1, kind: 1, at: -1 }, { name: 'workspace_kind_recent' });
  await db.auditEvents.createIndex({ userId: 1, at: -1 }, { name: 'user_recent' });
  await db.automationSettings.createIndex({ workspaceId: 1 }, { unique: true, name: 'workspace_unique' });
  await db.mailItems.createIndex({ workspaceId: 1, messageId: 1 }, { unique: true, name: 'workspace_message_unique' });
  await db.mailItems.createIndex({ workspaceId: 1, status: 1, receivedAt: -1 }, { name: 'workspace_status_recent' });
}

/** Parses an id from a URL/body. Returns null for anything that isn't a valid ObjectId. */
export function toId(value: unknown): ObjectId | null {
  if (value instanceof ObjectId) return value;
  const s = String(value ?? '');
  return /^[a-f0-9]{24}$/i.test(s) ? new ObjectId(s) : null;
}

export const newId = (): ObjectId => new ObjectId();
export const now = (): Date => new Date();

/** True for a duplicate-key error from a unique index. */
export const isDuplicate = (err: unknown): boolean => (err as { code?: number } | null)?.code === 11000;

/** Escapes user text for use inside a case-insensitive $regex. */
export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export { ObjectId };
