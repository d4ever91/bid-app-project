<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label, field, btnDark, btnGhost } from '../ui';
  import Field from './Field.svelte';
  import { runSchema, visible, errorCount, required, email, domain, minLen, maxLen, type Schema } from '../validation';
  import { PLANS as FALLBACK_PLANS, seatPrice, money } from '../subscription';
  import {
    COMPANY_TYPES, COMPANY_SIZES, SIGNUP_ROLES, BID_SECTORS, BID_VOLUMES,
    type BillingCycle, type CompanyProfile, type Plan, type PlanId, type SignupDraft
  } from '../types';
  import { onMount } from 'svelte';

  import { signup, fetchPlans, ApiError, type SessionUser } from '../api';

  const dispatch = createEventDispatcher<{
    created: { draft: SignupDraft; user: SessionUser | null };
    signin: void;
    notify: string;
  }>();

  let busy = false;
  let serverError: string | null = null;
  let serverFields: Record<string, string> = {};

  const FIELDS = [
    { key: 'workspace', label: 'Workspace name *', ph: 'Ordinal', type: 'text', mono: false },
    { key: 'domain', label: 'Company domain *', ph: 'ordinal.io', type: 'text', mono: true },
    { key: 'name', label: 'Your full name *', ph: 'Avery Mercer', type: 'text', mono: false },
    { key: 'email', label: 'Work email *', ph: 'a.mercer@ordinal.io', type: 'email', mono: true },
    { key: 'password', label: 'Password *', ph: 'At least 12 characters', type: 'password', mono: true }
  ] as const;

  const BENEFITS = [
    ['Directory sync in under an hour', 'Okta, Entra and Google Workspace connectors ship with every plan.'],
    ['Access posture you can hand an auditor', 'MFA coverage, role distribution and a tamper-evident audit trail.'],
    ['Bid workspace for regulated tenders', 'Track submissions, checklists and win rates alongside access.']
  ];

  let step = 1;
  let draft: SignupDraft = {
    workspace: '', domain: '', name: '', email: '', password: '',
    companyType: 'Consultancy', size: '51–200', role: '', country: '', sectors: [], bidVolume: '',
    plan: 'business', accept: false
  };

  /** Single-choice answer: clicking sets the value and marks the question answered. */
  const pick = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => (): void => {
    draft = { ...draft, [key]: value };
    touched = { ...touched, [key]: true };
  };

  /** Multi-choice answer: toggles the value in or out of the list. */
  const toggle = (key: 'sectors', value: string) => (): void => {
    const list = draft[key];
    draft = { ...draft, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    touched = { ...touched, [key]: true };
  };

  // Billing selections live outside the draft — they're the payment step, not the profile.
  let cycle: BillingCycle = 'annual';
  let seats = 10;
  let billing: 'trial' | 'paid' = 'trial';

  /**
   * The plan catalogue is authoritative on the server (it prices the Stripe line items),
   * so fetch it and fall back to the local copy only if the API is unreachable.
   */
  let plans: Plan[] = FALLBACK_PLANS;
  onMount(async () => {
    try {
      plans = await fetchPlans();
    } catch {
      // Offline/demo mode — local fixtures are already loaded.
    }
  });

  // Svelte 4 can't parse TypeScript inside markup, so casts live in these handlers.
  const setCycle = (id: string): void => { cycle = id as BillingCycle; };
  const setBilling = (id: string): void => { billing = id as 'trial' | 'paid'; };
  const onSeatsInput = (e: Event): void => {
    const n = parseInt((e.currentTarget as HTMLInputElement).value.replace(/\D/g, ''), 10);
    seats = Number.isNaN(n) ? 1 : Math.min(seatCeiling, Math.max(1, n));
  };

  const pickPlan = (id: PlanId): void => {
    draft = { ...draft, plan: id };
    const cap = plans.find((p) => p.id === id)?.seatCap;
    if (cap && seats > cap) seats = cap;
  };

  $: chosen = plans.find((p) => p.id === draft.plan) ?? plans[0];
  $: unitPrice = chosen ? seatPrice(chosen, cycle) : 0;
  $: dueToday = billing === 'trial' ? 0 : unitPrice * seats;
  $: seatCeiling = chosen?.seatCap ?? 5000;
  // Annual is billed as 10 months of the monthly rate in this catalogue.
  $: annualSaving = chosen ? chosen.monthly * 12 - chosen.annual : 0;

  const val = (key: string): string => String(draft[key as keyof SignupDraft] ?? '');
  const set = (key: string) => (e: Event) => {
    draft = { ...draft, [key]: (e.currentTarget as HTMLInputElement).value };
  };

  let touched: Record<string, boolean> = {};
  let submitted = false;
  const touch = (key: string) => (): void => { touched = { ...touched, [key]: true }; };

  // Step 1 — the account.
  const accountSchema: Schema<SignupDraft> = {
    workspace: [required('Name your workspace'), minLen(2), maxLen(40)],
    domain: [required('Your company domain is required'), domain()],
    name: [required('Enter your full name'), minLen(2), maxLen(80)],
    email: [required('A work email is required'), email()],
    password: [required('Choose a password'), minLen(12, 'At least 12 characters'), maxLen(128)]
  };

  // Step 2 — the company questions.
  const companySchema: Schema<SignupDraft> = {
    role: [required('Tell us your role')],
    country: [required('Where is your company based?'), maxLen(60)],
    sectors: [required('Pick at least one sector')],
    bidVolume: [required('Pick a range')]
  };

  const COMPANY_KEYS = ['companyType', 'size', ...Object.keys(companySchema)];

  $: accountErrors = runSchema(draft, accountSchema);
  $: companyErrors = runSchema(draft, companySchema);
  $: errors = step === 1 ? accountErrors : step === 2 ? companyErrors : {};
  $: shown = { ...visible(errors, touched, submitted), ...serverFields };
  $: stepValid = errorCount(errors) === 0;

  const next = (): void => {
    submitted = true;
    if (!stepValid) return;
    submitted = false;
    step += 1;
  };

  const back = (): void => {
    submitted = false;
    step = Math.max(1, step - 1);
  };

  const create = async (): Promise<void> => {
    if (!draft.accept) {
      dispatch('notify', 'Accept the terms to create your workspace');
      return;
    }
    if (busy) return;

    busy = true;
    serverError = null;
    serverFields = {};

    const company: CompanyProfile = {
      companyType: draft.companyType,
      size: draft.size,
      role: draft.role,
      country: draft.country.trim(),
      sectors: draft.sectors,
      bidVolume: draft.bidVolume
    };

    try {
      const session = await signup({
        workspace: draft.workspace.trim(),
        domain: draft.domain.trim().toLowerCase(),
        name: draft.name.trim(),
        email: draft.email.trim().toLowerCase(),
        password: draft.password,
        size: draft.size,
        companyType: draft.companyType,
        company,
        plan: draft.plan,
        cycle,
        seats,
        billing
      });

      // A paid signup must finish at Stripe before the workspace is active.
      if (session.checkoutUrl) {
        window.location.href = session.checkoutUrl;
        return;
      }

      dispatch('created', { draft, user: session.user });
    } catch (err) {
      if (err instanceof ApiError) {
        serverError = err.message;
        serverFields = err.fields;
        // Send the user back to whichever step holds the rejected field.
        const keys = Object.keys(err.fields).map((k) => k.replace(/^company\./, ''));
        if (keys.length) {
          serverFields = Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^company\./, ''), v]));
          submitted = true;
          step = keys.some((k) => k in accountSchema) ? 1 : keys.some((k) => COMPANY_KEYS.includes(k)) ? 2 : step;
        }
      } else {
        serverError = 'Something went wrong creating your workspace';
      }
    } finally {
      busy = false;
    }
  };

  /** Escape hatch when the API isn't running — proceed against local demo data. */
  const createOffline = (): void => dispatch('created', { draft, user: null });

  $: steps = [
    { n: '1', text: 'Your account', on: step >= 1 },
    { n: '2', text: 'Your company', on: step >= 2 },
    { n: '3', text: 'Choose a plan', on: step >= 3 }
  ];

  // Shared chip styling for the question step.
  const chip = (on: boolean): string =>
    `padding: 7px 13px; border: 1px solid ${on ? 'var(--ink)' : 'var(--line)'}; background: ${on ? 'var(--ink)' : '#fff'}; color: ${on ? '#fff' : 'var(--muted)'}; border-radius: 3px; font-size: 12.5px; cursor: pointer;`;
  const errText = `${mono} font-size: 11px; color: #932f2f; letter-spacing: 0.02em; margin-top: 7px;`;
