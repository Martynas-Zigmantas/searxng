// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Alexandria account sync (searx/accounts.py): when signed in, the start page state
 * (widget switches, recent searches, shortcuts, weather city) lives in the account
 * as well as in localStorage, so it follows you to every device you sign in on.
 *
 * pull() runs before the start page / extras modules read localStorage; after that
 * every write in homeStore.ts / home.ts fires "alexandria:store" and a debounced
 * PUT sends the whole (small) state back.  Signed out, nothing here runs.
 */

const KEYS = ["sxng-home-prefs", "sxng-home-history", "sxng-home-shortcuts", "sxng-home-place"] as const;
const HISTORY_KEY = "sxng-home-history";
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

const parseList = (raw: string | undefined | null): string[] => {
  try {
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

let timer: number | undefined;

export const push = (keepalive = false): Promise<unknown> =>
  fetch(URL_, {
    method: "PUT",
    credentials: "same-origin",
    keepalive: keepalive,
    headers: { "Content-Type": "application/json", "X-Alexandria": "1" },
    body: JSON.stringify(snapshot())
  }).catch(() => undefined);

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
      // the account wins, except recent searches made here while signed out are kept (merged on top)
      const local = parseList(localStorage.getItem(HISTORY_KEY));
      const remote = parseList(data[HISTORY_KEY]);
      for (const key of KEYS) {
        const value = data[key];
        if (typeof value === "string") localStorage.setItem(key, value);
        else localStorage.removeItem(key); // reset on another device
      }
      const seen = new Set<string>();
      const merged = [...local, ...remote].filter((q) => {
        const k = q.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (merged.length > 0) localStorage.setItem(HISTORY_KEY, JSON.stringify(merged.slice(0, 30)));
      if (merged.length !== remote.length) schedule();
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
