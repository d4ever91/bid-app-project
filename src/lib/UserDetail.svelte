<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label, panel, panelHead, field, btnDark, btnGhost } from '../ui';
  import { ACTIVITY, ROLES, ROLE_INFO, initials, statusDot, maskEmail, mfaColor } from '../data';
  import type { Role, User } from '../types';

  export let user: User;
  export let maskEmails = false;

  const dispatch = createEventDispatcher<{ back: void; edit: void; resetPassword: void; changeRole: Role; archive: void }>();

  const onRole = (e: Event): void => dispatch('changeRole', (e.currentTarget as HTMLSelectElement).value as Role);

  $: email = maskEmail(user.email, maskEmails);

  $: fields = [
    ['Full name', user.name],
    ['Email', email],
    ['Team', user.team],
    ['Location', user.location],
    ['Joined', user.joined],
    ['Last active', user.seen]
  ] as [string, string][];

  $: security = [
    ['MFA', user.mfa, mfaColor(user.mfa)],
    ['Password age', user.pwAge, 'var(--muted)'],
    ['Active sessions', user.sessions, 'var(--muted)']
  ] as [string, string, string][];
</script>

<div>
  <button class="link-btn" type="button" on:click={() => dispatch('back')} style="{mono} background: none; border: none; padding: 0; margin-bottom: 16px; font-size: 11.5px; color: var(--muted); cursor: pointer;">← All users</button>

  <div style="{panel} padding: 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 20px;">
    <div style="{mono} width: 52px; height: 52px; flex: none; background: var(--ink); color: #fff; font-size: 17px; display: flex; align-items: center; justify-content: center; border-radius: 3px;">{initials(user.name)}</div>
    <div style="min-width: 0; flex: 1;">
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <h1 style="font-size: 20px; font-weight: 600; margin: 0; letter-spacing: -0.01em;">{user.name}</h1>
        <span style="{mono} display: inline-flex; align-items: center; gap: 6px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; border: 1px solid var(--line); padding: 2px 8px; border-radius: 2px; color: #4a5250;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: {statusDot(user.status)};"></span>
          {user.status}
        </span>
      </div>
      <div style="{mono} font-size: 12px; color: var(--muted); margin-top: 5px;">{email} · {user.team} · id {user.id}</div>
    </div>
    <div style="display: flex; gap: 8px;">
      <button
        class="btn-ghost"
        type="button"
        style="{btnGhost} border-color: #e6c4c4; color: #932f2f;"
        on:click={() => dispatch('archive')}
      >Archive</button>
      <button class="btn-ghost" type="button" style={btnGhost} on:click={() => dispatch('resetPassword')}>Reset password</button>
      <button class="btn-dark" type="button" style={btnDark} on:click={() => dispatch('edit')}>Edit profile</button>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 340px); gap: 20px; align-items: start;">
    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div style={panel}>
        <div style={panelHead}>Profile</div>
        <div style="padding: 4px 18px 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0 24px;">
          {#each fields as [name, value]}
            <div style="padding: 11px 0; border-bottom: 1px solid var(--hair);">
              <div style="{label} color: var(--faint); margin-bottom: 5px;">{name}</div>
              <div style="font-size: 13.5px;">{value}</div>
            </div>
          {/each}
        </div>
      </div>

      <div style={panel}>
        <div style={panelHead}>Activity</div>
        {#each ACTIVITY as a}
          <div style="display: grid; grid-template-columns: 96px 1fr; gap: 14px; padding: 11px 18px; border-bottom: 1px solid var(--hair); font-size: 13px;">
            <span style="{mono} font-size: 11.5px; color: var(--faint);">{a.time}</span>
            <span style="color: #4a5250;">{a.text}</span>
          </div>
        {/each}
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div style={panel}>
        <div style={panelHead}>Role &amp; access</div>
        <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px;">
          <label style="display: flex; flex-direction: column; gap: 7px;">
            <span style={label}>Assigned role</span>
            <select class="field" value={user.role} on:change={onRole} style="{field} height: 34px; padding: 0 9px; cursor: pointer;">
              {#each ROLES as r (r)}<option value={r}>{r}</option>{/each}
            </select>
          </label>
          <p style="font-size: 12.5px; line-height: 1.6; color: var(--muted); margin: 0;">{ROLE_INFO[user.role].desc}</p>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            {#each ROLE_INFO[user.role].scopes as s (s)}
              <span style="{mono} font-size: 11px; background: #eef4f2; color: #0d5a4e; padding: 3px 8px; border-radius: 2px;">{s}</span>
            {/each}
          </div>
        </div>
      </div>

      <div style={panel}>
        <div style={panelHead}>Security</div>
        <div style="padding: 6px 18px 14px;">
          {#each security as [name, value, color], i}
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 11px 0; border-bottom: {i < 2 ? '1px solid var(--hair)' : 'none'}; font-size: 13px;">
              <span>{name}</span>
              <span style="{mono} font-size: 11.5px; color: {color};">{value}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
