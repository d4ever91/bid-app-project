/**
 * Runs a local MongoDB without Docker or a system install.
 *
 * Uses mongodb-memory-server to download the official MongoDB server binary once (cached in
 * ~/.cache/mongodb-binaries) and starts it on 127.0.0.1:27017 with its data kept in
 * server/.mongo-data — so data survives restarts, like a normal install.
 *
 *   node server/scripts/local-mongo.mjs          (npm run db:local)
 *
 * `npm run dev` starts this automatically when nothing is listening on the MongoDB port.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server-core';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(serverDir, '.mongo-data');
const port = Number(process.env.LOCAL_MONGO_PORT ?? 27017);
const version = process.env.LOCAL_MONGO_VERSION ?? '7.0.24';

fs.mkdirSync(dbPath, { recursive: true });

console.log(`[db] Starting local MongoDB ${version} on 127.0.0.1:${port} (data in server/.mongo-data)…`);
console.log('[db] First run downloads the MongoDB server (~70 MB, once) — this can take a minute.');

let server;
try {
  server = await MongoMemoryServer.create({
    binary: { version },
    instance: { port, ip: '127.0.0.1', dbPath, storageEngine: 'wiredTiger' }
  });
} catch (err) {
  console.error(`[db] Could not start local MongoDB: ${err.message}`);
  console.error('[db] Alternatives: install MongoDB (https://www.mongodb.com/docs/manual/administration/install-on-linux/),');
  console.error('[db] or use a free MongoDB Atlas cluster and put its URI in server/.env as MONGODB_URI.');
  process.exit(1);
}

console.log(`[db] Local MongoDB ready at mongodb://127.0.0.1:${port}/ordinal_bids`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  // Keep the data directory: only the process is stopped.
  await server.stop({ doCleanup: false }).catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
