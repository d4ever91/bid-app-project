<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label, panel, panelHead, btnDark, btnGhost, h1, sub } from '../ui';
  import {
    PLANS, CURRENT_PLAN, CURRENT_CYCLE, SEATS_LICENSED, SEATS_USED, RENEWAL_DATE,
    CARD_LABEL, CARD_EXPIRY, BILLING_EMAIL, BILLING_ADDRESS, VAT_NUMBER,
    USAGE, INVOICES, money, planById, seatPrice, contractTotal
  } from '../subscription';
  import type { BillingCycle, InvoiceStatus, PlanId } from '../types';

  import { changePlan, startCheckout, openBillingPortal, fetchSubscription, fetchInvoices, ApiError, getAccessToken } from '../api';
  import { onMount } from 'svelte';

  const dispatch = createEventDispatcher<{ notify: string }>();

  // Without a live session the screen runs on fixtures and skips network calls.
  const live = (): boolean => !!getAccessToken();
  let busy = false;

  let planId: PlanId = CURRENT_PLAN;

  /** Server state overrides the fixtures once a session exists. */
  let liveSeatsUsed: number | null = null;
  let liveSeatsLicensed: number | null = null;
  let liveStatus: string | null = null;
  let liveInvoices: Array<{ id: string; period: string | null; amount: number; status: string | null }> | null = null;

  onMount(async () => {
    if (!live()) return;
    try {
      const state = await fetchSubscription();
      planId = state.plan.id;
      cycle = state.cycle;
      liveSeatsUsed = state.seatsUsed;
      liveSeatsLicensed = state.seatsLicensed;
      liveStatus = state.status;
    } catch {
      // Fixtures already render; a failure here is not worth interrupting the screen.
    }
    liveInvoices = await fetchInvoices().then((r) => r.items).catch(() => null);
  });
  let cycle: BillingCycle = CURRENT_CYCLE;

  const STATUS_COLOR: Record<InvoiceStatus, string> = { Paid: 'var(--accent)', Open: '#8a5a10', Failed: '#b23a3a' };
  const CYCLES: BillingCycle[] = ['monthly', 'annual'];

  const choosePlan = (id: PlanId): void => {
    if (id === planId) return;
    const from = planById(planId).name;
    planId = id;

    if (!live()) {
      dispatch('notify', 'Plan change queued — ' + from + ' → ' + planById(id).name + ', effective at renewal');
      return;
    }

    void (async () => {
      busy = true;
      try {
        const message = await changePlan(id, cycle, SEATS_LICENSED);
        dispatch('notify', message ?? 'Plan updated to ' + planById(id).name);
      } catch (err) {
        planId = CURRENT_PLAN;
        dispatch('notify', err instanceof ApiError ? err.message : 'Could not change plan');
      } finally {
        busy = false;
      }
    })();
  };

  /** Sends the user to Stripe Checkout for the currently selected plan and cycle. */
  const checkout = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const url = await startCheckout(planId, cycle, SEATS_LICENSED);
      if (url) window.location.href = url;
      else dispatch('notify', 'Stripe is not configured on this environment');
    } catch (err) {
      dispatch('notify', err instanceof ApiError ? err.message : 'Could not open checkout');
    } finally {
      busy = false;
    }
  };

  /** Stripe-hosted portal — cards, invoices, cancellation. */
  const portal = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const url = await openBillingPortal();
      if (url) window.location.href = url;
      else dispatch('notify', 'Stripe is not configured on this environment');
    } catch (err) {
      dispatch('notify', err instanceof ApiError ? err.message : 'Could not open the billing portal');
    } finally {
      busy = false;
    }
  };

  const setCycle = (c: BillingCycle): void => {
    if (c === cycle) return;
    cycle = c;
    dispatch('notify', c === 'annual' ? 'Switched to annual billing — two months free' : 'Switched to monthly billing');
  };

  $: plan = planById(planId);
  $: total = contractTotal(plan, cycle, SEATS_LICENSED);
  $: perSeat = seatPrice(plan, cycle);
  $: monthlyEquivalent = cycle === 'annual' ? plan.annual / 12 : plan.monthly;
  $: annualSaving = (plan.monthly * 12 - plan.annual) * SEATS_LICENSED;
  $: seatFill = Math.round((SEATS_USED / SEATS_LICENSED) * 100);
  $: pendingChange = planId !== CURRENT_PLAN || cycle !== CURRENT_CYCLE;
</script>

