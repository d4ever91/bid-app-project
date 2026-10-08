import { config } from './config.js';
import { exists, load } from './db.js';
import { ensureSecret } from './auth.js';
import { seed } from './seed.js';
import { createApp } from './app.js';

if (!exists()) {
  console.log('[db] No data file yet — seeding demo data.');
  await seed();
} else {
  load();
}
ensureSecret();

const app = createApp();
app.listen(config.port, () => {
  console.log(`[api] Listening on http://localhost:${config.port}/api`);
  console.log(`[api] CORS origins: ${config.corsOrigins.join(', ')}`);
  console.log(`[api] Assistant: ${config.anthropicApiKey ? 'Claude (' + config.anthropicModel + ')' : 'built-in answers (set ANTHROPIC_API_KEY for Claude)'}`);
});
