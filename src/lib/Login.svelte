<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label, btnDark, btnGhost } from '../ui';
  import Field from './Field.svelte';
  import { runSchema, visible, errorCount, required, email, minLen, type Schema } from '../validation';

  import { login, ApiError, type SessionUser } from '../api';

  const dispatch = createEventDispatcher<{ signin: SessionUser; demo: void; signup: void; notify: string }>();

  type Credentials = { email: string; password: string };
  // Prefilled with the seeded developer account.
  let creds: Credentials = { email: 'a.mercer@ordinal.io', password: 'ordinal-dev-password' };

  let busy = false;
  let serverError: string | null = null;
  let serverFields: Record<string, string> = {};

  let touched: Record<string, boolean> = {};
  let submitted = false;
  const touch = (key: string) => (): void => { touched = { ...touched, [key]: true }; };
  const set = (key: keyof Credentials) => (e: Event): void => {
    creds = { ...creds, [key]: (e.currentTarget as HTMLInputElement).value };
  };

  const schema: Schema<Credentials> = {
    email: [required('Enter your work email'), email()],
    password: [required('Enter your password'), minLen(8, 'At least 8 characters')]
  };

  $: errors = runSchema(creds, schema);
  // Server-side field errors sit alongside the client ones and win, being more authoritative.
  $: shown = { ...visible(errors, touched, submitted), ...serverFields };
  $: valid = errorCount(errors) === 0;

  const signIn = async (): Promise<void> => {
    submitted = true;
    serverError = null;
    serverFields = {};
    if (!valid || busy) return;

    busy = true;
    try {
      const session = await login(creds.email, creds.password);
      dispatch('signin', session.user);
    } catch (err) {
      if (err instanceof ApiError) {
        serverError = err.message;
        serverFields = err.fields;
      } else {
        serverError = 'Something went wrong signing in';
      }
    } finally {
      busy = false;
    }
  };

  // SSO is not implemented server-side yet; it drops into the local demo data.
  const ssoSignIn = (): void => dispatch('demo');

  const STATUS: [string, string, string][] = [
    ['Identity provider', 'operational', '#4ecfae'],
    ['Directory sync', 'operational', '#4ecfae'],
    ['Audit pipeline', 'degraded — 4m lag', '#e0a94a']
  ];
</script>

<div style="min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr;">
  <div style="display: flex; flex-direction: column; justify-content: center; padding: 0 clamp(32px, 8vw, 128px); background: #fff; border-right: 1px solid var(--line);">
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 56px;">
      <div style="width: 22px; height: 22px; background: var(--accent);"></div>
      <span style="{mono} font-size: 13px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;">Ordinal / Console</span>
    </div>

    <h1 style="font-size: 30px; line-height: 1.15; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px;">Sign in to the admin console</h1>
    <p style="font-size: 14px; line-height: 1.6; color: var(--muted); margin: 0 0 36px; max-width: 40ch;">
      SSO is enforced for all engineering and IT administrators. Local credentials are audited.
    </p>

    <form on:submit|preventDefault={signIn} style="display: flex; flex-direction: column; gap: 18px; max-width: 380px;">
      <Field
        label="Work email"
        type="email"
        monoFont
        height="42px"
        value={creds.email}
        error={shown.email ?? null}
        on:input={set('email')}
        on:blur={touch('email')}
      />
      <Field
        label="Password"
        type="password"
        monoFont
        height="42px"
        value={creds.password}
        error={shown.password ?? null}
        on:input={set('password')}
        on:blur={touch('password')}
      />

      <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 2px;">
        <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted);">
          <input type="checkbox" checked style="accent-color: var(--accent); width: 14px; height: 14px;" />
          Trust this device for 30 days
        </label>
        <a href="#recover">Recover access</a>
      </div>

      {#if serverError}
        <div style="padding: 10px 12px; border: 1px solid #e6c4c4; background: #fdf5f5; border-radius: 3px; font-size: 12.5px; color: #932f2f; line-height: 1.5;">
          {serverError}
          {#if serverError.startsWith('Cannot reach')}
            <button type="button" on:click={() => dispatch('demo')} style="display: block; margin-top: 7px; background: none; border: none; padding: 0; font: inherit; color: #932f2f; text-decoration: underline; cursor: pointer;">Continue with demo data instead</button>
          {/if}
        </div>
      {/if}

      <button class="btn-dark" type="submit" disabled={busy} style="{btnDark} height: 44px; font-size: 14px; margin-top: 10px;{busy ? ' opacity: 0.6; cursor: wait;' : ''}">
        {busy ? 'Signing in…' : 'Continue'}
      </button>
      <button class="btn-ghost" type="button" on:click={ssoSignIn} style="{btnGhost} height: 44px; font-size: 14px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span style="width: 12px; height: 12px; border: 2px solid var(--accent); border-radius: 2px; display: inline-block;"></span>
        Continue with Okta SSO
      </button>
    </form>

    <p style="font-size: 13px; color: var(--muted); margin: 26px 0 0;">
      New to Ordinal?
      <button type="button" class="link-btn" on:click={() => dispatch('signup')} style="background: none; border: none; padding: 0; font: inherit; color: var(--accent); cursor: pointer;">Create a workspace</button>
    </p>
    <p style="{mono} font-size: 11px; color: var(--faint); margin: 34px 0 0; letter-spacing: 0.04em;">build 2026.8.1 · region us-east-1 · mfa required</p>
  </div>

  <div style="background: var(--ink); padding: clamp(32px, 6vw, 88px); display: flex; flex-direction: column; justify-content: center; gap: 28px;">
    <div style="{mono} font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #6f7a76;">Platform status</div>
    <div style="display: flex; flex-direction: column; gap: 1px; background: #262b2c; border: 1px solid #262b2c;">
      {#each STATUS as [name, state, color]}
        <div style="background: #191d1e; padding: 16px 18px; display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 13px; color: #d6dbd9;">{name}</span>
          <span style="{mono} font-size: 12px; color: {color};">{state}</span>
        </div>
      {/each}
    </div>
    <p style="font-size: 13px; line-height: 1.7; color: #8e9793; margin: 0; max-width: 44ch;">
      Access to this console is limited to accounts holding the <span style="{mono} color: #d6dbd9;">org:admin</span> scope. All sessions are recorded.
    </p>
  </div>
</div>
