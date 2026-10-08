/**
 * `npm run dev` — starts the API (server/, port 4000) and the Vite app (port 5173) together,
 * so the app never runs without its backend. Installs the API's dependencies on first run.
 *
 * If MongoDB is configured on this machine (the default) but nothing is listening, it also
 * starts a local MongoDB (server/scripts/local-mongo.mjs) — no Docker or install needed.
 * Ctrl+C stops everything.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';

// Install when node_modules is missing or any dependency in server/package.json isn't there
// (e.g. after a pull that added a package).
const serverPkg = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'));
const missing = Object.keys({ ...serverPkg.dependencies, ...serverPkg.devDependencies }).filter(
  (dep) => !fs.existsSync(path.join(serverDir, 'node_modules', dep, 'package.json'))
);
if (missing.length) {
  console.log(`[dev] Installing API dependencies (${missing.join(', ')})…`);
  const install = spawnSync(npm, ['install'], { cwd: serverDir, stdio: 'inherit', shell });
  if (install.status !== 0) {
    console.error('[dev] Could not install API dependencies — run `npm --prefix server install` and try again.');
    process.exit(1);
  }
}

const children = [];
const prefix = (name, color) => (chunk) =>
  process.stdout.write(
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((line, i, all) => line || i < all.length - 1)
      .map((line) => `\x1b[${color}m[${name}]\x1b[0m ${line}`)
      .join('\n') + '\n'
  );

function run(name, color, cmd, args, cwd, { essential = true } = {}) {
  const child = spawn(cmd, args, { cwd, shell, env: { ...process.env, FORCE_COLOR: '1' } });
  child.stdout.on('data', prefix(name, color));
  child.stderr.on('data', prefix(name, color));
  child.on('exit', (code) => {
    if (stopping) return;
    if (!essential) {
      console.log(`[dev] ${name} exited${code === null ? '' : ' with code ' + code} — the API will keep retrying the database.`);
      return;
    }
    console.log(`[dev] ${name} exited${code === null ? '' : ' with code ' + code} — stopping.`);
    stop(code ?? 0);
  });
  children.push(child);
  return child;
}

/* ---------------- MongoDB ---------------- */

/** MONGODB_URI from the environment or server/.env, else the local default. */
function mongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const envFile = path.join(serverDir, '.env');
  if (fs.existsSync(envFile)) {
    const line = fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => /^\s*MONGODB_URI\s*=/.test(l));
    const value = line?.split('=').slice(1).join('=').trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value) return value;
  }
  return 'mongodb://127.0.0.1:27017/ordinal_bids';
}

/** { host, port } when the URI points at this machine; null for Atlas/remote servers. */
function localTarget(uri) {
  const m = uri.match(/^mongodb:\/\/(?:[^@/]+@)?([^/:,?]+)(?::(\d+))?/);
  if (!m || !['127.0.0.1', 'localhost', '0.0.0.0'].includes(m[1])) return null;
  return { host: m[1] === 'localhost' ? '127.0.0.1' : m[1], port: Number(m[2] ?? 27017) };
}

const portOpen = (host, port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(800);
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });

async function ensureMongo() {
  const target = localTarget(mongoUri());
  if (!target) return; // Atlas or another remote server — nothing to start.
  if (await portOpen(target.host, target.port)) {
    console.log(`[dev] MongoDB found on ${target.host}:${target.port}.`);
    return;
  }
  console.log(`[dev] No MongoDB on ${target.host}:${target.port} — starting a local one (no Docker needed).`);
  process.env.LOCAL_MONGO_PORT = String(target.port);
  const db = run('db', '33', process.execPath, [path.join(serverDir, 'scripts', 'local-mongo.mjs')], serverDir, { essential: false });
  db.on('exit', () => (dbFailed = true));
  // The first run downloads MongoDB, so allow a few minutes before carrying on regardless.
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline && !dbFailed && !(await portOpen(target.host, target.port))) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
let dbFailed = false;

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

await ensureMongo();
run('api', '36', npm, ['run', 'dev'], serverDir);
run('web', '35', npm, ['run', 'dev:web'], root);
