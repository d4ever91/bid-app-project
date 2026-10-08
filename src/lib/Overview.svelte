<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchBidSummary, fetchOverview, getAccessToken, type BidSummary, type Overview } from '../api';
  import { mono, label, panel, panelHead, h1, sub } from '../ui';
  import { CHART, EVENTS, ROLES } from '../data';
  import type { Role, User } from '../types';

  export let users: User[] = [];

  /** Live figures from MongoDB once signed in — otherwise the demo fixtures stand. */
  let summary: BidSummary | null = null;
  let overview: Overview | null = null;
  onMount(async () => {
    if (!getAccessToken()) return;
    [overview, summary] = await Promise.all([fetchOverview().catch(() => null), fetchBidSummary().catch(() => null)]);
  });

  interface Tile {
    label: string;
    value: string;
    note: string;
    color: string;
  }

  const DEMO_TILES: Tile[] = [
    { label: 'Total users', value: '248', note: '+12 this month', color: 'var(--accent)' },
    { label: 'Active (7d)', value: '191', note: '77% of seats', color: 'var(--muted)' },
    { label: 'Pending invites', value: '7', note: '3 expiring in 48h', color: '#b45309' },
    { label: 'MFA coverage', value: '94%', note: '14 accounts unenrolled', color: '#b23a3a' }
  ];

  const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);

  $: tiles = overview
    ? ([
        {
          label: 'Total users',
          value: String(overview.tiles.totalUsers),
          note: overview.tiles.newUsers30d ? '+' + overview.tiles.newUsers30d + ' this month' : 'no new accounts this month',
          color: 'var(--accent)'
        },
        {
          label: 'Active (7d)',
          value: String(overview.tiles.active7d),
          note: Math.round((overview.tiles.active7d / Math.max(1, overview.tiles.seatsLicensed)) * 100) + '% of seats',
          color: 'var(--muted)'
        },
        {
          label: 'Pending invites',
          value: String(overview.tiles.pendingInvites),
          note: overview.tiles.expiringInvites48h ? overview.tiles.expiringInvites48h + ' expiring in 48h' : 'none expiring soon',
          color: overview.tiles.expiringInvites48h ? '#b45309' : 'var(--muted)'
        },
        {
          label: 'MFA coverage',
          value: overview.tiles.mfaCoverage + '%',
          note: overview.tiles.mfaMissing ? plural(overview.tiles.mfaMissing, 'account') + ' unenrolled' : 'every account enrolled',
          color: overview.tiles.mfaMissing ? '#b23a3a' : 'var(--accent)'
        }
      ] satisfies Tile[])
    : DEMO_TILES;

  const RANGES: string[] = ['24h', '30d', '90d'];

  const dayLabel = (iso: string): string =>
    new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', day: '2-digit', timeZone: 'UTC' });

  $: chart = overview ? overview.signIns.map((d) => d.count) : CHART;
  $: chartDays = overview ? overview.signIns.map((d) => d.date) : [];
  $: peak = Math.max(...chart, 1);
  $: axis = chartDays.length
    ? [chartDays[0], chartDays[Math.floor(chartDays.length / 2)], chartDays[chartDays.length - 1]].map(dayLabel)
    : ['Jul 09', 'Jul 23', 'Aug 07'];

  $: counts = overview
    ? overview.roles.map((r) => ({ name: r.role, count: r.count }))
    : ROLES.map((r: Role) => ({ name: r, count: users.filter((u) => u.role === r).length }));
  $: maxCount = Math.max(...counts.map((c) => c.count), 1);

  /** Badge colours per audit event kind. */
  const KIND: Record<string, { fg: string; bd: string }> = {
    role: { fg: '#0d5a4e', bd: '#c4ded7' },
    invite: { fg: '#8a5a10', bd: '#e6d4b3' },
    status: { fg: '#932f2f', bd: '#e6c4c4' },
    billing: { fg: '#5b3f9e', bd: '#d9cff0' },
    bid: { fg: '#0d5a7a', bd: '#c2dbe6' }
  };
  const neutral = { fg: '#4a5250', bd: '#dfe2e3' };

  /** "14:02:11" for today, "Mon 09:12" this week, otherwise "14 Aug". */
  function eventTime(iso: string): string {
    const d = new Date(iso);
    const ageDays = (Date.now() - d.getTime()) / 864e5;
    if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('en-GB', { hour12: false });
    if (ageDays < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  $: events = overview
    ? overview.events.map((e) => ({ time: eventTime(e.at), actor: e.actor, text: e.text, kind: e.kind, ...(KIND[e.kind] ?? neutral) }))
    : EVENTS;
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
    {#each tiles as t}
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
        {#each chart as v, i}
          <div class="bar" title="{chartDays[i] ? dayLabel(chartDays[i]) : 'day ' + (i + 1)}: {v} sign-ins" style="flex: 1; background: #cfd9d5; height: {Math.round((v / peak) * 100)}%; border-radius: 1px; min-width: 3px;"></div>
        {/each}
      </div>
      <div style="{mono} padding: 0 18px 14px; display: flex; justify-content: space-between; font-size: 10.5px; color: var(--faint);">
        {#each axis as a}<span>{a}</span>{/each}
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
      <span style="{mono} font-size: 11px; font-weight: 400; color: var(--faint);">{overview ? 'audit log · live' : 'audit pipeline · 4m lag'}</span>
    </div>
    {#each events as e}
      <div style="display: grid; grid-template-columns: 92px 150px 1fr auto; gap: 14px; align-items: center; padding: 11px 18px; border-bottom: 1px solid var(--hair); font-size: 13px;">
        <span style="{mono} font-size: 11.5px; color: var(--faint);">{e.time}</span>
        <span style="font-weight: 500;">{e.actor}</span>
        <span style="color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{e.text}</span>
        <span style="{mono} font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: {e.fg}; border: 1px solid {e.bd}; padding: 2px 7px; border-radius: 2px;">{e.kind}</span>
      </div>
    {/each}
  </div>
</div>
