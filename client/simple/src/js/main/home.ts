// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Start page widgets: greeting + clock, shortcuts, mail (signed in), weather,
 * recent searches, on today's photo (backdrop.ts).  State is in this
 * browser's localStorage (+ the account when signed in, accountSync.ts);
 * weather, photo and mail go through this instance (/widgets/*, /account/mail).
 */

import { listen } from "../toolkit.ts";
import { history, homePrefs } from "../util/homeStore.ts";
import { needle, startLoading } from "../util/loading.ts";
import { startBackdrop } from "./backdrop.ts";

type Shortcut = { name: string; url: string };
type Place = { name: string; region?: string; lat: number; lon: number; auto?: boolean; at?: number };
type Weather = {
  unit: string;
  temp: number;
  feels: number;
  code: number;
  is_day: number;
  wind: number;
  humidity: number;
  days: { date: string; code: number; max: number; min: number }[];
};

const SHORTCUTS_KEY = "sxng-home-shortcuts";
const PLACE_KEY = "sxng-home-place";

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { name: "YouTube", url: "https://www.youtube.com" },
  { name: "GitHub", url: "https://github.com" },
  { name: "Reddit", url: "https://www.reddit.com" },
  { name: "Wikipedia", url: "https://en.wikipedia.org" },
  { name: "Maps", url: "https://www.openstreetmap.org" },
  { name: "Hacker News", url: "https://news.ycombinator.com" }
];

const ICON = {
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  // Epistle's Inbox folder glyph (the scroll, epistle app/src/ui/folderIconData.ts), in Epistle's Inbox teal
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true" class="home-inbox-glyph" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3" width="17" height="3.2" rx="1.6"/><rect x="3.5" y="17.8" width="17" height="3.2" rx="1.6"/><path d="M6 6.2v11.6M18 6.2v11.6M9 10h6M9 13.5h4.5"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>'
};

const GREETINGS: [number, string][] = [
  [5, "Good night"],
  [12, "Good morning"],
  [18, "Good afternoon"]
];
const WWW_RE = /^www\./;
const HTTP_RE = /^https?:\/\//i;

const root = document.getElementById("home_widgets");
const signedIn = document.querySelector(".account-menu") !== null;
const searchInput = document.getElementById("q") as HTMLInputElement | null;

const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const readJSON = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeJSON = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or disabled: widgets just won't persist
  }
  window.dispatchEvent(new Event("alexandria:store"));
};

const el = (html: string): HTMLElement => {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLElement;
};

const searchUrl = (query: string, category?: string): string => {
  const base = document.querySelector<HTMLElement>(".home-chips")?.dataset.searchUrl ?? "./search";
  const params = new URLSearchParams({ q: query });
  if (category) params.set("categories", category);
  return `${base}?${params.toString()}`;
};

/* ---------------------------------------------------------------- greeting */

const greeting = document.getElementById("home_greeting");

const renderGreeting = (): void => {
  if (!greeting) return;
  greeting.hidden = false;
  const now = new Date();
  const hour = now.getHours();
  const part = GREETINGS.find(([until]) => hour < until)?.[1] ?? "Good evening";
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  greeting.innerHTML = `<span class="home-greeting-hello">${part}</span><span class="home-greeting-time">${time}</span><span class="home-greeting-date">${date}</span>`;
};

/* ----------------------------------------------------------- category chips */

for (const chip of document.querySelectorAll<HTMLButtonElement>(".home-chips button")) {
  listen("click", chip, () => {
    const query = searchInput?.value.trim() ?? "";
    if (!query) {
      searchInput?.focus();
      searchInput?.classList.add("home-nudge");
      setTimeout(() => searchInput?.classList.remove("home-nudge"), 600);
      return;
    }
    startLoading();
    window.location.href = searchUrl(query, chip.dataset.cat);
  });
}

/* --------------------------------------------------------------- shortcuts */

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(WWW_RE, "");
  } catch {
    return url;
  }
};

const tileHue = (text: string): number => {
  let hash = 0;
  for (const c of text) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  return hash;
};

