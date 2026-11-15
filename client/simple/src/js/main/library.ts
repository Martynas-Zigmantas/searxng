// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Something alive behind the search results: library things, one of five
 * scenes, a different one at every search / refresh (never the last one).
 *
 *   constellation  plum line icons joined by faint threads, drifting
 *   colour         the same in gold, rose, violet, teal
 *   wallpaper      an even pattern of faint icons, panning slowly (endpapers)
 *   tint           soft glows in the colours of the knowledge panel's picture (Alexandria's own without one);
 *                  replaced the bookshelves 2026-11-15 ("colours of the result", Martynas)
 *   glows          coloured icons floating upwards (no colour wash: "the icons are pretty enough")
 *
 * Light and dark versions; prefers-reduced-motion gets a still frame.  The
 * animation only runs while the tab is visible (requestAnimationFrame).
 * Picked 2026-10-25 (sheet 5, "all of them on rotation").
 */

import { LIBRARY_ICONS } from "../util/libraryIcons.ts";

const SCENES = ["constellation", "colour", "wallpaper", "tint", "glows"] as const;
type SceneName = (typeof SCENES)[number];

const LAST_KEY = "sxng-results-bg";
const html = document.documentElement;
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const dark =
  html.classList.contains("theme-dark") ||
  html.classList.contains("theme-black") ||
  (html.classList.contains("theme-auto") && window.matchMedia("(prefers-color-scheme: dark)").matches);

// colours: [page, ink (mono icons), thread]
const PAGE = dark ? "#2a0820" : "#ffffff"; // light: plain white, just the icons (Martynas, 2026-10-25)
const INK = dark ? "rgba(244,235,214,0.30)" : "rgba(74,18,56,0.32)";
const THREAD = dark ? "244,235,214" : "74,18,56";
const COLOURS = dark
  ? ["#e6c46e", "#f0868f", "#b99cff", "#6fd3c3", "#f4ebd6"]
  : ["#c9a24a", "#e8707a", "#a3242b", "#7a4fd0", "#4a1238", "#2f8f83"];

const names = Object.keys(LIBRARY_ICONS);

const pick = (): SceneName => {
  let last = "";
  try {
    last = localStorage.getItem(LAST_KEY) ?? "";
  } catch {
    // storage disabled
  }
  const choices = SCENES.filter((s) => s !== last);
  const scene = choices[Math.floor(Math.random() * choices.length)] ?? "constellation";
  try {
    localStorage.setItem(LAST_KEY, scene);
  } catch {
    // storage disabled
  }
  return scene;
};

const iconSvg = (name: string, color: string, width = 1.3): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${LIBRARY_ICONS[name] ?? ""}</svg>`;

// an icon as an image the canvas can draw (one per name + colour)
const images = new Map<string, HTMLImageElement>();
const iconImage = (name: string, color: string): HTMLImageElement => {
  const key = `${name}|${color}`;
  let img = images.get(key);
  if (!img) {
    img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name, color))}`;
    images.set(key, img);
  }
  return img;
};

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
const any = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;

/* ------------------------------------------------------------------ canvas */

type Frame = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

const canvasScene = (layer: HTMLElement, setup: (w: number, h: number) => Frame, fps = 30): void => {
  const canvas = document.createElement("canvas");
  layer.append(canvas);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  let frame: Frame = () => undefined;
  let w = 0;
  let h = 0;
  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    // the layer is the large viewport (100lvh): Safari's toolbar coming and going on scroll doesn't change it.
    // Only a real change of width (rotating the phone, resizing the window) rebuilds the scene; before, every
    // toolbar move fired "resize" and re-scattered the icons, so they jumped about at the top of the page.
    const nw = layer.clientWidth || window.innerWidth;
    const nh = layer.clientHeight || window.innerHeight;
    if (nw === w && Math.abs(nh - h) < 160) return;
    w = nw;
    h = nh;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    frame = setup(w, h);
  };
  resize();
  window.addEventListener("resize", resize);
  let last = 0;
  const tick = (now: number): void => {
    if (!still) requestAnimationFrame(tick);
    if (now - last < 1000 / fps - 2) return;
    last = now;
    frame(ctx, w, h, now);
  };
  // the icons are images: for reduced motion draw the still frame again once they have surely loaded
  requestAnimationFrame(tick);
  if (still) window.setTimeout(() => frame(ctx, w, h, 0), 600);
};

type Node = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  spin: number;
  img: HTMLImageElement;
};

