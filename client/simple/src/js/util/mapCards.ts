// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The Map tab's place cards (main/mapMode.ts), Google Maps style: name, kind
 * of place + stars + wheelchair, address on one line, opening hours, a photo,
 * Directions / Website / Call.  The result template gives what the search
 * engine knew (result_templates/map.html, <script class="map-card-data">);
 * /widgets/cards (searx/places.py) fills in the rest for the whole page in
 * one request.  Martynas, 2026-11-17: the stock cards were "not a nice
 * display of the locations, not much info and not pretty".
 */

import { hoursLines } from "./hours.ts";

export type CardData = {
  title: string;
  url: string;
  website: string;
  address: {
    name?: string;
    house_number?: string;
    road?: string;
    locality?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
  osm: { type?: string; id?: number };
};

type CardInfo = {
  kind?: string;
  stars?: number;
  hours?: string;
  phone?: string;
  website?: string;
  wheelchair?: string;
  image?: string;
};

const ICON = {
  route:
    '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  globe:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z"/>',
  phone:
    '<path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
};
const glyph = (name: keyof typeof ICON): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const SPACES = /\s+/g;
const TAGS = /<[^>]*>/g;

// house number first in these countries ("10 Downing Street"), after the street elsewhere ("Promenadeplatz 6")
const NUMBER_FIRST = new Set(["us", "gb", "ie", "fr", "ca", "au", "nz", "lu", "be"]);
const NUMBER_FIRST_NAMES = new Set([
  "United States",
  "United Kingdom",
  "Ireland",
  "France",
  "Canada",
  "Australia",
  "New Zealand"
]);

export const readCardData = (card: HTMLElement): CardData | undefined => {
  const raw = card.querySelector("script.map-card-data")?.textContent;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as CardData;
  } catch {
    return undefined;
  }
};

export const cardName = (data: CardData): string => (data.address.name || data.title.replace(TAGS, "")).trim();

const addressLine = (data: CardData): string => {
  const { house_number: num, road, locality, postcode, country, country_code: cc } = data.address;
  const numberFirst = NUMBER_FIRST.has((cc ?? "").toLowerCase()) || NUMBER_FIRST_NAMES.has(country ?? "");
  let street = road ?? "";
  if (num && road) street = numberFirst ? `${num} ${road}` : `${road} ${num}`;
  const town = [postcode, locality].filter(Boolean).join(" ");
  return [street, town].filter(Boolean).join(", ");
};

/** Same name at the same address (OpenStreetMap often has the point and the building): show it once. */
export const cardKey = (data: CardData): string =>
  [cardName(data), data.address.road, data.address.house_number].join("|").toLowerCase();

export const osmRef = (data: CardData): string => {
  const letter = { node: "N", way: "W", relation: "R" }[data.osm.type ?? ""];
  return letter && data.osm.id ? `${letter}${data.osm.id}` : "";
};

const actionsHtml = (data: CardData, lat: number, lon: number, info: CardInfo): string => {
  const website = info.website || data.website;
  const directions = `https://www.openstreetmap.org/directions?to=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
  return [
    `<a class="map-chip map-chip-main" href="${esc(directions)}" rel="noopener noreferrer">${glyph("route")}Directions</a>`,
    website ? `<a class="map-chip" href="${esc(website)}" rel="noopener noreferrer">${glyph("globe")}Website</a>` : "",
    info.phone ? `<a class="map-chip" href="tel:${esc(info.phone.replace(SPACES, ""))}">${glyph("phone")}Call</a>` : ""
  ].join("");
};

const metaHtml = (info: CardInfo): string => {
  const bits: string[] = [];
  if (info.kind) bits.push(esc(info.kind));
  if (info.stars)
    bits.push(`<span class="map-card-stars" aria-label="${info.stars} stars">${"★".repeat(info.stars)}</span>`);
  if (info.wheelchair === "yes") bits.push('<span title="Wheelchair accessible">♿ Accessible</span>');
  else if (info.wheelchair === "limited") bits.push('<span title="Partly wheelchair accessible">♿ Partly</span>');
  return bits.join('<span class="map-card-dot" aria-hidden="true">·</span>');
};

/** Replace the stock result with the place card (number badge, text, actions, photo slot). */
export const renderCard = (card: HTMLElement, data: CardData, n: number, lat: number, lon: number): void => {
  card.classList.add("map-card");
  card.innerHTML = `<span class="map-num" aria-hidden="true">${n}</span>
    <div class="map-card-main">
      <h3 class="map-card-title">${esc(cardName(data))}</h3>
      <p class="map-card-meta"></p>
      <p class="map-card-address">${esc(addressLine(data))}</p>
      <p class="map-card-hours" hidden></p>
      <div class="map-card-actions">${actionsHtml(data, lat, lon, {})}</div>
    </div>
    <a class="map-card-photo" href="${esc(data.url)}" rel="noopener noreferrer" hidden aria-hidden="true" tabindex="-1"></a>`;
  card.dataset.mapLat = String(lat);
  card.dataset.mapLon = String(lon);
};

const fillCard = (card: HTMLElement, data: CardData, info: CardInfo): void => {
  const meta = card.querySelector<HTMLElement>(".map-card-meta");
  if (meta) meta.innerHTML = metaHtml(info);
  const hours = card.querySelector<HTMLElement>(".map-card-hours");
  if (hours && info.hours) {
    const lines = hoursLines(info.hours);
    hours.innerHTML = `${glyph("clock")}<span>${lines.slice(0, 2).map(esc).join(" · ")}${lines.length > 2 ? " …" : ""}</span>`;
    hours.title = lines.join("\n");
    hours.hidden = false;
  }
  const actions = card.querySelector<HTMLElement>(".map-card-actions");
  if (actions) {
    actions.innerHTML = actionsHtml(data, Number(card.dataset.mapLat), Number(card.dataset.mapLon), info);
  }
  const photo = card.querySelector<HTMLElement>(".map-card-photo");
  if (photo && info.image) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.src = info.image;
    img.addEventListener("error", () => photo.remove());
    photo.append(img);
    photo.hidden = false;
  }
};

/** What OpenStreetMap + Wikidata know about every card, in one request (/widgets/cards). */
export const enrichCards = async (url: string, cards: { card: HTMLElement; data: CardData }[]): Promise<void> => {
  const refs = cards.map(({ data }) => osmRef(data)).filter(Boolean);
  if (refs.length === 0) return;
  const res = await fetch(`${url}?ids=${refs.join(",")}`);
  if (!res.ok) return;
  const infos = (await res.json()) as Record<string, CardInfo>;
  for (const { card, data } of cards) {
    const info = infos[osmRef(data)];
    if (info) fillCard(card, data, info);
  }
};
