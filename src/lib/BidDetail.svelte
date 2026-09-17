<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { mono, label, panel, panelHead, btnDark, btnGhost } from '../ui';
  import { STAGE_COLOR, money, dueLabel, dueColor } from '../bids';
  import type { Bid } from '../types';

  export let bid: Bid;

  const dispatch = createEventDispatcher<{ back: void; advance: void; assign: void }>();

  $: done = bid.tasks.filter((t) => t.done).length;
  $: readiness = Math.round((done / bid.tasks.length) * 100);
  $: facts = [
    ['Client', bid.client],
    ['Sector', bid.sector],
    ['Contract value', money(bid.value)],
    ['Bid owner', bid.owner],
    ['Submission due', bid.due],
    ['Incumbent', bid.incumbent]
  ] as [string, string][];
</script>

<div>
  <button class="link-btn" type="button" on:click={() => dispatch('back')} style="{mono} background: none; border: none; padding: 0; margin-bottom: 16px; font-size: 11.5px; color: var(--muted); cursor: pointer;">← All bids</button>

  <div style="{panel} padding: 20px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 20px;">
    <div style="min-width: 0; flex: 1;">
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <h1 style="font-size: 20px; font-weight: 600; margin: 0; letter-spacing: -0.01em;">{bid.title}</h1>
        <span style="{mono} display: inline-flex; align-items: center; gap: 6px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; border: 1px solid var(--line); padding: 2px 8px; border-radius: 2px; color: #4a5250;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: {STAGE_COLOR[bid.stage]};"></span>
          {bid.stage}
        </span>
      </div>
      <div style="{mono} font-size: 12px; color: var(--muted); margin-top: 5px;">{bid.id} · {bid.client} · {money(bid.value)} · <span style="color: {dueColor(bid)};">{dueLabel(bid)}</span></div>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn-ghost" type="button" style={btnGhost} on:click={() => dispatch('assign')}>Reassign owner</button>
      <button class="btn-dark" type="button" style={btnDark} on:click={() => dispatch('advance')}>Advance stage</button>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 340px); gap: 20px; align-items: start;">
    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div style={panel}>
        <div style={panelHead}>
          <span>Submission checklist</span>
          <span style="{mono} font-size: 11px; font-weight: 400; color: var(--muted);">{done} of {bid.tasks.length} complete</span>
        </div>
        {#each bid.tasks as t (t.label)}
          <div style="display: grid; grid-template-columns: 18px 1fr 150px; gap: 12px; align-items: center; padding: 11px 18px; border-bottom: 1px solid var(--hair); font-size: 13px;">
            <span style="width: 14px; height: 14px; border-radius: 2px; border: 1px solid {t.done ? 'var(--accent)' : '#c3c8c9'}; background: {t.done ? 'var(--accent)' : '#fff'}; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; line-height: 1;">{t.done ? '✓' : ''}</span>
            <span style="color: {t.done ? 'var(--muted)' : 'var(--ink)'}; text-decoration: {t.done ? 'line-through' : 'none'};">{t.label}</span>
            <span style="{mono} font-size: 11.5px; color: var(--faint); text-align: right;">{t.owner}</span>
          </div>
        {/each}
      </div>

      <div style={panel}>
        <div style={panelHead}>Bid log</div>
        {#each bid.notes as n (n.time + n.text)}
          <div style="display: grid; grid-template-columns: 110px 1fr; gap: 14px; padding: 11px 18px; border-bottom: 1px solid var(--hair); font-size: 13px;">
            <span style="{mono} font-size: 11.5px; color: var(--faint);">{n.time}</span>
            <span style="color: #4a5250;">{n.text}</span>
          </div>
        {/each}
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div style={panel}>
        <div style={panelHead}>Readiness</div>
        <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;">
          <div style="display: flex; flex-direction: column; gap: 7px;">
            <div style="display: flex; justify-content: space-between; font-size: 12.5px;">
              <span style="{mono}">Checklist</span>
              <span style="{mono} color: var(--muted);">{readiness}%</span>
            </div>
            <div style="height: 5px; background: var(--hair); border-radius: 2px; overflow: hidden;">
              <div style="height: 100%; width: {readiness}%; background: var(--accent);"></div>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 7px;">
            <div style="display: flex; justify-content: space-between; font-size: 12.5px;">
              <span style="{mono}">Win probability</span>
              <span style="{mono} color: var(--muted);">{bid.probability}%</span>
            </div>
            <div style="height: 5px; background: var(--hair); border-radius: 2px; overflow: hidden;">
              <div style="height: 100%; width: {bid.probability}%; background: {STAGE_COLOR[bid.stage]};"></div>
            </div>
          </div>
          <p style="font-size: 12.5px; line-height: 1.6; color: var(--muted); margin: 0;">
            Weighted value {money((bid.value * bid.probability) / 100)} against {money(bid.value)} contract value.
          </p>
        </div>
      </div>

      <div style={panel}>
        <div style={panelHead}>Bid facts</div>
        <div style="padding: 4px 18px 14px;">
          {#each facts as [name, value], i}
            <div style="padding: 11px 0; border-bottom: {i < facts.length - 1 ? '1px solid var(--hair)' : 'none'};">
              <div style="{label} color: var(--faint); margin-bottom: 5px;">{name}</div>
              <div style="font-size: 13.5px;">{value}</div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
