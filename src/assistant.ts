import type { ChatMessage, User } from './types';

// Assistant transport.
//
// The design prototype called a built-in model helper that only exists in that
// host. In this app the chat posts to your own backend instead:
//
//   POST  VITE_ASSISTANT_URL (default /api/assistant)
//   body  { system, messages: [{ role, content }], roster }
//   200   { text: "..." }
//
// Proxy that route to Anthropic's Messages API server-side (never ship an API
// key to the browser). Until the route exists, ask() throws and the chat falls
// back to answerLocally() so the screen stays demoable offline.

export const ENDPOINT: string = import.meta.env.VITE_ASSISTANT_URL ?? '/api/assistant';

export const SYSTEM_PROMPT = [
  'You are Ordy, the operations assistant inside the Ordinal admin console.',
  'The signed-in admin is Avery Mercer (org:admin). The workspace has 248 seats.',
  'You help IT and engineering admins audit access and act on accounts.',
  'Roles, most to least privileged: Owner, Admin, Engineer, Read-only.',
  'Never invent accounts or numbers — only use the roster you are given.',
  'Flag risk plainly: unenrolled MFA, password age over 180 days, suspended accounts with live sessions.',
  'Answer like a terse colleague: short sentences, plain text, no markdown headings.',
  'Stay under 90 words unless asked for detail.'
].join(' ');

interface AssistantResponse {
  text?: string;
}

export const rosterText = (users: User[]): string =>
  users
    .map((u) =>
      [u.id, u.name, u.email, u.role, u.team, u.status, 'mfa: ' + u.mfa, 'pw age: ' + u.pwAge, 'last active: ' + u.seen].join(' | ')
    )
    .join('\n');

export async function ask(messages: ChatMessage[], users: User[]): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.text })),
      roster: rosterText(users)
    })
  });
  if (!res.ok) throw new Error('assistant endpoint returned ' + res.status);
  const data = (await res.json()) as AssistantResponse;
  if (!data.text) throw new Error('assistant endpoint returned no text');
  return data.text;
}

const pwDays = (u: User): number => parseInt(u.pwAge, 10) || 0;
const list = (names: string[]): string => names.join(', ');

// Deterministic offline answers for the common audit questions.
export function answerLocally(question: string, users: User[]): string {
  const q = question.toLowerCase();

  if (q.includes('mfa')) {
    const gaps = users.filter((u) => u.mfa === 'Not enrolled');
    const pending = users.filter((u) => u.mfa === 'Pending');
    if (!gaps.length && !pending.length) return 'Every account in the roster is enrolled in MFA.';
    return (
      (gaps.length ? gaps.length + ' account(s) unenrolled: ' + list(gaps.map((u) => u.name + ' (' + u.role + ', ' + u.team + ')')) + '. ' : '') +
      (pending.length ? pending.length + ' invited account(s) still pending enrollment: ' + list(pending.map((u) => u.name)) + '.' : '')
    ).trim();
  }

  if (q.includes('password') || q.includes('stale')) {
    const stale = users.filter((u) => pwDays(u) > 180).sort((a, b) => pwDays(b) - pwDays(a));
    if (!stale.length) return 'No password older than 180 days.';
    return 'Stale credentials: ' + list(stale.map((u) => u.name + ' — ' + u.pwAge)) + '. Send resets from each profile.';
  }

  if (q.includes('suspend')) {
    const suspended = users.filter((u) => u.status === 'Suspended');
    if (!suspended.length) return 'No suspended accounts.';
    return 'Suspended: ' + list(suspended.map((u) => u.name + ' (' + u.role + ', last active ' + u.seen + ', ' + u.sessions + ')')) + '. Confirm offboarding tickets before deleting.';
  }

  if (q.includes('invite') || q.includes('pending')) {
    const invited = users.filter((u) => u.status === 'Invited');
    return invited.length
      ? 'Pending invites: ' + list(invited.map((u) => u.name + ' (' + u.role + ')')) + '. Invites expire 72h after sending.'
      : 'No pending invites.';
  }

  if (q.includes('admin') || q.includes('owner') || q.includes('privile')) {
    const priv = users.filter((u) => u.role === 'Owner' || u.role === 'Admin');
    return 'Elevated access — ' + priv.length + ' account(s): ' + list(priv.map((u) => u.name + ' (' + u.role + ', ' + u.team + ')')) + '.';
  }

  const hit = users.find((u) => q.includes(u.name.toLowerCase().split(' ')[0]));
  if (hit) {
    return hit.name + ' — ' + hit.role + ' on ' + hit.team + ', ' + hit.status.toLowerCase() + '. MFA ' + hit.mfa.toLowerCase() + ', password ' + hit.pwAge + ', ' + hit.sessions + ', last active ' + hit.seen + '.';
  }

  return 'Offline mode answers MFA, password age, suspended accounts, pending invites, elevated roles, and single-user lookups. Connect ' + ENDPOINT + ' for open-ended questions.';
}
