// Inline SVG bodies, rendered with {@html} inside a shared <svg> wrapper.
export const ICONS: Record<string, string> = {
  overview:
    '<path d="M2 9.5V14h4V9.5"/><path d="M6.5 14h3V6h-3z"/><path d="M10 14h4V3h-4z"/><path d="M2 9.5 8 4l3 2.5L14 3"/>',
  users:
    '<path d="M10.5 14v-1.3a3 3 0 0 0-3-3h-3a3 3 0 0 0-3 3V14"/><circle cx="6" cy="5" r="2.4"/><path d="M11 3.2a2.4 2.4 0 0 1 0 4.6M15 14v-1.3a3 3 0 0 0-2.2-2.9"/>',
  bids:
    '<path d="M4 2h5.5L13 5.5V14H4z"/><path d="M9.5 2v3.5H13"/><path d="M6.5 9h4M6.5 11.5h3"/>',
  inbox:
    '<path d="M2 4h12v8.5H2z"/><path d="m2 4.5 6 4.5 6-4.5"/><path d="M11.5 1.5 13 3l2-2"/>',
  assistant:
    '<path d="M14 10.5a1.5 1.5 0 0 1-1.5 1.5H6l-3 2.5V4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 14 4z"/><path d="M6 6.2h5M6 8.8h3"/>',
  profile:
    '<path d="M13 14v-1.4a3.2 3.2 0 0 0-3.2-3.2H6.2A3.2 3.2 0 0 0 3 12.6V14"/><circle cx="8" cy="5" r="2.6"/>',
  settings:
    '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4"/>',
  billing:
    '<path d="M1.8 4.6h12.4v7.2H1.8z"/><path d="M1.8 7h12.4"/><path d="M4.2 9.6h2.4"/>'
};
