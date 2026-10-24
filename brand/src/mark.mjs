// Alexandria marks, viewBox 0 0 100 100 (shown through 14 14 72 72).
// S1 = the logo since 2026-10-24 night: three scrolls on a gold shelf, Epistle's Archive glyph (the sister service).
// N1 = the old compass star (read as an AI sparkle). N2 = the needle = the loading spinner (kept).
export const C = { plum: '#4A1238', deep: '#2A0820', white: '#FFFFFF', gold: '#C9A24A', soft: '#F6EEF3', ink: '#22161D' };
import { SCROLLS, SHELF } from './scrolls.mjs';

const st = (c, w) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const pt = (a, d) => `${(50 + d * Math.cos(a)).toFixed(1)} ${(50 + d * Math.sin(a)).toFixed(1)}`;
const star = (waist, tip) => Array.from({ length: 8 }, (_, i) => pt((Math.PI / 4) * i - Math.PI / 2, i % 2 ? waist : tip));

export const marks = {
  // the 24-grid glyph (x 2..22, y 2.1..20.8) scaled 3.6x into the 72-unit view, a lighter line than Epistle's 1.5
  S1: (fg, gold, w = 6) =>
    `<g transform="translate(6.8 8.8) scale(3.6)" fill="none" stroke="${fg}" stroke-width="${(w * 0.55 / 3.6).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${SCROLLS}<path d="${SHELF}" stroke="${gold}"/></g>`,
  N1: (fg, gold, w = 6) => {
    const s = star(10, 34);
    return `<path d="M${s[1]} L${s.slice(2).join(' L')}" ${st(fg, w)}/><path d="M${s[7]} L${s[0]} L${s[1]}" ${st(gold, w)}/>`;
  },
  N2: (fg, gold, w = 6.5) =>
    `<path d="M38 50 L50 84 L62 50" ${st(fg, w)}/><path d="M38 50 L50 16 L62 50" ${st(gold, w)}/>`,
};
export const MARK = process.env.MARK || 'S1';
export const mark = (fg, gold, w) => marks[MARK](fg, gold, w);
