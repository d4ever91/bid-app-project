import type { Density } from './types';

// Shared inline-style fragments (strings, so they drop straight into style="…")
export const mono = 'font-family: var(--mono);';
export const label = mono + ' font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted);';
export const panel = 'background: var(--panel); border: 1px solid var(--line); border-radius: 3px;';
export const panelHead = 'padding: 13px 18px; border-bottom: 1px solid var(--line); font-size: 13.5px; font-weight: 600; display: flex; align-items: center; justify-content: space-between;';
export const field = 'height: 36px; padding: 0 11px; border: 1px solid var(--line); background: #fbfbfb; border-radius: 3px; font-size: 13px; outline: none;';
export const btnDark = 'height: 32px; padding: 0 13px; background: var(--ink); color: #fff; border: none; border-radius: 3px; font-size: 12.5px; font-weight: 500; cursor: pointer; transition: background 120ms;';
export const btnGhost = 'height: 32px; padding: 0 12px; background: #fff; border: 1px solid var(--line); border-radius: 3px; font-size: 12.5px; cursor: pointer;';
export const h1 = 'font-size: 21px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 4px;';
export const sub = 'font-size: 13px; color: var(--muted); margin: 0;';
export const gridCols = 'grid-template-columns: minmax(220px, 2fr) 120px 132px 116px 120px 84px;';

export const ROW_PAD: Record<Density, string> = {
  Dense: '10px 18px',
  Balanced: '14px 18px',
  Roomy: '18px 18px'
};
