<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchBidSummary, getAccessToken, type BidSummary } from '../api';
  import { mono, label, panel, panelHead, h1, sub } from '../ui';
  import { CHART, EVENTS, ROLES } from '../data';
  import type { Role, User } from '../types';

  export let users: User[] = [];

  /** Server pipeline figures, when a session exists — otherwise the fixtures stand. */
  let summary: BidSummary | null = null;
  onMount(async () => {
    if (!getAccessToken()) return;
    summary = await fetchBidSummary().catch(() => null);
  });

  interface Tile {
    label: string;
    value: string;
    note: string;
    color: string;
  }

  const TILES: Tile[] = [
    { label: 'Total users', value: '248', note: '+12 this month', color: 'var(--accent)' },
    { label: 'Active (7d)', value: '191', note: '77% of seats', color: 'var(--muted)' },
    { label: 'Pending invites', value: '7', note: '3 expiring in 48h', color: '#b45309' },
    { label: 'MFA coverage', value: '94%', note: '14 accounts unenrolled', color: '#b23a3a' }
  ];

  const RANGES: string[] = ['24h', '30d', '90d'];
  const peak = Math.max(...CHART);

  $: counts = ROLES.map((r: Role) => ({ name: r, count: users.filter((u) => u.role === r).length }));
  $: maxCount = Math.max(...counts.map((c) => c.count), 1);
</script>

<div>
  <div style="display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; gap: 20px; flex-wrap: wrap;">
    <div>
      <h1 style={h1}>Overview</h1>
      <p style={sub}>Workspace health and access posture · last 30 days</p>
    </div>
    <div style="{mono} font-size: 11px; color: var(--muted); display: flex; gap: 1px; border: 1px solid var(--line); border-radius: 3px; overflow: hidden;">
      {#each RANGES as t}
        <span style="padding: 6px 10px; background: {t === '30d' ? 'var(--ink)' : '#fff'}; color: {t === '30d' ? '#fff' : 'inherit'};">{t}</span>
      {/each}
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 3px; margin-bottom: 20px;">
    {#each TILES as t}
      <div style="background: #fff; padding: 16px 18px;">
        <div style="{label} margin-bottom: 10px;">{t.label}</div>
        <div style="font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1;">{t.value}</div>
        <div style="{mono} font-size: 11.5px; color: {t.color}; margin-top: 8px;">{t.note}</div>
      </div>
    {/each}
  </div>

  <div style="display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 20px; align-items: start;">
    <div style={panel}>
      <div style={panelHead}>
        <span>Sign-ins per day</span>
        <span style="{mono} font-size: 11px; font-weight: 400; color: var(--muted);">peak {peak}</span>
      </div>
      <div style="padding: 22px 18px 14px; display: flex; align-items: flex-end; gap: 4px; height: 172px;">
        {#each CHART as v, i}
          <div class="bar" title="day {i + 1}: {v}" style="flex: 1; background: #cfd9d5; height: {Math.round((v / peak) * 100)}%; border-radius: 1px; min-width: 3px;"></div>
        {/each}
      </div>
      <div style="{mono} padding: 0 18px 14px; display: flex; justify-content: space-between; font-size: 10.5px; color: var(--faint);">
        <span>Jul 09</span><span>Jul 23</span><span>Aug 07</span>
      </div>
    </div>

    <div style={panel}>
      <div style={panelHead}>Role distribution</div>
      <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;">
        {#each counts as c}
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; font-size: 12.5px;">
              <span style="{mono} letter-spacing: 0.02em;">{c.name}</span>
              <span style="{mono} color: var(--muted);">{c.count}</span>
            </div>
            <div style="height: 5px; background: var(--hair); border-radius: 2px; overflow: hidden;">
              <div style="height: 100%; width: {Math.round((c.count / maxCount) * 100)}%; background: var(--accent);"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <div style="{panel} margin-top: 20px;">
    <div style={panelHead}>
      <span>Recent access events</span>
      <span style="{mono} font-size: 11px; font-weight: 400; color: var(--faint);">audit pipeline · 4m lag</span>
    </div>
    {#each EVENTS as e}
      <div style="display: grid; grid-template-columns: 92px 150px 1fr auto; gap: 14px; align-items: center; padding: 11px 18px; border-bottom: 1px solid var(--hair); font-size: 13px;">
        <span style="{mono} font-size: 11.5px; color: var(--faint);">{e.time}</span>
        <span style="font-weight: 500;">{e.actor}</span>
        <span style="color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{e.text}</span>
        <span style="{mono} font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: {e.fg}; border: 1px solid {e.bd}; padding: 2px 7px; border-radius: 2px;">{e.kind}</span>
      </div>
    {/each}
  </div>
</div>
