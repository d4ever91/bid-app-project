<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label, panel, panelHead, field, btnDark, btnGhost, h1, sub } from '../ui';
  import Field from './Field.svelte';
  import { runSchema, visible, errorCount, required, minLen, maxLen, unique, integer, range, dateish, pattern, type Schema } from '../validation';
  import { BID_STAGES } from '../bids';
  import type { Bid, BidStage, NewBidDraft } from '../types';

  export let bids: Bid[] = [];

  const dispatch = createEventDispatcher<{ create: NewBidDraft; cancel: void }>();

  const SECTORS: string[] = ['Healthcare', 'Transport', 'Utilities', 'Financial services', 'Education', 'Public sector'];
  const OPPORTUNITY = [
    { key: 'title', label: 'Bid name *', ph: 'Identity platform consolidation', mono: false },
    { key: 'ref', label: 'Reference number *', ph: 'HRH/2026/IDP-0418', mono: true },
    { key: 'client', label: 'Client name *', ph: 'Halden Regional Health', mono: false },
    { key: 'contactName', label: 'Contact name', ph: 'Meredith Okafor', mono: false },
    { key: 'contact', label: 'Contact details', ph: 'Head of Digital · m.okafor@…', mono: true },
    { key: 'receivedOn', label: 'Received on', ph: '18 Jun 2026', mono: false }
  ] as const;
  const COMMERCIALS = [
    { key: 'value', label: 'Contract value (£)', ph: '1840000', mono: true },
    { key: 'due', label: 'Submission due', ph: '14 Aug 2026', mono: false },
    { key: 'daysLeft', label: 'Days until due', ph: '30', mono: true },
    { key: 'probability', label: 'Win probability (%)', ph: '25', mono: true },
    { key: 'incumbent', label: 'Incumbent', ph: 'Vessel Systems', mono: false }
  ] as const;

  let draft: NewBidDraft = {
    title: '', ref: '', client: '', sector: 'Healthcare', contactName: '', contact: '',
    receivedOn: '', value: '', stage: 'Qualifying', owner: 'Nadia Beshara',
    due: '', daysLeft: '', probability: '', incumbent: ''
  };

  const val = (key: string): string => String(draft[key as keyof NewBidDraft] ?? '');
  const set = (key: string) => (e: Event) => {
    draft = { ...draft, [key]: (e.currentTarget as HTMLInputElement).value };
  };

  const reset = (): void => {
    draft = {
      title: '', ref: '', client: '', sector: 'Healthcare', contactName: '', contact: '',
      receivedOn: '', value: '', stage: 'Qualifying', owner: 'Nadia Beshara',
      due: '', daysLeft: '', probability: '', incumbent: ''
    };
  };

  let touched: Record<string, boolean> = {};
  let submitted = false;
  const touch = (key: string) => (): void => { touched = { ...touched, [key]: true }; };

  const schema: Schema<NewBidDraft> = {
    title: [required('Give the bid a name'), minLen(4), maxLen(120)],
    ref: [
      required('A reference number is required'),
      pattern(/^[A-Za-z0-9/_.-]+$/, 'Letters, numbers and / - _ . only'),
      unique(() => bids.map((x) => x.ref), 'That reference number is already in use')
    ],
    client: [required('Enter the client name'), maxLen(120)],
    contact: [maxLen(120)],
    receivedOn: [dateish()],
    due: [dateish()],
    value: [integer('Enter the value in whole pounds, digits only')],
    daysLeft: [integer('Whole days only')],
    probability: [integer('Whole numbers only'), range(0, 100, 'Win probability is a percentage, 0–100')]
  };

  $: owners = [...new Set(bids.map((b) => b.owner))];
  $: errors = runSchema(draft, schema);
  $: shown = visible(errors, touched, submitted);
  $: valid = errorCount(errors) === 0;

  const submit = (): void => {
    submitted = true;
    if (valid) dispatch('create', draft);
  };

  const clear = (): void => { reset(); touched = {}; submitted = false; };
</script>

<div style="max-width: 760px;">
  <h1 style={h1}>New bid</h1>
  <p style="{sub} margin-bottom: 20px;">Log an inbound opportunity. A starter checklist is created automatically for the owner.</p>

  <div style={panel}>
    <div style={panelHead}>Opportunity</div>
    <div style="padding: 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
      {#each OPPORTUNITY as f (f.key)}
        <Field
          label={f.label}
          placeholder={f.ph}
          value={val(f.key)}
          monoFont={f.mono}
          error={shown[f.key] ?? null}
          on:input={set(f.key)}
          on:blur={touch(f.key)}
        />
      {/each}
      <label style="display: flex; flex-direction: column; gap: 7px;">
        <span style={label}>Sector</span>
        <select class="field" bind:value={draft.sector} style="{field} padding: 0 9px; cursor: pointer;">
          {#each SECTORS as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </label>
    </div>

    {#if submitted && !valid}
      <div style="margin: 0 18px 14px; padding: 10px 12px; border: 1px solid #e6c4c4; background: #fdf5f5; border-radius: 3px; font-size: 12.5px; color: #932f2f;">
        {errorCount(errors) === 1 ? 'One field needs attention' : errorCount(errors) + ' fields need attention'} before this bid can be created.
      </div>
    {/if}

    <div style="{panelHead} border-top: 1px solid var(--line); background: #fafbfa;">Commercials &amp; ownership</div>
    <div style="padding: 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
      <label style="display: flex; flex-direction: column; gap: 7px;">
        <span style={label}>Stage</span>
        <select class="field" bind:value={draft.stage} style="{field} padding: 0 9px; cursor: pointer;">
          {#each BID_STAGES as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </label>
      <label style="display: flex; flex-direction: column; gap: 7px;">
        <span style={label}>Bid owner</span>
        <select class="field" bind:value={draft.owner} style="{field} padding: 0 9px; cursor: pointer;">
          {#each owners as o (o)}<option value={o}>{o}</option>{/each}
        </select>
      </label>
      {#each COMMERCIALS as f (f.key)}
        <Field
          label={f.label}
          placeholder={f.ph}
          value={val(f.key)}
          monoFont={f.mono}
          error={shown[f.key] ?? null}
          on:input={set(f.key)}
          on:blur={touch(f.key)}
        />
      {/each}
    </div>

    <div style="padding: 14px 18px; border-top: 1px solid var(--line); background: #fafbfa; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
      <span style="{mono} font-size: 11px; color: var(--faint);">* required</span>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="btn-ghost" style={btnGhost} on:click={clear}>Clear</button>
        <button type="button" class="btn-ghost" style={btnGhost} on:click={() => dispatch('cancel')}>Cancel</button>
        <button type="button" class="btn-dark" style="{btnDark} padding: 0 14px;" on:click={submit}>Create bid</button>
      </div>
    </div>
  </div>
</div>
