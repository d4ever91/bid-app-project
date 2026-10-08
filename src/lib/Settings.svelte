<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { mono, label, panel, panelHead, field, btnDark, btnGhost, h1, sub } from '../ui';
  import { relative } from '../adapters';
  import {
    ApiError, fetchAutomationSettings, getAccessToken, saveAutomationSettings, testAiProvider, testMailboxConnection,
    type AiProvider, type AutomationSettings, type AutomationSettingsPatch, type IntegrationProvider
  } from '../api';

  const dispatch = createEventDispatcher<{ notify: string; inbox: void }>();

  const live = (): boolean => !!getAccessToken();

  interface ProviderInfo {
    id: IntegrationProvider;
    name: string;
    usedFor: string;
    placeholder: string;
    keyUrl: string;
    keySite: string;
  }

  const PROVIDERS: ProviderInfo[] = [
    {
      id: 'openai',
      name: 'OpenAI',
      usedFor: 'Reads bid emails and extracts client, value and deadline',
      placeholder: 'sk-…',
      keyUrl: 'https://platform.openai.com/api-keys',
      keySite: 'platform.openai.com/api-keys'
    },
    {
      id: 'gemini',
      name: 'Google Gemini',
      usedFor: 'Reads bid emails and extracts client, value and deadline',
      placeholder: 'AIza…',
      keyUrl: 'https://aistudio.google.com/apikey',
      keySite: 'aistudio.google.com/apikey'
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      usedFor: 'Powers the AI assistant',
      placeholder: 'sk-ant-…',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      keySite: 'console.anthropic.com/settings/keys'
    }
  ];

  let settings: AutomationSettings | null = null;
  let loading = true;
  let forbidden = false;

  // Typed-in values. Saved secrets never come back to the browser, so key fields start empty.
  let keys: Record<IntegrationProvider, string> = { openai: '', gemini: '', anthropic: '' };
  let models: Record<IntegrationProvider, string> = { openai: '', gemini: '', anthropic: '' };
  let mailUser = '';
  let mailPassword = '';
  let mailFolder = 'INBOX';

  /** Which card is busy: "<id>:save", "<id>:test", "<id>:remove". */
  let busy = '';
  let fieldErrors: Record<string, string> = {};

  function apply(s: AutomationSettings): void {
    settings = s;
    keys = { openai: '', gemini: '', anthropic: '' };
    models = { openai: s.openai.model, gemini: s.gemini.model, anthropic: s.anthropic.model };
    mailUser = s.mailbox.user;
    mailFolder = s.mailbox.folder;
    mailPassword = '';
  }

  async function load(): Promise<void> {
    loading = true;
    try {
      apply(await fetchAutomationSettings());
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) forbidden = true;
      else dispatch('notify', err instanceof ApiError ? err.message : 'Could not load settings');
    } finally {
      loading = false;
    }
  }

  async function run(tag: string, task: () => Promise<string | null>, fallback: string, failText: string): Promise<void> {
    busy = tag;
    fieldErrors = {};
    try {
      dispatch('notify', (await task()) ?? fallback);
    } catch (err) {
      if (err instanceof ApiError) fieldErrors = err.fields;
      dispatch('notify', err instanceof ApiError ? err.message : failText);
    } finally {
      busy = '';
    }
  }

  async function patch(body: AutomationSettingsPatch): Promise<string | null> {
    const { settings: s, message } = await saveAutomationSettings(body);
    apply(s);
    return message;
  }

  const providerPatch = (id: IntegrationProvider, value: { apiKey?: string; model?: string }): AutomationSettingsPatch =>
    id === 'openai' ? { openai: value } : id === 'gemini' ? { gemini: value } : { anthropic: value };

  function saveProvider(id: IntegrationProvider): Promise<void> {
    const key = keys[id].trim();
    return run(id + ':save', () => patch(providerPatch(id, { model: models[id], ...(key ? { apiKey: key } : {}) })), 'Saved', 'Could not save');
  }

  function removeProvider(id: IntegrationProvider): Promise<void> {
    return run(id + ':remove', () => patch(providerPatch(id, { apiKey: '' })), 'Key removed', 'Could not remove the key');
  }

  function testProvider(id: IntegrationProvider): Promise<void> {
    return run(id + ':test', () => testAiProvider(id, keys[id].trim() || undefined, models[id]), 'Connection works', 'The test request failed');
  }

  function useForBids(id: AiProvider): Promise<void> {
    return run(id + ':use', () => patch({ provider: id }), 'Saved', 'Could not switch provider');
  }

  function saveMailbox(): Promise<void> {
    return run(
      'gmail:save',
      () => patch({ mailbox: { user: mailUser, folder: mailFolder, ...(mailPassword.trim() ? { password: mailPassword } : {}) } }),
      'Saved',
      'Could not save the mailbox'
    );
  }

  function disconnectMailbox(): Promise<void> {
    return run('gmail:remove', () => patch({ enabled: false, mailbox: { password: '' } }), 'Mailbox disconnected', 'Could not disconnect');
  }

  function testMailbox(): Promise<void> {
    return run(
      'gmail:test',
      () => testMailboxConnection({ user: mailUser || undefined, password: mailPassword || undefined, folder: mailFolder || undefined }),
      'Mailbox connected',
      'Could not connect to the mailbox'
    );
  }

  onMount(() => {
    if (live()) void load();
    else loading = false;
  });

  /* ---- markup helpers (Svelte 4 markup can't hold TypeScript) ---- */

  // Helpers take `s` (the settings) as an argument so Svelte re-renders when it changes.
  type Settings = AutomationSettings | null;

  function info(s: Settings, id: IntegrationProvider): { hasKey: boolean; keyHint: string | null; suggestions: string[] } {
    return s ? s[id] : { hasKey: false, keyHint: null, suggestions: [] };
  }

  function status(s: Settings, id: IntegrationProvider): { text: string; on: boolean } {
    const p = info(s, id);
    if (p.hasKey) return { text: 'Connected · ' + (p.keyHint ?? 'key saved'), on: true };
    if (id === 'anthropic' && s?.anthropic.serverKey) return { text: 'Using the server key', on: true };
    return { text: 'Not connected', on: false };
  }

  const isBidProvider = (id: IntegrationProvider): boolean => id !== 'anthropic';
  const usedForBids = (s: Settings, id: IntegrationProvider): boolean => !!s && s.provider === id;
  const keyPlaceholder = (s: Settings, p: ProviderInfo): string => {
    const i = info(s, p.id);
    return i.hasKey ? 'Saved — ' + (i.keyHint ?? '') + ' (type to replace)' : p.placeholder;
  };
  const err = (errors: Record<string, string>, id: string): string => errors[id] ?? '';
  const mailConnected = (s: Settings): boolean => !!s?.mailbox.user && !!s?.mailbox.hasPassword;
  const when = (iso: string | null): string => (iso ? relative(iso) : 'never');

  const badge = (on: boolean): string =>
    `${mono} font-size: 10.5px; letter-spacing: 0.04em; padding: 3px 8px; border-radius: 10px; white-space: nowrap; ` +
    (on ? 'background: #e9f3f0; color: #1f6f5c;' : 'background: #f1f2f1; color: #7b8380;');
  const errText = `${mono} font-size: 11px; color: #932f2f;`;
  const hint = 'font-size: 12px; color: var(--muted); line-height: 1.55; margin: 0;';
  const danger = `${btnGhost} color: #932f2f; border-color: #e6c4c4;`;
  const col = 'display: flex; flex-direction: column; gap: 6px;';
