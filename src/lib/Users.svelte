<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label, panel, field, h1, sub, gridCols, ROW_PAD } from '../ui';
  import { ROLES, TOTAL_USERS, initials, statusDot, maskEmail } from '../data';
  import type { Density, RoleFilter, User } from '../types';

  export let users: User[] = [];
  export let query = '';
  export let role: RoleFilter = 'All';
  export let density: Density = 'Dense';
  export let maskEmails = false;
  /** Server-derived filter options and counts. Null in demo mode, where they come from rows. */
  export let facets: {
    teams: string[];
    roles: Array<{ value: string; count: number }>;
    statuses: Array<{ value: string; count: number }>;
    total: number;
    mfaMissing: number;
    archived: number;
  } | null = null;
  export let loading = false;
  export let selectedIds: string[] = [];

  const dispatch = createEventDispatcher<{
    query: string;
    role: RoleFilter;
    open: string;
    create: void;
    invite: void;
    bulk: { action: 'role' | 'status' | 'archive' | 'reset-password'; extra?: Record<string, string> };
  }>();

  type MfaBucket = 'All' | 'Enrolled' | 'Pending' | 'Not enrolled';
  type StatusFilter = 'All' | 'Active' | 'Invited' | 'Suspended';
  type SortKey = 'Name' | 'Role' | 'Team' | 'Password age';

  let filtersOpen = false;
  let team = 'All';
  let status: StatusFilter = 'All';
  let mfa: MfaBucket = 'All';
  let sort: SortKey = 'Name';

  const mfaBucket = (v: string): MfaBucket =>
    v === 'Not enrolled' ? 'Not enrolled' : v === 'Pending' ? 'Pending' : 'Enrolled';
  const pwDays = (v: string): number => parseInt(v, 10) || 0;

  const clearAll = (): void => {
    team = 'All';
    status = 'All';
    mfa = 'All';
    sort = 'Name';
    dispatch('role', 'All');
    dispatch('query', '');
  };

  // Facets cover the whole workspace; row-derived options would only reflect this page.
  $: teams = facets
    ? ['All', ...facets.teams]
    : ['All', ...new Set(users.map((x) => x.team))].sort((a, b) => (a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b)));

  $: statusOptions = facets
    ? ['All', ...facets.statuses.map((s) => s.value)]
    : ['All', 'Active', 'Invited', 'Suspended'];

  const countFor = (list: Array<{ value: string; count: number }> | undefined, value: string): string => {
    const hit = list?.find((x) => x.value === value);
    return hit ? ' (' + hit.count + ')' : '';
  };

  $: allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const toggleAll = (): void => {
    selectedIds = allSelected ? [] : rows.map((r) => r.id);
  };
  const toggleOne = (id: string): void => {
    selectedIds = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
  };

  let bulkRole = 'Engineer';
  let bulkStatus = 'Suspended';
  $: activeCount =
    [team, status, mfa].filter((v) => v !== 'All').length +
    (role === 'All' ? 0 : 1) +
    (query.trim() ? 1 : 0);

  // With facets present the server has already filtered and sorted; only sort locally otherwise.
  $: rows = (facets
    ? users
    : users.filter(
        (x) =>
          (team === 'All' || x.team === team) &&
          (status === 'All' || x.status === status) &&
          (mfa === 'All' || mfaBucket(x.mfa) === mfa)
      )
  )
    .slice()
    .sort((a, b) => {
      if (sort === 'Role') return ROLES.indexOf(a.role) - ROLES.indexOf(b.role);
      if (sort === 'Team') return a.team.localeCompare(b.team);
      if (sort === 'Password age') return pwDays(b.pwAge) - pwDays(a.pwAge);
      return a.name.localeCompare(b.name);
    });

  const onQuery = (e: Event): void => dispatch('query', (e.currentTarget as HTMLInputElement).value);
  const onRole = (e: Event): void => dispatch('role', (e.currentTarget as HTMLSelectElement).value as RoleFilter);
  const onOpen = (id: string): void => dispatch('open', id);

  $: pad = ROW_PAD[density] ?? ROW_PAD.Dense;
  $: rowStyle =
    'min-width: 848px; display: grid; grid-template-columns: 22px minmax(220px, 2fr) 120px 132px 116px 120px 84px; gap: 12px; padding: ' + pad +
    '; border-bottom: 1px solid var(--hair); align-items: center; font-size: 13px; cursor: pointer;';
</script>

