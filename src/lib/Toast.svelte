<script lang="ts">
  export let message: string | null = null;
</script>

{#if message}
  <div style="position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--ink); color: #fff; padding: 11px 16px; border-radius: 3px; font-size: 13px; z-index: 60; display: flex; align-items: center; gap: 10px; box-shadow: 0 10px 30px rgba(20, 23, 26, 0.3);">
    <span style="width: 6px; height: 6px; border-radius: 50%; background: #4ecfae;"></span>
    {message}
  </div>
{/if}
