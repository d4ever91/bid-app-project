import { config, isProd } from './config.js';
import { connect, db } from './db.js';
import { ensureSecret } from './auth.js';
import { seed } from './seed.js';
import { createApp } from './app.js';

const redact = (uri) => uri.replace(/\/\/([^@/]+)@/, '//***@');

/**
 * The HTTP server starts straight away and keeps retrying MongoDB in the background, so a
 * database that starts a few seconds later (or restarts) doesn't take the API down. Until
 * it connects, requests get a 503 that explains what's wrong.
 */
async function connectWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      await connect();
      console.log(`[db] Connected to ${redact(config.mongoUri)}`);
      await ensureSecret();
      if (config.seedOnStart && !isProd && (await db.workspaces.estimatedDocumentCount()) === 0) {
        console.log('[db] Empty database — seeding demo data.');
        const counts = await seed();
        console.log(`[seed] ${counts.workspaces} workspaces, ${counts.users} users, ${counts.bids} bids, ${counts.invoices} invoices.`);
      }
      return;
    } catch (err) {
      const wait = Math.min(30, 2 * attempt);
      console.error(`[db] Can't reach MongoDB at ${redact(config.mongoUri)} (${err.message}). Retrying in ${wait}s…`);
      if (attempt === 1) {
        console.error('[db] Start it with `docker compose up -d mongo`, or set MONGODB_URI in server/.env (e.g. a MongoDB Atlas URI).');
      }
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}

const app = createApp();
app.listen(config.port, () => {
  console.log(`[api] Listening on http://localhost:${config.port}/api`);
  console.log(`[api] CORS origins: ${config.corsOrigins.join(', ')}`);
  console.log(`[api] Assistant: ${config.anthropicApiKey ? 'Claude (' + config.anthropicModel + ')' : 'built-in answers (set ANTHROPIC_API_KEY for Claude)'}`);
});
void connectWithRetry();
