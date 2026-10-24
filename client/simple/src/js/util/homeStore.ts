// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * localStorage-only state shared by the start page and the results page:
 * which widgets are on, and the recent-searches list.
 */

export type HomePrefs = {
  clock: boolean;
  shortcuts: boolean;
  weather: boolean;
  recent: boolean;
  remember: boolean;
  fahrenheit: boolean;
};

const PREFS_KEY = "sxng-home-prefs";
const HISTORY_KEY = "sxng-home-history";
const HISTORY_MAX = 30;

const DEFAULTS: HomePrefs = {
  clock: true,
  shortcuts: true,
  weather: true,
  recent: true,
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
};

export const homePrefs: HomePrefs = { ...DEFAULTS, ...read<Partial<HomePrefs>>(PREFS_KEY, {}) };

export const saveHomePrefs = (): void => write(PREFS_KEY, homePrefs);

export const history = {
  list: (): string[] => read<string[]>(HISTORY_KEY, []),
  add: (query: string): void => {
    const q = query.trim();
    if (!(q && homePrefs.remember)) return;
    const items = history.list().filter((item) => item.toLowerCase() !== q.toLowerCase());
    items.unshift(q);
    write(HISTORY_KEY, items.slice(0, HISTORY_MAX));
  },
  remove: (query: string): void =>
    write(
      HISTORY_KEY,
      history.list().filter((item) => item !== query)
    ),
  clear: (): void => {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // storage disabled
    }
  }
};