</script>

<div style="max-width: 860px;">
  <div style="margin-bottom: 18px;">
    <h1 style={h1}>Settings</h1>
    <p style={sub}>Integrations — connect AI providers and your bid mailbox. Keys are encrypted and never shown again after saving.</p>
  </div>

  {#if !live()}
    <div style="{panel} padding: 18px; font-size: 13px; color: var(--muted);">Sign in to manage integrations — demo mode has no workspace to save keys to.</div>
  {:else if loading}
    <div style="{panel} padding: 18px; font-size: 13px; color: var(--muted);">Loading…</div>
  {:else if forbidden}
    <div style="{panel} padding: 18px; font-size: 13px; color: var(--muted);">Only workspace Owners and Admins can manage integrations.</div>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <div style="{label} padding-top: 2px;">AI providers</div>

      {#each PROVIDERS as p (p.id)}
        <section style={panel} data-integration={p.id}>
          <div style={panelHead}>
            <span style="display: flex; flex-direction: column; gap: 3px;">
              <span>{p.name}</span>
              <span style="font-size: 12px; font-weight: 400; color: var(--muted);">{p.usedFor}</span>
            </span>
            <span style="display: flex; gap: 6px; align-items: center;">
              {#if usedForBids(settings, p.id)}<span style={badge(true)}>Reads bid emails</span>{/if}
              <span style={badge(status(settings, p.id).on)}>{status(settings, p.id).text}</span>
            </span>
          </div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;">
            <div style="display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 12px;">
              <label style={col}>
                <span style={label}>API key</span>
                <input class="field" type="password" autocomplete="off" bind:value={keys[p.id]} placeholder={keyPlaceholder(settings, p)} style="{field} {mono} font-size: 12.5px;" />
                {#if err(fieldErrors, p.id + '.apiKey')}<span style={errText}>{err(fieldErrors, p.id + '.apiKey')}</span>{/if}
              </label>
              <label style={col}>
                <span style={label}>Model</span>
                <input class="field" list={p.id + '-model-list'} bind:value={models[p.id]} style="{field} {mono} font-size: 12.5px;" />
                <datalist id={p.id + '-model-list'}>{#each info(settings, p.id).suggestions as m}<option value={m}></option>{/each}</datalist>
              </label>
            </div>
            <p style={hint}>
              Create a key at <a href={p.keyUrl} target="_blank" rel="noreferrer" style="color: var(--accent);">{p.keySite}</a>. Usage is billed to that account.
              {#if p.id === 'anthropic' && settings?.anthropic.serverKey && !info(settings, p.id).hasKey}A server-wide key is set; adding one here overrides it for this workspace.{/if}
              {#if p.id === 'anthropic' && !settings?.anthropic.serverKey && !info(settings, p.id).hasKey}Without a key the assistant answers from built-in summaries.{/if}
            </p>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button type="button" class="btn-dark" style={btnDark} disabled={busy !== ''} on:click={() => saveProvider(p.id)}>{busy === p.id + ':save' ? 'Saving…' : 'Save'}</button>
              <button type="button" class="btn-ghost" style={btnGhost} disabled={busy !== ''} on:click={() => testProvider(p.id)}>{busy === p.id + ':test' ? 'Testing…' : 'Test'}</button>
              {#if info(settings, p.id).hasKey}
                <button type="button" class="btn-ghost" style={danger} disabled={busy !== ''} on:click={() => removeProvider(p.id)}>{busy === p.id + ':remove' ? 'Removing…' : 'Remove key'}</button>
              {/if}
              {#if p.id === 'openai' && !usedForBids(settings, p.id)}
                <button type="button" class="btn-ghost" style="{btnGhost} margin-left: auto;" disabled={busy !== ''} on:click={() => useForBids('openai')}>Use for bid emails</button>
              {:else if p.id === 'gemini' && !usedForBids(settings, p.id)}
                <button type="button" class="btn-ghost" style="{btnGhost} margin-left: auto;" disabled={busy !== ''} on:click={() => useForBids('gemini')}>Use for bid emails</button>
              {:else if isBidProvider(p.id)}
                <span style="{mono} margin-left: auto; font-size: 11px; color: var(--faint);">used for bid emails</span>
              {/if}
            </div>
          </div>
        </section>
      {/each}

      <div style="{label} padding-top: 8px;">Mailbox</div>

      <section style={panel} data-integration="gmail">
        <div style={panelHead}>
          <span style="display: flex; flex-direction: column; gap: 3px;">
            <span>Gmail</span>
            <span style="font-size: 12px; font-weight: 400; color: var(--muted);">The inbox that receives tender and RFP emails · read-only</span>
          </span>
          <span style={badge(mailConnected(settings))}>{mailConnected(settings) ? 'Connected · ' + settings?.mailbox.user : 'Not connected'}</span>
        </div>
        <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;">
          <div style="display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.3fr) minmax(0, 1fr); gap: 12px;">
            <label style={col}>
              <span style={label}>Gmail address</span>
              <input class="field" type="email" bind:value={mailUser} placeholder="bids@yourcompany.com" style="{field} {mono} font-size: 12.5px;" />
              {#if err(fieldErrors, 'mailbox.user')}<span style={errText}>{err(fieldErrors, 'mailbox.user')}</span>{/if}
            </label>
            <label style={col}>
              <span style={label}>App password</span>
              <input class="field" type="password" autocomplete="off" bind:value={mailPassword} placeholder={settings?.mailbox.hasPassword ? 'Saved (type to replace)' : 'abcd efgh ijkl mnop'} style="{field} {mono} font-size: 12.5px;" />
            </label>
            <label style={col}>
              <span style={label}>Folder or label</span>
              <input class="field" bind:value={mailFolder} placeholder="INBOX" style="{field} {mono} font-size: 12.5px;" />
            </label>
          </div>
          <p style={hint}>
            Gmail needs an app password: turn on 2-Step Verification, then create one at
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style="color: var(--accent);">myaccount.google.com/apppasswords</a>.
            {#if mailConnected(settings)}Last checked {when(settings?.mailbox.lastCheckedAt ?? null)}.{/if}
          </p>
          {#if settings?.mailbox.lastError}
            <div style="font-size: 12.5px; color: #932f2f; background: #fdf5f5; border: 1px solid #e6c4c4; border-radius: 3px; padding: 9px 12px;">Last check failed: {settings.mailbox.lastError}</div>
          {/if}
          <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <button type="button" class="btn-dark" style={btnDark} disabled={busy !== ''} on:click={saveMailbox}>{busy === 'gmail:save' ? 'Saving…' : 'Save'}</button>
            <button type="button" class="btn-ghost" style={btnGhost} disabled={busy !== ''} on:click={testMailbox}>{busy === 'gmail:test' ? 'Connecting…' : 'Test'}</button>
            {#if settings?.mailbox.hasPassword}
              <button type="button" class="btn-ghost" style={danger} disabled={busy !== ''} on:click={disconnectMailbox}>{busy === 'gmail:remove' ? 'Disconnecting…' : 'Disconnect'}</button>
            {/if}
            <button type="button" class="btn-ghost" style="{btnGhost} margin-left: auto;" on:click={() => dispatch('inbox')}>Automation rules →</button>
          </div>
        </div>
      </section>
    </div>
  {/if}
</div>
