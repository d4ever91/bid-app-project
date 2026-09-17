<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label, panel, panelHead, field, btnDark, btnGhost, h1, sub } from '../ui';
  import { SESSIONS } from '../subscription';
  import { initials } from '../data';

  const dispatch = createEventDispatcher<{ notify: string; billing: void }>();

  let name = 'Avery Mercer';
  let email = 'a.mercer@ordinal.io';
  let jobTitle = 'Head of Platform Engineering';
  let timezone = 'Europe/London';
  let dirty = false;

  interface Pref {
    title: string;
    note: string;
    on: boolean;
  }

  let prefs: Pref[] = [
    { title: 'Weekly access digest', note: 'Monday summary of role changes and MFA gaps.', on: true },
    { title: 'Risk alerts', note: 'Immediate email when an admin account loses MFA.', on: true },
    { title: 'Bid deadline reminders', note: 'Three days before any bid you own is due.', on: true },
    { title: 'Product news', note: 'Occasional release notes. No more than monthly.', on: false }
  ];

  const togglePref = (title: string): void => {
    prefs = prefs.map((x) => (x.title === title ? { ...x, on: !x.on } : x));
    dispatch('notify', 'Notification preferences saved');
  };

  const save = (): void => {
    dirty = false;
    dispatch('notify', 'Profile saved');
  };
</script>

