// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Start page widgets: greeting + clock, shortcuts, weather, recent searches
 * and a !bang cheat sheet.  Everything is stored in this browser's
 * localStorage only; weather goes through this instance (/widgets/*).
 */

import { listen } from "../toolkit.ts";
import { type HomePrefs, history, homePrefs, saveHomePrefs } from "../util/homeStore.ts";
import { needle, startLoading } from "../util/loading.ts";

type Shortcut = { name: string; url: string };
type Place = { name: string; region?: string; lat: number; lon: number };
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

const BANGS: [string, string][] = [
  ["!g", "Google only"],
  ["!w", "Wikipedia"],
  ["!yt", "YouTube"],
  ["!gh", "GitHub"],
  ["!re", "Reddit"],
  [":en", "Results in English"],
  ["!!g", "Jump straight to Google"]
];

const ICON = {
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>'
};

const GREETINGS: [number, string][] = [
  [5, "Good night"],
  [12, "Good morning"],
  [18, "Good afternoon"]
];
const WWW_RE = /^www\./;
const HTTP_RE = /^https?:\/\//i;
const BANG_RE = /^[!:]\S+\s*/;

const root = document.getElementById("home_widgets");
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
  if (!homePrefs.clock) {
    greeting.hidden = true;
    return;
  }
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
          <span class="home-shortcut-icon" style="--hue:${tileHue(shortcut.name)}">${esc(letter)}</span>
          <span class="home-shortcut-name">${esc(shortcut.name)}</span>
        </a>
        <button type="button" class="home-shortcut-remove" aria-label="Remove ${esc(shortcut.name)}">${ICON.close}</button>
      </div>`);
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

const widgetUrl = (kind: "geocode" | "weather"): string =>
  (kind === "geocode" ? root?.dataset.geocodeUrl : root?.dataset.weatherUrl) ?? `./widgets/${kind}`;

const renderWeatherSetup = (card: HTMLElement): void => {
  card.innerHTML = `
    <h3>${ICON.pin}Weather</h3>
    <p class="home-muted">Pick a city to see the forecast. It's stored in this browser only.</p>
    <div class="home-place-search">
      <input type="text" placeholder="Search a city…" aria-label="City" autocomplete="off">
      <ul class="home-place-results" role="listbox"></ul>
    </div>`;
  const input = card.querySelector("input") as HTMLInputElement;
  const list = card.querySelector("ul") as HTMLUListElement;
  let timer: number | undefined;

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
  const place = readJSON<Place | null>(PLACE_KEY, null);
  if (!place) {
    renderWeatherSetup(card);
    return;
  }

  card.innerHTML = `<h3>${ICON.pin}${esc(place.name)}</h3><div class="home-weather-wait"></div>`;
  card.querySelector(".home-weather-wait")?.append(needle("Loading weather"));
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
      <h3>${ICON.pin}${esc(place.name)}
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
      localStorage.removeItem(PLACE_KEY);
      renderWeatherSetup(card);
      (card.querySelector("input") as HTMLInputElement).focus();
    });
  } catch {
    card.innerHTML = `<h3>${ICON.pin}${esc(place.name)}</h3><p class="home-muted">Weather is unavailable right now.</p>`;
  }
};

/* ---------------------------------------------------------- recent searches */

const renderRecent = (card: HTMLElement): void => {
  const items = history.list();
  card.innerHTML = `<h3>${ICON.clock}Recent searches${
    items.length > 0 ? '<button type="button" class="home-link-btn" data-clear>Clear</button>' : ""
  }</h3>`;

  if (!homePrefs.remember) {
    card.append(el('<p class="home-muted">Search history is off. Turn it on in Customize.</p>'));
    return;
  }
  if (items.length === 0) {
    card.append(el('<p class="home-muted">Your searches show up here. Only on this device, never on the server.</p>'));
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
  listen("click", card.querySelector("[data-clear]") as HTMLElement, () => {
    history.clear();
    renderRecent(card);
  });
};

/* ------------------------------------------------------------------- bangs */

const renderBangs = (card: HTMLElement): void => {
  card.innerHTML = `<h3><span class="home-bang-mark">!</span>Search shortcuts</h3>
    <p class="home-muted">Type these in front of a query.</p>
    <ul class="home-bangs">${BANGS.map(([bang, what]) => `<li><button type="button" data-bang="${esc(bang)}"><code>${esc(bang)}</code><span>${esc(what)}</span></button></li>`).join("")}</ul>`;
  for (const button of card.querySelectorAll<HTMLButtonElement>("[data-bang]")) {
    listen("click", button, () => {
      if (!searchInput) return;
      const query = searchInput.value.replace(BANG_RE, "");
      searchInput.value = `${button.dataset.bang} ${query}`;
      searchInput.focus();
      searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    });
  }
};

/* --------------------------------------------------------------- customize */

const TOGGLES: [keyof HomePrefs, string][] = [
  ["clock", "Greeting & clock"],
  ["shortcuts", "Shortcuts"],
  ["weather", "Weather"],
  ["recent", "Recent searches"],
  ["bangs", "Search shortcuts (!bangs)"],
  ["remember", "Remember my searches"],
  ["fahrenheit", "Use °F"]
];

const renderCustomize = (): HTMLElement => {
  const wrap = el(`
    <div class="home-customize">
      <button type="button" class="home-customize-btn" aria-expanded="false">${ICON.edit}<span>Customize</span></button>
      <div class="home-card home-customize-panel" hidden>
        <h3>Customize this page</h3>
        ${TOGGLES.map(
          ([key, label]) =>
            `<label class="home-toggle"><input type="checkbox" data-key="${key}" ${homePrefs[key] ? "checked" : ""}><span>${label}</span></label>`
        ).join("")}
        <button type="button" class="home-link-btn" data-reset>Reset shortcuts</button>
      </div>
    </div>`);
  const button = wrap.querySelector(".home-customize-btn") as HTMLButtonElement;
  const panel = wrap.querySelector(".home-customize-panel") as HTMLElement;

  listen("click", button, () => {
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
  });
  for (const input of panel.querySelectorAll<HTMLInputElement>("input[data-key]")) {
    listen("change", input, () => {
      homePrefs[input.dataset.key as keyof HomePrefs] = input.checked;
      if (input.dataset.key === "remember" && !input.checked) history.clear();
      saveHomePrefs();
      render(true);
    });
  }
  listen("click", panel.querySelector("[data-reset]") as HTMLElement, () => {
    localStorage.removeItem(SHORTCUTS_KEY);
    render(true);
  });
  return wrap;
};

/* ------------------------------------------------------------------ layout */

const render = (keepPanelOpen = false): void => {
  if (!root) return;
  renderGreeting();
  root.innerHTML = "";

  if (homePrefs.shortcuts) root.append(renderShortcuts());

  const cards = el('<div class="home-cards"></div>');
  if (homePrefs.weather) {
    const card = el('<article class="home-card home-weather"></article>');
    void renderWeather(card);
    cards.append(card);
  }
  if (homePrefs.recent) {
    const card = el('<article class="home-card"></article>');
    renderRecent(card);
    cards.append(card);
  }
  if (homePrefs.bangs) {
    const card = el('<article class="home-card"></article>');
    renderBangs(card);
    cards.append(card);
  }
  if (cards.childElementCount) root.append(cards);

  const customize = renderCustomize();
  if (keepPanelOpen) {
    (customize.querySelector(".home-customize-panel") as HTMLElement).hidden = false;
  }
  root.append(customize);
};

render();
setInterval(renderGreeting, 15_000);
