<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { mono, label, panel, panelHead, field, btnDark, btnGhost, h1, sub } from '../ui';
  import { relative } from '../adapters';
  import { money } from '../bids';
  import {
    ApiError, createBidFromEmail, fetchAutomationSettings, fetchInbox, getAccessToken, ignoreEmail, ingestEmail, reprocessEmail,
    runAutomation,
    type AiProvider, type AutomationSettings, type MailItem, type MailStatus
  } from '../api';

  const dispatch = createEventDispatcher<{ notify: string; openBid: string; changed: void; counts: number; settings: 'integrations' | 'automation' }>();

  const live = (): boolean => !!getAccessToken();
  const fail = (err: unknown, fallback: string): void => {
    dispatch('notify', err instanceof ApiError ? err.message : fallback);
  };

  /* ---------------- settings (read-only here; edited under Settings → Bid automation) ---------------- */

  let settings: AutomationSettings | null = null;
  /** Engineers can use the inbox but only Owners/Admins manage settings. */
  let canManage = true;

  async function loadSettings(): Promise<void> {
    try {
      settings = await fetchAutomationSettings();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) canManage = false;
    }
  }

  const openSettings = (tab: 'integrations' | 'automation'): void => {
    dispatch('settings', tab);
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
  });

  const pct = (n: number): string => Math.round(n * 100) + '%';
  const when = (iso: string | null): string => (iso ? relative(iso) : 'never');
  const kb = (n: number): string => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const providerName = (p: AiProvider): string => (p === 'openai' ? 'OpenAI' : 'Gemini');
  const chip = (on: boolean): string =>
    `${mono} padding: 6px 11px; border: 1px solid ${on ? 'var(--ink)' : 'var(--line)'}; background: ${on ? 'var(--ink)' : '#fff'}; color: ${on ? '#fff' : 'var(--muted)'}; border-radius: 3px; font-size: 11px; letter-spacing: 0.04em; cursor: pointer;`;
</script>

<div>
  <div style="display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; gap: 16px; flex-wrap: wrap;">
    <div>
      <h1 style={h1}>Bid inbox</h1>
      <p style={sub}>
        {#if !live()}
          Sign in to connect a mailbox — demo mode has no inbox.
        {:else if settings?.ready.polling}
          Watching {settings.mailbox.user} · read by {providerName(settings.provider)} · last checked {when(settings.mailbox.lastCheckedAt)}
        {:else}
          Emails are read by AI and turned into bids. Set it up under Settings → Bid automation.
        {/if}
      </p>
    </div>
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      {#if canManage}
        <button type="button" class="btn-ghost" style={btnGhost} disabled={!live()} on:click={() => openSettings('automation')}>Automation settings</button>
      {/if}
    </div>
  </div>

  {#if live() && canManage && settings && !settings.ready.ai}
    <div style="{panel} border-color: #e6d4b3; background: #fdf9f1; padding: 13px 18px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
      <span style="font-size: 13px; color: #8a5a10;">Add an OpenAI or Gemini API key and connect Gmail in Settings to start turning emails into bids.</span>
      <button type="button" class="btn-dark" style={btnDark} on:click={() => openSettings('integrations')}>Open settings</button>
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
</div>
