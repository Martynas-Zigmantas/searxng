// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * /history: every search you made (up to HISTORY_MAX), grouped by day, newest first.
 * Filter it, forget one, pause it, or clear it all. The list lives in localStorage
 * (homeStore.ts) and, signed in, in the account (accountSync.ts); the server only
 * ever stores it for the account, it never reads it.
 */

import { listen } from "../toolkit.ts";
import { type HistoryEntry, history, homePrefs, saveHomePrefs } from "../util/homeStore.ts";

const root = document.getElementById("history_app");
const SEARCH_URL = root?.dataset.searchUrl ?? "./search";
// entries moved from the old list have made-up times (1, 2, 3...): they go under "Earlier"
const REAL_TIME = 1_000_000_000_000;
const DAY = 86_400_000;

const ICON = {
  clock:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
};

const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const el = (html: string): HTMLElement => {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLElement;
};

const searchUrl = (query: string): string => `${SEARCH_URL}?${new URLSearchParams({ q: query }).toString()}`;

const startOfDay = (t: number): number => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const dayLabel = (t: number): string => {
  if (t < REAL_TIME) return "Earlier";
  const today = startOfDay(Date.now());
  const day = startOfDay(t);
  if (day === today) return "Today";
  if (day === today - DAY) return "Yesterday";
  const sameYear = new Date(t).getFullYear() === new Date().getFullYear();
  return new Date(t).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" })
  });
};

const groups = (items: HistoryEntry[]): [string, HistoryEntry[]][] => {
  const out: [string, HistoryEntry[]][] = [];
  for (const item of items) {
    const label = dayLabel(item.t);
    const last = out.at(-1);
    if (last && last[0] === label) last[1].push(item);
    else out.push([label, [item]]);
  }
  return out;
};

let filter = "";

const renderList = (list: HTMLElement): void => {
  const all = history.entries();
  const needle = filter.trim().toLowerCase();
  const items = needle ? all.filter((item) => item.q.toLowerCase().includes(needle)) : all;
  list.innerHTML = "";

  if (all.length === 0) {
    list.append(
      el(
        `<div class="history-empty">${ICON.clock}<p>${
          homePrefs.remember ? "Nothing here yet. Your searches will show up here." : "History is paused."
        }</p></div>`
      )
    );
    return;
  }
  if (items.length === 0) {
    list.append(el(`<div class="history-empty">${ICON.search}<p>No searches match “${esc(filter.trim())}”.</p></div>`));
    return;
  }

  for (const [label, entries] of groups(items)) {
    const section = el(`<section class="history-day"><h2>${esc(label)}</h2><ul></ul></section>`);
    const ul = section.querySelector("ul") as HTMLElement;
    for (const item of entries) {
      const time =
        item.t >= REAL_TIME ? new Date(item.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      const row = el(`
        <li>
          <a href="${esc(searchUrl(item.q))}">${ICON.clock}<span class="history-q">${esc(item.q)}</span></a>
          <time>${time}</time>
          <button type="button" class="history-forget" aria-label="Forget “${esc(item.q)}”" title="Forget">${ICON.close}</button>
        </li>`);
      listen("click", row.querySelector("button") as HTMLElement, () => {
        history.remove(item.q);
        row.classList.add("history-gone");
        window.setTimeout(() => renderList(list), 180);
      });
      ul.append(row);
    }
    list.append(section);
  }
};

const render = (): void => {
  if (!root) return;
  root.innerHTML = "";
  const count = history.entries().length;
  const bar = el(`
    <div class="history-bar">
      <label class="history-filter">${ICON.search}<input type="search" placeholder="Search your history" aria-label="Search your history" value="${esc(filter)}"></label>
      <label class="history-pause"><span>Save my searches</span><input type="checkbox" class="checkbox-onoff" ${homePrefs.remember ? "checked" : ""}></label>
      <button type="button" class="history-clear" ${count ? "" : "disabled"}>Clear all</button>
    </div>`);
  const list = el('<div class="history-list"></div>');
  const input = bar.querySelector('input[type="search"]') as HTMLInputElement;
  listen("input", input, () => {
    filter = input.value;
    renderList(list);
  });
  listen("change", bar.querySelector(".history-pause input") as HTMLInputElement, (event: Event) => {
    homePrefs.remember = (event.target as HTMLInputElement).checked;
    saveHomePrefs();
    render();
  });
  listen("click", bar.querySelector(".history-clear") as HTMLElement, () => {
    if (!window.confirm(`Forget all ${count} searches? This can't be undone.`)) return;
    history.clear();
    render();
  });
  root.append(bar);
  if (!homePrefs.remember) {
    root.append(
      el(
        '<p class="history-paused">New searches aren’t being saved. Switch “Save my searches” back on to keep them.</p>'
      )
    );
  }
  root.append(list);
  renderList(list);
};

render();