const renderShortcuts = (): HTMLElement => {
  const shortcuts = readJSON<Shortcut[]>(SHORTCUTS_KEY, DEFAULT_SHORTCUTS);
  const box = el('<div class="home-shortcuts" role="list"></div>');

  shortcuts.forEach((shortcut, index) => {
    const letter = (shortcut.name.trim()[0] ?? "?").toUpperCase();
    const tile = el(`
      <div class="home-shortcut" role="listitem">
        <a href="${esc(shortcut.url)}" rel="noreferrer" title="${esc(hostOf(shortcut.url))}">
          <span class="home-shortcut-icon" style="--hue:${tileHue(shortcut.name)}">${esc(letter)}<img src="./widgets/favicon?host=${encodeURIComponent(hostOf(shortcut.url))}" alt="" hidden></span>
          <span class="home-shortcut-name">${esc(shortcut.name)}</span>
        </a>
        <button type="button" class="home-shortcut-remove" aria-label="Remove ${esc(shortcut.name)}">${ICON.close}</button>
      </div>`);
    // the site's icon replaces the letter once it loads; no icon (404) = the letter stays
    const favicon = tile.querySelector("img") as HTMLImageElement;
    const showFavicon = (): void => {
      if (favicon.naturalWidth > 0) favicon.closest(".home-shortcut-icon")?.classList.add("has-favicon");
    };
    favicon.addEventListener("load", showFavicon);
    if (favicon.complete) showFavicon();
    favicon.addEventListener("error", () => favicon.remove());
    listen("click", tile.querySelector("button") as HTMLElement, () => {
      shortcuts.splice(index, 1);
      writeJSON(SHORTCUTS_KEY, shortcuts);
      render();
    });
    box.append(tile);
  });

  if (shortcuts.length < 12) {
    const add = el(`
      <div class="home-shortcut home-shortcut-add" role="listitem">
        <button type="button" class="home-shortcut-addbtn">
          <span class="home-shortcut-icon">${ICON.plus}</span>
          <span class="home-shortcut-name">Add shortcut</span>
        </button>
      </div>`);
    listen("click", add.querySelector("button") as HTMLElement, () => {
      const form = el(`
        <form class="home-card home-shortcut-form">
          <h3>Add shortcut</h3>
          <label>Name<input name="name" required maxlength="24" placeholder="e.g. Gmail"></label>
          <label>URL<input name="url" required placeholder="https://mail.google.com"></label>
          <div class="home-form-actions">
            <button type="button" class="home-btn-ghost" data-cancel>Cancel</button>
            <button type="submit" class="home-btn">Add</button>
          </div>
        </form>`) as HTMLFormElement;
      listen("click", form.querySelector("[data-cancel]") as HTMLElement, () => form.remove());
      listen("submit", form, (event: Event) => {
        event.preventDefault();
        const data = new FormData(form);
        let url = String(data.get("url") ?? "").trim();
        if (!HTTP_RE.test(url)) url = `https://${url}`;
        shortcuts.push({ name: String(data.get("name") ?? "").trim(), url: url });
        writeJSON(SHORTCUTS_KEY, shortcuts);
        render();
      });
      box.after(form);
      (form.querySelector("input") as HTMLInputElement).focus();
    });
    box.append(add);
  }
  return box;
};

/* ----------------------------------------------------------------- weather */

