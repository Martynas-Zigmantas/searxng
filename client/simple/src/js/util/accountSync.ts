// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Alexandria account sync (searx/accounts.py): when signed in, the start page state
 * (widget switches, search history, shortcuts, weather city) lives in the account
 * as well as in localStorage, so it follows you to every device you sign in on.
 *
 * pull() runs before the start page / extras modules read localStorage; after that
 * every write in homeStore.ts / home.ts fires "alexandria:store" and a debounced
 * PUT sends the whole (small) state back.  Signed out, nothing here runs.
 * (Preferences sync on the server, by cookie: accounts.py prefs_before / prefs_after.)
 */

import { fromOldHistory, type HistoryEntry, tidyHistory } from "./homeStore.ts";

// sxng-home-history = the old history list: still read from accounts that haven't moved yet
const KEYS = [
  "sxng-home-prefs",
  "sxng-history",
  "sxng-home-history",
  "sxng-home-shortcuts",
  "sxng-home-place"
] as const;
const HISTORY_KEY = "sxng-history";
const OLD_HISTORY_KEY = "sxng-home-history";
// when this browser last agreed with the account: only searches made after it are merged in, so a search
// deleted (or a history cleared) on another device doesn't come back from here
const SYNCED_KEY = "sxng-history-synced";
const URL_ = document.querySelector<HTMLElement>(".account-menu")?.dataset.syncUrl ?? "/account/data";
const DEBOUNCE_MS = 1500;

type Blob = Partial<Record<(typeof KEYS)[number], string>>;

const snapshot = (): Blob => {
  const out: Blob = {};
  for (const key of KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
};

const parseEntries = (raw: string | undefined | null): HistoryEntry[] => {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? value.filter(
          (item): item is HistoryEntry =>
            typeof item === "object" && item !== null && typeof item.q === "string" && typeof item.t === "number"
        )
      : [];
  } catch {
    return [];
  }
};

const localHistory = (): HistoryEntry[] => [
  ...parseEntries(localStorage.getItem(HISTORY_KEY)),
  ...fromOldHistory(localStorage.getItem(OLD_HISTORY_KEY))
];

let timer: number | undefined;

const markSynced = (): void => {
  try {
    localStorage.setItem(SYNCED_KEY, String(Date.now()));
  } catch {
    // storage disabled
  }
};

export const push = (keepalive = false): Promise<unknown> =>
  fetch(URL_, {
    method: "PUT",
    credentials: "same-origin",
    keepalive: keepalive,
    headers: { "Content-Type": "application/json", "X-Alexandria": "1" },
    body: JSON.stringify(snapshot())
  })
    .then((resp) => {
      if (resp.ok) markSynced();
    })
    .catch(() => undefined);

const schedule = (): void => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = undefined;
    void push();
  }, DEBOUNCE_MS);
};

export const pull = async (): Promise<void> => {
  try {
    const resp = await fetch(URL_, { credentials: "same-origin", cache: "no-store" });
    if (!resp.ok) return;
    const { data } = (await resp.json()) as { data: Blob | null };
    if (data) {
      // the account wins, except searches made here while signed out are kept (merged in by time)
      const since = Number(localStorage.getItem(SYNCED_KEY) || 0);
      const local = localHistory().filter((item) => item.t > since);
      const remote = [...parseEntries(data[HISTORY_KEY]), ...fromOldHistory(data[OLD_HISTORY_KEY])];
      for (const key of KEYS) {
        const value = data[key];
        if (typeof value === "string") localStorage.setItem(key, value);
        else localStorage.removeItem(key); // reset on another device
      }
      localStorage.removeItem(OLD_HISTORY_KEY);
      const merged = tidyHistory([...local, ...remote]);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
      if (merged.length !== parseEntries(data[HISTORY_KEY]).length || data[OLD_HISTORY_KEY] !== undefined) schedule();
      else markSynced();
    } else {
      // first sign-in anywhere: this browser's state becomes the account's
      await push();
    }
  } catch {
    // offline or storage disabled: the page just works from localStorage
  }
  window.addEventListener("alexandria:store", schedule);
  window.addEventListener("pagehide", () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      void push(true);
    }
  });
};
