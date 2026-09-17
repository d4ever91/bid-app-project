<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label, panel, field, btnDark, btnGhost, h1, sub } from '../ui';
  import Field from './Field.svelte';
  import { runSchema, visible, errorCount, required, email, minLen, maxLen, unique, type Schema } from '../validation';
  import { ROLES, ROLE_INFO } from '../data';
  import type { NewUserDraft, Role, User } from '../types';

  export let users: User[] = [];
  export let mode: 'create' | 'invite' = 'create';

  const dispatch = createEventDispatcher<{ create: NewUserDraft; cancel: void }>();

  const TEAMS: string[] = ['Platform', 'Infrastructure', 'Security', 'Data', 'IT Operations'];
  const MANAGERS: string[] = ['Avery Mercer', 'Priya Raghunathan', 'Tomas Lindqvist'];
  const FIELDS = [
    { key: 'name', label: 'Full name *', ph: 'Dana Okonjo', mono: false },
    { key: 'email', label: 'Work email *', ph: 'd.okonjo@ordinal.io', mono: true },
    { key: 'location', label: 'Location', ph: 'Lisbon, PT', mono: false }
  ] as const;

  let draft: NewUserDraft = {
    name: '', email: '', team: 'Platform', manager: 'Avery Mercer',
    location: '', role: 'Engineer', requireMfa: true
  };

  const pickRole = (r: Role): void => { draft = { ...draft, role: r }; };

  const val = (key: string): string => String(draft[key as keyof NewUserDraft] ?? '');
  const set = (key: string) => (e: Event) => {
    draft = { ...draft, [key]: (e.currentTarget as HTMLInputElement).value };
  };

  let touched: Record<string, boolean> = {};
  let submitted = false;
  const touch = (key: string) => (): void => { touched = { ...touched, [key]: true }; };

  const schema: Schema<NewUserDraft> = {
    name: [required('Enter the person&rsquo;s full name'), minLen(2), maxLen(80)],
    email: [
      required('A work email is required'),
      email(),
      unique(() => users.map((x) => x.email), 'That email already has an account')
    ],
    location: [maxLen(60)]
  };

  $: errors = runSchema(draft, schema);
  $: shown = visible(errors, touched, submitted);
  $: valid = errorCount(errors) === 0;

  const submit = (): void => {
    submitted = true;
    if (valid) dispatch('create', draft);
  };
</script>

<div style="max-width: 680px;">
  <h1 style={h1}>{mode === 'invite' ? 'Invite user' : 'New user'}</h1>
  <p style="{sub} margin-bottom: 20px;">
    An email invite expires after 72 hours. Directory-synced accounts are provisioned automatically instead.
  </p>

  <div style={panel}>
    <div style="padding: 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
      {#each FIELDS as f (f.key)}
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
        <span style={label}>Team</span>
        <select class="field" bind:value={draft.team} style="{field} padding: 0 9px; cursor: pointer;">
          {#each TEAMS as t (t)}<option value={t}>{t}</option>{/each}
        </select>
      </label>
      <label style="display: flex; flex-direction: column; gap: 7px;">
        <span style={label}>Manager</span>
        <select class="field" bind:value={draft.manager} style="{field} padding: 0 9px; cursor: pointer;">
          {#each MANAGERS as m (m)}<option value={m}>{m}</option>{/each}
        </select>
      </label>
    </div>

    {#if submitted && !valid}
      <div style="margin: 0 18px 14px; padding: 10px 12px; border: 1px solid #e6c4c4; background: #fdf5f5; border-radius: 3px; font-size: 12.5px; color: #932f2f;">
        {errorCount(errors) === 1 ? 'One field needs attention' : errorCount(errors) + ' fields need attention'} before this user can be created.
      </div>
    {/if}

    <div style="padding: 0 18px 18px;">
      <div style="{label} margin-bottom: 9px;">Role</div>
      <div style="display: flex; flex-direction: column; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 3px;">
        {#each ROLES as r (r)}
          <div
            role="radio"
            aria-checked={draft.role === r}
            tabindex="0"
            on:click={() => pickRole(r)}
            on:keydown={(e) => e.key === 'Enter' && pickRole(r)}
            style="background: {draft.role === r ? '#f4f8f7' : '#fff'}; padding: 12px 14px; display: flex; gap: 11px; align-items: flex-start; cursor: pointer;"
          >
            <span style="width: 14px; height: 14px; flex: none; margin-top: 2px; border-radius: 50%; border: 1px solid {draft.role === r ? 'var(--accent)' : '#c3c8c9'}; background: {draft.role === r ? 'var(--accent)' : '#fff'}; box-shadow: {draft.role === r ? 'inset 0 0 0 2px #fff' : 'none'};"></span>
            <div>
              <div style="font-size: 13.5px; font-weight: 500;">{r}</div>
              <div style="font-size: 12.5px; color: var(--muted); margin-top: 2px;">{ROLE_INFO[r].desc}</div>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <div style="padding: 14px 18px; border-top: 1px solid var(--line); background: #fafbfa; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
      <button
        type="button"
        on:click={() => (draft = { ...draft, requireMfa: !draft.requireMfa })}
        style="background: none; border: none; padding: 0; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); cursor: pointer;"
      >
        <span style="width: 15px; height: 15px; border-radius: 2px; border: 1px solid {draft.requireMfa ? 'var(--accent)' : '#c3c8c9'}; background: {draft.requireMfa ? 'var(--accent)' : '#fff'}; color: #fff; font-size: 10px; line-height: 1; display: flex; align-items: center; justify-content: center;">{draft.requireMfa ? '✓' : ''}</span>
        Require MFA enrollment on first sign-in
      </button>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="btn-ghost" style={btnGhost} on:click={() => dispatch('cancel')}>Cancel</button>
        <button type="button" class="btn-dark" style="{btnDark} padding: 0 14px;" on:click={submit}>Create &amp; send invite</button>
      </div>
    </div>
  </div>
</div>