const WMO: Record<number, [string, string]> = {
  0: ["☀️", "Clear"],
  1: ["🌤️", "Mostly clear"],
  2: ["⛅", "Partly cloudy"],
  3: ["☁️", "Overcast"],
  45: ["🌫️", "Fog"],
  48: ["🌫️", "Rime fog"],
  51: ["🌦️", "Light drizzle"],
  53: ["🌦️", "Drizzle"],
  55: ["🌧️", "Heavy drizzle"],
  56: ["🌧️", "Freezing drizzle"],
  57: ["🌧️", "Freezing drizzle"],
  61: ["🌦️", "Light rain"],
  63: ["🌧️", "Rain"],
  65: ["🌧️", "Heavy rain"],
  66: ["🌧️", "Freezing rain"],
  67: ["🌧️", "Freezing rain"],
  71: ["🌨️", "Light snow"],
  73: ["🌨️", "Snow"],
  75: ["❄️", "Heavy snow"],
  77: ["🌨️", "Snow grains"],
  80: ["🌦️", "Showers"],
  81: ["🌧️", "Showers"],
  82: ["⛈️", "Violent showers"],
  85: ["🌨️", "Snow showers"],
  86: ["❄️", "Snow showers"],
  95: ["⛈️", "Thunderstorm"],
  96: ["⛈️", "Thunder + hail"],
  99: ["⛈️", "Thunder + hail"]
};

const wmo = (code: number, isDay = 1): [string, string] => {
  const [icon, text] = WMO[code] ?? ["🌡️", "—"];
  return [code === 0 && !isDay ? "🌙" : icon, text];
};

const WIDGET_URLS = { geocode: "geocodeUrl", weather: "weatherUrl", locate: "locateUrl" } as const;
const widgetUrl = (kind: keyof typeof WIDGET_URLS): string => root?.dataset[WIDGET_URLS[kind]] ?? `./widgets/${kind}`;

const AUTO_TTL = 6 * 3600 * 1000;

// a city the user picked wins; otherwise the rough location of their IP (asked from this server, cached 6 h)
const resolvePlace = async (): Promise<Place | null> => {
  const saved = readJSON<Place | null>(PLACE_KEY, null);
  if (saved && !saved.auto) return saved;
  if (saved?.auto && Date.now() - (saved.at ?? 0) < AUTO_TTL) return saved;
  try {
    const res = await fetch(widgetUrl("locate"));
    if (!res.ok) throw new Error(String(res.status));
    const found = (await res.json()) as Place;
    const place: Place = {
      name: found.name,
      region: found.region,
      lat: found.lat,
      lon: found.lon,
      auto: true,
      at: Date.now()
    };
    writeJSON(PLACE_KEY, place);
    return place;
  } catch {
    return saved;
  }
};

const renderWeatherSetup = (card: HTMLElement): void => {
  card.innerHTML = `
    <h3>${ICON.pin}Weather</h3>
    <p class="home-muted">Pick a city, or let it follow your rough location (from your IP address). Stored in this browser only.</p>
    <button type="button" class="home-link-btn home-use-location" data-auto>${ICON.pin}Use my location</button>
    <div class="home-place-search">
      <input type="text" placeholder="Search a city…" aria-label="City" autocomplete="off">
      <ul class="home-place-results" role="listbox"></ul>
    </div>`;
  const input = card.querySelector("input") as HTMLInputElement;
  const list = card.querySelector("ul") as HTMLUListElement;
  let timer: number | undefined;

  listen("click", card.querySelector("[data-auto]") as HTMLElement, () => {
    localStorage.removeItem(PLACE_KEY);
    window.dispatchEvent(new Event("alexandria:store"));
    void renderWeather(card);
  });

  listen("input", input, () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const query = input.value.trim();
      if (query.length < 2) {
        list.innerHTML = "";
        return;
      }
      try {
        const res = await fetch(`${widgetUrl("geocode")}?q=${encodeURIComponent(query)}`);
        const { results = [] } = (await res.json()) as { results?: Place[] };
        list.innerHTML = "";
        if (results.length === 0) list.innerHTML = '<li class="home-muted">No matches</li>';
        for (const place of results) {
          const item = el(
            `<li role="option" tabindex="0"><strong>${esc(place.name)}</strong> <span>${esc(place.region ?? "")}</span></li>`
          );
          const pick = (): void => {
            writeJSON(PLACE_KEY, place);
            void renderWeather(card);
          };
          listen("click", item, pick);
          listen("keydown", item, (event: KeyboardEvent) => {
            if (event.key === "Enter") pick();
          });
          list.append(item);
        }
      } catch {
        list.innerHTML = '<li class="home-muted">Lookup failed, try again</li>';
      }
    }, 250);
  });
};

