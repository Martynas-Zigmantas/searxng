// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Alexandria's own map looks (Martynas, 2026-11-17: "a custom colouring, not
 * the defaults"): vector tiles (map data, not pictures) from /widgets/vtile,
 * which proxies OpenFreeMap and trims every tile to what is drawn here
 * (searx/places.py VECTOR_KEEP), coloured by OpenLayers itself, so no second
 * map library.
 *
 * Day and night each have several looks; Preferences -> Map colours picks
 * them (map_day / map_night, synced with an Alexandria account), base.html
 * hands them over as <html data-map-day / data-map-night>.  Defaults: "blue"
 * by day (white buildings with dark outlines, blue roads), "matrix" by night.
 * No red or orange anywhere: Alexandria's plum instead.
 */

import type { FeatureLike } from "ol/Feature";
import MVT from "ol/format/MVT";
import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import { Fill, Stroke, Style, Text } from "ol/style";
import { createXYZ } from "ol/tilegrid";

export type Palette = {
  land: string;
  water: string;
  green: string;
  wood: string;
  urban: string;
  building: string;
  buildingLine: string;
  minor: string;
  casing: string;
  major: string;
  majorCasing: string;
  motorway: string;
  motorwayCasing: string;
  rail: string;
  border: string;
  place: string;
  street: string;
  poi: string;
  halo: string;
  waterLabel: string;
  neon?: boolean; // neon night: thin bright roads, no casing
  pin: string; // the result pins (main/mapMode.ts)
  pinInk: string;
};

// the white Apple / Google-style base the day looks share: blue water, deep greens
const WHITE: Palette = {
  land: "#fbfbfa",
  water: "#8ec5f0",
  green: "#86c47e",
  wood: "#66ae60",
  urban: "#f3f3f1",
  building: "#e6e5e2",
  buildingLine: "#d6d4d0",
  minor: "#ffffff",
  casing: "#d9d9d6",
  major: "#ffffff",
  majorCasing: "#b9b7b2",
  motorway: "#b96d97",
  motorwayCasing: "#6e2350",
  rail: "#9aa0a6",
  border: "#8a3a62",
  place: "#202124",
  street: "#5f6368",
  poi: "#4a1238",
  halo: "#ffffff",
  waterLabel: "#2a6db5",
  pin: "#4A1238",
  pinInk: "#F4EBD6"
};

// white buildings with dark outlines on light grey ground, coloured roads
const roads = (
  minor: string,
  minorLine: string,
  major: string,
  majorLine: string,
  motorway = "#b96d97",
  motorwayLine = "#6e2350"
): Palette => ({
  ...WHITE,
  land: "#eceff2",
  urban: "#e6e9ed",
  building: "#ffffff",
  buildingLine: "#9aa3ad",
  minor: minor,
  casing: minorLine,
  major: major,
  majorCasing: majorLine,
  motorway: motorway,
  motorwayCasing: motorwayLine
});

type Neon = {
  bg: string;
  block: string;
  line: string;
  road: string;
  big: string;
  water: string;
  label: string;
  park: string;
};

// neon night: dark blocks with faint edges, sharp bright roads, pins in the road colour
const neon = (n: Neon): Palette => ({
  land: n.bg,
  water: n.water,
  green: n.park,
  wood: n.park,
  urban: n.bg,
  building: n.block,
  buildingLine: n.line,
  minor: `${n.road}aa`,
  casing: n.bg,
  major: n.road,
  majorCasing: n.bg,
  motorway: n.big,
  motorwayCasing: n.bg,
  rail: n.line,
  border: n.big,
  place: n.label,
  street: n.road,
  poi: n.big,
  halo: n.bg,
  waterLabel: n.label,
  neon: true,
  pin: n.road,
  pinInk: n.bg
});

export const DAY_LOOKS: Record<string, Palette> = {
  blue: roads("#dbe9ff", "#9dbbe8", "#5c9dff", "#2a63c4"),
  gold: roads("#fff3c4", "#e2c56a", "#ffcf3f", "#c99a12"),
  plum: roads("#f6e1ec", "#d7a9c2", "#d27aa9", "#8a3a62", "#6e2350", "#3d0f2c"),
  teal: roads("#d8f3ec", "#94d3c3", "#33bfa0", "#1d7f6a"),
  google: roads("#ffffff", "#c3c8ce", "#ffd666", "#d9a520"),
  classic: WHITE
};

