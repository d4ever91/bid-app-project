/**
 * Per-workspace automation settings: which AI provider to use, the API keys (encrypted), the
 * Gmail mailbox to watch, and when a detected bid is created automatically.
 */
import type { ObjectId } from 'mongodb';
import { db, newId, now } from '../db.js';
import { decryptSecret, maskSecret } from '../secrets.js';
import type { AiProvider, AutomationSettingsDoc } from '../types.js';
import { DEFAULT_MODELS, MODEL_SUGGESTIONS } from './ai.js';

export const GMAIL_IMAP = { host: 'imap.gmail.com', port: 993, secure: true };

export function defaultSettings(workspaceId: ObjectId): AutomationSettingsDoc {
  const at = now();
  return {
    _id: newId(),
    workspaceId,
    enabled: false,
    provider: 'openai',
    openai: { apiKey: null, model: DEFAULT_MODELS.openai },
    gemini: { apiKey: null, model: DEFAULT_MODELS.gemini },
    mailbox: {
      ...GMAIL_IMAP,
      user: '',
      password: null,
      folder: 'INBOX',
      since: null,
      lastUid: 0,
      uidValidity: null,
      lastCheckedAt: null,
      lastError: null
    },
    autoCreateThreshold: 0.75,
    pollMinutes: 5,
    readAttachments: true,
    createdAt: at,
    updatedAt: at
  };
}

export async function loadSettings(workspaceId: ObjectId): Promise<AutomationSettingsDoc> {
  return (await db.automationSettings.findOne({ workspaceId })) ?? defaultSettings(workspaceId);
}

export const apiKeyFor = (s: AutomationSettingsDoc, provider: AiProvider = s.provider): string | null =>
  decryptSecret(s[provider].apiKey);

export const modelFor = (s: AutomationSettingsDoc, provider: AiProvider = s.provider): string =>
  s[provider].model || DEFAULT_MODELS[provider];

export const mailboxPassword = (s: AutomationSettingsDoc): string | null => decryptSecret(s.mailbox.password);

/** What the Settings screen sees — secrets are reduced to "set / not set" plus a short hint. */
export function publicSettings(s: AutomationSettingsDoc) {
  const key = (p: AiProvider) => {
    const plain = apiKeyFor(s, p);
    return { hasKey: !!plain, keyHint: maskSecret(plain), model: modelFor(s, p), suggestions: MODEL_SUGGESTIONS[p] };
  };
  const aiReady = !!apiKeyFor(s);
  const mailboxReady = !!(s.mailbox.user && mailboxPassword(s));
  return {
    enabled: s.enabled,
    provider: s.provider,
    openai: key('openai'),
    gemini: key('gemini'),
    mailbox: {
      host: s.mailbox.host,
      port: s.mailbox.port,
      secure: s.mailbox.secure,
      user: s.mailbox.user,
      hasPassword: !!mailboxPassword(s),
      folder: s.mailbox.folder,
      lastCheckedAt: s.mailbox.lastCheckedAt?.toISOString() ?? null,
      lastError: s.mailbox.lastError
    },
    autoCreateThreshold: s.autoCreateThreshold,
    pollMinutes: s.pollMinutes,
    readAttachments: s.readAttachments,
    ready: { ai: aiReady, mailbox: mailboxReady, polling: s.enabled && aiReady && mailboxReady }
  };
}
