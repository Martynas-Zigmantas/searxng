// Screenshots for the README collage. Needs a running Alexandria (ALEXANDRIA_URL, default http://127.0.0.1:5173).
//   PW=<path to playwright/index.mjs> ALEXANDRIA_URL=http://127.0.0.1:8888 node docs/readme/src/shots.mjs
// account.png needs a signed-in session cookie (SESSION=<flask session>, minted with the dev secret_key);
// ONLY=account.png re-takes just that one.
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
const take = async (name, path, { w = 1440, h = 900, scheme = 'light', click, clip, session } = {}) => {
  if (process.env.ONLY && process.env.ONLY !== name) return;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: w < 500 ? 2 : 1 });
  await ctx.addInitScript(seed);
  if (session) await ctx.addCookies([{ name: 'session', value: session, url: URL_ }]);
  const p = await ctx.newPage();
  // signed in, the page keeps a mail request open: 'load' + the wait below instead of networkidle
  await p.goto(URL_ + path, { waitUntil: session ? 'load' : 'networkidle', timeout: 60000 });
  if (click) await p.click(click);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: OUT + name, clip });
  await ctx.close();
};
await take('home-light.png', '/');
await take('results-dark.png', '/search?q=rust+programming', { scheme: 'dark' });
await take('home-dark-phone.png', '/', { w: 390, h: 844, scheme: 'dark' });
if (process.env.SESSION)
  await take('account.png', '/', { session: process.env.SESSION, click: '.account-btn', clip: { x: 1020, y: 0, width: 420, height: 440 } });
await take('prefs.png', '/preferences', { clip: { x: 240, y: 40, width: 960, height: 600 } });
await b.close();
console.log('shots written');