const renderWeather = async (card: HTMLElement): Promise<void> => {
  card.innerHTML = `<h3>${ICON.pin}Weather</h3><div class="home-weather-wait"></div>`;
  card.querySelector(".home-weather-wait")?.append(needle("Loading weather"));
  const place = await resolvePlace();
  if (!place) {
    renderWeatherSetup(card);
    return;
  }
  const title = `${esc(place.name)}${place.auto ? '<span class="home-near">near you</span>' : ""}`;
  try {
    const unit = homePrefs.fahrenheit ? "f" : "c";
    const res = await fetch(`${widgetUrl("weather")}?lat=${place.lat}&lon=${place.lon}&unit=${unit}`);
    if (!res.ok) throw new Error(String(res.status));
    const w = (await res.json()) as Weather;
    const [icon, text] = wmo(w.code, w.is_day);
    const days = w.days
      .slice(1, 4)
      .map((day) => {
        const [dayIcon] = wmo(day.code);
        const name = new Date(`${day.date}T12:00`).toLocaleDateString([], { weekday: "short" });
        return `<li><span>${name}</span><span class="home-weather-dicon">${dayIcon}</span><span>${Math.round(day.max)}°<small>${Math.round(day.min)}°</small></span></li>`;
      })
      .join("");
    const [today] = w.days;
    card.innerHTML = `
      <h3>${ICON.pin}${title}
        <button type="button" class="home-icon-btn" data-change title="Change city" aria-label="Change city">${ICON.edit}</button>
      </h3>
      <div class="home-weather-now">
        <span class="home-weather-icon">${icon}</span>
        <span class="home-weather-temp">${Math.round(w.temp)}<small>${esc(w.unit)}</small></span>
        <span class="home-weather-meta">
          <strong>${text}</strong>
          <span>Feels ${Math.round(w.feels)}° · ${today ? `${Math.round(today.max)}° / ${Math.round(today.min)}°` : ""}</span>
          <span>💨 ${Math.round(w.wind)} km/h · 💧 ${Math.round(w.humidity)}%</span>
        </span>
      </div>
      <ul class="home-weather-days">${days}</ul>`;
    listen("click", card.querySelector("[data-change]") as HTMLElement, () => {
      renderWeatherSetup(card);
      (card.querySelector("input") as HTMLInputElement).focus();
    });
  } catch {
    card.innerHTML = `<h3>${ICON.pin}${title}</h3><p class="home-muted">Weather is unavailable right now.</p>`;
  }
};

/* ---------------------------------------------------------- recent searches */

const renderRecent = (card: HTMLElement): void => {
  const items = history.list();
  const all = root?.dataset.historyUrl ?? "/history";
  // clearing it all is on /history ("Clear all")
  card.innerHTML = `<h3>${ICON.clock}Recent searches<a class="home-link-btn" href="${esc(all)}">See all</a></h3>`;

  if (!homePrefs.remember) {
    card.append(el(`<p class="home-muted">Search history is paused. Turn it back on on the <a href="${esc(all)}">history page</a>.</p>`));
    return;
  }
  if (items.length === 0) {
    // signed in, they're kept in the Epistle account too (accountSync.ts)
    const where = document.querySelector(".account-menu")
      ? "Kept in your Epistle account, on every device you sign in on."
      : "Only on this device, never on the server.";
    card.append(el(`<p class="home-muted">Your searches show up here. ${where}</p>`));
    return;
  }

  const list = el('<ul class="home-recent"></ul>');
  for (const query of items.slice(0, 8)) {
    const item = el(
      `<li><a href="${esc(searchUrl(query))}">${ICON.clock}<span>${esc(query)}</span></a><button type="button" aria-label="Forget">${ICON.close}</button></li>`
    );
    listen("click", item.querySelector("button") as HTMLElement, () => {
      history.remove(query);
      renderRecent(card);
    });
    list.append(item);
  }
  card.append(list);
};

/* -------------------------------------------------------------------- mail */

