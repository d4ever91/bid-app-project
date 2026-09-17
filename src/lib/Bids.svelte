<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label, panel, panelHead, field, h1, sub } from '../ui';
  import { BID_STAGES, STAGE_COLOR, money, dueLabel, dueColor } from '../bids';
  import type { Bid, BidStageFilter } from '../types';

  export let bids: Bid[] = [];
  export let stage: BidStageFilter = 'All';
  export let query = '';
  /** Server paging. Null in demo mode, where the fixture list pages locally. */
  export let paging: { page: number; limit: number; total: number; pages: number } | null = null;
  export let loading = false;
  /** Facet options from the server, so dropdowns aren't limited to the current page. */
  export let owners: string[] = [];
  export let sectors: string[] = [];

  const dispatch = createEventDispatcher<{
    open: string;
    stage: BidStageFilter;
    query: string;
    create: void;
    filters: { owner: string; sector: string; due: string; sort: string };
    page: number;
  }>();

  const onQuery = (e: Event): void => dispatch('query', (e.currentTarget as HTMLInputElement).value);
  const onOpen = (id: string): void => dispatch('open', id);

  const GRID = 'grid-template-columns: minmax(240px, 2.2fr) 150px 110px 118px 150px 96px;';
  const CHIPS: BidStageFilter[] = ['All', 'Qualifying', 'Drafting', 'Review', 'Submitted', 'Won', 'Lost'];
  const pickStage = (s: BidStageFilter): void => dispatch('stage', s);

  type DueBucket = 'All' | 'Next 7 days' | 'Next 30 days' | 'Later' | 'Awaiting outcome' | 'Closed';
  type BidSort = 'Due date' | 'Value' | 'Win probability' | 'Client';

  const DUE_BUCKETS: DueBucket[] = ['All', 'Next 7 days', 'Next 30 days', 'Later', 'Awaiting outcome', 'Closed'];
  const SORTS: BidSort[] = ['Due date', 'Value', 'Win probability', 'Client'];

  let filtersOpen = false;
  let owner = 'All';
  let sector = 'All';
  let due: DueBucket = 'All';
  let sort: BidSort = 'Due date';

  const dueBucket = (x: Bid): DueBucket => {
    if (x.stage === 'Won' || x.stage === 'Lost') return 'Closed';
    if (x.daysLeft < 0) return 'Awaiting outcome';
    if (x.daysLeft <= 7) return 'Next 7 days';
    if (x.daysLeft <= 30) return 'Next 30 days';
    return 'Later';
  };

  // Emitted on every filter change; the parent decides whether that means a refetch.
  $: dispatch('filters', { owner, sector, due, sort });

  const clearAll = (): void => {
    owner = 'All';
    sector = 'All';
    due = 'All';
    sort = 'Due date';
    dispatch('stage', 'All');
    dispatch('query', '');
  };

  $: ownerOptions = owners.length ? ['All', ...owners] : ['All', ...new Set(bids.map((x) => x.owner))];
  $: sectorOptions = sectors.length ? ['All', ...sectors] : ['All', ...new Set(bids.map((x) => x.sector))];
  $: activeCount =
    [owner, sector, due].filter((v) => v !== 'All').length +
    (stage === 'All' ? 0 : 1) +
    (query.trim() ? 1 : 0);

  const isOpen = (b: Bid): boolean => b.stage !== 'Won' && b.stage !== 'Lost';

  $: filtered = paging ? bids : bids
    .filter((b) => {
      const q = query.trim().toLowerCase();
      const okStage = stage === 'All' || b.stage === stage;
      const okOwner = owner === 'All' || b.owner === owner;
      const okSector = sector === 'All' || b.sector === sector;
      const okDue = due === 'All' || dueBucket(b) === due;
      const okQuery = !q || (b.title + ' ' + b.client + ' ' + b.owner + ' ' + b.id).toLowerCase().includes(q);
      return okStage && okOwner && okSector && okDue && okQuery;
    })
    .slice()
    .sort((a, b2) => {
      if (sort === 'Value') return b2.value - a.value;
      if (sort === 'Win probability') return b2.probability - a.probability;
      if (sort === 'Client') return a.client.localeCompare(b2.client);
      return a.daysLeft - b2.daysLeft;
    });

  $: openBids = bids.filter(isOpen);
  $: pipeline = openBids.reduce((sum, b) => sum + b.value, 0);
  $: weighted = openBids.reduce((sum, b) => sum + (b.value * b.probability) / 100, 0);
  $: decided = bids.filter((b) => b.stage === 'Won' || b.stage === 'Lost');
  $: winRate = decided.length ? Math.round((bids.filter((b) => b.stage === 'Won').length / decided.length) * 100) : 0;
  $: urgent = openBids.filter((b) => b.daysLeft >= 0 && b.daysLeft <= 7);

  $: byStage = BID_STAGES.map((s) => ({
    name: s,
    count: bids.filter((b) => b.stage === s).length,
    value: bids.filter((b) => b.stage === s).reduce((sum, b) => sum + b.value, 0)
  }));
  $: maxStageValue = Math.max(...byStage.map((s) => s.value), 1);
