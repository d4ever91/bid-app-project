<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label } from '../ui';
  import { ICONS } from '../icons';
  import type { Screen } from '../types';

  export let screen: Screen = 'overview';
  export let totalUsers = 0;
  export let openBids = 0;
  export let planName = '';
  export let collapsed = false;
  export let meName = 'Avery Mercer';
  export let meInitials = 'AM';

  const dispatch = createEventDispatcher<{ navigate: Screen; toggle: void; logout: void }>();
  const go = (next: Screen): void => dispatch('navigate', next);

  interface NavItem {
    key: Screen;
    icon: string;
    label: string;
    badge: string;
    active: boolean;
  }

  const REFERENCE: string[] = ['Roles & scopes', 'Audit log', 'API tokens'];

  const navStyle = (active: boolean): string =>
    'text-align: left; background: ' + (active ? '#1d2223' : 'transparent') +
    '; border: none; border-left: 2px solid ' + (active ? 'var(--accent)' : 'transparent') +
    '; color: ' + (active ? '#fff' : '#a5aeaa') +
    '; padding: ' + (collapsed ? '9px 0' : '9px 16px') +
    '; font-size: 13.5px; cursor: pointer; display: flex; align-items: center; gap: 8px; justify-content: ' +
    (collapsed ? 'center' : 'space-between') + ';';

  $: operate = [
    { key: 'overview', icon: ICONS.overview, label: 'Overview', badge: '', active: screen === 'overview' },
    { key: 'users', icon: ICONS.users, label: 'Users', badge: String(totalUsers), active: screen === 'users' || screen === 'detail' || screen === 'invite' },
    { key: 'bids', icon: ICONS.bids, label: 'Bids', badge: String(openBids), active: screen === 'bids' || screen === 'bid' || screen === 'newbid' },
    { key: 'assistant', icon: ICONS.assistant, label: 'AI assistant', badge: '', active: screen === 'assistant' }
  ] as NavItem[];

  $: account = [
    { key: 'profile', icon: ICONS.profile, label: 'Your profile', badge: '', active: screen === 'profile' },
    { key: 'billing', icon: ICONS.billing, label: 'Subscription', badge: planName, active: screen === 'billing' }
  ] as NavItem[];
</script>

<aside style="background: var(--ink); display: flex; flex-direction: column; padding: 20px 0; position: sticky; top: 0; height: 100vh;">
  <div style="display: flex; align-items: center; gap: 9px; padding: 0 14px 18px; justify-content: {collapsed ? 'center' : 'space-between'};">
    <span style="display: flex; align-items: center; gap: 9px; min-width: 0;">
      <span style="width: 18px; height: 18px; flex: none; background: var(--accent);"></span>
      {#if !collapsed}
        <span style="{mono} font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #fff;">Ordinal</span>
      {/if}
    </span>
    {#if !collapsed}
      <button
        type="button"
        title="Collapse sidebar"
        class="nav-toggle"
        on:click={() => dispatch('toggle')}
        style="width: 24px; height: 24px; flex: none; background: transparent; border: 1px solid #262b2c; border-radius: 3px; color: #6f7a76; font-size: 12px; line-height: 1; cursor: pointer;"
      >«</button>
    {/if}
  </div>

  {#if collapsed}
    <button
      type="button"
      title="Expand sidebar"
      class="nav-toggle"
      on:click={() => dispatch('toggle')}
      style="margin: 0 auto 14px; width: 24px; height: 24px; background: transparent; border: 1px solid #262b2c; border-radius: 3px; color: #6f7a76; font-size: 12px; line-height: 1; cursor: pointer;"
    >»</button>
  {/if}

  {#if !collapsed}
    <div style="{label} font-size: 10px; letter-spacing: 0.14em; color: #5f6a66; padding: 0 18px 8px;">Operate</div>
  {/if}
  <nav style="display: flex; flex-direction: column;">
    {#each operate as item (item.key)}
      <button class="nav-item" type="button" title={item.label} style={navStyle(item.active)} on:click={() => go(item.key)}>
        <span style="display: flex; align-items: center; gap: 10px; min-width: 0;">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="flex: none;" aria-hidden="true">{@html item.icon}</svg>
          {#if !collapsed}<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{item.label}</span>{/if}
        </span>
        {#if !collapsed && item.badge}
          <span style="{mono} font-size: 11px; color: #6f7a76;">{item.badge}</span>
        {/if}
      </button>
    {/each}
  </nav>

  {#if !collapsed}
    <div style="{label} font-size: 10px; letter-spacing: 0.14em; color: #5f6a66; padding: 24px 18px 8px;">Account</div>
  {/if}
  <nav style="display: flex; flex-direction: column; margin-top: {collapsed ? '14px' : '0'};">
    {#each account as item (item.key)}
      <button class="nav-item" type="button" title={item.label} style={navStyle(item.active)} on:click={() => go(item.key)}>
        <span style="display: flex; align-items: center; gap: 10px; min-width: 0;">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="flex: none;" aria-hidden="true">{@html item.icon}</svg>
          {#if !collapsed}<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{item.label}</span>{/if}
        </span>
        {#if !collapsed && item.badge}
          <span style="{mono} font-size: 11px; color: #6f7a76;">{item.badge}</span>
        {/if}
      </button>
    {/each}
  </nav>

  {#if !collapsed}
    <div style="{label} font-size: 10px; letter-spacing: 0.14em; color: #5f6a66; padding: 24px 18px 8px;">Reference</div>
    <nav style="display: flex; flex-direction: column;">
      {#each REFERENCE as item (item)}
        <span style="color: #4d5754; padding: 9px 18px; font-size: 13.5px; cursor: not-allowed;">{item}</span>
      {/each}
    </nav>
  {/if}

  <button
    class="nav-item"
    type="button"
    title="Sign out"
    on:click={() => dispatch('logout')}
    style="margin-top: auto; text-align: left; padding: 9px 14px; border: none; background: transparent; color: #a5aeaa; font-size: 13.5px; cursor: pointer; display: flex; align-items: center; gap: 10px; justify-content: {collapsed ? 'center' : 'flex-start'};"
  >
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="flex: none;" aria-hidden="true">
      <path d="M6.2 13.5H3.4A1.4 1.4 0 0 1 2 12.1V3.9a1.4 1.4 0 0 1 1.4-1.4h2.8" />
      <path d="M10.5 11 14 8l-3.5-3M14 8H6.2" />
    </svg>
    {#if !collapsed}<span>Sign out</span>{/if}
  </button>

  <button
    class="nav-item"
    type="button"
    title={meName}
    on:click={() => go('profile')}
    style="text-align: left; padding: 14px 14px 0; border: none; border-top: 1px solid #262b2c; background: transparent; cursor: pointer; display: flex; align-items: center; gap: 10px; justify-content: {collapsed ? 'center' : 'flex-start'};"
  >
    <span style="{mono} width: 28px; height: 28px; flex: none; background: #262b2c; color: #d6dbd9; font-size: 11px; display: flex; align-items: center; justify-content: center; border-radius: 2px;">{meInitials}</span>
    {#if !collapsed}
      <span style="display: flex; flex-direction: column; line-height: 1.3; min-width: 0;">
        <span style="font-size: 12.5px; color: #d6dbd9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{meName}</span>
        <span style="{mono} font-size: 10.5px; color: #6f7a76;">org:admin</span>
      </span>
    {/if}
  </button>
</aside>