<div style="max-width: 1000px;">
  <div style="display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 18px; gap: 20px; flex-wrap: wrap;">
    <div>
      <h1 style={h1}>Subscription &amp; billing</h1>
      <p style={sub}>{plan.name} plan · {SEATS_LICENSED} licensed seats · renews {RENEWAL_DATE}</p>
    </div>
    <div style="{mono} display: flex; gap: 1px; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; font-size: 11px;">
      {#each CYCLES as c (c)}
        <button
          type="button"
          on:click={() => setCycle(c)}
          style="padding: 6px 12px; border: none; cursor: pointer; letter-spacing: 0.06em; text-transform: uppercase; background: {cycle === c ? 'var(--ink)' : '#fff'}; color: {cycle === c ? '#fff' : 'var(--muted)'};"
        >{c}</button>
      {/each}
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 3px; margin-bottom: 20px;">
    <div style="background: #fff; padding: 16px 18px;">
      <div style="{label} margin-bottom: 10px;">Contract value</div>
      <div style="font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1;">{money(total)}</div>
      <div style="{mono} font-size: 11.5px; color: var(--muted); margin-top: 8px;">per {cycle === 'annual' ? 'year' : 'month'}</div>
    </div>
    <div style="background: #fff; padding: 16px 18px;">
      <div style="{label} margin-bottom: 10px;">Per seat</div>
      <div style="font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1;">{money(perSeat)}</div>
      <div style="{mono} font-size: 11.5px; color: var(--muted); margin-top: 8px;">≈ £{monthlyEquivalent.toFixed(2)} / month</div>
    </div>
    <div style="background: #fff; padding: 16px 18px;">
      <div style="{label} margin-bottom: 10px;">Seats in use</div>
      <div style="font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1;">{SEATS_USED}<span style="font-size: 18px; color: var(--muted);">/{SEATS_LICENSED}</span></div>
      <div style="{mono} font-size: 11.5px; color: {seatFill > 90 ? '#b23a3a' : 'var(--muted)'}; margin-top: 8px;">{SEATS_LICENSED - SEATS_USED} spare</div>
    </div>
    <div style="background: #fff; padding: 16px 18px;">
      <div style="{label} margin-bottom: 10px;">Annual saving</div>
      <div style="font-size: 30px; font-weight: 600; letter-spacing: -0.02em; line-height: 1;">{money(annualSaving)}</div>
      <div style="{mono} font-size: 11.5px; color: var(--accent); margin-top: 8px;">vs. paying monthly</div>
    </div>
  </div>

  {#if pendingChange}
    <div style="{panel} border-color: #e6d4b3; background: #fdf9f1; padding: 13px 18px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
      <span style="font-size: 13px; color: #8a5a10;">
        Pending change: {planById(CURRENT_PLAN).name} / {CURRENT_CYCLE} → <strong style="font-weight: 600;">{plan.name} / {cycle}</strong>. Takes effect {RENEWAL_DATE}.
      </span>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        {#if live()}
          <button type="button" class="btn-dark" style={btnDark} disabled={busy} on:click={checkout}>
            {busy ? 'Opening…' : 'Pay now'}
          </button>
        {/if}
        <button type="button" class="btn-ghost" style={btnGhost} on:click={() => { planId = CURRENT_PLAN; cycle = CURRENT_CYCLE; dispatch('notify', 'Pending plan change cancelled'); }}>Cancel change</button>
      </div>
    </div>
  {/if}

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 20px;">
    {#each PLANS as p (p.id)}
      <div style="{panel} border-color: {p.id === planId ? 'var(--accent)' : 'var(--line)'}; display: flex; flex-direction: column;">
        <div style="padding: 16px 18px; border-bottom: 1px solid var(--line);">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
            <span style="font-size: 15px; font-weight: 600;">{p.name}</span>
            {#if p.id === CURRENT_PLAN}
              <span style="{mono} font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #0d5a4e; background: #eef4f2; padding: 3px 7px; border-radius: 2px;">Current</span>
            {/if}
          </div>
          <div style="margin-top: 12px; display: flex; align-items: baseline; gap: 6px;">
            <span style="font-size: 26px; font-weight: 600; letter-spacing: -0.02em;">{money(seatPrice(p, cycle))}</span>
            <span style="{mono} font-size: 11.5px; color: var(--muted);">/ seat / {cycle === 'annual' ? 'yr' : 'mo'}</span>
          </div>
          <p style="font-size: 12.5px; line-height: 1.6; color: var(--muted); margin: 10px 0 0;">{p.blurb}</p>
        </div>
        <div style="padding: 14px 18px; display: flex; flex-direction: column; gap: 9px; flex: 1;">
          {#each p.features as f (f)}
            <div style="display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; line-height: 1.5;">
              <span style="color: var(--accent); flex: none;">✓</span>
              <span>{f}</span>
            </div>
          {/each}
          <div style="{mono} font-size: 11px; color: var(--faint); margin-top: 4px;">
            {p.seatCap ? 'up to ' + p.seatCap + ' seats' : 'unlimited seats'}
          </div>
        </div>
        <div style="padding: 14px 18px; border-top: 1px solid var(--line); background: #fafbfa;">
          {#if p.id === planId}
            <button type="button" disabled style="{btnGhost} width: 100%; color: var(--faint); cursor: default;">Selected</button>
          {:else}
            <button type="button" class="btn-dark" style="{btnDark} width: 100%;{busy ? ' opacity: 0.6; cursor: wait;' : ''}" disabled={busy} on:click={() => choosePlan(p.id)}>
              {seatPrice(p, cycle) > perSeat ? 'Upgrade to ' + p.name : 'Move to ' + p.name}
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 340px); gap: 20px; align-items: start;">
    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div style={panel}>
        <div style={panelHead}>
          <span>Usage this period</span>
          <span style="{mono} font-size: 11px; font-weight: 400; color: var(--faint);">resets 01 Sep</span>
        </div>
        <div style="padding: 16px 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px;">
          {#each USAGE as m (m.label)}
            <div style="display: flex; flex-direction: column; gap: 7px;">
              <div style="display: flex; justify-content: space-between; font-size: 12.5px;">
                <span>{m.label}</span>
                <span style="{mono} color: var(--muted);">{m.used.toLocaleString('en-GB')} / {m.limit.toLocaleString('en-GB')}</span>
              </div>
              <div style="height: 5px; background: var(--hair); border-radius: 2px; overflow: hidden;">
                <div style="height: 100%; width: {Math.min(100, Math.round((m.used / m.limit) * 100))}%; background: {m.used / m.limit > 0.9 ? '#b23a3a' : 'var(--accent)'};"></div>
              </div>
              <span style="{mono} font-size: 11px; color: var(--faint);">{m.unit}</span>
            </div>
          {/each}
        </div>
      </div>

      <div style={panel}>
        <div style={panelHead}>
          <span>Invoices</span>
          <button type="button" class="link-btn" on:click={() => dispatch('notify', 'Invoice archive exported to ' + BILLING_EMAIL)} style="{mono} background: none; border: none; padding: 0; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); cursor: pointer;">Export all</button>
        </div>
        <div style="{label} display: grid; grid-template-columns: 150px 1fr 90px 100px 80px; gap: 12px; padding: 9px 18px; background: #fafbfa; border-bottom: 1px solid var(--line);">
          <span>Invoice</span><span>Period</span><span>Seats</span><span>Amount</span><span style="text-align: right;">Status</span>
        </div>
        {#each INVOICES as inv (inv.id)}
          <div style="display: grid; grid-template-columns: 150px 1fr 90px 100px 80px; gap: 12px; align-items: center; padding: 11px 18px; border-bottom: 1px solid var(--hair); font-size: 13px;">
            <span style="{mono} font-size: 11.5px;">{inv.id}</span>
            <span style="color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{inv.period}</span>
            <span style="{mono} font-size: 11.5px; color: var(--muted);">{inv.seats}</span>
            <span style="{mono} font-size: 12px;">{money(inv.amount)}</span>
            <span style="{mono} font-size: 11px; text-align: right; color: {STATUS_COLOR[inv.status]};">{inv.status}</span>
          </div>
        {/each}
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div style={panel}>
        <div style={panelHead}>Payment method</div>
        <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px;">
          <div style="border: 1px solid var(--line); border-radius: 3px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 13px;">{CARD_LABEL}</div>
              <div style="{mono} font-size: 11.5px; color: var(--faint); margin-top: 3px;">expires {CARD_EXPIRY}</div>
            </div>
            <span style="{mono} font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #0d5a4e; background: #eef4f2; padding: 3px 7px; border-radius: 2px;">Default</span>
          </div>
          <button
            type="button"
            class="btn-ghost"
            style={btnGhost}
            disabled={busy}
            on:click={() => (live() ? portal() : dispatch('notify', 'Payment method update link sent to ' + BILLING_EMAIL))}
          >Update card</button>
        </div>
      </div>

      <div style={panel}>
        <div style={panelHead}>Billing details</div>
        <div style="padding: 4px 18px 14px;">
          {#each [['Billing email', BILLING_EMAIL], ['Address', BILLING_ADDRESS], ['VAT number', VAT_NUMBER], ['Next charge', RENEWAL_DATE]] as [k, v], i}
            <div style="padding: 11px 0; border-bottom: {i < 3 ? '1px solid var(--hair)' : 'none'};">
              <div style="{label} color: var(--faint); margin-bottom: 5px;">{k}</div>
              <div style="font-size: 13px; line-height: 1.5;">{v}</div>
            </div>
          {/each}
        </div>
      </div>

      <div style="{panel} border-color: #e6c4c4;">
        <div style="{panelHead} border-bottom-color: #e6c4c4; color: #932f2f;">Cancel subscription</div>
        <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px;">
          <p style="font-size: 12.5px; line-height: 1.6; color: var(--muted); margin: 0;">
            Access continues until {RENEWAL_DATE}. Audit logs are exportable for 30 days after that, then deleted.
          </p>
          <button type="button" on:click={() => dispatch('notify', 'Cancellation request opened — a specialist will confirm')} style="{btnGhost} border-color: #e6c4c4; color: #932f2f;">Request cancellation</button>
        </div>
      </div>
    </div>
  </div>
</div>
