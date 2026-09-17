<script lang="ts">
  import { label as labelStyle, field as fieldStyle, mono } from '../ui';

  export let label = '';
  export let value = '';
  export let placeholder = '';
  export let type = 'text';
  export let monoFont = false;
  export let error: string | null = null;
  export let height = '36px';
  export let hint = '';

  // `null` error means "valid or not yet shown" — only a string paints the red state.
  $: invalid = !!error;
</script>

<label style="display: flex; flex-direction: column; gap: 7px; min-width: 0;">
  <span style={labelStyle}>{label}</span>
  <input
    class="field"
    {type}
    {placeholder}
    {value}
    aria-invalid={invalid}
    on:input
    on:blur
    style="{fieldStyle} height: {height};{monoFont ? ' font-family: var(--mono); font-size: 12.5px;' : ''}{invalid
      ? ' border-color: #c86b6b; background: #fdf7f7;'
      : ''}"
  />
  {#if invalid}
    <span style="{mono} font-size: 11px; color: #932f2f; letter-spacing: 0.02em;">{error}</span>
  {:else if hint}
    <span style="{mono} font-size: 11px; color: var(--faint); letter-spacing: 0.02em;">{hint}</span>
  {/if}
</label>
