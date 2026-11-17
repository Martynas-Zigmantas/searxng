// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The place card (elements/infobox.html, searx/places.py): a knowledge panel
 * with coordinates gets a map on top and what OpenStreetMap knows about the
 * place under its name (kind of place, address, opening hours, phone,
 * website, directions).  Map data comes through this instance
 * (/widgets/vtile), drawn in the visitor's map look (util/mapStyle.ts).
 */

import "ol/ol.css";
import { Feature, Map as OlMap, View } from "ol";
import { defaults as defaultControls } from "ol/control";
import { Point } from "ol/geom";
import { defaults as defaultInteractions } from "ol/interaction";
import { Vector as VectorLayer } from "ol/layer";
import { fromLonLat, transformExtent } from "ol/proj";
import { Vector as VectorSource } from "ol/source";
import { Icon, Style } from "ol/style";
import { alexandriaLayer, currentLook } from "../util/mapStyle.ts";

type Place = {
  kind: string;
  address: string[];
  hours: string;
  phone: string;
  website: string;
  directions: string;
  bbox: number[]; // [south, north, west, east] of the place's outline, or []
};

const ICON = {
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  phone:
    '<path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z"/>',
  globe:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z"/>',
  route:
    '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>'
};

const glyph = (name: keyof typeof ICON): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

// the pin on the map, in the map look's colour (Alexandria's plum by day)
const LOOK = currentLook();
const PIN = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44"><path d="M17 43s15-13.4 15-26A15 15 0 0 0 2 17c0 12.6 15 26 15 26z" fill="${LOOK.pin}" stroke="#fff" stroke-width="2.5"/><circle cx="17" cy="17" r="5.5" fill="${LOOK.pinInk}"/></svg>`
)}`;

const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const DAYS: Record<string, string> = {
  Mo: "Mon",
  Tu: "Tue",
  We: "Wed",
  Th: "Thu",
  Fr: "Fri",
  Sa: "Sat",
  Su: "Sun",
  PH: "Holidays"
};
const SPACES = /\s+/g;
const WEB_PREFIX = /^https?:\/\/(www\.)?/;
const TRAILING_SLASH = /\/$/;
const DAY_RANGE = /(\w{3})-(\w{3})/g;
const OFF = /\boff\b/g;
const DAY_CODE = /\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g;
const TIME_RANGE = /(\d{2}:\d{2})-(\d{2}:\d{2})/g;

// OpenStreetMap's opening_hours ("Mo-Fr 09:00-17:00; Sa 10:00-14:00") as lines people read
const hoursLines = (hours: string): string[] => {
  if (hours.trim() === "24/7") return ["Open 24 hours"];
  return hours
    .split(";")
    .map((part) =>
      part
        .trim()
        .replace(TIME_RANGE, "$1–$2")
        .replace(DAY_CODE, (code) => DAYS[code] ?? code)
        .replace(DAY_RANGE, "$1–$2")
        .replace(OFF, "closed")
    )
    .filter(Boolean)
    .slice(0, 8);
};

const row = (icon: keyof typeof ICON, html: string): string =>
  `<div class="place-row">${glyph(icon)}<div>${html}</div></div>`;

const showDetails = async (box: HTMLElement): Promise<Place | undefined> => {
  const { url } = box.dataset;
  if (!url) return undefined;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const place = (await res.json()) as Place;

  const rows: string[] = [];
  if (place.address.length > 0) rows.push(row("pin", place.address.map(esc).join("<br>")));
  if (place.hours) rows.push(row("clock", hoursLines(place.hours).map(esc).join("<br>")));
  if (place.phone)
    rows.push(row("phone", `<a href="tel:${esc(place.phone.replace(SPACES, ""))}">${esc(place.phone)}</a>`));
  if (place.website) {
    const host = place.website.replace(WEB_PREFIX, "").replace(TRAILING_SLASH, "");
    rows.push(row("globe", `<a href="${esc(place.website)}" rel="noopener noreferrer">${esc(host)}</a>`));
  }

  const actions = [
    `<a class="place-action place-action-main" href="${esc(place.directions)}" rel="noopener noreferrer">${glyph("route")}Directions</a>`,
    place.website
      ? `<a class="place-action" href="${esc(place.website)}" rel="noopener noreferrer">${glyph("globe")}Website</a>`
      : "",
    place.phone
      ? `<a class="place-action" href="tel:${esc(place.phone.replace(SPACES, ""))}">${glyph("phone")}Call</a>`
      : ""
  ].join("");

  box.innerHTML = `${place.kind ? `<p class="place-kind">${esc(place.kind)}</p>` : ""}
    <div class="place-actions">${actions}</div>
    ${rows.length > 0 ? `<div class="place-rows">${rows.join("")}</div>` : ""}`;
  box.hidden = false;
  return place;
};

const showMap = (el: HTMLElement): View | undefined => {
  const lat = Number.parseFloat(el.dataset.lat ?? "");
  const lon = Number.parseFloat(el.dataset.lon ?? "");
  if (Number.isNaN(lat) || Number.isNaN(lon)) return undefined;
  const zoom = Math.min(Number.parseInt(el.dataset.zoom ?? "16", 10) || 16, 17);

  const pin = new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
  pin.setStyle(new Style({ image: new Icon({ src: PIN, anchor: [0.5, 1], width: 30 }) }));

  const view = new View({ center: fromLonLat([lon, lat]), zoom: zoom, maxZoom: 18, enableRotation: false });
  new OlMap({
    target: el,
    layers: [
      // Alexandria's own look (util/mapStyle.ts): vector tiles through this instance, coloured here
      alexandriaLayer(el.dataset.vtiles ?? "/widgets/vtile/", LOOK),
      new VectorLayer({ source: new VectorSource({ features: [pin] }) })
    ],
    // scrolling the page over the map scrolls the page; zoom with the buttons, pinch or a double click
    interactions: defaultInteractions({ mouseWheelZoom: false }),
    controls: defaultControls({ rotate: false, attributionOptions: { collapsible: false } }),
    view: view
  });
  return view;
};

for (const card of document.querySelectorAll<HTMLElement>(".infobox-place")) {
  const mapEl = card.querySelector<HTMLElement>(".place-map");
  const view = mapEl ? showMap(mapEl) : undefined;
  const box = card.querySelector<HTMLElement>(".place-details");
  if (box) {
    void showDetails(box)
      .then((place) => {
        // Wikidata's zoom guess is often far off (its area is in m², the guess wants km²): fit the place's real outline
        const [south, north, west, east] = place?.bbox ?? [];
        if (view && south !== undefined && north !== undefined && west !== undefined && east !== undefined) {
          view.fit(transformExtent([west, south, east, north], "EPSG:4326", "EPSG:3857"), {
            padding: [30, 30, 30, 30],
            maxZoom: 17,
            duration: 250
          });
        }
      })
      .catch(() => undefined);
  }
}