</script>

<div>
  <div style="display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; gap: 20px; flex-wrap: wrap;">
    <div>
      <h1 style={h1}>Bid management</h1>
      <p style={sub}>{openBids.length} live bids · {money(pipeline)} unweighted pipeline</p>
    </div>
    <div style="display: flex; gap: 8px;">
      <input
        class="field"
        type="text"
        placeholder="Search bid, reference, client…"
        value={query}
        on:input={onQuery}
        style="{field} width: 258px; height: 32px; background: #fff;"
      />
      <button type="button" class="btn-dark" on:click={() => dispatch('create')} style="height: 32px; padding: 0 13px; background: var(--ink); color: #fff; border: none; border-radius: 3px; font-size: 12.5px; font-weight: 500; cursor: pointer; white-space: nowrap;">New bid</button>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 3px; margin-bottom: 20px;">
    <div style="background: #fff; padding: 16px 18px;">
      <div style="{label} margin-bottom: 10px;">Live pipeline</div>
      <div style="font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1;">{money(pipeline)}</div>
      <div style="{mono} font-size: 11.5px; color: var(--muted); margin-top: 8px;">across {openBids.length} bids</div>
    </div>
    <div style="background: #fff; padding: 16px 18px;">
      <div style="{label} margin-bottom: 10px;">Weighted value</div>
      <div style="font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1;">{money(weighted)}</div>
      <div style="{mono} font-size: 11.5px; color: var(--accent); margin-top: 8px;">by win probability</div>
    </div>
    <div style="background: #fff; padding: 16px 18px;">
      <div style="{label} margin-bottom: 10px;">Win rate</div>
      <div style="font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1;">{winRate}<span style="font-size: 18px; color: var(--muted);">%</span></div>
      <div style="{mono} font-size: 11.5px; color: var(--muted); margin-top: 8px;">last {decided.length} decisions</div>
    </div>
    <div style="background: #fff; padding: 16px 18px;">
      <div style="{label} margin-bottom: 10px;">Due within 7 days</div>
      <div style="font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1;">{urgent.length}</div>
      <div style="{mono} font-size: 11.5px; color: {urgent.length ? '#b23a3a' : 'var(--muted)'}; margin-top: 8px;">
        {urgent.length ? urgent[0].id + ' closest' : 'nothing imminent'}
      </div>
    </div>
  </div>

  <div style="{panel} margin-bottom: 20px;">
    <div style={panelHead}>
      <span>Pipeline by stage</span>
      <span style="{mono} font-size: 11px; font-weight: 400; color: var(--faint);">value, incl. closed</span>
    </div>
    <div style="padding: 16px 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 18px;">
      {#each byStage as s (s.name)}
        <div style="display: flex; flex-direction: column; gap: 7px;">
          <div style="display: flex; align-items: center; gap: 7px;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: {STAGE_COLOR[s.name]};"></span>
            <span style="{mono} font-size: 11.5px;">{s.name}</span>
            <span style="{mono} font-size: 11.5px; color: var(--faint); margin-left: auto;">{s.count}</span>
          </div>
          <div style="height: 5px; background: var(--hair); border-radius: 2px; overflow: hidden;">
            <div style="height: 100%; width: {Math.round((s.value / maxStageValue) * 100)}%; background: {STAGE_COLOR[s.name]};"></div>
          </div>
          <span style="{mono} font-size: 11px; color: var(--muted);">{s.value ? money(s.value) : '—'}</span>
        </div>
      {/each}
    </div>
  </div>

  <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;">
    {#each CHIPS as s (s)}
      <button
        type="button"
        on:click={() => pickStage(s)}
        style="{mono} font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; padding: 5px 10px; border-radius: 2px; cursor: pointer; border: 1px solid {stage === s ? 'var(--ink)' : 'var(--line)'}; background: {stage === s ? 'var(--ink)' : '#fff'}; color: {stage === s ? '#fff' : 'var(--muted)'};"
      >{s}</button>
    {/each}

    <button
      type="button"
      on:click={() => (filtersOpen = !filtersOpen)}
      style="{mono} margin-left: auto; height: 28px; padding: 0 11px; background: #fff; border: 1px solid {filtersOpen || activeCount ? 'var(--ink)' : 'var(--line)'}; border-radius: 3px; font-size: 11px; letter-spacing: 0.04em; color: {filtersOpen || activeCount ? 'var(--ink)' : 'var(--muted)'}; cursor: pointer; white-space: nowrap;"
    >Advanced filters{activeCount ? ' · ' + activeCount : ''}</button>

    {#if activeCount}
      <button
        type="button"
        title="Remove all filters"
        class="clear-btn"
        on:click={clearAll}
        style="width: 28px; height: 28px; flex: none; background: #fff; border: 1px solid var(--line); border-radius: 3px; color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center;"
      ><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
        <path d="M1.5 2h11L8.4 7v4.6L5.6 12.8V7L1.5 2Z" />
        <path d="M9.6 9.6l3.4 3.4M13 9.6l-3.4 3.4" />
      </svg></button>
    {/if}
  </div>

  {#if filtersOpen}
    <div style="{panel} padding: 14px 18px; margin-bottom: 12px; display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap;">
      <label style="display: flex; flex-direction: column; gap: 6px; min-width: 168px; flex: 1;">
        <span style={label}>Bid owner</span>
        <select class="field" bind:value={owner} style="{field} height: 32px; padding: 0 8px; cursor: pointer;">
          {#each ownerOptions as o (o)}<option value={o}>{o === 'All' ? 'Any owner' : o}</option>{/each}
        </select>
      </label>
      <label style="display: flex; flex-direction: column; gap: 6px; min-width: 168px; flex: 1;">
        <span style={label}>Sector</span>
        <select class="field" bind:value={sector} style="{field} height: 32px; padding: 0 8px; cursor: pointer;">
          {#each sectorOptions as s (s)}<option value={s}>{s === 'All' ? 'Any sector' : s}</option>{/each}
        </select>
      </label>
      <label style="display: flex; flex-direction: column; gap: 6px; min-width: 168px; flex: 1;">
        <span style={label}>Deadline</span>
        <select class="field" bind:value={due} style="{field} height: 32px; padding: 0 8px; cursor: pointer;">
          {#each DUE_BUCKETS as d (d)}<option value={d}>{d === 'All' ? 'Any deadline' : d}</option>{/each}
        </select>
      </label>
      <label style="display: flex; flex-direction: column; gap: 6px; min-width: 168px; flex: 1;">
        <span style={label}>Sort by</span>
        <select class="field" bind:value={sort} style="{field} height: 32px; padding: 0 8px; cursor: pointer;">
          {#each SORTS as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </label>

      {#if activeCount}
        <button
          type="button"
          title="Remove all filters"
          class="clear-btn"
          on:click={clearAll}
          style="{mono} height: 32px; padding: 0 11px; background: none; border: 1px solid var(--line); border-radius: 3px; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); cursor: pointer; display: flex; align-items: center; gap: 7px;"
        ><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
        <path d="M1.5 2h11L8.4 7v4.6L5.6 12.8V7L1.5 2Z" />
        <path d="M9.6 9.6l3.4 3.4M13 9.6l-3.4 3.4" />
      </svg> Clear all</button>
      {/if}
    </div>
  {/if}

  <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin-bottom: 8px;">
    <span style="{mono} font-size: 11px; color: var(--faint); letter-spacing: 0.04em;">
      {#if paging}
        showing {filtered.length} of {paging.total} bids
      {:else}
        {filtered.length === bids.length ? 'showing all ' + bids.length + ' bids' : 'showing ' + filtered.length + ' of ' + bids.length + ' bids'}
      {/if}
    </span>
    <span style="{mono} font-size: 11px; color: var(--faint); letter-spacing: 0.04em;">
      {loading ? 'loading…' : 'sorted by ' + sort.toLowerCase()}
    </span>
  </div>

  <div style="{panel} overflow-x: auto;">
    <div style="{label} min-width: 926px; display: grid; {GRID} gap: 12px; padding: 9px 18px; background: #fafbfa; border-bottom: 1px solid var(--line);">
      <span>Bid</span><span>Stage</span><span>Value</span><span>Win prob.</span><span>Owner</span>
      <span style="text-align: right;">Due</span>
    </div>

    {#each filtered as b (b.id)}
      <div
        class="row"
        role="button"
        tabindex="0"
        on:click={() => onOpen(b.id)}
        on:keydown={(e) => e.key === 'Enter' && onOpen(b.id)}
        style="min-width: 926px; display: grid; {GRID} gap: 12px; padding: 11px 18px; border-bottom: 1px solid var(--hair); align-items: center; font-size: 13px; cursor: pointer;"
      >
        <div style="min-width: 0;">
          <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{b.title}</div>
          <div style="{mono} font-size: 11.5px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{b.id} · {b.client}</div>
        </div>
        <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #4a5250;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: {STAGE_COLOR[b.stage]};"></span>
          {b.stage}
        </span>
        <span style="{mono} font-size: 12px;">{money(b.value)}</span>
        <span style="display: flex; align-items: center; gap: 8px;">
          <span style="flex: 1; height: 4px; background: var(--hair); border-radius: 2px; overflow: hidden; min-width: 34px;">
            <span style="display: block; height: 100%; width: {b.probability}%; background: var(--accent);"></span>
          </span>
          <span style="{mono} font-size: 11.5px; color: var(--muted);">{b.probability}%</span>
        </span>
        <span style="color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{b.owner}</span>
        <span style="{mono} text-align: right; font-size: 11.5px; color: {dueColor(b)};">{dueLabel(b)}</span>
      </div>
    {/each}

    {#if filtered.length === 0}
      <div style="padding: 22px 18px; font-size: 13px; color: var(--muted);">
        {loading ? 'Loading bids…' : 'No bids match that filter.'}
      </div>
    {/if}

    {#if paging && paging.total > 0}
      <div style="{mono} min-width: 926px; padding: 11px 18px; display: flex; align-items: center; justify-content: space-between; gap: 14px; font-size: 11.5px; color: var(--muted); border-top: 1px solid var(--hair);">
        <span>
          {(paging.page - 1) * paging.limit + 1}–{Math.min(paging.page * paging.limit, paging.total)} of {paging.total}
        </span>

        <div style="display: flex; align-items: center; gap: 6px;">
          <button
            type="button"
            disabled={paging.page <= 1 || loading}
            on:click={() => dispatch('page', paging.page - 1)}
            style="border: 1px solid var(--line); background: #fff; padding: 3px 9px; border-radius: 2px; font: inherit; color: {paging.page <= 1 ? 'var(--line)' : 'var(--muted)'}; cursor: {paging.page <= 1 ? 'not-allowed' : 'pointer'};"
          >prev</button>

          <span style="letter-spacing: 0.04em;">page {paging.page} of {paging.pages}</span>

          <button
            type="button"
            disabled={paging.page >= paging.pages || loading}
            on:click={() => dispatch('page', paging.page + 1)}
            style="border: 1px solid var(--line); background: #fff; padding: 3px 9px; border-radius: 2px; font: inherit; color: {paging.page >= paging.pages ? 'var(--line)' : 'var(--muted)'}; cursor: {paging.page >= paging.pages ? 'not-allowed' : 'pointer'};"
          >next</button>
        </div>
      </div>
    {/if}
  </div>
</div>
