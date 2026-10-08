import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');

/** Minimal .env loader so `npm run dev` picks up server/.env without another dependency. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || line.trim().startsWith('#')) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnvFile(path.join(SERVER_ROOT, '.env'));

const list = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),

  /** Browser origins allowed to call the API directly (with cookies). */
  corsOrigins: list(process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173'),

  /** Where the frontend lives — used to build invite, reset and checkout return links. */
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),

  /** Empty means: generate one and keep it in the data file (fine for local dev only). */
  jwtSecret: process.env.JWT_SECRET ?? '',
  accessTtlSeconds: Number(process.env.ACCESS_TTL_SECONDS ?? 15 * 60),
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),

  dataFile: path.resolve(SERVER_ROOT, process.env.DATA_FILE ?? 'data/db.json'),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'
};

export const isProd = config.env === 'production';

if (isProd && !config.jwtSecret) {
  throw new Error('JWT_SECRET must be set in production.');
}
