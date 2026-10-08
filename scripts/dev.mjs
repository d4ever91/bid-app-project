/**
 * `npm run dev` — starts the API (server/, port 4000) and the Vite app (port 5173) together,
 * so the app never runs without its backend. Installs the API's dependencies on first run.
 * Ctrl+C stops both.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';

if (!fs.existsSync(path.join(serverDir, 'node_modules'))) {
  console.log('[dev] Installing API dependencies (first run)…');
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

function run(name, color, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, shell, env: { ...process.env, FORCE_COLOR: '1' } });
  child.stdout.on('data', prefix(name, color));
  child.stderr.on('data', prefix(name, color));
  child.on('exit', (code) => {
    console.log(`[dev] ${name} exited${code === null ? '' : ' with code ' + code} — stopping.`);
    stop(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

run('api', '36', npm, ['run', 'dev'], serverDir);
run('web', '35', npm, ['run', 'dev:web'], root);
