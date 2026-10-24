// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Small UX extras on every page: app launcher, "/" to focus the search box,
 * a shadow under the sticky results header, copy-link buttons on results,
 * and remembering the query (localStorage only) for the start page.
 */

import { Endpoints, endpoint, listen } from "../toolkit.ts";
import { history } from "../util/homeStore.ts";
import { startLoading, stopLoading } from "../util/loading.ts";

/* ------------------------------------------------------------ app launcher */

const launcher = document.querySelector<HTMLElement>(".app-launcher");
if (launcher) {
  const button = launcher.querySelector<HTMLButtonElement>(".app-launcher-btn");
  const panel = launcher.querySelector<HTMLElement>(".app-launcher-panel");

  const setOpen = (open: boolean): void => {
    if (!(button && panel)) return;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    launcher.classList.toggle("open", open);
  };

  if (button && panel) {
    listen("click", button, (event: MouseEvent) => {
      event.stopPropagation();
      setOpen(panel.hidden !== false);
    });
    listen("click", document, (event: MouseEvent) => {
      if (!launcher.contains(event.target as Node)) setOpen(false);
    });
    listen("keydown", document, (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    });
  }
}

/* ------------------------------------------------------ loading needle */

// any search (search box, category tabs, filters, pagination, suggestions) is a form submit
document.addEventListener(
  "submit",
  (event: Event) => {
    // widget forms (add shortcut, ...) stay on the page
    if (!(event.target as HTMLElement).closest(".home-widgets")) startLoading();
  },
  true
);

// same-tab clicks on links inside this site (recent searches, prefs, logo, ...)
document.addEventListener("click", (event: MouseEvent) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
  if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.hash)) return;
  startLoading();
});

// back/forward cache restores the page as it was: drop the needle
window.addEventListener("pageshow", stopLoading);

/* --------------------------------------------------------- "/" focuses box */

const searchInput = document.getElementById("q") as HTMLInputElement | null;

listen("keydown", document, (event: KeyboardEvent) => {
  if (event.key !== "/" || !searchInput) return;
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable]")) return;
  event.preventDefault();
  searchInput.focus();
  searchInput.select();
});

/* -------------------------------------------------------------- results page */

if (endpoint === Endpoints.results) {
  if (searchInput?.value) history.add(searchInput.value);

  const header = document.getElementById("search");
  if (header) {
    const onScroll = (): void => {
      header.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  const copyIcon =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

  for (const result of document.querySelectorAll<HTMLElement>("#urls article.result")) {
    const link = result.querySelector<HTMLAnchorElement>("h3 a");
    const engines = result.querySelector<HTMLElement>(".engines");
    if (!(link && engines && navigator.clipboard)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-link";
    button.title = "Copy link";
    button.setAttribute("aria-label", "Copy link");
    button.innerHTML = copyIcon;
    listen("click", button, async () => {
      try {
        await navigator.clipboard.writeText(link.href);
        button.classList.add("copied");
        setTimeout(() => button.classList.remove("copied"), 1200);
      } catch {
        // clipboard blocked (http): nothing to do
      }
    });
    engines.prepend(button);
  }
}
