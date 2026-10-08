/**
 * MongoDB connection and collections.
 *
 * Documents use ObjectId `_id`s (serialised as hex strings for the frontend) and real Date
 * fields. `db.<collection>` returns the driver's Collection, so route code reads like plain
 * MongoDB: `await db.users.findOne({ email })`.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { config } from './config.js';

export const COLLECTIONS = ['workspaces', 'users', 'invites', 'bids', 'refreshTokens', 'resetTokens', 'invoices', 'settings'];

let client = null;
let database = null;

export const db = Object.fromEntries(COLLECTIONS.map((name) => [name, null]));
for (const name of COLLECTIONS) {
  Object.defineProperty(db, name, {
    get() {
      if (!database) throw Object.assign(new Error('Database not connected'), { code: 'DB_NOT_CONNECTED' });
      return database.collection(name);
    },
    enumerable: true
  });
}

export const isConnected = () => database !== null;

export async function connect(uri = config.mongoUri, dbName = config.mongoDb) {
  const next = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, appName: 'ordinal-bid-api' });
  await next.connect();
  const nextDb = next.db(dbName || undefined);
  await nextDb.command({ ping: 1 });
  client = next;
  database = nextDb;
  await ensureIndexes();
  return database;
}

export async function disconnect() {
  await client?.close();
  client = null;
  database = null;
}

/** Drops the whole database — tests use this to clean up their throwaway database. */
export async function dropDatabase() {
  await database?.dropDatabase();
}

/** Drops every app collection — used by the seed and tests. */
export async function dropAll() {
  const existing = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of COLLECTIONS) if (existing.has(name)) await database.collection(name).drop();
  await ensureIndexes();
}

async function ensureIndexes() {
  await db.workspaces.createIndex({ domain: 1 }, { unique: true, name: 'domain_unique' });
  await db.users.createIndex({ email: 1 }, { name: 'email' });
  await db.users.createIndex({ workspaceId: 1, deletedAt: 1, name: 1 }, { name: 'workspace_name' });
  await db.invites.createIndex({ workspaceId: 1, createdAt: -1 }, { name: 'workspace_created' });
  await db.invites.createIndex({ tokenHash: 1 }, { name: 'token' });
  await db.bids.createIndex({ workspaceId: 1, reference: 1 }, { unique: true, name: 'workspace_reference_unique' });
  await db.bids.createIndex({ workspaceId: 1, deletedAt: 1, dueAt: 1 }, { name: 'workspace_due' });
  await db.refreshTokens.createIndex({ hash: 1 }, { unique: true, name: 'hash_unique' });
  await db.refreshTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiry_ttl' });
  await db.resetTokens.createIndex({ hash: 1 }, { unique: true, name: 'hash_unique' });
  await db.resetTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiry_ttl' });
  await db.invoices.createIndex({ workspaceId: 1, issued: -1 }, { name: 'workspace_issued' });
}

/** Parses an id from a URL/body. Returns null for anything that isn't a valid ObjectId. */
export function toId(value) {
  if (value instanceof ObjectId) return value;
  const s = String(value ?? '');
  return /^[a-f0-9]{24}$/i.test(s) ? new ObjectId(s) : null;
}

export const newId = () => new ObjectId();
export const now = () => new Date();

/** True for a duplicate-key error from a unique index. */
export const isDuplicate = (err) => err?.code === 11000;

/** Escapes user text for use inside a case-insensitive $regex. */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export { ObjectId };
