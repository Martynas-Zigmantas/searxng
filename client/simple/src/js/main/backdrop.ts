// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The start page background: a Bing photo of the day, a different one every
 * time the page opens (never the one this browser saw last).  The picture
 * comes through this instance (/widgets/photo, home_widgets.py), so the
 * browser never talks to Bing.  The page is in "on a picture" mode
 * (html.home-bg-on.home-bg-dark): light text and glass cards, see pretty.less.
 */

const LAST_KEY = "sxng-home-photo";

const lastSeen = (): string => {
  try {
    return localStorage.getItem(LAST_KEY) ?? "";
  } catch {
    return "";
  }
};

const remember = (id: string): void => {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // storage disabled: may repeat, that's all
  }
};

type Photo = { id: string; image: string; title: string; credit: string };

export const startBackdrop = (): void => {
  const widgets = document.getElementById("home_widgets");
  const url = widgets?.dataset.photoUrl ?? "/widgets/photo";
  const html = document.documentElement;
  const layer = document.createElement("div");
  layer.id = "home_bg";
  layer.className = "home-bg home-bg-photo";
  layer.setAttribute("aria-hidden", "true");
  document.body.prepend(layer);
  html.classList.add("home-bg-on", "home-bg-dark");

  void (async () => {
    try {
      const res = await fetch(`${url}?${new URLSearchParams({ not: lastSeen() }).toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const photo = (await res.json()) as Photo;
      remember(photo.id);
      const tall = window.innerHeight > window.innerWidth * 1.1;
      const img = new Image();
      img.alt = "";
      img.decoding = "async";
      img.onload = () => layer.classList.add("home-bg-loaded");
      img.onerror = () => layer.classList.add("home-bg-loaded");
      img.src = `${photo.image}&s=${tall ? "tall" : "wide"}`;
      layer.append(img);

      const credit = document.createElement("p");
      credit.className = "home-bg-credit";
      const title = document.createElement("strong");
      title.textContent = photo.title;
      const by = document.createElement("span");
      by.textContent = photo.credit;
      credit.append(title, by);
      // in the page, after the widgets: on phones it scrolls with the cards, on wide screens it sits bottom left
      (widgets?.parentElement ?? document.body).append(credit);
    } catch {
      // no photo: the plum shade under it stays
      layer.classList.add("home-bg-loaded");
    }
  })();
};