type Letter = { from: string; email: string; subject: string; encrypted: boolean; date: string; url: string };
type Mail = { state: string; unseen?: number; messages?: Letter[]; inbox_url?: string; compose_url?: string };

const MAIL_REFRESH_MS = 90_000;

const ago = (iso: string): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h`;
  if (mins < 6 * 24 * 60) return new Date(t).toLocaleDateString([], { weekday: "short" });
  return new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });
};

const renderMail = async (card: HTMLElement): Promise<void> => {
  if (!card.querySelector(".home-mail-list, .home-mail-done")) {
    card.innerHTML = `<h3>${ICON.mail}Inbox</h3><div class="home-weather-wait"></div>`;
    card.querySelector(".home-weather-wait")?.append(needle("Loading mail"));
  }
  let mail: Mail = { state: "unavailable" };
  try {
    const res = await fetch(root?.dataset.mailUrl ?? "/account/mail", {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (res.ok) mail = (await res.json()) as Mail;
  } catch {
    // offline: "not reachable" below
  }
  if (mail.state !== "ok") {
    card.innerHTML = `<h3>${ICON.mail}Inbox</h3><p class="home-muted">Your mail isn’t reachable right now. It’ll show up here again on its own.</p>`;
    return;
  }
  const unseen = mail.unseen ?? 0;
  const letters = mail.messages ?? [];
  const open = esc(mail.inbox_url ?? "#");
  const head = `<h3>${ICON.mail}Inbox${
    unseen ? `<span class="home-mail-count">${unseen > 999 ? "999+" : unseen} unread</span>` : ""
  }<a class="home-link-btn" href="${open}">Open Epistle</a></h3>`;
  if (letters.length === 0) {
    card.innerHTML = `${head}<div class="home-mail-done"><span>✨</span><p><strong>You’re all caught up</strong>No unread letters in your Inbox.</p></div>`;
    return;
  }
  const rows = letters
    .map((m) => {
      const subject = m.encrypted
        ? `<span class="home-mail-lock">${ICON.lock}Encrypted letter</span>`
        : esc(m.subject || "(no subject)");
      return `<li><a href="${esc(m.url)}">
        <span class="home-mail-avatar" style="--hue:${tileHue(m.email || m.from)}">${esc((m.from.trim()[0] ?? "?").toUpperCase())}</span>
        <span class="home-mail-text"><strong>${esc(m.from)}</strong><span>${subject}</span></span>
        <time>${ago(m.date)}</time></a></li>`;
    })
    .join("");
  const more =
    unseen > letters.length
      ? `<a class="home-mail-more" href="${open}">+${unseen - letters.length} more unread</a>`
      : "";
  card.innerHTML = `${head}<ul class="home-mail-list">${rows}</ul>${more}`;
};

let mailTimer: number | undefined;

const watchMail = (card: HTMLElement): void => {
  void renderMail(card);
  window.clearInterval(mailTimer);
  mailTimer = window.setInterval(() => {
    if (document.visibilityState === "visible" && card.isConnected) void renderMail(card);
  }, MAIL_REFRESH_MS);
};

document.addEventListener("visibilitychange", () => {
  const card = document.querySelector<HTMLElement>(".home-mail");
  if (document.visibilityState === "visible" && card) void renderMail(card);
});

/* ------------------------------------------------------------------ layout */

// the same page for everyone: no Customize (Martynas, 2026-10-25). Old saved widget switches are ignored.
const render = (): void => {
  if (!root) return;
  renderGreeting();
  root.innerHTML = "";

  root.append(renderShortcuts());

  const cards = el('<div class="home-cards"></div>');
  if (signedIn) {
    const card = el('<article class="home-card home-mail"></article>');
    watchMail(card);
    cards.append(card);
  }
  {
    const card = el('<article class="home-card home-weather"></article>');
    void renderWeather(card);
    cards.append(card);
  }
  {
    const card = el('<article class="home-card"></article>');
    renderRecent(card);
    cards.append(card);
  }
  root.append(cards);
};

startBackdrop();
render();
setInterval(renderGreeting, 15_000);
