<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { mono, label, panel, panelHead, field, btnDark, btnGhost, h1, sub } from '../ui';
  import { relative } from '../adapters';
  import { money } from '../bids';
  import {
    ApiError, createBidFromEmail, fetchAutomationSettings, fetchInbox, getAccessToken, ignoreEmail, ingestEmail, reprocessEmail,
    runAutomation, saveAutomationSettings, testAiProvider, testMailboxConnection,
    type AiProvider, type AutomationSettings, type AutomationSettingsPatch, type MailItem, type MailStatus
  } from '../api';

  const dispatch = createEventDispatcher<{ notify: string; openBid: string; changed: void; counts: number }>();

  const live = (): boolean => !!getAccessToken();
  const fail = (err: unknown, fallback: string): void => {
    dispatch('notify', err instanceof ApiError ? err.message : fallback);
  };

  type Tab = 'inbox' | 'settings';
  let tab: Tab = 'inbox';

  /* ---------------- settings ---------------- */

  let settings: AutomationSettings | null = null;
  /** Engineers can use the inbox but only Owners/Admins manage settings. */
  let canManage = true;

  // Form state. Secrets start empty: the saved ones are never sent back to the browser.
  let enabled = false;
  let provider: AiProvider = 'openai';
  let openaiKey = '';
  let geminiKey = '';
  let openaiModel = '';
  let geminiModel = '';
  let mailUser = '';
  let mailPassword = '';
  let mailFolder = 'INBOX';
  let mailHost = 'imap.gmail.com';
  let mailPort = 993;
  let mailSecure = true;
  let showAdvanced = false;
  let threshold = 75;
  let pollMinutes = 5;
  let readAttachments = true;
  let saving = false;
  let testing = '';
  let fieldErrors: Record<string, string> = {};

  function applySettings(s: AutomationSettings): void {
    settings = s;
    enabled = s.enabled;
    provider = s.provider;
    openaiModel = s.openai.model;
    geminiModel = s.gemini.model;
    mailUser = s.mailbox.user;
    mailFolder = s.mailbox.folder;
    mailHost = s.mailbox.host;
    mailPort = s.mailbox.port;
    mailSecure = s.mailbox.secure;
    threshold = Math.round(s.autoCreateThreshold * 100);
    pollMinutes = s.pollMinutes;
    readAttachments = s.readAttachments;
    openaiKey = '';
    geminiKey = '';
    mailPassword = '';
  }

  async function loadSettings(): Promise<void> {
    try {
      applySettings(await fetchAutomationSettings());
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) canManage = false;
    }
  }

  async function save(extra: AutomationSettingsPatch = {}): Promise<void> {
    saving = true;
    fieldErrors = {};
    const patch: AutomationSettingsPatch = {
      enabled,
      provider,
      openai: { model: openaiModel, ...(openaiKey.trim() ? { apiKey: openaiKey.trim() } : {}) },
      gemini: { model: geminiModel, ...(geminiKey.trim() ? { apiKey: geminiKey.trim() } : {}) },
      mailbox: {
        user: mailUser,
        folder: mailFolder,
        host: mailHost,
        port: Number(mailPort),
        secure: mailSecure,
        ...(mailPassword.trim() ? { password: mailPassword } : {})
      },
      autoCreateThreshold: threshold / 100,
      pollMinutes: Number(pollMinutes),
      readAttachments,
      ...extra
    };
    try {
      const { settings: s, message } = await saveAutomationSettings(patch);
      applySettings(s);
      dispatch('notify', message ?? 'Settings saved');
    } catch (err) {
      if (err instanceof ApiError) fieldErrors = err.fields;
      fail(err, 'Could not save settings');
    } finally {
      saving = false;
    }
  }

  const removeKey = (p: AiProvider): Promise<void> => save(p === 'openai' ? { openai: { apiKey: '' } } : { gemini: { apiKey: '' } });

  async function testAi(p: AiProvider): Promise<void> {
    testing = p;
    try {
      const key = p === 'openai' ? openaiKey.trim() : geminiKey.trim();
      const model = p === 'openai' ? openaiModel : geminiModel;
      dispatch('notify', (await testAiProvider(p, key || undefined, model)) ?? 'Connection works');
    } catch (err) {
      fail(err, 'The test request failed');
    } finally {
      testing = '';
    }
  }

  async function testMailbox(): Promise<void> {
    testing = 'mailbox';
    try {
      const message = await testMailboxConnection({
        user: mailUser || undefined,
        password: mailPassword || undefined,
        folder: mailFolder || undefined,
        host: mailHost || undefined,
        port: Number(mailPort) || undefined,
        secure: mailSecure
      });
      dispatch('notify', message ?? 'Mailbox connected');
    } catch (err) {
      fail(err, 'Could not connect to the mailbox');
    } finally {
      testing = '';
    }
  }

  const toggleEnabled = (): void => {
    enabled = !enabled;
    void save({ enabled });
  };

  /* ---------------- inbox ---------------- */

  const FILTERS: Array<{ id: MailStatus | 'all'; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'needs_review', label: 'To review' },
    { id: 'bid_created', label: 'Bids created' },
    { id: 'not_a_bid', label: 'Not bids' },
    { id: 'failed', label: 'Failed' },
    { id: 'ignored', label: 'Dismissed' }
  ];

  const STATUS: Record<MailStatus, { text: string; color: string }> = {
    bid_created: { text: 'Bid created', color: 'var(--accent)' },
    needs_review: { text: 'To review', color: '#b45309' },
    not_a_bid: { text: 'Not a bid', color: '#8a8f93' },
    failed: { text: 'Failed', color: '#b23a3a' },
    ignored: { text: 'Dismissed', color: '#b5bab8' }
  };

  let filter: MailStatus | 'all' = 'all';
  let items: MailItem[] = [];
  let counts: Record<string, number> = {};
  let loadingInbox = false;
  let selectedId: string | null = null;
  let running = false;
  let busyItem = false;

  // Editable copy of the AI's extraction for the selected email.
  let draft = { title: '', client: '', reference: '', sector: '', value: '', dueDate: '' };
  let showText = false;

  $: selected = items.find((i) => i.id === selectedId) ?? null;
  $: totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  function pick(item: MailItem): void {
    selectedId = item.id;
    showText = false;
    draft = {
      title: item.ai?.title ?? item.subject,
      client: item.ai?.client ?? item.fromName ?? '',
      reference: item.ai?.reference ?? '',
      sector: item.ai?.sector ?? '',
      value: item.ai?.value ? String(item.ai.value) : '',
      dueDate: item.ai?.dueDate ?? ''
    };
  }

  async function loadInbox(): Promise<void> {
    loadingInbox = true;
    try {
      const page = await fetchInbox(filter);
      items = page.items;
      counts = page.counts;
      dispatch('counts', counts.needs_review ?? 0);
      const keep = items.find((i) => i.id === selectedId);
      if (keep) pick(keep);
      else if (items.length) pick(items[0]);
      else selectedId = null;
    } catch (err) {
      fail(err, 'Could not load the bid inbox');
    } finally {
      loadingInbox = false;
    }
  }

  const setFilter = (id: MailStatus | 'all'): void => {
    filter = id;
    void loadInbox();
  };

  async function checkNow(): Promise<void> {
    running = true;
    try {
      const { message } = await runAutomation();
      dispatch('notify', message ?? 'Mailbox checked');
      await Promise.all([loadInbox(), loadSettings()]);
      dispatch('changed');
    } catch (err) {
      fail(err, 'Could not check the mailbox');
      await loadSettings();
    } finally {
      running = false;
    }
  }

  async function createBid(): Promise<void> {
    if (!selected) return;
    busyItem = true;
    try {
      const value = Number(String(draft.value).replace(/[^\d.]/g, ''));
      const { bid, message } = await createBidFromEmail(selected.id, {
        title: draft.title || undefined,
        client: draft.client || undefined,
        reference: draft.reference || undefined,
        sector: draft.sector || undefined,
        value: Number.isFinite(value) && draft.value !== '' ? value : undefined,
        dueDate: draft.dueDate || undefined
      });
      dispatch('notify', message ?? 'Bid created');
      dispatch('changed');
      await loadInbox();
      dispatch('openBid', bid._id);
    } catch (err) {
      fail(err, 'Could not create the bid');
    } finally {
      busyItem = false;
    }
  }

  async function dismiss(): Promise<void> {
    if (!selected) return;
    busyItem = true;
    try {
      await ignoreEmail(selected.id);
      dispatch('notify', 'Email dismissed');
      await loadInbox();
    } catch (err) {
      fail(err, 'Could not dismiss the email');
    } finally {
      busyItem = false;
    }
  }

  async function reprocess(): Promise<void> {
    if (!selected) return;
    busyItem = true;
    try {
      const { message } = await reprocessEmail(selected.id);
      dispatch('notify', message ?? 'Email re-read');
      dispatch('changed');
      await loadInbox();
    } catch (err) {
      fail(err, 'Could not re-read the email');
    } finally {
      busyItem = false;
    }
  }

  /* ---------------- paste an email ---------------- */

  let pasting = false;
  let pasteFrom = '';
  let pasteSubject = '';
  let pasteText = '';
  let pasteBusy = false;

  async function submitPaste(): Promise<void> {
    pasteBusy = true;
    try {
      const looksRaw = /^(from|received|return-path|delivered-to|message-id|mime-version):/im.test(pasteText.slice(0, 2000)) && !pasteSubject;
      const { item, message } = await ingestEmail(
        looksRaw ? { raw: pasteText } : { from: pasteFrom || undefined, subject: pasteSubject, text: pasteText }
      );
      dispatch('notify', message ?? 'Email processed');
      pasting = false;
      pasteFrom = pasteSubject = pasteText = '';
      filter = 'all';
      selectedId = item.id;
      dispatch('changed');
      await loadInbox();
    } catch (err) {
      fail(err, 'Could not process that email');
    } finally {
      pasteBusy = false;
    }
  }

  onMount(async () => {
    if (!live()) return;
    await Promise.all([loadSettings(), loadInbox()]);
    if (canManage && settings && !settings.ready.ai) tab = 'settings';
  });

  const pct = (n: number): string => Math.round(n * 100) + '%';
  const when = (iso: string | null): string => (iso ? relative(iso) : 'never');
  const kb = (n: number): string => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const providerName = (p: AiProvider): string => (p === 'openai' ? 'OpenAI' : 'Gemini');
  const chip = (on: boolean): string =>
    `${mono} padding: 6px 11px; border: 1px solid ${on ? 'var(--ink)' : 'var(--line)'}; background: ${on ? 'var(--ink)' : '#fff'}; color: ${on ? '#fff' : 'var(--muted)'}; border-radius: 3px; font-size: 11px; letter-spacing: 0.04em; cursor: pointer;`;
  const dot = (ok: boolean): string =>
    `display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${ok ? 'var(--accent)' : '#c3c8c9'}; margin-right: 7px;`;
  const errText = `${mono} font-size: 11px; color: #932f2f; margin-top: 6px;`;
  const hint = 'font-size: 12px; color: var(--muted); line-height: 1.55; margin: 0;';
