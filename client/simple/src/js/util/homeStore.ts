// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * localStorage state shared by the start page, the results page and /history:
 * which widgets are on and the search history (synced to the
 * Alexandria account when signed in: accountSync.ts).
 */

export type HomePrefs = {
  clock: boolean;
  shortcuts: boolean;
  weather: boolean;
  recent: boolean;
  mail: boolean;
  remember: boolean;
  fahrenheit: boolean;
};

export type HistoryEntry = { q: string; t: number };

const PREFS_KEY = "sxng-home-prefs";
const HISTORY_KEY = "sxng-history";
const OLD_HISTORY_KEY = "sxng-home-history"; // before /history: newest first, no times
export const HISTORY_MAX = 400;

const DEFAULTS: HomePrefs = {
  clock: true,
  shortcuts: true,
  weather: true,
  recent: true,
  mail: true,
  remember: true,
  fahrenheit: false
};

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage disabled
  }
  window.dispatchEvent(new Event("alexandria:store"));
};

export const homePrefs: HomePrefs = { ...DEFAULTS, ...read<Partial<HomePrefs>>(PREFS_KEY, {}) };

export const saveHomePrefs = (): void => write(PREFS_KEY, homePrefs);

const isEntry = (item: unknown): item is HistoryEntry =>
  typeof item === "object" &&
  item !== null &&
  typeof (item as HistoryEntry).q === "string" &&
  typeof (item as HistoryEntry).t === "number";

/** newest first, one entry per query (case-insensitive), the latest time wins */
export const tidyHistory = (items: HistoryEntry[]): HistoryEntry[] => {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => b.t - a.t)
    .filter((item) => {
      const key = item.q.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, HISTORY_MAX);
};

/** the old list of plain strings (newest first) as entries with made-up, descending times */
export const fromOldHistory = (raw: string | null | undefined): HistoryEntry[] => {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((q): q is string => typeof q === "string").map((q, i) => ({ q: q, t: list.length - i }));
  } catch {
    return [];
  }
};

const entries = (): HistoryEntry[] => {
  const current = read<unknown[]>(HISTORY_KEY, []);
  const list = Array.isArray(current) ? current.filter(isEntry) : [];
  let old: string | null = null;
  try {
    old = localStorage.getItem(OLD_HISTORY_KEY);
  } catch {
    // storage disabled
  }
  if (old === null) return list;
  // one-time move from the old list
  const merged = tidyHistory([...list, ...fromOldHistory(old)]);
  try {
    localStorage.removeItem(OLD_HISTORY_KEY);
  } catch {
    // storage disabled
  }
  write(HISTORY_KEY, merged);
  return merged;
};

export const history = {
  entries: entries,
  list: (): string[] => entries().map((item) => item.q),
  add: (query: string): void => {
    const q = query.trim();
    if (!(q && homePrefs.remember)) return;
    write(HISTORY_KEY, tidyHistory([{ q: q, t: Date.now() }, ...entries()]));
  },
  remove: (query: string): void =>
    write(
      HISTORY_KEY,
      entries().filter((item) => item.q !== query)
    ),
  clear: (): void => write(HISTORY_KEY, [])
};