</script>

<div style="min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);">
  <div style="background: #fff; border-right: 1px solid var(--line); padding: clamp(28px, 5vw, 64px) clamp(28px, 6vw, 88px); display: flex; flex-direction: column;">
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 34px;">
      <div style="width: 22px; height: 22px; background: var(--accent);"></div>
      <span style="{mono} font-size: 13px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;">Ordinal / Console</span>
    </div>

    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 30px;">
      {#each steps as s (s.n)}
        <div style="display: flex; align-items: center; gap: 9px;">
          <span style="{mono} width: 22px; height: 22px; border-radius: 50%; border: 1px solid {s.on ? 'var(--accent)' : 'var(--line)'}; background: {s.on ? 'var(--accent)' : '#fff'}; color: {s.on ? '#fff' : 'var(--faint)'}; font-size: 11px; display: flex; align-items: center; justify-content: center;">{s.n}</span>
          <span style="{mono} font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: {s.on ? 'var(--ink)' : 'var(--faint)'};">{s.text}</span>
        </div>
      {/each}
    </div>

    {#if step === 1}
      <div style="max-width: 520px;">
        <h1 style="font-size: 28px; line-height: 1.18; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px;">Start your 14-day trial</h1>
        <p style="font-size: 14px; line-height: 1.6; color: var(--muted); margin: 0 0 28px;">
          No card required. Invite your team once the workspace is up — every plan includes unlimited admins.
        </p>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
          {#each FIELDS as f (f.key)}
            <Field
              label={f.label}
              type={f.type}
              placeholder={f.ph}
              value={val(f.key)}
              monoFont={f.mono}
              height="38px"
              hint={f.key === 'password' ? 'minimum 12 characters' : ''}
              error={shown[f.key] ?? null}
              on:input={set(f.key)}
              on:blur={touch(f.key)}
            />
          {/each}
        </div>

        {#if submitted && !stepValid}
          <div style="margin-top: 20px; padding: 10px 12px; border: 1px solid #e6c4c4; background: #fdf5f5; border-radius: 3px; font-size: 12.5px; color: #932f2f; max-width: 460px;">
            {errorCount(errors) === 1 ? 'One field needs attention' : errorCount(errors) + ' fields need attention'} before you can continue.
          </div>
        {/if}

        <button type="button" class="btn-dark" on:click={next} style="{btnDark} margin-top: 26px; height: 44px; width: 100%; max-width: 240px; font-size: 14px;">Continue</button>

        <p style="font-size: 13px; color: var(--muted); margin: 22px 0 0;">
          Already have a workspace?
          <button type="button" class="link-btn" on:click={() => dispatch('signin')} style="background: none; border: none; padding: 0; font: inherit; color: var(--accent); cursor: pointer;">Sign in</button>
        </p>
      </div>
    {:else if step === 2}
      <div style="max-width: 520px;">
        <h1 style="font-size: 28px; line-height: 1.18; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px;">About your company</h1>
        <p style="font-size: 14px; line-height: 1.6; color: var(--muted); margin: 0 0 28px;">
          A few quick questions so we can set up your workspace.
        </p>

        <div style="display: flex; flex-direction: column; gap: 22px;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
            <label style="display: flex; flex-direction: column; gap: 7px; min-width: 0;">
              <span style={label}>Your role</span>
              <select
                class="field"
                value={draft.role}
                aria-invalid={!!shown.role}
                on:change={set('role')}
                on:blur={touch('role')}
                style="{field} height: 38px; padding: 0 9px; cursor: pointer;{shown.role ? ' border-color: #c86b6b; background: #fdf7f7;' : ''}{draft.role ? '' : ' color: var(--faint);'}"
              >
                <option value="" disabled>Select…</option>
                {#each SIGNUP_ROLES as r (r)}<option value={r}>{r}</option>{/each}
              </select>
              {#if shown.role}<span style="{mono} font-size: 11px; color: #932f2f; letter-spacing: 0.02em;">{shown.role}</span>{/if}
            </label>
            <Field
              label="Country"
              placeholder="India"
              value={draft.country}
              height="38px"
              error={shown.country ?? null}
              on:input={set('country')}
              on:blur={touch('country')}
            />
          </div>

          <fieldset style="border: none; padding: 0; margin: 0;">
            <legend style="{label} margin-bottom: 9px; padding: 0;">Company type</legend>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              {#each COMPANY_TYPES as t (t)}
                <button type="button" aria-pressed={draft.companyType === t} on:click={pick('companyType', t)} style={chip(draft.companyType === t)}>{t}</button>
              {/each}
            </div>
          </fieldset>

          <fieldset style="border: none; padding: 0; margin: 0;">
            <legend style="{label} margin-bottom: 9px; padding: 0;">Employees</legend>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              {#each COMPANY_SIZES as z (z)}
                <button type="button" aria-pressed={draft.size === z} on:click={pick('size', z)} style={chip(draft.size === z)}>{z}</button>
              {/each}
            </div>
          </fieldset>

          <fieldset style="border: none; padding: 0; margin: 0;">
            <legend style="{label} margin-bottom: 9px; padding: 0;">Sectors you bid into</legend>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              {#each BID_SECTORS as s (s)}
                <button type="button" aria-pressed={draft.sectors.includes(s)} on:click={toggle('sectors', s)} style={chip(draft.sectors.includes(s))}>{s}</button>
              {/each}
            </div>
            {#if shown.sectors}<div style={errText}>{shown.sectors}</div>{/if}
          </fieldset>

          <fieldset style="border: none; padding: 0; margin: 0;">
            <legend style="{label} margin-bottom: 9px; padding: 0;">Bids per year</legend>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              {#each BID_VOLUMES as v (v)}
                <button type="button" aria-pressed={draft.bidVolume === v} on:click={pick('bidVolume', v)} style={chip(draft.bidVolume === v)}>{v}</button>
              {/each}
            </div>
            {#if shown.bidVolume}<div style={errText}>{shown.bidVolume}</div>{/if}
          </fieldset>
        </div>

        {#if submitted && !stepValid}
          <div style="margin-top: 20px; padding: 10px 12px; border: 1px solid #e6c4c4; background: #fdf5f5; border-radius: 3px; font-size: 12.5px; color: #932f2f; max-width: 460px;">
            {errorCount(errors) === 1 ? 'One question needs an answer' : errorCount(errors) + ' questions need an answer'} before you can continue.
          </div>
        {/if}

        <div style="display: flex; gap: 8px; margin-top: 26px;">
          <button type="button" class="btn-ghost" on:click={back} style="{btnGhost} height: 44px; padding: 0 18px; font-size: 14px;">Back</button>
          <button type="button" class="btn-dark" on:click={next} style="{btnDark} height: 44px; padding: 0 22px; font-size: 14px;">Continue</button>
        </div>
      </div>
    {:else}
      <div style="max-width: 620px;">
        <h1 style="font-size: 28px; line-height: 1.18; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px;">Choose a plan</h1>
        <p style="font-size: 14px; line-height: 1.6; color: var(--muted); margin: 0 0 22px;">
          {billing === 'trial'
            ? 'Nothing is charged for 14 days, and you can change plan at any point during the trial.'
            : 'Billed through Stripe. Change plan or seat count at any time from Subscription.'}
        </p>

        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px; flex-wrap: wrap;">
          <div style="display: flex; border: 1px solid var(--line); border-radius: 3px; overflow: hidden;">
            {#each [['monthly', 'Monthly'], ['annual', 'Annual']] as [id, text] (id)}
              <button
                type="button"
                on:click={() => setCycle(id)}
                style="{mono} padding: 7px 13px; border: none; background: {cycle === id ? 'var(--ink)' : '#fff'}; color: {cycle === id ? '#fff' : 'var(--muted)'}; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer;"
              >{text}</button>
            {/each}
          </div>
          {#if cycle === 'annual' && annualSaving > 0}
            <span style="{mono} font-size: 11px; color: var(--accent); letter-spacing: 0.04em;">saves {money(annualSaving)} per seat per year</span>
          {/if}
        </div>

        <div style="display: flex; flex-direction: column; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 3px;">
          {#each plans as p (p.id)}
            <div
              role="radio"
              aria-checked={draft.plan === p.id}
              tabindex="0"
              on:click={() => pickPlan(p.id)}
              on:keydown={(e) => e.key === 'Enter' && pickPlan(p.id)}
              style="background: {draft.plan === p.id ? '#f4f8f7' : '#fff'}; padding: 15px 16px; display: flex; gap: 12px; align-items: flex-start; cursor: pointer;"
            >
              <span style="width: 15px; height: 15px; flex: none; margin-top: 3px; border-radius: 50%; border: 1px solid {draft.plan === p.id ? 'var(--accent)' : '#c3c8c9'}; background: {draft.plan === p.id ? 'var(--accent)' : '#fff'}; box-shadow: {draft.plan === p.id ? 'inset 0 0 0 2px #fff' : 'none'};"></span>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                  <span style="font-size: 14.5px; font-weight: 600;">{p.name}</span>
                  <span style="{mono} font-size: 12px; color: var(--muted);">{money(seatPrice(p, cycle))} per seat / {cycle === 'annual' ? 'year' : 'month'}</span>
                </div>
                <div style="font-size: 12.5px; color: var(--muted); margin-top: 4px;">{p.blurb}</div>
                <div style="{mono} font-size: 11px; color: var(--faint); margin-top: 6px;">{p.seatCap ? 'up to ' + p.seatCap + ' seats' : 'unlimited seats'}</div>
              </div>
            </div>
          {/each}
        </div>

        <div style="margin-top: 22px; border: 1px solid var(--line); border-radius: 3px; background: #fff;">
          <div style="padding: 14px 16px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
            <div>
              <div style="font-size: 13.5px; font-weight: 600;">Seats</div>
              <div style="font-size: 12.5px; color: var(--muted); margin-top: 2px;">
                {chosen?.seatCap ? 'Up to ' + chosen.seatCap + ' on ' + chosen.name : 'Unlimited on ' + (chosen?.name ?? '')} · add more later
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 1px; border: 1px solid var(--line); border-radius: 3px; overflow: hidden;">
              <button type="button" aria-label="Fewer seats" on:click={() => (seats = Math.max(1, seats - 5))} style="width: 34px; height: 34px; border: none; background: #fff; color: var(--muted); font-size: 15px; cursor: pointer;">−</button>
              <input
                type="text"
                inputmode="numeric"
                value={seats}
                on:input={onSeatsInput}
                style="{mono} width: 62px; height: 34px; border: none; text-align: center; font-size: 13px; outline: none;"
              />
              <button type="button" aria-label="More seats" on:click={() => (seats = Math.min(seatCeiling, seats + 5))} style="width: 34px; height: 34px; border: none; background: #fff; color: var(--muted); font-size: 15px; cursor: pointer;">+</button>
            </div>
          </div>

          <div style="display: flex; flex-direction: column;">
            {#each [['trial', '14-day free trial', 'No card required. We will remind you before it ends.'], ['paid', 'Pay now', 'Card details are taken on the next screen, hosted by Stripe.']] as [id, title, note] (id)}
              <button
                type="button"
                on:click={() => setBilling(id)}
                style="text-align: left; border: none; border-bottom: 1px solid var(--line); background: {billing === id ? '#f4f8f7' : '#fff'}; padding: 13px 16px; display: flex; gap: 11px; align-items: flex-start; cursor: pointer;"
              >
                <span style="width: 15px; height: 15px; flex: none; margin-top: 2px; border-radius: 50%; border: 1px solid {billing === id ? 'var(--accent)' : '#c3c8c9'}; background: {billing === id ? 'var(--accent)' : '#fff'}; box-shadow: {billing === id ? 'inset 0 0 0 2px #fff' : 'none'};"></span>
                <span>
                  <span style="display: block; font-size: 13.5px; font-weight: 500;">{title}</span>
                  <span style="display: block; font-size: 12.5px; color: var(--muted); margin-top: 2px;">{note}</span>
                </span>
              </button>
            {/each}
          </div>

          <div style="padding: 14px 16px; background: #fafbfa; display: flex; flex-direction: column; gap: 7px;">
            <div style="display: flex; justify-content: space-between; font-size: 13px; color: var(--muted);">
              <span>{chosen?.name} · {seats} {seats === 1 ? 'seat' : 'seats'} · {cycle}</span>
              <span style={mono}>{money(unitPrice)} × {seats}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; font-weight: 600;">
              <span>Due today</span>
              <span style="{mono} font-size: 16px;">{money(dueToday)}</span>
            </div>
            {#if billing === 'trial'}
              <div style="{mono} font-size: 11px; color: var(--faint); letter-spacing: 0.02em;">
                then {money(unitPrice * seats)} per {cycle === 'annual' ? 'year' : 'month'} from day 15
              </div>
            {/if}
          </div>
        </div>

        <button
          type="button"
          on:click={() => (draft = { ...draft, accept: !draft.accept })}
          style="margin-top: 20px; background: none; border: none; padding: 0; display: flex; align-items: flex-start; gap: 9px; font-size: 13px; line-height: 1.55; color: var(--muted); cursor: pointer; text-align: left;"
        >
          <span style="width: 15px; height: 15px; flex: none; margin-top: 2px; border-radius: 2px; border: 1px solid {draft.accept ? 'var(--accent)' : '#c3c8c9'}; background: {draft.accept ? 'var(--accent)' : '#fff'}; color: #fff; font-size: 10px; line-height: 1; display: flex; align-items: center; justify-content: center;">{draft.accept ? '✓' : ''}</span>
          <span>I accept the terms of service and the data processing addendum on behalf of my organisation.</span>
        </button>

        {#if serverError}
          <div style="margin-top: 20px; padding: 10px 12px; border: 1px solid #e6c4c4; background: #fdf5f5; border-radius: 3px; font-size: 12.5px; color: #932f2f; line-height: 1.5; max-width: 460px;">
            {serverError}
            {#if serverError.startsWith('Cannot reach')}
              <button type="button" on:click={createOffline} style="display: block; margin-top: 7px; background: none; border: none; padding: 0; font: inherit; color: #932f2f; text-decoration: underline; cursor: pointer;">Continue with demo data instead</button>
            {/if}
          </div>
        {/if}

        <div style="display: flex; gap: 8px; margin-top: 26px;">
          <button type="button" class="btn-ghost" on:click={back} style="{btnGhost} height: 44px; padding: 0 18px; font-size: 14px;">Back</button>
          <button type="button" class="btn-dark" disabled={busy} on:click={create} style="{btnDark} height: 44px; padding: 0 20px; font-size: 14px;{busy ? ' opacity: 0.6; cursor: wait;' : ''}">
            {busy ? 'Creating…' : billing === 'paid' ? 'Continue to payment' : 'Start free trial'}
          </button>
        </div>
      </div>
    {/if}

    <p style="{mono} font-size: 11px; color: var(--faint); margin: auto 0 0; padding-top: 34px; letter-spacing: 0.04em;">soc 2 type ii · iso 27001 · data resident in eu-west</p>
  </div>

  <div style="background: var(--ink); padding: clamp(28px, 5vw, 72px); display: flex; flex-direction: column; justify-content: center; gap: 30px;">
    <div style="{mono} font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #6f7a76;">What you get on day one</div>
    <div style="display: flex; flex-direction: column; gap: 18px;">
      {#each BENEFITS as [title, note] (title)}
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <span style="color: #4ecfae; font-size: 13px; line-height: 1.5;">✓</span>
          <div>
            <div style="font-size: 14px; color: #fff;">{title}</div>
            <div style="font-size: 12.5px; line-height: 1.6; color: #8e9793; margin-top: 3px;">{note}</div>
          </div>
        </div>
      {/each}
    </div>

    <div style="border: 1px solid #262b2c; background: #191d1e; padding: 18px; border-radius: 3px;">
      <p style="font-size: 13.5px; line-height: 1.7; color: #d6dbd9; margin: 0 0 12px;">"We cut joiner-mover-leaver from four days to under an hour, and the audit pack writes itself."</p>
      <div style="{mono} font-size: 11px; color: #6f7a76;">IT Director · 480-seat logistics group</div>
    </div>
  </div>
</div>
