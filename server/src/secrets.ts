/**
 * Encryption for secrets stored in MongoDB (AI API keys, mailbox app passwords).
 *
 * AES-256-GCM with a random IV per value; the stored form is `v1:<base64(iv | tag | data)>`.
 * The key comes from SECRETS_KEY (required in production). In development, if it isn't set,
 * a key is derived from the JWT secret so local setups work without extra config.
 * Secrets are decrypted only on the server, at the moment they're used.
 */
import crypto from 'node:crypto';
import { config } from './config.js';
import { jwtSecret } from './auth.js';

function key(): Buffer {
  const raw = config.secretsKey.trim();
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
    // Any other string: stretch it to 32 bytes rather than refusing to start.
    return crypto.createHash('sha256').update(raw).digest();
  }
  const secret = jwtSecret();
  if (!secret) throw new Error('No encryption key available yet (database not connected)');
  return crypto.createHash('sha256').update('ordinal-secrets:' + secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith('v1:')) return null;
  try {
    const buf = Buffer.from(stored.slice(3), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key (e.g. SECRETS_KEY changed) — treat as not set so the user re-enters it.
    return null;
  }
}

/** "sk-…a1b2" — enough to recognise a key without revealing it. */
export function maskSecret(plain: string | null): string | null {
  if (!plain) return null;
  if (plain.length <= 8) return '••••';
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}
