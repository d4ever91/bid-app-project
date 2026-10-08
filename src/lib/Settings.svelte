<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { mono, label, panel, panelHead, field, btnDark, btnGhost, h1, sub } from '../ui';
  import { relative } from '../adapters';
  import {
    ApiError, fetchAutomationSettings, getAccessToken, saveAutomationSettings, testAiProvider, testMailboxConnection,
    type AiProvider, type AutomationSettings, type AutomationSettingsPatch, type IntegrationProvider
  } from '../api';

  const dispatch = createEventDispatcher<{ notify: string; inbox: void }>();

  type Tab = 'integrations' | 'automation';
  /** Which tab opens first (the Bid inbox links straight to "automation"). */
  export let tab: Tab = 'integrations';

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
  let mailHost = 'imap.gmail.com';
  let mailPort = 993;
  let mailSecure = true;
  let showServer = false;

  // Bid automation rules.
  let threshold = 75;
  let pollMinutes = 5;
  let readAttachments = true;

  /** Which card is busy: "<id>:save", "<id>:test", "<id>:remove". */
  let busy = '';
  let fieldErrors: Record<string, string> = {};

  function apply(s: AutomationSettings): void {
    settings = s;
    keys = { openai: '', gemini: '', anthropic: '' };
    models = { openai: s.openai.model, gemini: s.gemini.model, anthropic: s.anthropic.model };
    mailUser = s.mailbox.user;
    mailFolder = s.mailbox.folder;
    mailHost = s.mailbox.host;
    mailPort = s.mailbox.port;
    mailSecure = s.mailbox.secure;
    mailPassword = '';
    threshold = Math.round(s.autoCreateThreshold * 100);
    pollMinutes = s.pollMinutes;
    readAttachments = s.readAttachments;
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
      () => patch({ mailbox: { ...mailboxFields(), ...(mailPassword.trim() ? { password: mailPassword } : {}) } }),
      'Saved',
      'Could not save the mailbox'
    );
  }

  const mailboxFields = () => ({ user: mailUser, folder: mailFolder, host: mailHost, port: Number(mailPort), secure: mailSecure });

  function disconnectMailbox(): Promise<void> {
    return run('gmail:remove', () => patch({ enabled: false, mailbox: { password: '' } }), 'Mailbox disconnected', 'Could not disconnect');
  }

  function testMailbox(): Promise<void> {
    return run(
      'gmail:test',
      () =>
        testMailboxConnection({
          user: mailUser || undefined,
          password: mailPassword || undefined,
          folder: mailFolder || undefined,
          host: mailHost || undefined,
          port: Number(mailPort) || undefined,
          secure: mailSecure
        }),
      'Mailbox connected',
      'Could not connect to the mailbox'
    );
  }

  function saveRules(): Promise<void> {
    return run(
      'rules:save',
      () => patch({ autoCreateThreshold: threshold / 100, pollMinutes: Number(pollMinutes), readAttachments }),
      'Settings saved',
      'Could not save settings'
    );
  }

  function toggleEnabled(): Promise<void> {
    const next = !settings?.enabled;
    return run('rules:enabled', () => patch({ enabled: next }), next ? 'Automatic checking is on' : 'Automatic checking is off', 'Could not change that');
  }

  function discardRules(): void {
    if (settings) apply(settings);
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
  const providerName = (p: AiProvider): string => (p === 'openai' ? 'OpenAI' : 'Google Gemini');
  const BID_PROVIDERS: AiProvider[] = ['openai', 'gemini'];
  const dot = (ok: boolean): string =>
    `display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${ok ? 'var(--accent)' : '#c3c8c9'}; margin-right: 8px;`;
  const tabStyle = (on: boolean): string =>
    `${mono} padding: 9px 2px; margin-right: 22px; border: none; border-bottom: 2px solid ${on ? 'var(--ink)' : 'transparent'}; background: none; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; color: ${on ? 'var(--ink)' : 'var(--muted)'};`;

  const badge = (on: boolean): string =>
    `${mono} font-size: 10.5px; letter-spacing: 0.04em; padding: 3px 8px; border-radius: 10px; white-space: nowrap; ` +
    (on ? 'background: #e9f3f0; color: #1f6f5c;' : 'background: #f1f2f1; color: #7b8380;');
  const errText = `${mono} font-size: 11px; color: #932f2f;`;
  const hint = 'font-size: 12px; color: var(--muted); line-height: 1.55; margin: 0;';
  const danger = `${btnGhost} color: #932f2f; border-color: #e6c4c4;`;
  const col = 'display: flex; flex-direction: column; gap: 6px;';
</script>

<div style="max-width: 860px;">
  <div style="margin-bottom: 14px;">
    <h1 style={h1}>Settings</h1>
    <p style={sub}>
      {#if tab === 'integrations'}Connect AI providers and your bid mailbox. Keys are encrypted and never shown again after saving.
      {:else}How emails become bids: on/off, which AI reads them, and when bids are created automatically.{/if}
    </p>
  </div>
  <div role="tablist" style="display: flex; border-bottom: 1px solid var(--line); margin-bottom: 18px;">
    <button type="button" role="tab" aria-selected={tab === 'integrations'} style={tabStyle(tab === 'integrations')} on:click={() => (tab = 'integrations')}>Integrations</button>
    <button type="button" role="tab" aria-selected={tab === 'automation'} style={tabStyle(tab === 'automation')} on:click={() => (tab = 'automation')}>Bid automation</button>
  </div>

  {#if !live()}
    <div style="{panel} padding: 18px; font-size: 13px; color: var(--muted);">Sign in to manage integrations — demo mode has no workspace to save keys to.</div>
  {:else if loading}
    <div style="{panel} padding: 18px; font-size: 13px; color: var(--muted);">Loading…</div>
  {:else if forbidden}
    <div style="{panel} padding: 18px; font-size: 13px; color: var(--muted);">Only workspace Owners and Admins can manage integrations.</div>
  {:else if tab === 'integrations'}
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
            {#if showServer}
              <label style={col}>
                <span style={label}>IMAP host</span>
                <input class="field" bind:value={mailHost} style="{field} {mono} font-size: 12.5px;" />
              </label>
              <label style={col}>
                <span style={label}>Port</span>
                <input class="field" type="number" bind:value={mailPort} style="{field} {mono} font-size: 12.5px;" />
              </label>
              <label style="display: flex; align-items: center; gap: 7px; padding-top: 20px; font-size: 12.5px;">
                <input type="checkbox" bind:checked={mailSecure} style="accent-color: var(--accent);" /> SSL/TLS
              </label>
            {/if}
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
            <button type="button" on:click={() => (showServer = !showServer)} style="{mono} background: none; border: none; padding: 0 4px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); cursor: pointer;">{showServer ? 'Hide server settings' : 'Server settings'}</button>
            <button type="button" class="btn-ghost" style="{btnGhost} margin-left: auto;" on:click={() => (tab = 'automation')}>Bid automation →</button>
          </div>
        </div>
      </section>
    </div>
  {:else}
    <!-- ---------------- Bid automation ---------------- -->
    <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 300px); gap: 20px; align-items: start;">
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <section style={panel} data-section="switch">
          <div style="padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; gap: 14px;">
            <span style="display: flex; flex-direction: column; gap: 3px;">
              <span style="font-size: 14px; font-weight: 600;">Automatic checking</span>
              <span style="font-size: 12.5px; color: var(--muted);">
                {#if settings?.ready.polling}Reading {settings.mailbox.user} every {settings.pollMinutes} min · last checked {when(settings.mailbox.lastCheckedAt)}
                {:else if settings?.enabled}On, but waiting for {settings.ready.ai ? 'a mailbox' : 'an AI key'} — see Integrations
                {:else}Off — new emails are only read when you press “Check mailbox now” in the Bid inbox{/if}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={!!settings?.enabled}
              aria-label="Automatic checking"
              disabled={busy !== ''}
              on:click={toggleEnabled}
              style="flex: none; width: 38px; height: 21px; padding: 2px; border-radius: 11px; border: 1px solid {settings?.enabled ? 'var(--accent)' : 'var(--line)'}; background: {settings?.enabled ? 'var(--accent)' : '#fff'}; cursor: pointer; display: flex; justify-content: {settings?.enabled ? 'flex-end' : 'flex-start'};"
            >
              <span style="width: 15px; height: 15px; border-radius: 50%; background: {settings?.enabled ? '#fff' : '#c3c8c9'};"></span>
            </button>
          </div>
        </section>

        <section style={panel} data-section="reader">
          <div style={panelHead}>
            <span>AI that reads bid emails</span>
            <button type="button" on:click={() => (tab = 'integrations')} style="{mono} background: none; border: none; font-size: 11px; color: var(--accent); cursor: pointer; padding: 0;">Manage keys →</button>
          </div>
          <div style="padding: 16px 18px; display: flex; gap: 8px;">
            {#each BID_PROVIDERS as id (id)}
              <button
                type="button"
                disabled={busy !== ''}
                on:click={() => useForBids(id)}
                style="flex: 1; text-align: left; padding: 11px 13px; border: 1px solid {usedForBids(settings, id) ? 'var(--accent)' : 'var(--line)'}; background: {usedForBids(settings, id) ? '#f4f8f7' : '#fff'}; border-radius: 3px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px;"
              >
                <span style="display: flex; flex-direction: column; gap: 2px;">
                  <span style="font-size: 13.5px; font-weight: 500;">{providerName(id)}</span>
                  <span style="{mono} font-size: 10.5px; color: var(--faint);">{info(settings, id).hasKey ? 'key saved · ' + (settings ? settings[id].model : '') : 'no key yet'}</span>
                </span>
                {#if usedForBids(settings, id)}<span style={badge(true)}>In use</span>{/if}
              </button>
            {/each}
          </div>
        </section>

        <section style={panel} data-section="rules">
          <div style={panelHead}>Rules</div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 16px;">
            <label style="display: flex; flex-direction: column; gap: 8px;">
              <span style="display: flex; justify-content: space-between; font-size: 13px;">
                <span>Create bids automatically when the AI is at least</span>
                <span style="{mono} font-weight: 600;">{threshold}% sure</span>
              </span>
              <input type="range" min="50" max="100" step="5" bind:value={threshold} style="accent-color: var(--accent);" />
              <span style={hint}>Below that, detected bids wait in the Bid inbox under “To review”. Set 100% to always review.</span>
              {#if err(fieldErrors, 'autoCreateThreshold')}<span style={errText}>{err(fieldErrors, 'autoCreateThreshold')}</span>{/if}
            </label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <label style={col}>
                <span style={label}>Check the mailbox every</span>
                <select class="field" bind:value={pollMinutes} style="{field} padding: 0 9px; cursor: pointer;">
                  {#each [5, 10, 15, 30, 60, 240] as m}<option value={m}>{m < 60 ? m + ' minutes' : m / 60 + ' hour' + (m > 60 ? 's' : '')}</option>{/each}
                </select>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; padding-top: 20px; font-size: 13px;">
                <input type="checkbox" bind:checked={readAttachments} style="accent-color: var(--accent);" />
                Let the AI read PDF attachments (tender packs)
              </label>
            </div>
          </div>
          <div style="padding: 12px 18px; border-top: 1px solid var(--line); background: #fafbfa; display: flex; justify-content: flex-end; gap: 8px;">
            <button type="button" class="btn-ghost" style={btnGhost} disabled={busy !== ''} on:click={discardRules}>Discard</button>
            <button type="button" class="btn-dark" style={btnDark} disabled={busy !== ''} on:click={saveRules}>{busy === 'rules:save' ? 'Saving…' : 'Save rules'}</button>
          </div>
        </section>
      </div>

      <div style="display: flex; flex-direction: column; gap: 16px;">
        <section style={panel} data-section="status">
          <div style={panelHead}>Status</div>
          <div style="padding: 14px 18px; display: flex; flex-direction: column; gap: 11px; font-size: 13px;">
            <div><span style={dot(!!settings?.ready.ai)}></span>{settings?.ready.ai ? providerName(settings.provider) + ' key saved' : 'No key for ' + (settings ? providerName(settings.provider) : 'the AI')}</div>
            <div><span style={dot(!!settings?.ready.mailbox)}></span>{settings?.ready.mailbox ? 'Mailbox ' + settings.mailbox.user : 'Mailbox not connected'}</div>
            <div><span style={dot(!!settings?.ready.polling)}></span>{settings?.ready.polling ? 'Checking every ' + settings.pollMinutes + ' min' : 'Automatic checking is off'}</div>
          </div>
          {#if settings?.mailbox.lastError}
            <div style="margin: 0 18px 14px; font-size: 12px; color: #932f2f; background: #fdf5f5; border: 1px solid #e6c4c4; border-radius: 3px; padding: 8px 10px;">Last check failed: {settings.mailbox.lastError}</div>
          {/if}
          <div style="padding: 12px 18px; border-top: 1px solid var(--line);">
            <button type="button" class="btn-ghost" style="{btnGhost} width: 100%;" on:click={() => dispatch('inbox')}>Open Bid inbox →</button>
          </div>
        </section>

        <section style={panel}>
          <div style={panelHead}>How it works</div>
          <div style="padding: 14px 18px; font-size: 12.5px; color: var(--muted); line-height: 1.65; display: flex; flex-direction: column; gap: 8px;">
            <span>1. New emails in the folder are read every few minutes (the first check looks back 7 days). Nothing is marked as read.</span>
            <span>2. {settings ? providerName(settings.provider) : 'The AI'} decides whether each one is a bid and extracts client, value, deadline, contact and requirements.</span>
            <span>3. Confident ones become bids in <strong style="font-weight: 600;">Qualifying</strong>. The rest wait in the Bid inbox for you.</span>
          </div>
        </section>
      </div>
    </div>
  {/if}
</div>
