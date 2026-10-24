// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The spinning compass needle (logo N2) as Alexandria's loading indicator.
 * `startLoading()` puts <html> in the loading state: the search button's
 * magnifier turns into the needle and the results fade a little.
 */

const html = document.documentElement;
let timer: number | undefined;

export const startLoading = (): void => {
  html.classList.add("is-loading");
  // never get stuck if the navigation didn't happen (download, blocked popup, ...)
  window.clearTimeout(timer);
  timer = window.setTimeout(stopLoading, 15_000);
};

export const stopLoading = (): void => {
  window.clearTimeout(timer);
  html.classList.remove("is-loading");
};

// a fresh needle element, e.g. for a widget that is fetching
export const needle = (label = "Loading"): HTMLElement => {
  const box = document.createElement("span");
  box.className = "needle-loading";
  box.setAttribute("role", "status");
  box.setAttribute("aria-label", label);
  const tpl = document.getElementById("needle_template") as HTMLTemplateElement | null;
  if (tpl) box.append(tpl.content.cloneNode(true));
  return box;
};
