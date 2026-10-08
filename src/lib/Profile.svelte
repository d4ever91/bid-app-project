<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { mono, label, panel, panelHead, field, btnDark, btnGhost, h1, sub } from '../ui';
  import { SESSIONS } from '../subscription';
  import { initials } from '../data';
  import { relative } from '../adapters';
  import {
    ApiError, fetchProfile, fetchSessions, getAccessToken, requestOwnPasswordReset, saveProfile, setNotification, signOutOtherSessions,
    type Profile
  } from '../api';
  import type { Session } from '../types';

  const dispatch = createEventDispatcher<{ notify: string; billing: void; renamed: string }>();

  // Without a session the screen shows demo values; once signed in everything comes from the API.
  const live = (): boolean => !!getAccessToken();
  let profile: Profile | null = null;
  let busy = false;

  let name = 'Avery Mercer';
  let email = 'a.mercer@ordinal.io';
  let jobTitle = 'Head of Platform Engineering';
  let timezone = 'Europe/London';
  let roleBadge = 'org:admin';
  let dirty = false;

  const TIMEZONES = ['Europe/London', 'Europe/Stockholm', 'America/New_York', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai', 'Australia/Sydney'];

  interface Pref {
    key: string;
    title: string;
    note: string;
    on: boolean;
  }

  let prefs: Pref[] = [
    { key: 'weeklyDigest', title: 'Weekly access digest', note: 'Monday summary of role changes and MFA gaps.', on: true },
    { key: 'riskAlerts', title: 'Risk alerts', note: 'Immediate email when an admin account loses MFA.', on: true },
    { key: 'bidReminders', title: 'Bid deadline reminders', note: 'Three days before any bid you own is due.', on: true },
    { key: 'productNews', title: 'Product news', note: 'Occasional release notes. No more than monthly.', on: false }
  ];

  let sessions: Session[] = SESSIONS;
  let security: Array<[string, string]> = [['Password', 'changed 31 days ago'], ['MFA', 'WebAuthn + TOTP'], ['Recovery codes', '8 of 10 unused']];

  function apply(p: Profile): void {
    profile = p;
    name = p.name;
    email = p.email;
    jobTitle = p.jobTitle;
    timezone = p.timezone;
    roleBadge = p.role;
    prefs = p.notifications;
    security = [
      ['Password', p.security.passwordChangedAt ? 'changed ' + relative(p.security.passwordChangedAt) : 'not set'],
      ['MFA', p.security.mfaMethod ?? 'not enrolled'],
      ['Recovery codes', p.security.recoveryCodesLeft === null ? 'not generated' : p.security.recoveryCodesLeft + ' of 10 unused']
    ];
    dirty = false;
  }

  async function loadSessions(): Promise<void> {
    const rows = await fetchSessions().catch(() => null);
    if (rows) {
      sessions = rows.map((s) => ({
        device: s.device,
        location: s.location ?? '—',
        ip: s.ip ?? '—',
        lastSeen: s.current ? 'this device' : relative(s.lastUsedAt),
        current: s.current
      }));
    }
  }

  onMount(async () => {
    if (!live()) return;
    const p = await fetchProfile().catch(() => null);
    if (p) apply(p);
    await loadSessions();
  });

  const fail = (err: unknown, fallback: string) => dispatch('notify', err instanceof ApiError ? err.message : fallback);

  const togglePref = async (key: string): Promise<void> => {
    const current = prefs.find((x) => x.key === key);
    if (!current) return;
    prefs = prefs.map((x) => (x.key === key ? { ...x, on: !x.on } : x));
    if (!live()) return void dispatch('notify', 'Notification preferences saved');
    try {
      apply(await setNotification(key, !current.on));
      dispatch('notify', 'Notification preferences saved');
    } catch (err) {
      prefs = prefs.map((x) => (x.key === key ? { ...x, on: current.on } : x));
      fail(err, 'Could not save that preference');
    }
  };

  const discard = (): void => {
    if (profile) apply(profile);
    else dirty = false;
  };

  const save = async (): Promise<void> => {
    if (!live()) {
      dirty = false;
      return void dispatch('notify', 'Profile saved');
    }
    busy = true;
    try {
      const { profile: p, message } = await saveProfile({ name, email, jobTitle, timezone });
      apply(p);
      dispatch('renamed', p.name);
      dispatch('notify', message ?? 'Profile saved');
    } catch (err) {
      fail(err, 'Could not save your profile');
    } finally {
      busy = false;
    }
  };

  const changePassword = async (): Promise<void> => {
    if (!live()) return void dispatch('notify', 'Password reset email sent');
    try {
      dispatch('notify', (await requestOwnPasswordReset()) ?? 'Password reset email sent');
    } catch (err) {
      fail(err, 'Could not send a reset link');
    }
  };

  const signOutOthers = async (): Promise<void> => {
    if (!live()) return void dispatch('notify', 'Signed out of 2 other sessions');
    try {
      dispatch('notify', (await signOutOtherSessions()) ?? 'Signed out of other sessions');
      await loadSessions();
    } catch (err) {
      fail(err, 'Could not sign out other sessions');
    }
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
        <span style="{mono} font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; border: 1px solid var(--line); padding: 2px 8px; border-radius: 2px; color: #4a5250;">{roleBadge}</span>
      </div>
      <div style="{mono} font-size: 12px; color: var(--muted); margin-top: 5px;">{email}{jobTitle ? ' · ' + jobTitle : ''}</div>
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
              {#each TIMEZONES as tz (tz)}<option value={tz}>{tz}</option>{/each}
            </select>
          </label>
        </div>
        <div style="padding: 14px 18px; border-top: 1px solid var(--line); background: #fafbfa; display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn-ghost" style={btnGhost} on:click={discard}>Discard</button>
          <button type="button" class="btn-dark" style="{btnDark}{busy ? ' opacity: 0.6; cursor: wait;' : ''}" disabled={busy} on:click={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>

      <div style={panel}>
        <div style={panelHead}>Notifications</div>
        {#each prefs as pref (pref.key)}
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
              on:click={() => togglePref(pref.key)}
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
          <button type="button" class="link-btn" on:click={signOutOthers} style="{mono} background: none; border: none; padding: 0; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); cursor: pointer;">Sign out others</button>
        </div>
        {#each sessions as s, i (s.ip + s.device + i)}
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
          {#each security as [k, v] (k)}
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 11px 0; border-bottom: 1px solid var(--hair); font-size: 13px;">
              <span>{k}</span>
              <span style="{mono} font-size: 11.5px; color: var(--muted);">{v}</span>
            </div>
          {/each}
          <div style="display: flex; gap: 8px; padding-top: 14px;">
            <button type="button" class="btn-ghost" style="{btnGhost} flex: 1;" on:click={changePassword}>Change password</button>
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
