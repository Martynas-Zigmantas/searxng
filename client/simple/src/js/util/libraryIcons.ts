// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Library line icons for the results page backgrounds (main/library.ts): 24px grid,
 * stroke only, drawn in Epistle's line style (2026-10-25).
 */

export const LIBRARY_ICONS: Record<string, string> = {
  book: '<path d="M6 3.5h10.5a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1.5 1.5 0 0 1-1.5-1.5v-14A1.5 1.5 0 0 1 6 3.5z"/><path d="M4.5 18.5A1.5 1.5 0 0 1 6 17h11.5M8.5 7.5h6M8.5 10h4"/>',
  openbook:
    '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13M6 8.5c1.5-.1 2.8.1 4 .6M6 11.5c1.5-.1 2.8.1 4 .6M14 9.1c1.2-.5 2.5-.7 4-.6M14 12.1c1.2-.5 2.5-.7 4-.6"/>',
  stack:
    '<rect x="4" y="15.5" width="16" height="4" rx="1"/><rect x="5.5" y="11.5" width="13" height="4" rx="1"/><rect x="4.5" y="7.5" width="14" height="4" rx="1" transform="rotate(-4 11.5 9.5)"/><path d="M7 17.5h7M8 13.5h5"/>',
  shelf:
    '<path d="M3 20.5h18M3 12h18"/><path d="M5 12V5.5h2V12M7.5 12V4h2.2v8M10.5 12V6.5h1.8V12M13.2 12l1.6-7 2 .5-1.6 7"/><path d="M5 20.5v-6h2.2v6M8 20.5v-5h2v5M11 20.5v-6.5h2.2v6.5M15 20.5v-4.5h3.5v4.5"/>',
  ladder: '<path d="M8 3l-3 18M16 3l3 18M7.4 7h9.2M6.8 11h10.4M6.1 15h11.8M5.5 19h13"/>',
  quill:
    '<path d="M20 3.5c-6 .5-10.5 4-12.5 10l-1 3.5 3.5-1c5.5-2 9-6.5 10-12.5z"/><path d="M6.5 17L4 20.5M10 12.5l4-4"/>',
  inkwell:
    '<path d="M7 11h10l1.5 8.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/><path d="M9 11V8.5h6V11M10.5 8.5V6.5h3v2"/><path d="M16 5.5l4-3"/>',
  scroll:
    '<path d="M7 5h11.5a2 2 0 0 1 0 4H18v9a2.5 2.5 0 0 1-2.5 2.5H6"/><path d="M7 5a2 2 0 0 0-2 2v11a2.5 2.5 0 1 0 5 0v-1H6.5M10 9h5M10 12h5M10 15h3"/>',
  column: '<path d="M4.5 5h15M5.5 3h13M6 20.5h12M5 21.5h14M7.5 5v15.5M10.5 5v15.5M13.5 5v15.5M16.5 5v15.5"/>',
  lamp: '<path d="M4 15c0-2 3.5-3.5 8-3.5 2.5 0 4.5.5 6 1.3l2.5-1.8c.5 1.5 0 3-1.5 4H5.5C4.6 15 4 15 4 15z"/><path d="M9 15.5c.3 1.5 1.5 2.5 3 2.5s2.7-1 3-2.5M12 11.5V9.8M12 7.5c-.8-1-.8-2.2 0-3.5.8 1.3.8 2.5 0 3.5z"/>',
  hourglass:
    '<path d="M6 3.5h12M6 20.5h12M7.5 3.5c0 4 4.5 5.5 4.5 8.5s-4.5 4.5-4.5 8.5M16.5 3.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5"/><path d="M9.5 18.5h5"/>',
  globe:
    '<circle cx="12" cy="10" r="6.5"/><path d="M5.5 10h13M12 3.5c2 2 2.8 4.2 2.8 6.5S14 14.5 12 16.5M12 3.5c-2 2-2.8 4.2-2.8 6.5S10 14.5 12 16.5M17.5 4.5a8 8 0 0 1-11 11.5M12 18v2.5M8.5 20.5h7"/>',
  candle: '<path d="M9.5 10h5v10h-5zM7 20.5h10M12 10V8.5M12 6.8c-1-1-1-2.3 0-3.8 1 1.5 1 2.8 0 3.8z"/>',
  amphora:
    '<path d="M9 3.5h6M10 3.5v2.5c-3 1.5-4.5 4-4.5 7.5 0 3.5 2.5 6.5 6.5 7.5 4-1 6.5-4 6.5-7.5S17 7.5 14 6V3.5"/><path d="M10 6.5C7.5 6.5 6 8 6.5 10M14 6.5c2.5 0 4 1.5 3.5 3.5M7 13h10"/>'
};
