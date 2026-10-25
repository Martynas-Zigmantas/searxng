// Screenshots for the README collage. Needs a running Alexandria (ALEXANDRIA_URL, default http://127.0.0.1:5173).
//   PW=<path to playwright/index.mjs> ALEXANDRIA_URL=http://127.0.0.1:8888 node docs/readme/src/shots.mjs
const OUT = new URL('./shots/', import.meta.url).pathname;
const URL_ = process.env.ALEXANDRIA_URL || 'http://127.0.0.1:5173';
const { chromium } = await import(process.env.PW || 'playwright');
const seed = () => {
  if (localStorage.getItem('seeded')) return;
  localStorage.setItem('seeded', '1');
  localStorage.setItem('sxng-home-place', JSON.stringify({ name: 'Leeds', region: 'England', lat: 53.796, lon: -1.548 }));
  const now = Date.now();
  localStorage.setItem('sxng-history', JSON.stringify(['rust programming', 'best ergonomic keyboard', 'leeds weather weekend', 'nextcloud docker compose', 'self host a search engine'].map((q, i) => ({ q, t: now - i * 3.6e6 }))));
};
const b = await chromium.launch();
const take = async (name, path, { w = 1440, h = 900, scheme = 'light', click, clip } = {}) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: w < 500 ? 2 : 1 });
  await ctx.addInitScript(seed);
  const p = await ctx.newPage();
  await p.goto(URL_ + path, { waitUntil: 'networkidle', timeout: 60000 });
  if (click) await p.click(click);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: OUT + name, clip });
  await ctx.close();
};
await take('home-light.png', '/');
await take('results-dark.png', '/search?q=rust+programming', { scheme: 'dark' });
await take('home-dark-phone.png', '/', { w: 390, h: 844, scheme: 'dark' });
await take('launcher.png', '/', { click: '.app-launcher-btn', clip: { x: 1100, y: 0, width: 340, height: 370 } });
await take('prefs.png', '/preferences', { clip: { x: 240, y: 40, width: 960, height: 600 } });
await b.close();
console.log('shots written');
