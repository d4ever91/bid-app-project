/**
 * Assistant.
 *
 * With ANTHROPIC_API_KEY set, chat goes to Claude with the workspace roster and pipeline as
 * context. Without it, the server answers the common audit questions from live data so the
 * screen still works offline. The key never reaches the browser.
 */
import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError, badRequest, ok } from '../http.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const DAY = 864e5;
const ms = (d) => new Date(d).getTime();
const daysSince = (d) => (d ? Math.round((Date.now() - ms(d)) / DAY) : null);
const daysUntil = (d) => (d ? Math.round((ms(d) - Date.now()) / DAY) : null);
const money = (v) => '£' + Math.round(v).toLocaleString('en-GB');
const list = (items) => items.join(', ');

async function context(workspace) {
  const [users, bids] = await Promise.all([
    db.users.find({ workspaceId: workspace._id, deletedAt: null }, { projection: { passwordHash: 0 } }).toArray(),
    db.bids.find({ workspaceId: workspace._id, deletedAt: null }).toArray()
  ]);
  return { users, bids };
}

function rosterText(users) {
  return users
    .map((u) =>
      [
        u.name, u.email, u.role, u.team, u.status,
        'mfa: ' + (u.mfaEnrolledAt ? 'enrolled' : u.status === 'Invited' ? 'pending' : 'not enrolled'),
        'password age: ' + (u.passwordChangedAt ? daysSince(u.passwordChangedAt) + ' days' : '—'),
        'last active: ' + (u.lastSeenAt ? daysSince(u.lastSeenAt) + ' days ago' : 'never')
      ].join(' | ')
    )
    .join('\n');
}

function pipelineText(bids) {
  return bids
    .map((b) =>
      [b.reference, b.title, b.client, b.stage, money(b.value ?? 0), (b.probability ?? 0) + '%', 'owner: ' + (b.ownerName ?? '—'),
        'due: ' + (b.dueAt ? daysUntil(b.dueAt) + ' days' : 'TBC')].join(' | ')
    )
    .join('\n');
}

function systemPrompt(req) {
  return [
    `You are Ordy, the operations assistant inside the ${req.workspace.name} console.`,
    `The signed-in user is ${req.user.name} (${req.user.role}).`,
    'You help admins audit access and manage the bid pipeline.',
    'Roles, most to least privileged: Owner, Admin, Engineer, Read-only.',
    'Never invent accounts, bids or numbers — only use the data below.',
    'Flag risk plainly: unenrolled MFA, password age over 180 days, suspended accounts, bids due within 7 days.',
    'Answer like a terse colleague: short sentences, plain text, no markdown headings. Stay under 90 words unless asked for detail.'
  ].join(' ');
}

/** Deterministic answers for the common questions — used when no model key is configured. */
function answerLocally(question, { users, bids }) {
  const q = question.toLowerCase();

  if (q.includes('mfa')) {
    const gaps = users.filter((u) => !u.mfaEnrolledAt && u.status !== 'Invited');
    const pending = users.filter((u) => u.status === 'Invited');
    if (!gaps.length && !pending.length) return 'Every account is enrolled in MFA.';
    return [
      gaps.length ? `${gaps.length} account(s) without MFA: ${list(gaps.map((u) => `${u.name} (${u.role}, ${u.team})`))}.` : '',
      pending.length ? `${pending.length} invited account(s) still to enrol: ${list(pending.map((u) => u.name))}.` : ''
    ].join(' ').trim();
  }

  if (q.includes('password') || q.includes('stale')) {
    const stale = users
      .filter((u) => (daysSince(u.passwordChangedAt) ?? 0) > 180)
      .sort((a, b) => daysSince(b.passwordChangedAt) - daysSince(a.passwordChangedAt));
    if (!stale.length) return 'No password is older than 180 days.';
    return `Stale credentials: ${list(stale.map((u) => `${u.name} — ${daysSince(u.passwordChangedAt)} days`))}. Send resets from each profile.`;
  }

  if (q.includes('suspend')) {
    const suspended = users.filter((u) => u.status === 'Suspended');
    return suspended.length ? `Suspended: ${list(suspended.map((u) => `${u.name} (${u.team})`))}.` : 'No suspended accounts.';
  }

  if (q.includes('owner') || q.includes('admin') || q.includes('privileg')) {
    const priv = users.filter((u) => u.role === 'Owner' || u.role === 'Admin');
    return `${priv.length} privileged account(s): ${list(priv.map((u) => `${u.name} (${u.role})`))}.`;
  }

  if (q.includes('bid') || q.includes('pipeline') || q.includes('due') || q.includes('deadline')) {
    const open = bids.filter((b) => !['Won', 'Lost'].includes(b.stage));
    const soon = open
      .filter((b) => b.stage !== 'Submitted' && daysUntil(b.dueAt) !== null && daysUntil(b.dueAt) >= 0 && daysUntil(b.dueAt) <= 7)
      .sort((a, b) => ms(a.dueAt) - ms(b.dueAt));
    const pipeline = open.reduce((s, b) => s + (b.value ?? 0), 0);
    return (
      `${open.length} open bid(s) worth ${money(pipeline)}.` +
      (soon.length
        ? ` Due within 7 days: ${list(soon.map((b) => `${b.reference} ${b.title} (${daysUntil(b.dueAt)}d, ${b.ownerName})`))}.`
        : ' Nothing due in the next 7 days.')
    );
  }

  const active = users.filter((u) => u.status === 'Active').length;
  return `${users.length} accounts (${active} active) and ${bids.length} bids in this workspace. Ask about MFA gaps, stale passwords, suspended accounts, privileged roles or bids due soon.`;
}

async function askClaude(system, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: config.anthropicModel, max_tokens: 600, system, messages })
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('[assistant] model error', res.status, body?.error?.message);
    throw new HttpError(502, 'ASSISTANT_UNAVAILABLE', 'The assistant is unavailable right now — try again shortly');
  }
  return (body?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}

function cleanMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) throw badRequest('Send at least one message');
  const messages = raw
    .slice(-20)
    .map((m) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content ?? m?.text ?? '').slice(0, 4000) }))
    .filter((m) => m.content.trim());
  // The model API requires the conversation to start with a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) throw badRequest('Send at least one message');
  return messages;
}

async function reply(req, rawMessages) {
  const messages = cleanMessages(rawMessages);
  const data = await context(req.workspace);
  if (!config.anthropicApiKey) return answerLocally(messages[messages.length - 1].content, data);

  const system = `${systemPrompt(req)}\n\nAccounts:\n${rosterText(data.users)}\n\nBids:\n${pipelineText(data.bids)}`;
  return (await askClaude(system, messages)) || answerLocally(messages[messages.length - 1].content, data);
}

router.get('/suggestions', (_req, res) => {
  ok(res, [
    'Who has MFA turned off?',
    'Which passwords are older than 180 days?',
    'Which bids are due in the next 7 days?',
    'List everyone with Owner or Admin access'
  ]);
});

router.post('/chat', async (req, res) => {
  ok(res, { reply: await reply(req, req.body?.messages) });
});

/** Older client transport (src/assistant.ts `ask`) — same answer, `{ text }` response. */
router.post('/', async (req, res) => {
  res.json({ text: await reply(req, req.body?.messages) });
});

export default router;