// icons on a jittered grid (evenly spread), drifting, joined by threads when close
const constellation = (layer: HTMLElement, coloured: boolean): void => {
  canvasScene(layer, (w, h) => {
    const cols = Math.max(4, Math.round(w / 130));
    const rows = Math.max(4, Math.round(h / 130));
    const nodes: Node[] = [];
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        if (Math.random() < 0.18) continue;
        nodes.push({
          x: ((i + rand(0.15, 0.85)) * w) / cols,
          y: ((j + rand(0.15, 0.85)) * h) / rows,
          vx: rand(-0.12, 0.12),
          vy: rand(-0.12, 0.12),
          size: rand(22, 38),
          rot: rand(-0.26, 0.26),
          spin: rand(-0.0006, 0.0006),
          img: iconImage(any(names), coloured ? any(COLOURS) : INK)
        });
      }
    }
    const reach = 190;
    const threadColour = coloured ? "201,162,74" : THREAD;
    const threadAlpha = coloured ? 0.32 : 0.13;
    return (ctx) => {
      ctx.clearRect(0, 0, w, h);
      if (!coloured) {
        ctx.fillStyle = PAGE;
        ctx.fillRect(0, 0, w, h);
      }
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.rot += n.spin;
        if (n.x < -40) n.x = w + 40;
        if (n.x > w + 40) n.x = -40;
        if (n.y < -40) n.y = h + 40;
        if (n.y > h + 40) n.y = -40;
      }
      ctx.lineWidth = 1;
      for (let a = 0; a < nodes.length; a += 1) {
        for (let b = a + 1; b < nodes.length; b += 1) {
          const p = nodes[a] as Node;
          const q = nodes[b] as Node;
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d >= reach) continue;
          ctx.strokeStyle = `rgba(${threadColour},${threadAlpha * (1 - d / reach)})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
      for (const n of nodes) {
        // a disc of page colour under each icon, so the threads stop at its edge
        ctx.fillStyle = PAGE;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.size * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(n.x, n.y);
        ctx.rotate(n.rot);
        ctx.drawImage(n.img, -n.size / 2, -n.size / 2, n.size, n.size);
        ctx.restore();
      }
    };
  });
};

// endpapers: an even pattern of faint icons, panning slowly on a diagonal
const wallpaper = (layer: HTMLElement): void => {
  canvasScene(
    layer,
    (w, h) => {
      const cell = 92;
      const tileW = cell * 7;
      const tileH = cell * 6;
      const tile = document.createElement("canvas");
      tile.width = tileW;
      tile.height = tileH;
      const tctx = tile.getContext("2d") as CanvasRenderingContext2D;
      const faint = dark ? "rgba(244,235,214,0.14)" : "rgba(74,18,56,0.11)";
      const cells: { x: number; y: number; rot: number; img: HTMLImageElement }[] = [];
      for (let i = 0; i < 7; i += 1) {
        for (let j = 0; j < 6; j += 1) {
          cells.push({
            x: (i + 0.5 + (j % 2) * 0.5) * cell,
            y: (j + 0.5) * cell,
            rot: (((i + j) % 5) - 2) * 0.14,
            img: iconImage(names[(i * 3 + j * 5) % names.length] as string, faint)
          });
        }
      }
      let drawn = false;
      return (ctx, _w, _h, t) => {
        if (!drawn) {
          tctx.clearRect(0, 0, tileW, tileH);
          for (const c of cells) {
            for (const dx of [0, -tileW]) {
              tctx.save();
              tctx.translate(c.x + dx, c.y);
              tctx.rotate(c.rot);
              tctx.drawImage(c.img, -14, -14, 28, 28);
              tctx.restore();
            }
          }
          drawn = cells.every((c) => c.img.complete);
        }
        ctx.fillStyle = PAGE;
        ctx.fillRect(0, 0, w, h);
        const pattern = ctx.createPattern(tile, "repeat");
        if (!pattern) return;
        const shift = (t * 0.006) % tileH;
        ctx.save();
        ctx.translate(shift % tileW, shift);
        ctx.fillStyle = pattern;
        ctx.fillRect(-tileW, -tileH, w + 2 * tileW, h + 2 * tileH);
        ctx.restore();
      };
    },
    20
  );
};

/* --------------------------------------------------------------- DOM scenes */

const place = (
  layer: HTMLElement,
  name: string,
  x: number,
  y: number,
  size: number,
  color: string,
  cls = "",
  width = 1.2
): HTMLElement => {
  const el = document.createElement("div");
  el.className = `lib-icon ${cls}`;
  el.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px`;
  el.innerHTML = iconSvg(name, color, width);
  layer.append(el);
  return el;
};

// soft glows in the corners in the colours of the knowledge panel's picture (Apple Park's rainbow logo -> orange,
// pink, blue; a forest -> greens); no picture, or one we can't read -> Alexandria's gold, rose and plum
const TINT_DEFAULT = dark ? ["#7a2a5c", "#8a5a1e", "#3d2a6e"] : ["#f2c46b", "#e98c9a", "#b48ad8"];

const toHsl = (r: number, g: number, b: number): [number, number, number] => {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue = (rn - gn) / d + 4;
  if (max === rn) hue = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) hue = (bn - rn) / d + 2;
  hue *= 60;
  return [hue, sat, l];
};

