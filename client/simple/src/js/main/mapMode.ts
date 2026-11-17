// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The Map tab (results.html adds #map_view when every result is a place):
 * one big map with a numbered pin per result, the list beside it (under it
 * on phones).  Pin <-> card: clicking a pin picks its card, clicking a card
 * flies to its pin and draws the place's outline.  Tiles come through this
 * instance (/widgets/tile), so the browser never talks to OpenStreetMap.
 * Martynas, 2026-11-17: "map should mean map".
 */

import "ol/ol.css";
import { Feature, Map as OlMap, Overlay, View } from "ol";
import { defaults as defaultControls } from "ol/control";
import { boundingExtent, type Extent } from "ol/extent";
import { GeoJSON } from "ol/format";
import { Point } from "ol/geom";
import { Vector as VectorLayer } from "ol/layer";
import { fromLonLat, transformExtent } from "ol/proj";
import { Vector as VectorSource } from "ol/source";
import { getDistance } from "ol/sphere";
import { Fill, Icon, Stroke, Style } from "ol/style";
import { type CardData, cardKey, enrichCards, readCardData, renderCard } from "../util/mapCards.ts";
import { alexandriaLayer, currentLook } from "../util/mapStyle.ts";

const LOOK = currentLook();

type Place = {
  n: number;
  card: HTMLElement;
  title: string;
  lon: number;
  lat: number;
  bbox?: Extent; // EPSG:3857
  geojson?: string;
  pin: Feature<Point>;
  at: number[]; // the pin, EPSG:3857
};

const mapEl = document.querySelector<HTMLElement>("#map_view");