<div>
  <div style="display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 16px; gap: 20px; flex-wrap: wrap;">
    <div>
      <h1 style={h1}>Users</h1>
      <p style={sub}>
        {rows.length} of {facets?.total ?? TOTAL_USERS} accounts · directory-synced{facets && facets.mfaMissing ? ' · ' + facets.mfaMissing + ' without MFA' : ''}
      </p>
    </div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
      <input
        class="field"
        type="text"
        placeholder="Search name, email, team…"
        value={query}
        on:input={onQuery}
        style="{field} width: 258px; height: 32px; background: #fff;"
      />
      <select
        class="field"
        value={role}
        on:change={onRole}
        style="{field} height: 32px; padding: 0 8px; background: #fff; cursor: pointer;"
      >
        <option value="All">All roles</option>
        {#each ROLES as r (r)}<option value={r}>{r}{countFor(facets?.roles, r)}</option>{/each}
      </select>

      <button
        type="button"
        on:click={() => (filtersOpen = !filtersOpen)}
        style="{mono} height: 32px; padding: 0 11px; background: #fff; border: 1px solid {filtersOpen || activeCount ? 'var(--ink)' : 'var(--line)'}; border-radius: 3px; font-size: 11px; letter-spacing: 0.04em; color: {filtersOpen || activeCount ? 'var(--ink)' : 'var(--muted)'}; cursor: pointer; white-space: nowrap;"
      >Advanced filters{activeCount ? ' · ' + activeCount : ''}</button>

      <button type="button" class="btn-dark" on:click={() => dispatch('create')} style="height: 32px; padding: 0 13px; background: var(--ink); color: #fff; border: none; border-radius: 3px; font-size: 12.5px; font-weight: 500; cursor: pointer; white-space: nowrap;">New user</button>
      <button type="button" class="btn-ghost" on:click={() => dispatch('invite')} style="height: 32px; padding: 0 13px; background: #fff; border: 1px solid var(--line); border-radius: 3px; font-size: 12.5px; cursor: pointer; white-space: nowrap;">Invite user</button>

      {#if activeCount}
        <button
          type="button"
          title="Remove all filters"
          class="clear-btn"
          on:click={clearAll}
          style="width: 32px; height: 32px; flex: none; background: #fff; border: 1px solid var(--line); border-radius: 3px; color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center;"
        ><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
        <path d="M1.5 2h11L8.4 7v4.6L5.6 12.8V7L1.5 2Z" />
        <path d="M9.6 9.6l3.4 3.4M13 9.6l-3.4 3.4" />
      </svg></button>
      {/if}
    </div>
  </div>

  {#if filtersOpen}
    <div style="{panel} padding: 14px 18px; margin-bottom: 12px; display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap;">
      <label style="display: flex; flex-direction: column; gap: 6px; min-width: 168px; flex: 1;">
        <span style={label}>Team</span>
        <select class="field" bind:value={team} style="{field} height: 32px; padding: 0 8px; cursor: pointer;">
          {#each teams as t (t)}<option value={t}>{t === 'All' ? 'Any team' : t}</option>{/each}
        </select>
      </label>
      <label style="display: flex; flex-direction: column; gap: 6px; min-width: 168px; flex: 1;">
        <span style={label}>Status</span>
        <select class="field" bind:value={status} style="{field} height: 32px; padding: 0 8px; cursor: pointer;">
          {#each statusOptions as s (s)}<option value={s}>{s === 'All' ? 'Any status' : s + countFor(facets?.statuses, s)}</option>{/each}
        </select>
      </label>
      <label style="display: flex; flex-direction: column; gap: 6px; min-width: 168px; flex: 1;">
        <span style={label}>MFA</span>
        <select class="field" bind:value={mfa} style="{field} height: 32px; padding: 0 8px; cursor: pointer;">
          {#each ['All', 'Enrolled', 'Pending', 'Not enrolled'] as m (m)}<option value={m}>{m === 'All' ? 'Any MFA state' : m}</option>{/each}
        </select>
      </label>
      <label style="display: flex; flex-direction: column; gap: 6px; min-width: 168px; flex: 1;">
        <span style={label}>Sort by</span>
        <select class="field" bind:value={sort} style="{field} height: 32px; padding: 0 8px; cursor: pointer;">
          {#each ['Name', 'Role', 'Team', 'Password age'] as s (s)}<option value={s}>{s}</option>{/each}
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

  {#if selectedIds.length}
    <div style="{panel} padding: 11px 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #f4f8f7; border-color: var(--accent);">
      <span style="{mono} font-size: 11.5px; color: var(--ink); letter-spacing: 0.02em;">{selectedIds.length} selected</span>

      <span style="width: 1px; height: 20px; background: var(--line);"></span>

      <select class="field" bind:value={bulkRole} style="{field} height: 30px; padding: 0 8px; cursor: pointer; width: auto;">
        {#each ROLES as r (r)}<option value={r}>{r}</option>{/each}
      </select>
      <button type="button" on:click={() => dispatch('bulk', { action: 'role', extra: { role: bulkRole } })} style="{mono} height: 30px; padding: 0 11px; background: #fff; border: 1px solid var(--line); border-radius: 3px; font-size: 11px; letter-spacing: 0.04em; cursor: pointer; white-space: nowrap;">Set role</button>

      <select class="field" bind:value={bulkStatus} style="{field} height: 30px; padding: 0 8px; cursor: pointer; width: auto;">
        {#each ['Active', 'Suspended'] as s (s)}<option value={s}>{s}</option>{/each}
      </select>
      <button type="button" on:click={() => dispatch('bulk', { action: 'status', extra: { status: bulkStatus } })} style="{mono} height: 30px; padding: 0 11px; background: #fff; border: 1px solid var(--line); border-radius: 3px; font-size: 11px; letter-spacing: 0.04em; cursor: pointer; white-space: nowrap;">Set status</button>

      <button type="button" on:click={() => dispatch('bulk', { action: 'reset-password' })} style="{mono} height: 30px; padding: 0 11px; background: #fff; border: 1px solid var(--line); border-radius: 3px; font-size: 11px; letter-spacing: 0.04em; cursor: pointer; white-space: nowrap;">Reset passwords</button>

      <button type="button" on:click={() => dispatch('bulk', { action: 'archive' })} style="{mono} margin-left: auto; height: 30px; padding: 0 11px; background: #fff; border: 1px solid #e6c4c4; border-radius: 3px; font-size: 11px; letter-spacing: 0.04em; color: #932f2f; cursor: pointer; white-space: nowrap;">Archive</button>
      <button type="button" on:click={() => (selectedIds = [])} style="{mono} height: 30px; padding: 0 9px; background: none; border: none; font-size: 11px; color: var(--muted); cursor: pointer;">Clear</button>
    </div>
  {/if}

  <div style="{panel} overflow-x: auto; position: relative;">
    {#if loading}
      <div style="{mono} position: absolute; top: 10px; right: 16px; font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); z-index: 2;">loading…</div>
    {/if}

    <div style="{label} min-width: 848px; display: grid; 36px {gridCols.replace('grid-template-columns:', '').replace(';', '')} gap: 12px; padding: 9px 18px; background: #fafbfa; border-bottom: 1px solid var(--line); grid-template-columns: 22px minmax(220px, 2fr) 120px 132px 116px 120px 84px;">
      <input type="checkbox" checked={allSelected} on:change={toggleAll} aria-label="Select all rows" style="width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer;" />
      <span>User</span><span>Role</span><span>Team</span><span>Status</span><span>Last active</span>
      <span style="text-align: right;">Actions</span>
    </div>

    {#each rows as u (u.id)}
      <div
        class="row"
        role="button"
        tabindex="0"
        style={rowStyle}
        on:click={() => onOpen(u.id)}
        on:keydown={(e) => e.key === 'Enter' && onOpen(u.id)}
      >
        <input
          type="checkbox"
          checked={selectedIds.includes(u.id)}
          aria-label="Select {u.name}"
          on:click|stopPropagation
          on:change={() => toggleOne(u.id)}
          style="width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer;"
        />
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
          <div style="{mono} width: 28px; height: 28px; flex: none; background: var(--hair); color: #4a5250; font-size: 11px; display: flex; align-items: center; justify-content: center; border-radius: 2px;">{initials(u.name)}</div>
          <div style="display: flex; flex-direction: column; line-height: 1.35; min-width: 0;">
            <span style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{u.name}</span>
            <span style="{mono} font-size: 11.5px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{maskEmail(u.email, maskEmails)}</span>
          </div>
        </div>
        <span style="{mono} font-size: 11.5px;">{u.role}</span>
        <span style="color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{u.team}</span>
        <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #4a5250;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: {statusDot(u.status)};"></span>
          {u.status}
        </span>
        <span style="{mono} font-size: 11.5px; color: var(--muted);">{u.seen}</span>
        <span style="{mono} text-align: right; font-size: 11.5px; color: var(--accent);">Manage →</span>
      </div>
    {/each}

    <div style="{mono} min-width: 848px; padding: 11px 18px; display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--muted);">
      <span>{facets ? 'showing ' + rows.length + ' of ' + facets.total : 'page 1 of 28'}</span>
      <div style="display: flex; gap: 6px;">
        <span style="border: 1px solid var(--line); padding: 3px 9px; border-radius: 2px; color: #c3c8c9;">prev</span>
        <span style="border: 1px solid var(--line); padding: 3px 9px; border-radius: 2px; cursor: pointer;">next</span>
      </div>
    </div>
  </div>
</div>