// up to three lively colours of a picture, made soft enough to sit behind text
const pictureColours = async (src: string): Promise<string[]> => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data; // throws on a picture from a site without CORS: defaults stay
  const buckets = new Map<number, { n: number; h: number; s: number }>();
  for (let i = 0; i < px.length; i += 4) {
    const [hue, sat, light] = toHsl(px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0);
    if (sat < 0.25 || light < 0.15 || light > 0.92 || (px[i + 3] ?? 0) < 128) continue; // greys, black, white, see-through
    const key = Math.round(hue / 30) % 12;
    const b = buckets.get(key) ?? { n: 0, h: 0, s: 0 };
    b.n += 1;
    b.h += hue;
    b.s += sat;
    buckets.set(key, b);
  }
  // the most common hues, at least 40° apart (two yellows side by side look like one muddy glow)
  const picked: { n: number; h: number; s: number }[] = [];
  for (const b of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const hue = b.h / b.n;
    const near = picked.some((p) => {
      const diff = Math.abs(p.h / p.n - hue);
      return Math.min(diff, 360 - diff) < 40;
    });
    if (!near) picked.push(b);
    if (picked.length === 3) break;
  }
  return picked.map(
    (b) =>
      `hsl(${Math.round(b.h / b.n)} ${Math.round(Math.min(85, Math.max(45, (b.s / b.n) * 100)))}% ${dark ? 34 : 72}%)`
  );
};

const tint = (layer: HTMLElement): void => {
  layer.style.background = PAGE;
  const spots = ["lib-tint-a", "lib-tint-b", "lib-tint-c"].map((cls, i) => {
    const el = document.createElement("div");
    el.className = `lib-tint ${cls}`;
    el.style.background = `radial-gradient(closest-side, ${TINT_DEFAULT[i]}, transparent)`;
    layer.append(el);
    return el;
  });
  const src = document.querySelector<HTMLImageElement>("#infoboxes .infobox > img")?.src;
  if (!src) return;
  void pictureColours(src)
    .then((found) => {
      const colours = [...found, ...TINT_DEFAULT].slice(0, 3);
      spots.forEach((el, i) => {
        el.style.background = `radial-gradient(closest-side, ${colours[i]}, transparent)`;
      });
    })
    .catch(() => undefined);
};

// coloured icons floating slowly upwards on the plain page
const glows = (layer: HTMLElement): void => {
  layer.style.background = PAGE;
  const w = layer.clientWidth || window.innerWidth;
  const h = layer.clientHeight || window.innerHeight;
  const tints = dark
    ? ["rgba(230,196,110,.6)", "rgba(240,134,143,.55)", "rgba(185,156,255,.5)"]
    : ["rgba(201,162,74,.55)", "rgba(232,112,122,.5)", "rgba(122,79,208,.4)", "rgba(163,36,43,.4)"];
  const count = Math.round(Math.min(40, (w * h) / 32_000));
  for (let i = 0; i < count; i += 1) {
    const el = place(layer, any(names), rand(0, w), rand(0, h), rand(28, 46), any(tints), "lib-float");
    el.style.animationDuration = `${rand(40, 80)}s`;
    el.style.animationDelay = `${-rand(0, 80)}s`;
  }
};

/* ------------------------------------------------------------------- start */

export const startLibrary = (): void => {
  const layer = document.createElement("div");
  layer.id = "library_bg";
  layer.className = "library-bg";
  layer.setAttribute("aria-hidden", "true");
  layer.style.background = PAGE;
  document.body.prepend(layer);
  html.classList.add("library-bg-on");
  const scene = pick();
  layer.dataset.scene = scene;
  if (scene === "constellation") constellation(layer, false);
  else if (scene === "colour") constellation(layer, true);
  else if (scene === "wallpaper") wallpaper(layer);
  else if (scene === "tint") tint(layer);
  else glows(layer);
};

startLibrary();