<div style="max-width: 940px;">
  <div style="margin-bottom: 18px;">
    <h1 style={h1}>Your profile</h1>
    <p style={sub}>Personal details, security, and what Ordinal emails you about.</p>
  </div>

  <div style="{panel} padding: 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 20px;">
    <div style="{mono} width: 52px; height: 52px; flex: none; background: var(--ink); color: #fff; font-size: 17px; display: flex; align-items: center; justify-content: center; border-radius: 3px;">{initials(name)}</div>
    <div style="min-width: 0; flex: 1;">
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <h2 style="font-size: 18px; font-weight: 600; margin: 0; letter-spacing: -0.01em;">{name}</h2>
        <span style="{mono} font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; border: 1px solid var(--line); padding: 2px 8px; border-radius: 2px; color: #4a5250;">org:admin</span>
      </div>
      <div style="{mono} font-size: 12px; color: var(--muted); margin-top: 5px;">{email} · {jobTitle}</div>
    </div>
    <button type="button" class="btn-ghost" style={btnGhost} on:click={() => dispatch('billing')}>Manage subscription</button>
  </div>

  <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 340px); gap: 20px; align-items: start;">
    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div style={panel}>
        <div style={panelHead}>
          <span>Personal details</span>
          {#if dirty}<span style="{mono} font-size: 11px; font-weight: 400; color: #8a5a10;">unsaved changes</span>{/if}
        </div>
        <div style="padding: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <label style="display: flex; flex-direction: column; gap: 7px;">
            <span style={label}>Full name</span>
            <input class="field" type="text" bind:value={name} on:input={() => (dirty = true)} style={field} />
          </label>
          <label style="display: flex; flex-direction: column; gap: 7px;">
            <span style={label}>Work email</span>
            <input class="field" type="email" bind:value={email} on:input={() => (dirty = true)} style="{field} {mono} font-size: 12.5px;" />
          </label>
          <label style="display: flex; flex-direction: column; gap: 7px;">
            <span style={label}>Job title</span>
            <input class="field" type="text" bind:value={jobTitle} on:input={() => (dirty = true)} style={field} />
          </label>
          <label style="display: flex; flex-direction: column; gap: 7px;">
            <span style={label}>Timezone</span>
            <select class="field" bind:value={timezone} on:change={() => (dirty = true)} style="{field} padding: 0 9px; cursor: pointer;">
              {#each ['Europe/London', 'Europe/Stockholm', 'America/New_York', 'Asia/Singapore'] as tz (tz)}<option value={tz}>{tz}</option>{/each}
            </select>
          </label>
        </div>
        <div style="padding: 14px 18px; border-top: 1px solid var(--line); background: #fafbfa; display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn-ghost" style={btnGhost} on:click={() => (dirty = false)}>Discard</button>
          <button type="button" class="btn-dark" style={btnDark} on:click={save}>Save changes</button>
        </div>
      </div>

      <div style={panel}>
        <div style={panelHead}>Notifications</div>
        {#each prefs as pref (pref.title)}
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 18px; border-bottom: 1px solid var(--hair);">
            <div style="min-width: 0;">
              <div style="font-size: 13.5px; font-weight: 500;">{pref.title}</div>
              <div style="font-size: 12.5px; color: var(--muted); margin-top: 2px;">{pref.note}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={pref.on}
              aria-label={pref.title}
              on:click={() => togglePref(pref.title)}
              style="flex: none; width: 38px; height: 21px; padding: 2px; border-radius: 11px; border: 1px solid {pref.on ? 'var(--accent)' : 'var(--line)'}; background: {pref.on ? 'var(--accent)' : '#fff'}; cursor: pointer; display: flex; justify-content: {pref.on ? 'flex-end' : 'flex-start'};"
            >
              <span style="width: 15px; height: 15px; border-radius: 50%; background: {pref.on ? '#fff' : '#c3c8c9'};"></span>
            </button>
          </div>
        {/each}
      </div>

      <div style={panel}>
        <div style={panelHead}>
          <span>Active sessions</span>
          <button type="button" class="link-btn" on:click={() => dispatch('notify', 'Signed out of 2 other sessions')} style="{mono} background: none; border: none; padding: 0; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); cursor: pointer;">Sign out others</button>
        </div>
        {#each SESSIONS as s (s.ip)}
          <div style="display: grid; grid-template-columns: 1fr 150px 110px; gap: 14px; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--hair); font-size: 13px;">
            <div style="min-width: 0;">
              <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{s.device}</div>
              <div style="{mono} font-size: 11.5px; color: var(--faint);">{s.ip}</div>
            </div>
            <span style="color: var(--muted);">{s.location}</span>
            <span style="{mono} font-size: 11.5px; text-align: right; color: {s.current ? 'var(--accent)' : 'var(--muted)'};">{s.lastSeen}</span>
          </div>
        {/each}
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div style={panel}>
        <div style={panelHead}>Security</div>
        <div style="padding: 6px 18px 14px;">
          {#each [['Password', 'changed 31 days ago'], ['MFA', 'WebAuthn + TOTP'], ['Recovery codes', '8 of 10 unused']] as [k, v] (k)}
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 11px 0; border-bottom: 1px solid var(--hair); font-size: 13px;">
              <span>{k}</span>
              <span style="{mono} font-size: 11.5px; color: var(--muted);">{v}</span>
            </div>
          {/each}
          <div style="display: flex; gap: 8px; padding-top: 14px;">
            <button type="button" class="btn-ghost" style="{btnGhost} flex: 1;" on:click={() => dispatch('notify', 'Password reset email sent')}>Change password</button>
          </div>
        </div>
      </div>

      <div style={panel}>
        <div style={panelHead}>API access</div>
        <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px;">
          <div style="{mono} font-size: 11.5px; color: var(--muted);">pat_9f2c····································a11</div>
          <p style="font-size: 12.5px; line-height: 1.6; color: var(--muted); margin: 0;">Personal token, full <span style={mono}>org:admin</span> scope. Rotated 4 hours ago.</p>
          <button type="button" class="btn-ghost" style={btnGhost} on:click={() => dispatch('notify', 'New personal token generated')}>Rotate token</button>
        </div>
      </div>

      <div style="{panel} border-color: #e6c4c4;">
        <div style="{panelHead} border-bottom-color: #e6c4c4; color: #932f2f;">Danger zone</div>
        <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px;">
          <p style="font-size: 12.5px; line-height: 1.6; color: var(--muted); margin: 0;">
            You are the only account holding <span style={mono}>org:admin</span> alongside Priya Raghunathan. Transfer ownership before leaving the workspace.
          </p>
          <button type="button" on:click={() => dispatch('notify', 'Ownership transfer requires a second admin to approve')} style="{btnGhost} border-color: #e6c4c4; color: #932f2f;">Transfer ownership</button>
        </div>
      </div>
    </div>
  </div>
</div>