// numbered pin in the map look's colour (plum by day); the picked one is gold and a bit bigger
const pinSvg = (n: number, picked: boolean): string => {
  const fill = picked ? "#C9A24A" : LOOK.pin;
  const ink = picked ? "#4A1238" : LOOK.pinInk;
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44"><path d="M17 43s15-13.4 15-26A15 15 0 0 0 2 17c0 12.6 15 26 15 26z" fill="${fill}" stroke="#fff" stroke-width="2.5"/><text x="17" y="22" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${n > 9 ? 12 : 14}" font-weight="700" fill="${ink}">${n}</text></svg>`
  )}`;
};

const styles = new Map<string, Style>();
const pinStyle = (n: number, picked: boolean): Style => {
  const key = `${n}-${picked}`;
  let style = styles.get(key);
  if (!style) {
    style = new Style({
      image: new Icon({ src: pinSvg(n, picked), anchor: [0.5, 1], width: picked ? 38 : 30 }),
      zIndex: picked ? 1000 : 100 - n
    });
    styles.set(key, style);
  }
  return style;
};

const readPlace = (card: HTMLElement, n: number): Place | undefined => {
  const link = card.querySelector<HTMLElement>("[data-leaflet-target]");
  if (!link) return undefined;
  const { mapLat, mapLon, mapBoundingbox, mapGeojson } = link.dataset;
  let lat = Number.parseFloat(mapLat ?? "");
  let lon = Number.parseFloat(mapLon ?? "");
  let bbox: Extent | undefined;
  if (mapBoundingbox) {
    try {
      // [south, north, west, east]
      const [s, nn, w, e] = (JSON.parse(mapBoundingbox) as (string | number)[]).map(Number);
      if ([s, nn, w, e].every((v) => v !== undefined && Number.isFinite(v))) {
        if (Number.isNaN(lat) || Number.isNaN(lon)) {
          lat = ((s as number) + (nn as number)) / 2;
          lon = ((w as number) + (e as number)) / 2;
        }
        if (s !== nn || w !== e) {
          bbox = transformExtent([w as number, s as number, e as number, nn as number], "EPSG:4326", "EPSG:3857");
        }
      }
    } catch {
      // no usable box
    }
  }
  if (Number.isNaN(lat) || Number.isNaN(lon)) return undefined;
  const at = fromLonLat([lon, lat]);
  const pin = new Feature({ geometry: new Point(at) });
  pin.setStyle(pinStyle(n, false));
  pin.set("n", n);
  const title = card.querySelector("h3")?.textContent?.trim() ?? "";
  return { n: n, card: card, title: title, lon: lon, lat: lat, bbox: bbox, geojson: mapGeojson, pin: pin, at: at };
};

if (mapEl) {
  document.documentElement.classList.add("map-mode");
  const cards = [...document.querySelectorAll<HTMLElement>("#urls article.result-map")];
  const places: Place[] = [];
  const shown: { card: HTMLElement; data: CardData }[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const data = readCardData(card);
    if (data) {
      // the same place twice (OpenStreetMap's point and its building): keep the first
      const key = cardKey(data);
      if (seen.has(key)) {
        card.remove();
        continue;
      }
      seen.add(key);
    }
    const place = readPlace(card, places.length + 1);
    if (!place) continue;
    places.push(place);
    card.dataset.mapN = String(place.n);
    if (data) {
      renderCard(card, data, place.n, place.lat, place.lon);
      shown.push({ card: card, data: data });
    } else {
      const badge = document.createElement("span");
      badge.className = "map-num";
      badge.textContent = String(place.n);
      badge.setAttribute("aria-hidden", "true");
      card.prepend(badge);
    }
  }
  if (mapEl.dataset.cards) void enrichCards(mapEl.dataset.cards, shown).catch(() => undefined);

  const [top] = places;
  if (top) {
    const pins = new VectorSource({ features: places.map((p) => p.pin) });
    const outline = new VectorSource();
    const view = new View({
      center: fromLonLat([top.lon, top.lat]),
      zoom: 14,
      maxZoom: 18,
      enableRotation: false
    });

    const label = document.createElement("div");
    label.className = "map-label";
    const overlay = new Overlay({ element: label, positioning: "bottom-center", offset: [0, -46], stopEvent: false });

    const map = new OlMap({
      target: mapEl,
      layers: [
        // Alexandria's own look (util/mapStyle.ts): vector tiles through this instance, coloured here
        alexandriaLayer(mapEl.dataset.vtiles ?? "/widgets/vtile/", LOOK),
        new VectorLayer({
          source: outline,
          style: new Style({
            stroke: new Stroke({ color: "#4A1238", width: 2.5 }),
            fill: new Fill({ color: "rgba(201,162,74,0.18)" })
          })
        }),
        new VectorLayer({ source: pins })
      ],
      overlays: [overlay],
      controls: defaultControls({ rotate: false, attributionOptions: { collapsible: false } }),
      view: view
    });

    // first view: every pin near the top result (one far-away namesake shouldn't zoom out to the whole planet)
    const near = places.filter((p) => getDistance([top.lon, top.lat], [p.lon, p.lat]) < 80_000);
    const fitAll = (): void => {
      const extent = near.length > 1 ? boundingExtent(near.map((p) => p.at)) : (top.bbox ?? null);
      if (extent) view.fit(extent, { padding: [70, 50, 40, 50], maxZoom: 16 });
      else view.setZoom(15);
    };
    fitAll();

    let picked: Place | undefined;
    const pick = (place: Place | undefined, fly: boolean, scroll: boolean): void => {
      if (picked) {
        picked.pin.setStyle(pinStyle(picked.n, false));
        picked.card.classList.remove("map-picked");
      }
      picked = place;
      outline.clear();
      if (!place) {
        overlay.setPosition(undefined);
        return;
      }
      place.pin.setStyle(pinStyle(place.n, true));
      place.card.classList.add("map-picked");
      label.textContent = place.title;
      overlay.setPosition(place.at);
      if (place.geojson) {
        try {
          const shape = new GeoJSON().readFeatures(JSON.parse(place.geojson), {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857"
          });
          // a point is already the pin
          outline.addFeatures(shape.filter((f) => f.getGeometry()?.getType() !== "Point"));
        } catch {
          // no outline
        }
      }
      if (fly) {
        if (place.bbox) {
          view.fit(place.bbox, { padding: [80, 60, 50, 60], maxZoom: 17, duration: 400 });
        } else {
          view.animate({
            center: place.at,
            zoom: Math.max(view.getZoom() ?? 15, 16),
            duration: 400
          });
        }
      }
      if (scroll) place.card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    map.on("singleclick", (event) => {
      const hit = map.forEachFeatureAtPixel(event.pixel, (f) => f, { hitTolerance: 4 });
      const n = hit?.get("n") as number | undefined;
      pick(n ? places[n - 1] : undefined, false, true);
    });
    map.on("pointermove", (event) => {
      mapEl.style.cursor = map.hasFeatureAtPixel(event.pixel, { hitTolerance: 4 }) ? "pointer" : "";
    });

    for (const place of places) {
      place.card.addEventListener("click", (event) => {
        // the title / website links still go where they go
        if ((event.target as HTMLElement).closest("a")) return;
        pick(place, true, false);
        if (window.matchMedia("(max-width: 50em)").matches) {
          // phones: back up to the map, just under the sticky search header
          const header = document.querySelector<HTMLElement>("#search")?.getBoundingClientRect().bottom ?? 0;
          window.scrollTo({
            top: window.scrollY + mapEl.getBoundingClientRect().top - Math.max(header, 0) - 8,
            behavior: "smooth"
          });
        }
      });
      place.card.addEventListener("mouseenter", () => {
        if (picked !== place) place.pin.setStyle(pinStyle(place.n, true));
      });
      place.card.addEventListener("mouseleave", () => {
        if (picked !== place) place.pin.setStyle(pinStyle(place.n, false));
      });
    }

    // back to the overview
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "map-reset";
    reset.textContent = places.length > 1 ? "Show all" : "Recentre";
    reset.addEventListener("click", () => {
      pick(undefined, false, false);
      fitAll();
    });
    mapEl.append(reset);

    // the sticky map changes size with the window
    new ResizeObserver(() => map.updateSize()).observe(mapEl);
  } else {
    mapEl.remove();
    document.documentElement.classList.remove("map-mode");
  }
}
