// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Start page "What's new" card (home.ts): the newest item with its picture,
 * the older ones behind "Earlier".  On wide screens it's a column on the left
 * (html.home-news-side), on phones it sits under the shortcuts.  Hide folds it
 * into a pill on this device until a newer item is added to NEWS.
 *
 * Add news at the TOP of NEWS with a new id; it opens again for everyone.
 */

import { listen } from "../toolkit.ts";

type News = {
  id: string;
  date: string;
  title: string;
  text: string;
  facts?: string[];
  links?: { label: string; url: string; icon: keyof typeof GLYPH }[];
  visual?: "epistle-apps";
};

const NEWS: News[] = [
  {
    id: "2026-10-epistle-apps",
    date: "October 2026",
    title: "Epistle Mail apps are here",
    text: "We built Epistle, the mail behind your Alexandria account. Now it runs as a real app on your computer and your phone.",
    facts: [
      "Native Linux app, every distro: .deb, .rpm, Arch",
      "Android app, same inbox",
      "Sealed letters and signed updates"
    ],
    links: [
      { label: "Linux", url: "https://www.epistle.email/linux", icon: "laptop" },
      { label: "Android", url: "https://epistle.email/app/", icon: "phone" }
    ],
    visual: "epistle-apps"
  },
  {
    id: "2026-10-sign-in",
    date: "October 2026",
    title: "Sign in with Epistle",
    text: "One account for Alexandria and your mail. Your searches and settings follow you to every device you sign in on."
  },
  {
    id: "2026-10-photo",
    date: "October 2026",
    title: "Photo of the day",
    text: "A new picture every time you open the start page."
  }
];

const HIDDEN_KEY = "sxng-home-news-hidden"; // id of the newest item when Hide was pressed
const SIDE = window.matchMedia("(min-width: 85rem)");

const GLYPH = {
  laptop:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/></svg>',
  // Epistle's mark (epistle site assets/app-icon.svg)
  epistle:
    '<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="22" fill="#4A1238"/><path d="M13 50 C30 21, 63 21, 87 65 M13 50 C30 79, 63 79, 87 35" fill="none" stroke="#F4EBD6" stroke-width="6.5" stroke-linecap="round"/></svg>',
  spark:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" fill="currentColor"/></svg>'
};

const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const hiddenId = (): string | null => {
  try {
    return localStorage.getItem(HIDDEN_KEY);
  } catch {
    return null;
  }
};

const setHidden = (id: string | null): void => {
  try {
    if (id) localStorage.setItem(HIDDEN_KEY, id);
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // private window: it just opens again next time
  }
};

const visual = (kind: News["visual"], root: HTMLElement): string => {
  if (kind !== "epistle-apps") return "";
  const linux = esc(root.dataset.newsLinux ?? "");
  const android = esc(root.dataset.newsAndroid ?? "");
  return `<div class="home-news-hero" aria-hidden="true">
    <span class="home-news-badge home-news-badge-l">${GLYPH.laptop}Linux</span>
    <span class="home-news-badge home-news-badge-r">${GLYPH.phone}Android</span>
    <div class="home-news-win"><div class="home-news-winbar"><i></i><i></i><i></i></div><img src="${linux}" alt="" loading="eager" decoding="async"></div>
    <div class="home-news-phone"><img src="${android}" alt="" loading="eager" decoding="async"></div>
  </div>`;
};

const renderCard = (news: HTMLElement, root: HTMLElement, place: () => void): void => {
  const [top, ...earlier] = NEWS;
  if (!top) return;

  const facts = top.facts?.length
    ? `<ul class="home-news-facts">${top.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`
    : "";
  const links = top.links?.length
    ? `<div class="home-news-links">${top.links
        .map(
          (l, i) =>
            `<a class="home-news-btn${i ? " home-news-btn-alt" : ""}" href="${esc(l.url)}" rel="noopener">${GLYPH[l.icon]}${esc(l.label)}</a>`
        )
        .join("")}</div>`
    : "";
  const older = earlier
    .map(
      (n) =>
        `<li><span class="home-news-date">${esc(n.date)}</span><strong>${esc(n.title)}</strong><p>${esc(n.text)}</p></li>`
    )
    .join("");
  const earlierNames = earlier.map((n) => `<b>${esc(n.title)}</b>`).join(", ");

  news.className = "home-card home-news";
  news.innerHTML = `${visual(top.visual, root)}
    <div class="home-news-in">
      <span class="home-news-tag">What’s new</span>
      <div class="home-news-head">${top.visual === "epistle-apps" ? GLYPH.epistle : ""}<div><h3>${esc(top.title)}</h3><small>${esc(top.date)}</small></div></div>
      <p class="home-news-text">${esc(top.text)}</p>
      ${facts}${links}
      ${earlier.length > 0 ? `<ul class="home-news-earlier" hidden>${older}</ul>` : ""}
      <div class="home-news-foot">
        ${earlier.length > 0 ? `<button type="button" class="home-news-more" aria-expanded="false">Earlier: ${earlierNames}</button>` : "<span></span>"}
        <button type="button" class="home-news-hide">Hide</button>
      </div>
    </div>`;

  const more = news.querySelector<HTMLElement>(".home-news-more");
  const list = news.querySelector<HTMLElement>(".home-news-earlier");
  if (more && list) {
    listen("click", more, () => {
      const open = list.hidden;
      list.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      more.innerHTML = open ? "Show less" : `Earlier: ${earlierNames}`;
    });
  }
  listen("click", news.querySelector(".home-news-hide") as HTMLElement, () => {
    setHidden(top.id);
    renderPill(news, root, place);
    place();
  });
};

const renderPill = (news: HTMLElement, root: HTMLElement, place: () => void): void => {
  const [top] = NEWS;
  if (!top) return;
  news.className = "home-news-pill";
  news.innerHTML = `<button type="button">${GLYPH.spark}<span>What’s new</span><em>${esc(top.title)}</em></button>`;
  listen("click", news.querySelector("button") as HTMLElement, () => {
    setHidden(null);
    renderCard(news, root, place);
    place();
  });
};

let news: HTMLElement | null = null;
let anchor: HTMLElement | null = null;

/** The card (or the pill), placed by itself: left column on wide screens, else right after `after`.
 *  home.ts re-renders the widgets when shortcuts change: the same card is just placed again. */
export const renderNews = (root: HTMLElement, after: HTMLElement): void => {
  const [top] = NEWS;
  if (!top) return;
  anchor = after;
  const html = document.documentElement;

  const place = (): void => {
    if (!(news && anchor)) return;
    const side = SIDE.matches;
    const open = news.classList.contains("home-news");
    html.classList.toggle("home-news-side", side && open);
    html.classList.toggle("home-news-side-pill", side && !open);
    // outside #home_widgets on the side: its fade-in transform would break position: fixed
    if (side) {
      const index = root.closest(".index") ?? document.body;
      if (news.parentElement !== index) index.append(news);
    } else if (anchor.nextElementSibling !== news) {
      anchor.after(news);
    }
  };

  if (!news) {
    news = document.createElement("article");
    if (hiddenId() === top.id) renderPill(news, root, place);
    else renderCard(news, root, place);
    SIDE.addEventListener("change", place);
  }
  place();
};
