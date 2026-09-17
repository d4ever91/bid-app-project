<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, btnDark } from '../ui';

  export let crumb = '';
  export let actionLabel = 'New user';

  const dispatch = createEventDispatcher<{ invite: void }>();
</script>

<header style="height: 52px; border-bottom: 1px solid var(--line); background: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; position: sticky; top: 0; z-index: 5;">
  <div style="{mono} font-size: 11.5px; letter-spacing: 0.06em; color: var(--muted); display: flex; align-items: center; gap: 8px;">
    <span>ordinal.io</span>
    <span style="color: #c3c8c9;">/</span>
    <span style="color: var(--ink);">{crumb}</span>
  </div>
  <div style="display: flex; align-items: center; gap: 8px;">
    <div style="{mono} font-size: 11px; color: var(--muted); border: 1px solid var(--line); padding: 4px 8px; border-radius: 3px;">⌘K</div>
    <button class="btn-dark" type="button" style="{btnDark} height: 30px; white-space: nowrap;" on:click={() => dispatch('invite')}>{actionLabel}</button>
  </div>
</header>