export const NIGHT_LOOKS: Record<string, Palette> = {
  matrix: neon({
    bg: "#020604",
    block: "#04110a",
    line: "#0b5a2a",
    road: "#22ff6e",
    big: "#b6ff3a",
    water: "#021a10",
    label: "#c8ffd8",
    park: "#03140a"
  }),
  tron: neon({
    bg: "#03060c",
    block: "#07111d",
    line: "#0b6f8f",
    road: "#19e6ff",
    big: "#ff9e1a",
    water: "#04192a",
    label: "#bff8ff",
    park: "#04130f"
  }),
  synth: neon({
    bg: "#0d0221",
    block: "#180536",
    line: "#5a1f8a",
    road: "#ff2bd6",
    big: "#19e6ff",
    water: "#071a3d",
    label: "#ffd1f5",
    park: "#0c1b2e"
  }),
  uv: neon({
    bg: "#07020f",
    block: "#130726",
    line: "#4b1e8f",
    road: "#b45cff",
    big: "#ff4fd8",
    water: "#0a0f3a",
    label: "#e7d4ff",
    park: "#0c1426"
  }),
  // Alexandria's aubergine, deep navy water, dark greens, gold and plum roads
  aubergine: {
    land: "#2a0a22",
    water: "#1b4f86",
    green: "#173a24",
    wood: "#12321e",
    urban: "#310f29",
    building: "#3f1a37",
    buildingLine: "#4f2446",
    minor: "#52274a",
    casing: "#2a0a22",
    major: "#8a6d2f",
    majorCasing: "#2a0a22",
    motorway: "#a3577c",
    motorwayCasing: "#e0a8c8",
    rail: "#6a4a62",
    border: "#e0a8c8",
    place: "#f4ebd6",
    street: "#d8c4cf",
    poi: "#e6c46e",
    halo: "#2a0a22",
    waterLabel: "#8fbfee",
    pin: "#E0A8C8",
    pinInk: "#4A1238"
  }
};

const SANS = "Inter, Arial, sans-serif";

// web-mercator resolution -> zoom level
const zoomOf = (resolution: number): number => Math.log2(156_543.033_928_040_97 / resolution);

const MAJOR = new Set(["primary", "secondary", "trunk"]);
const MINOR = new Set(["tertiary", "minor", "service", "residential", "unclassified", "living_street", "street"]);
const GREEN = new Set(["park", "grass", "meadow", "garden", "cemetery", "pitch", "playground", "recreation_ground"]);
const URBAN = new Set(["residential", "commercial", "retail"]);

type RoadKind = "motorway" | "major" | "minor";
const BASE_WIDTH: Record<RoadKind, number> = { motorway: 2.2, major: 1.6, minor: 0.8 };
const RANK: Record<RoadKind, number> = { motorway: 30, major: 20, minor: 10 };

const roadKind = (cls: string): RoadKind | undefined => {
  if (cls === "motorway") return "motorway";
  if (MAJOR.has(cls)) return "major";
  if (MINOR.has(cls)) return "minor";
  return undefined;
};

