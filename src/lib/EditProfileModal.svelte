<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { btnDark, btnGhost } from '../ui';
  import Field from './Field.svelte';
  import { runSchema, visible, errorCount, required, email, minLen, maxLen, type Schema } from '../validation';
  import type { ProfileDraft, User } from '../types';

  export let user: User;

  const dispatch = createEventDispatcher<{ close: void; save: ProfileDraft }>();

  let draft: ProfileDraft = { name: user.name, email: user.email, team: user.team };

  let touched: Record<string, boolean> = {};
  let submitted = false;
  const touch = (key: string) => (): void => { touched = { ...touched, [key]: true }; };
  const set = (key: keyof ProfileDraft) => (e: Event): void => {
    draft = { ...draft, [key]: (e.currentTarget as HTMLInputElement).value };
  };

  const schema: Schema<ProfileDraft> = {
    name: [required('A name is required'), minLen(2), maxLen(80)],
    email: [required('A work email is required'), email()],
    team: [required('A team is required'), maxLen(60)]
  };

  $: errors = runSchema(draft, schema);
  $: shown = visible(errors, touched, submitted);
  $: valid = errorCount(errors) === 0;

  const save = (): void => {
    submitted = true;
    if (valid) dispatch('save', draft);
  };
</script>

<div
  role="presentation"
  on:click={() => dispatch('close')}
  style="position: fixed; inset: 0; background: rgba(20, 23, 26, 0.42); z-index: 40; display: flex; align-items: center; justify-content: center; padding: 24px;"
>
  <div
    role="dialog"
    aria-label="Edit profile"
    on:click|stopPropagation
    style="background: #fff; border-radius: 4px; width: 460px; max-width: 100%; box-shadow: 0 24px 60px rgba(20, 23, 26, 0.28);"
  >
    <div style="padding: 15px 18px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between;">
      <span style="font-size: 14px; font-weight: 600;">Edit profile</span>
      <button type="button" on:click={() => dispatch('close')} style="background: none; border: none; font-size: 16px; color: var(--faint); cursor: pointer; line-height: 1;">×</button>
    </div>

    <div style="padding: 18px; display: flex; flex-direction: column; gap: 14px;">
      <Field label="Full name" value={draft.name} error={shown.name ?? null} on:input={set('name')} on:blur={touch('name')} />
      <Field label="Work email" type="email" monoFont value={draft.email} error={shown.email ?? null} on:input={set('email')} on:blur={touch('email')} />
      <Field label="Team" value={draft.team} error={shown.team ?? null} on:input={set('team')} on:blur={touch('team')} />
    </div>

    <div style="padding: 14px 18px; border-top: 1px solid var(--line); background: #fafbfa; display: flex; justify-content: flex-end; gap: 8px;">
      <button class="btn-ghost" type="button" style={btnGhost} on:click={() => dispatch('close')}>Cancel</button>
      <button class="btn-dark" type="button" style={btnDark} on:click={save}>Save changes</button>
    </div>
  </div>
</div>
