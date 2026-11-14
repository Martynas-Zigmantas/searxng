// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The start page background: Bing's photo of the day the first time the page
 * opens after a new one comes out, then a different one every time, walking
 * this browser's own shuffle of every photo kept (no repeats until the whole
 * pool has been shown).  The picture comes through this instance
 * (/widgets/photo, home_widgets.py), so the browser never talks to Bing.  The
 * page is in "on a picture" mode (html.home-bg-on.home-bg-dark): light text
 * and glass cards, see pretty.less.
 */

const STATE_KEY = "sxng-home-photos";
const SEED = /^[0-9a-z]{1,32}$/;

// seed = this browser's shuffle, n = how far along it, today = the last photo of the day it was shown
type State = { seed: string; n: number; today: string };

const load = (): State => {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null") as Partial<State> | null;
    if (raw && typeof raw.seed === "string" && SEED.test(raw.seed)) {
      return {
        seed: raw.seed,
        n: Number.isInteger(raw.n) && (raw.n as number) >= 0 ? (raw.n as number) : 0,
        today: String(raw.today ?? "")
      };
    }
  } catch {
    // fall through to a fresh shuffle
  }
  return {
    seed: Math.random().toString(36).slice(2, 12) || "0",
    n: 0,
    today: ""
  };
};

const save = (state: State): void => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // storage disabled: every visit gets the photo of the day, that's all
  }
};

type Photo = {
  id: string;
  image: string;
  title: string;
  credit: string;
  today: boolean;
};

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
      const state = load();
      const query = new URLSearchParams({
        seed: state.seed,
        n: String(state.n),
        today: state.today
      });
      const res = await fetch(`${url}?${query.toString()}`, {
        cache: "no-store"
      });
      if (!res.ok) throw new Error(String(res.status));
      const photo = (await res.json()) as Photo;
      save(photo.today ? { ...state, today: photo.id } : { ...state, n: state.n + 1 });
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