export const isDark = (): boolean => {
  const html = document.documentElement;
  return (
    html.classList.contains("theme-dark") ||
    html.classList.contains("theme-black") ||
    (html.classList.contains("theme-auto") && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
};

/** The look this visitor picked (Preferences -> Map colours) for the page's light / dark mode. */
export const currentLook = (dark = isDark()): Palette => {
  const { mapDay = "", mapNight = "" } = document.documentElement.dataset;
  if (dark) return NIGHT_LOOKS[mapNight] ?? (NIGHT_LOOKS.matrix as Palette);
  return DAY_LOOKS[mapDay] ?? (DAY_LOOKS.blue as Palette);
};

const styleFor = (c: Palette) => {
  const cache = new Map<string, Style | Style[]>();
  const once = (key: string, make: () => Style | Style[]): Style | Style[] => {
    let s = cache.get(key);
    if (!s) {
      s = make();
      cache.set(key, s);
    }
    return s;
  };
  const fill = (color: string, z = 0): Style => new Style({ fill: new Fill({ color: color }), zIndex: z });

  const road = (kind: RoadKind, z: number, tunnel: boolean): Style[] => {
    // widths in pixels, growing with the zoom
    const w = Math.max(0.5, BASE_WIDTH[kind] * 1.45 ** (z - 12));
    const colours: Record<RoadKind, [string, string]> = {
      motorway: [c.motorway, c.motorwayCasing],
      major: [c.major, c.majorCasing],
      minor: [c.minor, c.casing]
    };
    const [inner, outer] = colours[kind];
    const rank = RANK[kind];
    if (c.neon) {
      // crisp neon lines on black (a blurred glow looked fuzzy at some zooms, Martynas 2026-11-17)
      const core = Math.max(1, w * (kind === "minor" ? 0.45 : 0.6));
      return [new Style({ stroke: new Stroke({ color: inner, width: core, lineCap: "round" }), zIndex: rank + 1 })];
    }
    return [
      new Style({ stroke: new Stroke({ color: outer, width: w + 1.6, lineCap: "round" }), zIndex: rank }),
      new Style({
        stroke: new Stroke({ color: inner, width: w, lineCap: "round", lineDash: tunnel ? [4, 4] : undefined }),
        zIndex: rank + 1
      })
    ];
  };

  const label = (text: string, font: string, color: string, z: number, line = false): Style =>
    new Style({
      text: new Text({
        text: text,
        font: font,
        placement: line ? "line" : "point",
        fill: new Fill({ color: color }),
        stroke: new Stroke({ color: c.halo, width: 3 })
      }),
      zIndex: z
    });

  const placeLabel = (feature: FeatureLike, layer: string, cls: string, z: number): Style | undefined => {
    const name = feature.get("name") as string | undefined;
    if (!name) return undefined;
    const big = cls === "city" || cls === "country" || cls === "state";
    const mid = cls === "town" || cls === "suburb";
    if (!(big || mid) && z < 13) return undefined;
    let size = 13;
    if (big) size = 18;
    else if (mid) size = 15;
    const color = layer === "water_name" ? c.waterLabel : c.place;
    return label(name, `${big ? 700 : 600} ${size}px ${SANS}`, color, big ? 70 : 60);
  };

  return (feature: FeatureLike, resolution: number): Style | Style[] | undefined => {
    const layer = feature.get("layer") as string;
    const cls = (feature.get("class") as string | undefined) ?? "";
    const z = Math.round(zoomOf(resolution) * 2) / 2;

    switch (layer) {
      case "water":
        return once("water", () => fill(c.water, 3));
      case "waterway":
        return once(
          `waterway${z}`,
          () => new Style({ stroke: new Stroke({ color: c.water, width: Math.max(1, (z - 10) * 0.8) }), zIndex: 3 })
        );
      case "landcover":
        return cls === "wood" || cls === "forest"
          ? once("wood", () => fill(c.wood, 1))
          : once("green", () => fill(c.green, 1));
      case "park":
        return once("green", () => fill(c.green, 1));
      case "landuse":
        if (GREEN.has(cls)) return once("green", () => fill(c.green, 1));
        if (URBAN.has(cls)) return once("urban", () => fill(c.urban, 0));
        return undefined;
      case "building":
        if (z < 14) return undefined;
        return once(
          "building",
          () =>
            new Style({
              fill: new Fill({ color: c.building }),
              stroke: new Stroke({ color: c.buildingLine, width: 0.7 }),
              zIndex: 4
            })
        );
      case "boundary":
        if (feature.get("maritime") === 1 || Number(feature.get("admin_level")) > 4) return undefined;
        return once(
          "border",
          () => new Style({ stroke: new Stroke({ color: c.border, width: 1, lineDash: [5, 4] }), zIndex: 5 })
        );
      case "transportation": {
        if (cls === "rail" || cls === "transit") {
          return once(
            "rail",
            () => new Style({ stroke: new Stroke({ color: c.rail, width: 1.2, lineDash: [6, 4] }), zIndex: 6 })
          );
        }
        const kind = roadKind(cls);
        if (!kind || (kind === "minor" && z < 13)) return undefined;
        const tunnel = feature.get("brunnel") === "tunnel";
        return once(`${kind}${z}${tunnel}`, () => road(kind, z, tunnel));
      }
      case "transportation_name": {
        const name = feature.get("name") as string | undefined;
        if (!name || z < 14) return undefined;
        return label(name, `500 ${z >= 16 ? 12 : 11}px ${SANS}`, c.street, 50, true);
      }
      case "water_name":
      case "place":
        return placeLabel(feature, layer, cls, z);
      case "poi": {
        const name = feature.get("name") as string | undefined;
        if (!name || z < 15) return undefined;
        return label(name, `italic 500 11px ${SANS}`, c.poi, 40);
      }
      default:
        return undefined;
    }
  };
};

/** The map layer in the visitor's look; ``base`` is the instance's /widgets/vtile/ URL. */
export const alexandriaLayer = (base: string, look = currentLook()): VectorTileLayer =>
  new VectorTileLayer({
    declutter: true,
    background: look.land,
    source: new VectorTileSource({
      format: new MVT(),
      url: `${base}{z}/{x}/{y}.pbf`,
      // tiles stop at z14 and are drawn at 512 px; deeper zooms re-use them (no new downloads)
      tileGrid: createXYZ({ maxZoom: 14, tileSize: 512 }),
      attributions:
        '<a href="https://openfreemap.org" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a>'
    }),
    style: styleFor(look)
  });
