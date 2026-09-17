<script lang="ts">
  import { tick } from 'svelte';
  import { assistantChat, assistantSuggestions, getAccessToken } from '../api';
  import { onMount } from 'svelte';
  import { mono, label, panel, h1, sub, btnDark } from '../ui';
  import { ask, answerLocally, ENDPOINT } from '../assistant';
  import type { ChatMessage, User } from '../types';

  export let users: User[] = [];

  let prompts: string[] = [
    'Who is missing MFA?',
    'Which passwords are older than 180 days?',
    'Review the suspended accounts.',
    'Who holds elevated access?'
  ];

  let chat: ChatMessage[] = [];
  let input = '';
  let busy = false;
  let offline = false;
  let scroller: HTMLDivElement | undefined;

  onMount(async () => {
    if (!getAccessToken()) return;
    const fromServer = await assistantSuggestions().catch(() => null);
    if (fromServer?.length) prompts = fromServer;
  });

  const scrollDown = async (): Promise<void> => {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  };

  async function send(preset?: string): Promise<void> {
    const text = (preset ?? input).trim();
    if (!text || busy) return;

    chat = [...chat, { role: 'user', text }];
    input = '';
    busy = true;
    void scrollDown();

    try {
      // Server proxy first — it holds the provider key. `ask` is the in-browser fallback.
      const reply = getAccessToken()
        ? await assistantChat(chat.map((m) => ({ role: m.role, content: m.text })))
        : await ask(chat, users);
      chat = [...chat, { role: 'assistant', text: reply }];
      offline = false;
    } catch {
      offline = true;
      chat = [...chat, { role: 'assistant', text: answerLocally(text, users), local: true }];
    } finally {
      busy = false;
      void scrollDown();
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const bubble = (m: ChatMessage): string =>
    'max-width: 76%; border-radius: 3px; padding: 10px 13px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; ' +
    (m.role === 'user'
      ? 'background: var(--ink); color: #fff; border: 1px solid var(--ink);'
      : 'background: #fff; color: var(--ink); border: 1px solid var(--line);');
</script>

<div style="max-width: 820px;">
  <div style="display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 16px; gap: 20px; flex-wrap: wrap;">
    <div>
      <h1 style={h1}>AI assistant</h1>
      <p style={sub}>Ask about access posture across the 248-seat workspace. Reads the roster only — it never acts on its own.</p>
    </div>
    <div style="{mono} display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 3px; padding: 5px 9px; background: #fff;">
      <span style="width: 7px; height: 7px; border-radius: 50%; background: {offline ? '#c98a1e' : 'var(--accent)'};"></span>
      {offline ? 'offline heuristics' : 'ordy · haiku'}
    </div>
  </div>

  <div style="{panel} display: flex; flex-direction: column; height: calc(100vh - 220px); min-height: 420px; overflow: hidden;">
    <div bind:this={scroller} style="flex: 1; overflow-y: auto; padding: 18px; background: #fafbfa; display: flex; flex-direction: column; gap: 12px;">
      {#if chat.length === 0}
        <div style="display: flex; flex-direction: column; gap: 16px; max-width: 60ch;">
          <p style="font-size: 13.5px; line-height: 1.7; color: #4a5250; margin: 0;">
            I read the same roster the Users table does — roles, teams, MFA state, password age, session counts.
            Ask an audit question and I'll answer with named accounts.
          </p>
          <div style="display: flex; flex-direction: column; gap: 7px;">
            <span style="{label} color: var(--faint);">Try</span>
            {#each prompts as p (p)}
              <button
                type="button"
                on:click={() => send(p)}
                style="text-align: left; background: #fff; border: 1px solid var(--line); border-radius: 3px; padding: 10px 12px; font-size: 12.5px; cursor: pointer; color: var(--ink);"
              >{p}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#each chat as m, i (i)}
        <div style="display: flex; flex-direction: column; align-items: {m.role === 'user' ? 'flex-end' : 'flex-start'}; gap: 4px;">
          <div style={bubble(m)}>{m.text}</div>
          {#if m.local}
            <span style="{mono} font-size: 10.5px; color: #8a5a10;">computed locally · {ENDPOINT} unreachable</span>
          {/if}
        </div>
      {/each}

      {#if busy}
        <span style="{mono} font-size: 11px; color: var(--faint); letter-spacing: 0.06em;">working…</span>
      {/if}
    </div>

    <div style="flex: none; border-top: 1px solid var(--line); padding: 12px 14px; background: #fff; display: flex; flex-direction: column; gap: 9px;">
      <textarea
        class="field"
        rows="2"
        placeholder="Ask about roles, MFA, stale credentials, a specific person…"
        bind:value={input}
        on:keydown={onKey}
        style="width: 100%; height: auto; resize: none; padding: 9px 11px; line-height: 1.5;"
      ></textarea>
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="{mono} font-size: 10.5px; color: var(--faint);">enter to send · shift+enter newline</span>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn-ghost" style="height: 30px; padding: 0 11px; background: #fff; border: 1px solid var(--line); border-radius: 3px; font-size: 12.5px; cursor: pointer;" on:click={() => (chat = [])}>Clear</button>
          <button type="button" class="btn-dark" style="{btnDark} height: 30px;" on:click={() => send()}>Send</button>
        </div>
      </div>
    </div>
  </div>
</div>
