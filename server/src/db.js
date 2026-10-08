/**
 * Tiny JSON-file store.
 *
 * Every collection is an array of plain objects kept in memory and written back to
 * `data/db.json` after each change (atomically, via a temp file + rename). It needs no
 * database server, which keeps local setup to `npm install && npm run dev`. The route
 * code only touches `db.<collection>` arrays and `db.save()`, so swapping in Mongo or
 * Postgres later means replacing this file and the queries, not the HTTP layer.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const COLLECTIONS = ['workspaces', 'users', 'invites', 'bids', 'refreshTokens', 'resetTokens', 'invoices'];

const empty = () => ({
  meta: { version: 1, createdAt: new Date().toISOString() },
  ...Object.fromEntries(COLLECTIONS.map((name) => [name, []]))
});

let state = empty();

export const db = {
  get meta() {
    return state.meta;
  }
};

// Expose collections as plain arrays: db.users, db.bids, ...
for (const name of COLLECTIONS) {
  Object.defineProperty(db, name, {
    get: () => state[name],
    set: (rows) => {
      state[name] = rows;
    },
    enumerable: true
  });
}

export function exists() {
  return fs.existsSync(config.dataFile);
}

export function load() {
  if (!exists()) {
    state = empty();
    return false;
  }
  const parsed = JSON.parse(fs.readFileSync(config.dataFile, 'utf8'));
  state = { ...empty(), ...parsed };
  for (const name of COLLECTIONS) state[name] ??= [];
  return true;
}

export function save() {
  fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
  const tmp = config.dataFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, config.dataFile);
}

export function reset() {
  state = empty();
}

db.save = save;

/** Short, URL-safe, sortable-enough ids. */
export const newId = () => crypto.randomBytes(12).toString('hex');

export const now = () => new Date().toISOString();
