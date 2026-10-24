// Alexandria mark: a four-point compass star, outline only, its north tip drawn in gold.
// viewBox 0 0 100 100, centred. N1 = the star (chosen 2026-10-24), N2 = just the needle (kept for reference).
export const C = { plum: '#4A1238', deep: '#2A0820', white: '#FFFFFF', gold: '#C9A24A', soft: '#F6EEF3', ink: '#22161D' };
const st = (c, w) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const pt = (a, d) => `${(50 + d * Math.cos(a)).toFixed(1)} ${(50 + d * Math.sin(a)).toFixed(1)}`;
const star = (waist, tip) => Array.from({ length: 8 }, (_, i) => pt((Math.PI / 4) * i - Math.PI / 2, i % 2 ? waist : tip));

export const marks = {
  N1: (fg, gold, w = 6) => {
    const s = star(10, 34);
    return `<path d="M${s[1]} L${s.slice(2).join(' L')}" ${st(fg, w)}/><path d="M${s[7]} L${s[0]} L${s[1]}" ${st(gold, w)}/>`;
  },
  N2: (fg, gold, w = 6.5) =>
    `<path d="M38 50 L50 84 L62 50" ${st(fg, w)}/><path d="M38 50 L50 16 L62 50" ${st(gold, w)}/>`,
};
export const MARK = process.env.MARK || 'N1';
export const mark = (fg, gold, w) => marks[MARK](fg, gold, w);