</script>

<div>
  <div style="display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; gap: 16px; flex-wrap: wrap;">
    <div>
      <h1 style={h1}>Bid automation</h1>
      <p style={sub}>
        {#if !live()}
          Sign in to connect a mailbox — demo mode has no inbox.
        {:else if settings?.ready.polling}
          Watching {settings.mailbox.user} · read by {providerName(settings.provider)} · last checked {when(settings.mailbox.lastCheckedAt)}
        {:else}
          Emails are read by AI and turned into bids. Set it up under Settings.
        {/if}
      </p>
    </div>
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      <div style="display: flex; gap: 1px; border: 1px solid var(--line); border-radius: 3px; overflow: hidden;">
        {#each [['inbox', 'Inbox'], ['settings', 'Settings']] as [id, text] (id)}
          {#if id === 'inbox' || canManage}
            <button
              type="button"
              on:click={() => (tab = id === 'settings' ? 'settings' : 'inbox')}
              style="{mono} padding: 7px 13px; border: none; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; background: {tab === id ? 'var(--ink)' : '#fff'}; color: {tab === id ? '#fff' : 'var(--muted)'};"
            >{text}{id === 'inbox' && counts.needs_review ? ' · ' + counts.needs_review : ''}</button>
          {/if}
        {/each}
      </div>
    </div>
  </div>

  {#if tab === 'inbox'}
    {#if live() && canManage && settings && !settings.ready.ai}
      <div style="{panel} border-color: #e6d4b3; background: #fdf9f1; padding: 13px 18px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
        <span style="font-size: 13px; color: #8a5a10;">Add an OpenAI or Gemini API key and connect Gmail to start turning emails into bids.</span>
        <button type="button" class="btn-dark" style={btnDark} on:click={() => (tab = 'settings')}>Open settings</button>
      </div>
    {/if}

    <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap;">
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        {#each FILTERS as f (f.id)}
          <button type="button" style={chip(filter === f.id)} on:click={() => setFilter(f.id)}>
            {f.label}{f.id === 'all' ? (totalCount ? ' ' + totalCount : '') : counts[f.id] ? ' ' + counts[f.id] : ''}
          </button>
        {/each}
      </div>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="btn-ghost" style={btnGhost} disabled={!live()} on:click={() => (pasting = !pasting)}>{pasting ? 'Close' : 'Paste an email'}</button>
        {#if canManage}
          <button
            type="button"
            class="btn-dark"
            style="{btnDark}{running ? ' opacity: 0.6; cursor: wait;' : ''}"
            disabled={running || !live() || !settings?.ready.mailbox}
            title={settings?.ready.mailbox ? 'Read new emails now' : 'Connect a mailbox in Settings first'}
            on:click={checkNow}
          >{running ? 'Checking…' : 'Check mailbox now'}</button>
        {/if}
      </div>
    </div>

    {#if pasting}
      <div style="{panel} margin-bottom: 18px;">
        <div style={panelHead}>
          <span>Paste an email</span>
          <span style="{mono} font-size: 11px; font-weight: 400; color: var(--faint);">or paste the full source (.eml / "Show original" in Gmail)</span>
        </div>
        <div style="padding: 16px 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <label style="display: flex; flex-direction: column; gap: 7px;">
            <span style={label}>From</span>
            <input class="field" type="email" bind:value={pasteFrom} placeholder="procurement@council.gov.uk" style="{field} {mono} font-size: 12.5px;" />
          </label>
          <label style="display: flex; flex-direction: column; gap: 7px;">
            <span style={label}>Subject</span>
            <input class="field" type="text" bind:value={pasteSubject} placeholder="Invitation to tender: …" style={field} />
          </label>
          <label style="display: flex; flex-direction: column; gap: 7px; grid-column: 1 / -1;">
            <span style={label}>Email text</span>
            <textarea class="field" bind:value={pasteText} rows="8" placeholder="Paste the body of the email here" style="{field} height: auto; padding: 10px 11px; line-height: 1.5; resize: vertical; font-family: inherit;"></textarea>
          </label>
        </div>
        <div style="padding: 12px 18px; border-top: 1px solid var(--line); background: #fafbfa; display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn-ghost" style={btnGhost} on:click={() => (pasting = false)}>Cancel</button>
          <button type="button" class="btn-dark" style="{btnDark}{pasteBusy ? ' opacity: 0.6; cursor: wait;' : ''}" disabled={pasteBusy || !pasteText.trim()} on:click={submitPaste}>
            {pasteBusy ? 'Reading with AI…' : 'Read with AI'}
          </button>
        </div>
      </div>
    {/if}

    <div style="display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.25fr); gap: 18px; align-items: start;">
      <div style={panel}>
        {#if loadingInbox && !items.length}
          <div style="padding: 18px; font-size: 13px; color: var(--muted);">Loading…</div>
        {:else if !items.length}
          <div style="padding: 22px 18px; font-size: 13px; color: var(--muted); line-height: 1.6;">
            {filter === 'all' ? 'No emails read yet. Check the mailbox, or paste an email to try it.' : 'Nothing here.'}
          </div>
        {/if}
        {#each items as item (item.id)}
          <button
            type="button"
            on:click={() => pick(item)}
            style="width: 100%; text-align: left; border: none; border-bottom: 1px solid var(--hair); background: {item.id === selectedId ? '#f4f8f7' : '#fff'}; border-left: 2px solid {item.id === selectedId ? 'var(--accent)' : 'transparent'}; padding: 12px 16px; cursor: pointer; display: flex; flex-direction: column; gap: 4px;"
          >
            <span style="display: flex; justify-content: space-between; gap: 10px; align-items: baseline;">
              <span style="font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink);">{item.subject}</span>
              <span style="{mono} font-size: 11px; color: var(--faint); flex: none;">{relative(item.receivedAt)}</span>
            </span>
            <span style="display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--muted);">
              <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{item.fromName ?? item.from}</span>
              <span style="{mono} font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; color: {STATUS[item.status].color}; flex: none;">
                {STATUS[item.status].text}{item.ai && item.ai.isBid ? ' · ' + pct(item.ai.confidence) : ''}
              </span>
            </span>
          </button>
        {/each}
      </div>

      {#if selected}
        <div style={panel}>
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--line);">
            <div style="display: flex; justify-content: space-between; gap: 12px; align-items: flex-start;">
              <div style="min-width: 0;">
                <div style="font-size: 15px; font-weight: 600; line-height: 1.35;">{selected.subject}</div>
                <div style="{mono} font-size: 11.5px; color: var(--muted); margin-top: 5px;">
                  {selected.fromName ? selected.fromName + ' · ' : ''}{selected.from} · {new Date(selected.receivedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{selected.source === 'manual' ? ' · pasted' : ''}
                </div>
              </div>
              <span style="{mono} font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: {STATUS[selected.status].color}; border: 1px solid var(--line); padding: 3px 8px; border-radius: 2px; flex: none;">{STATUS[selected.status].text}</span>
            </div>
            {#if selected.ai}
              <div style="margin-top: 12px; padding: 10px 12px; background: #fafbfa; border: 1px solid var(--hair); border-radius: 3px; font-size: 12.5px; line-height: 1.55; color: #4a5250;">
                <span style="{mono} font-size: 11px; color: var(--faint);">{providerName(selected.ai.provider)} · {selected.ai.model} · {pct(selected.ai.confidence)} sure it's {selected.ai.isBid ? 'a bid' : 'not a bid'} ·</span>
                {selected.ai.reason}
              </div>
            {:else if selected.error}
              <div style="margin-top: 12px; padding: 10px 12px; background: #fdf5f5; border: 1px solid #e6c4c4; border-radius: 3px; font-size: 12.5px; color: #932f2f;">{selected.error}</div>
            {/if}
          </div>

          {#if selected.status === 'bid_created'}
            <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 10px;">
              <div style="font-size: 13px;">A bid was created from this email{selected.ai?.title ? ': ' + selected.ai.title : ''}.</div>
              {#if selected.bidId}
                <div><button type="button" class="btn-dark" style={btnDark} on:click={() => selected && selected.bidId && dispatch('openBid', selected.bidId)}>Open the bid</button></div>
              {/if}
            </div>
          {:else if selected.status !== 'ignored'}
            <div style="padding: 16px 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px;">
              <label style="display: flex; flex-direction: column; gap: 6px; grid-column: 1 / -1;">
                <span style={label}>Bid title</span>
                <input class="field" bind:value={draft.title} style={field} />
              </label>
              <label style="display: flex; flex-direction: column; gap: 6px;">
                <span style={label}>Client</span>
                <input class="field" bind:value={draft.client} style={field} />
              </label>
              <label style="display: flex; flex-direction: column; gap: 6px;">
                <span style={label}>Reference</span>
                <input class="field" bind:value={draft.reference} placeholder="auto" style="{field} {mono} font-size: 12.5px;" />
              </label>
              <label style="display: flex; flex-direction: column; gap: 6px;">
                <span style={label}>Value{selected.ai?.currency ? ' (' + selected.ai.currency + ')' : ''}</span>
                <input class="field" bind:value={draft.value} inputmode="numeric" placeholder="unknown" style="{field} {mono} font-size: 12.5px;" />
              </label>
              <label style="display: flex; flex-direction: column; gap: 6px;">
                <span style={label}>Due date</span>
                <input class="field" type="date" bind:value={draft.dueDate} style="{field} {mono} font-size: 12.5px;" />
              </label>
              <label style="display: flex; flex-direction: column; gap: 6px; grid-column: 1 / -1;">
                <span style={label}>Sector</span>
                <input class="field" bind:value={draft.sector} style={field} />
              </label>
            </div>
            <div style="padding: 12px 18px; border-top: 1px solid var(--line); background: #fafbfa; display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="btn-ghost" style={btnGhost} disabled={busyItem} on:click={reprocess}>Read again</button>
              <button type="button" class="btn-ghost" style={btnGhost} disabled={busyItem} on:click={dismiss}>Dismiss</button>
              <button type="button" class="btn-dark" style="{btnDark}{busyItem ? ' opacity: 0.6; cursor: wait;' : ''}" disabled={busyItem || !draft.title.trim()} on:click={createBid}>Create bid</button>
            </div>
          {/if}

          {#if selected.ai && (selected.ai.summary || selected.ai.requirements.length || selected.ai.contactName || selected.ai.value)}
            <div style="padding: 14px 18px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; font-size: 13px;">
              {#if selected.ai.summary}<div style="line-height: 1.6; color: #4a5250;">{selected.ai.summary}</div>{/if}
              <div style="{mono} font-size: 11.5px; color: var(--muted); display: flex; gap: 16px; flex-wrap: wrap;">
                {#if selected.ai.value}<span>value {selected.ai.currency && selected.ai.currency !== 'GBP' ? selected.ai.currency + ' ' + selected.ai.value.toLocaleString('en-GB') : money(selected.ai.value)}</span>{/if}
                {#if selected.ai.dueDate}<span>due {selected.ai.dueDate}</span>{/if}
                {#if selected.ai.contactName || selected.ai.contactEmail}<span>contact {selected.ai.contactName ?? ''} {selected.ai.contactEmail ?? ''}</span>{/if}
              </div>
              {#if selected.ai.requirements.length}
                <div>
                  <div style="{label} margin-bottom: 6px;">Becomes the bid's task list</div>
                  {#each selected.ai.requirements as r}
                    <div style="display: flex; gap: 8px; font-size: 12.5px; line-height: 1.55;"><span style="color: var(--accent);">·</span><span>{r}</span></div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          {#if selected.attachments.length}
            <div style="padding: 12px 18px; border-top: 1px solid var(--line); display: flex; gap: 8px; flex-wrap: wrap;">
              {#each selected.attachments as a}
                <span style="{mono} font-size: 11px; border: 1px solid var(--line); border-radius: 2px; padding: 3px 8px; color: #4a5250;">
                  {a.filename} · {kb(a.size)}{a.sentToAi ? ' · read by AI' : ''}
                </span>
              {/each}
            </div>
          {/if}

          <div style="padding: 12px 18px; border-top: 1px solid var(--line);">
            <button type="button" class="link-btn" on:click={() => (showText = !showText)} style="{mono} background: none; border: none; padding: 0; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); cursor: pointer;">
              {showText ? 'Hide email' : 'Show email'}
            </button>
            {#if showText}
              <pre style="margin: 10px 0 0; white-space: pre-wrap; font-family: inherit; font-size: 12.5px; line-height: 1.6; color: #4a5250; max-height: 360px; overflow: auto;">{selected.text || '(no text)'}</pre>
            {/if}
          </div>
        </div>
      {:else}
        <div style="{panel} padding: 22px 18px; font-size: 13px; color: var(--muted);">Select an email to see what the AI found.</div>
      {/if}
    </div>
  {:else}
    <!-- ---------------- Settings ---------------- -->
    <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 330px); gap: 20px; align-items: start;">
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <div style={panel}>
          <div style={panelHead}>
            <span>AI provider</span>
            <span style="{mono} font-size: 11px; font-weight: 400; color: var(--faint);">reads each email and extracts the bid</span>
          </div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; gap: 8px;">
              {#each [['openai', 'OpenAI'], ['gemini', 'Google Gemini']] as [id, text] (id)}
                <button
                  type="button"
                  on:click={() => (provider = id === 'gemini' ? 'gemini' : 'openai')}
                  style="flex: 1; text-align: left; padding: 11px 13px; border: 1px solid {provider === id ? 'var(--accent)' : 'var(--line)'}; background: {provider === id ? '#f4f8f7' : '#fff'}; border-radius: 3px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;"
                >
                  <span style="font-size: 13.5px; font-weight: 500;">{text}</span>
                  <span style="{mono} font-size: 10.5px; color: var(--faint);">
                    {#if id === 'openai'}{settings?.openai.hasKey ? 'key saved' : 'no key'}{:else}{settings?.gemini.hasKey ? 'key saved' : 'no key'}{/if}
                  </span>
                </button>
              {/each}
            </div>

            {#if provider === 'openai'}
              <div style="display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 12px;">
                <label style="display: flex; flex-direction: column; gap: 6px;">
                  <span style={label}>OpenAI API key</span>
                  <input class="field" type="password" autocomplete="off" bind:value={openaiKey} placeholder={settings?.openai.hasKey ? 'Saved — ' + settings.openai.keyHint + ' (type to replace)' : 'sk-…'} style="{field} {mono} font-size: 12.5px;" />
                  {#if fieldErrors['openai.apiKey']}<span style={errText}>{fieldErrors['openai.apiKey']}</span>{/if}
                </label>
                <label style="display: flex; flex-direction: column; gap: 6px;">
                  <span style={label}>Model</span>
                  <input class="field" list="openai-models" bind:value={openaiModel} style="{field} {mono} font-size: 12.5px;" />
                  <datalist id="openai-models">{#each settings?.openai.suggestions ?? [] as m}<option value={m}></option>{/each}</datalist>
                </label>
              </div>
              <p style={hint}>Create a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style="color: var(--accent);">platform.openai.com/api-keys</a>. Usage is billed to your OpenAI account.</p>
            {:else}
              <div style="display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 12px;">
                <label style="display: flex; flex-direction: column; gap: 6px;">
                  <span style={label}>Gemini API key</span>
                  <input class="field" type="password" autocomplete="off" bind:value={geminiKey} placeholder={settings?.gemini.hasKey ? 'Saved — ' + settings.gemini.keyHint + ' (type to replace)' : 'AIza…'} style="{field} {mono} font-size: 12.5px;" />
                  {#if fieldErrors['gemini.apiKey']}<span style={errText}>{fieldErrors['gemini.apiKey']}</span>{/if}
                </label>
                <label style="display: flex; flex-direction: column; gap: 6px;">
                  <span style={label}>Model</span>
                  <input class="field" list="gemini-models" bind:value={geminiModel} style="{field} {mono} font-size: 12.5px;" />
                  <datalist id="gemini-models">{#each settings?.gemini.suggestions ?? [] as m}<option value={m}></option>{/each}</datalist>
                </label>
              </div>
              <p style={hint}>Create a key in <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style="color: var(--accent);">Google AI Studio</a>. Usage is billed to your Google Cloud project.</p>
            {/if}

            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="btn-ghost" style={btnGhost} disabled={testing !== ''} on:click={() => testAi(provider)}>{testing === provider ? 'Testing…' : 'Test ' + providerName(provider)}</button>
              {#if (provider === 'openai' && settings?.openai.hasKey) || (provider === 'gemini' && settings?.gemini.hasKey)}
                <button type="button" class="btn-ghost" style="{btnGhost} color: #932f2f; border-color: #e6c4c4;" disabled={saving} on:click={() => removeKey(provider)}>Remove saved key</button>
              {/if}
            </div>
          </div>
        </div>

        <div style={panel}>
          <div style={panelHead}>
            <span>Gmail mailbox</span>
            <span style="{mono} font-size: 11px; font-weight: 400; color: var(--faint);">read-only · nothing is marked as read</span>
          </div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <label style="display: flex; flex-direction: column; gap: 6px;">
                <span style={label}>Gmail address</span>
                <input class="field" type="email" bind:value={mailUser} placeholder="bids@yourcompany.com" style="{field} {mono} font-size: 12.5px;" />
                {#if fieldErrors['mailbox.user']}<span style={errText}>{fieldErrors['mailbox.user']}</span>{/if}
              </label>
              <label style="display: flex; flex-direction: column; gap: 6px;">
                <span style={label}>App password</span>
                <input class="field" type="password" autocomplete="off" bind:value={mailPassword} placeholder={settings?.mailbox.hasPassword ? 'Saved (type to replace)' : 'abcd efgh ijkl mnop'} style="{field} {mono} font-size: 12.5px;" />
              </label>
              <label style="display: flex; flex-direction: column; gap: 6px;">
                <span style={label}>Folder or label</span>
                <input class="field" bind:value={mailFolder} placeholder="INBOX" style="{field} {mono} font-size: 12.5px;" />
              </label>
              <div style="display: flex; align-items: flex-end;">
                <button type="button" class="link-btn" on:click={() => (showAdvanced = !showAdvanced)} style="{mono} background: none; border: none; padding: 0 0 10px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); cursor: pointer;">{showAdvanced ? 'Hide server settings' : 'Server settings'}</button>
              </div>
              {#if showAdvanced}
                <label style="display: flex; flex-direction: column; gap: 6px;">
                  <span style={label}>IMAP host</span>
                  <input class="field" bind:value={mailHost} style="{field} {mono} font-size: 12.5px;" />
                </label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                  <label style="display: flex; flex-direction: column; gap: 6px;">
                    <span style={label}>Port</span>
                    <input class="field" type="number" bind:value={mailPort} style="{field} {mono} font-size: 12.5px;" />
                  </label>
                  <label style="display: flex; align-items: center; gap: 7px; padding-top: 20px; font-size: 12.5px;">
                    <input type="checkbox" bind:checked={mailSecure} style="accent-color: var(--accent);" /> SSL/TLS
                  </label>
                </div>
              {/if}
            </div>
            <div style="font-size: 12px; color: var(--muted); line-height: 1.6; background: #fafbfa; border: 1px solid var(--hair); border-radius: 3px; padding: 10px 12px;">
              Gmail needs an <strong style="font-weight: 600;">app password</strong>, not your normal password:
              turn on 2-Step Verification, then create one at
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style="color: var(--accent);">myaccount.google.com/apppasswords</a>.
              Make sure IMAP is on in Gmail → Settings → Forwarding and POP/IMAP. Tip: point it at a label (e.g. <span style={mono}>Tenders</span>) with a Gmail filter.
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn-ghost" style={btnGhost} disabled={testing !== ''} on:click={testMailbox}>{testing === 'mailbox' ? 'Connecting…' : 'Test connection'}</button>
            </div>
            {#if settings?.mailbox.lastError}
              <div style="font-size: 12.5px; color: #932f2f; background: #fdf5f5; border: 1px solid #e6c4c4; border-radius: 3px; padding: 9px 12px;">Last check failed: {settings.mailbox.lastError}</div>
            {/if}
          </div>
        </div>

        <div style={panel}>
          <div style={panelHead}>Rules</div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 16px;">
            <label style="display: flex; flex-direction: column; gap: 8px;">
              <span style="display: flex; justify-content: space-between; font-size: 13px;">
                <span>Create bids automatically when the AI is at least</span>
                <span style="{mono} font-weight: 600;">{threshold}% sure</span>
              </span>
              <input type="range" min="50" max="100" step="5" bind:value={threshold} style="accent-color: var(--accent);" />
              <span style={hint}>Below that, detected bids wait in the inbox under “To review”. Set 100% to always review.</span>
            </label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <label style="display: flex; flex-direction: column; gap: 6px;">
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
            <button type="button" class="btn-ghost" style={btnGhost} disabled={saving} on:click={() => settings && applySettings(settings)}>Discard</button>
            <button type="button" class="btn-dark" style="{btnDark}{saving ? ' opacity: 0.6; cursor: wait;' : ''}" disabled={saving} on:click={() => save()}>{saving ? 'Saving…' : 'Save settings'}</button>
          </div>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 20px;">
        <div style={panel}>
          <div style={panelHead}>Status</div>
          <div style="padding: 14px 18px; display: flex; flex-direction: column; gap: 11px; font-size: 13px;">
            <div><span style={dot(!!settings?.ready.ai)}></span>{settings?.ready.ai ? providerName(settings.provider) + ' key saved' : 'No API key for ' + providerName(provider)}</div>
            <div><span style={dot(!!settings?.ready.mailbox)}></span>{settings?.ready.mailbox ? 'Mailbox ' + settings.mailbox.user : 'Mailbox not connected'}</div>
            <div><span style={dot(!!settings?.ready.polling)}></span>{settings?.ready.polling ? 'Checking every ' + settings.pollMinutes + ' min · last ' + when(settings.mailbox.lastCheckedAt) : 'Automatic checking is off'}</div>
          </div>
          <div style="padding: 12px 18px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <span style="font-size: 13px;">Automatic checking</span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Automatic checking"
              disabled={saving}
              on:click={toggleEnabled}
              style="flex: none; width: 38px; height: 21px; padding: 2px; border-radius: 11px; border: 1px solid {enabled ? 'var(--accent)' : 'var(--line)'}; background: {enabled ? 'var(--accent)' : '#fff'}; cursor: pointer; display: flex; justify-content: {enabled ? 'flex-end' : 'flex-start'};"
            >
              <span style="width: 15px; height: 15px; border-radius: 50%; background: {enabled ? '#fff' : '#c3c8c9'};"></span>
            </button>
          </div>
        </div>

        <div style={panel}>
          <div style={panelHead}>How it works</div>
          <div style="padding: 14px 18px; font-size: 12.5px; color: var(--muted); line-height: 1.65; display: flex; flex-direction: column; gap: 8px;">
            <span>1. New emails in the folder are read every few minutes (the first check looks back 7 days).</span>
            <span>2. {providerName(provider)} decides whether each one is a bid opportunity and extracts client, value, deadline, contact and requirements.</span>
            <span>3. Confident ones become bids in <strong style="font-weight: 600;">Qualifying</strong>, with the requirements as tasks. The rest wait here for you.</span>
            <span>Keys and the app password are encrypted and never shown again after saving.</span>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
