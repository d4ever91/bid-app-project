import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/ — one level up from src/ (tsx) or dist/ (compiled). */
export const SERVER_ROOT = path.resolve(here, '..');

/** Minimal .env loader so `npm run dev` picks up server/.env without another dependency. */
function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnvFile(path.join(SERVER_ROOT, '.env'));

const list = (value: string | undefined): string[] =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),

  /** Browser origins allowed to call the API directly (with cookies). */
  corsOrigins: list(process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173'),

  /** Where the frontend lives — used to build invite and reset links. */
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),

  /** Empty means: generate one and keep it in the database (fine for local dev only). */
  jwtSecret: process.env.JWT_SECRET ?? '',
  accessTtlSeconds: Number(process.env.ACCESS_TTL_SECONDS ?? 15 * 60),
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),

  /** MongoDB connection string. The database name comes from the URI path, or MONGODB_DB. */
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/ordinal_bids',
  mongoDb: process.env.MONGODB_DB ?? '',
  /** Seed demo data when the database has no workspaces yet (never in production). */
  seedOnStart: (process.env.SEED_ON_START ?? 'true') !== 'false',

  /**
   * Key that encrypts API keys and mailbox passwords stored in MongoDB (32 bytes, base64 or hex).
   * Required in production; in development one is derived from the JWT secret.
   */
  secretsKey: process.env.SECRETS_KEY ?? '',
  /** Override the AI endpoints (proxies, Azure-compatible gateways, tests). */
  openaiBaseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
  geminiBaseUrl: (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
  /** Set to false to stop the background mailbox poller (e.g. on extra API instances). */
  mailPolling: (process.env.MAIL_POLLING ?? 'true') !== 'false',

  /** Server-wide fallback for the AI assistant; a workspace key set in Settings → Integrations wins. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicBaseUrl: (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1').replace(/\/$/, ''),
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'
};

export const isProd = config.env === 'production';

if (isProd && !config.jwtSecret) {
  throw new Error('JWT_SECRET must be set in production.');
}
if (isProd && !config.secretsKey) {
  throw new Error('SECRETS_KEY must be set in production (it encrypts stored API keys and mailbox passwords).');
}
