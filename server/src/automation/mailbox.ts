/**
 * Reads new emails from the configured mailbox over IMAP (Gmail: imap.gmail.com:993 with an
 * app password). The folder is opened read-only — nothing is marked read, moved or deleted.
 * Progress is tracked by UID, so every email is fetched once; the first run looks back
 * 7 days (or to the "since" date) rather than reading the whole mailbox.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { HttpError } from '../http.js';

export interface MailboxConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  folder: string;
}

export interface IncomingEmail {
  uid: number | null;
  messageId: string | null;
  from: string;
  fromName: string | null;
  subject: string;
  receivedAt: Date;
  text: string;
  attachments: Array<{ filename: string; contentType: string; size: number; content: Buffer }>;
}

const FIRST_RUN_DAYS = 7;
const MAX_PER_RUN = 25;

/** Turns IMAP/Gmail failures into something a person can act on. */
function explain(err: unknown, cfg: Pick<MailboxConfig, 'host' | 'user' | 'folder'>): HttpError {
  const e = err as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string; serverResponseCode?: string };
  const gmail = /gmail|googlemail/.test(cfg.host);
  if (e?.authenticationFailed || e?.serverResponseCode === 'AUTHENTICATIONFAILED') {
    return new HttpError(
      400,
      'MAILBOX_AUTH',
      gmail
        ? `Gmail rejected the login for ${cfg.user}. Use a 16-character app password (Google Account → Security → 2-Step Verification → App passwords), not your normal password, and make sure IMAP is enabled in Gmail settings.`
        : `The mail server rejected the login for ${cfg.user}. Check the username and password.`
    );
  }
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') return new HttpError(400, 'MAILBOX_HOST', `Can't find the mail server "${cfg.host}".`);
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET') {
    return new HttpError(400, 'MAILBOX_CONNECT', `Can't connect to ${cfg.host} (${e.code}). Check the host, port and SSL setting.`);
  }
  if (e?.serverResponseCode === 'NONEXISTENT' || /doesn't exist|does not exist|nonexistent|unknown mailbox/i.test(e?.responseText ?? '')) {
    return new HttpError(400, 'MAILBOX_FOLDER', `The folder "${cfg.folder}" doesn't exist in this mailbox.`);
  }
  return new HttpError(400, 'MAILBOX_ERROR', `Mailbox error: ${e?.responseText || e?.message || String(err)}`);
}

function client(cfg: MailboxConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    // Self-signed test servers only; real servers (Gmail) always present valid certificates.
    tls: { rejectUnauthorized: process.env.IMAP_ALLOW_SELF_SIGNED !== 'true' }
  });
}

const htmlToText = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

/** Normalises a parsed MIME message (from IMAP or a pasted .eml). */
export function fromParsed(parsed: ParsedMail, uid: number | null, fallbackDate: Date): IncomingEmail {
  const sender = parsed.from?.value?.[0];
  return {
    uid,
    messageId: parsed.messageId ?? null,
    from: sender?.address ?? parsed.from?.text ?? 'unknown',
    fromName: sender?.name || null,
    subject: parsed.subject ?? '(no subject)',
    receivedAt: parsed.date ?? fallbackDate,
    text: (parsed.text?.trim() || (typeof parsed.html === 'string' ? htmlToText(parsed.html) : '')).slice(0, 60000),
    attachments: (parsed.attachments ?? [])
      .filter((a) => !a.related)
      .map((a) => ({ filename: a.filename ?? 'attachment', contentType: a.contentType, size: a.size, content: a.content }))
  };
}

export async function parseRawEmail(raw: string | Buffer): Promise<IncomingEmail> {
  return fromParsed(await simpleParser(raw), null, new Date());
}

/** Connects, opens the folder and reports how many emails it holds (Settings → "Test mailbox"). */
export async function testMailbox(cfg: MailboxConfig): Promise<{ messages: number; folder: string }> {
  const imap = client(cfg);
  try {
    await imap.connect();
    const box = await imap.mailboxOpen(cfg.folder, { readOnly: true });
    return { messages: box.exists, folder: box.path };
  } catch (err) {
    throw explain(err, cfg);
  } finally {
    await imap.logout().catch(() => imap.close());
  }
}

/**
 * Fetches emails newer than `lastUid` (or from `since` on the first run / after the folder was
 * rebuilt). Returns them oldest first, plus the cursor to store for next time.
 */
export async function fetchNewEmails(
  cfg: MailboxConfig,
  cursor: { lastUid: number; uidValidity: string | null; since: Date | null }
): Promise<{ emails: IncomingEmail[]; lastUid: number; uidValidity: string; more: boolean }> {
  const imap = client(cfg);
  try {
    await imap.connect();
    const box = await imap.mailboxOpen(cfg.folder, { readOnly: true });
    const uidValidity = String(box.uidValidity);
    const fresh = !cursor.lastUid || cursor.uidValidity !== uidValidity;

    let uids: number[] = [];
    if (box.exists > 0) {
      const found = fresh
        ? await imap.search({ since: cursor.since ?? new Date(Date.now() - FIRST_RUN_DAYS * 864e5) }, { uid: true })
        : await imap.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true });
      // "N:*" always matches the newest message, even if it's older than N — filter that out.
      uids = (found || []).filter((u) => fresh || u > cursor.lastUid).sort((a, b) => a - b);
    }

    const batch = uids.slice(0, MAX_PER_RUN);
    const emails: IncomingEmail[] = [];
    if (batch.length) {
      for await (const msg of imap.fetch(batch.join(','), { uid: true, source: true, internalDate: true }, { uid: true })) {
        if (!msg.source) continue;
        const internal = msg.internalDate instanceof Date ? msg.internalDate : new Date();
        emails.push(fromParsed(await simpleParser(msg.source), msg.uid, internal));
      }
      emails.sort((a, b) => (a.uid ?? 0) - (b.uid ?? 0));
    }

    const highest = batch.length ? batch[batch.length - 1] : fresh ? Math.max(0, Number(box.uidNext ?? 1) - 1) : cursor.lastUid;
    return { emails, lastUid: highest, uidValidity, more: uids.length > batch.length };
  } catch (err) {
    throw explain(err, cfg);
  } finally {
    await imap.logout().catch(() => imap.close());
  }
}
