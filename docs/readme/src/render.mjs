// README art for Alexandria (banner, screens collage, flow diagrams, BookStack cover) in its own look.
// Re-render:   PW=<path to playwright/index.mjs> node docs/readme/src/render.mjs
// Fresh screenshots first (needs a running instance, see README "Run it locally"):
//              PW=... ALEXANDRIA_URL=http://127.0.0.1:5173 node docs/readme/src/shots.mjs
import fs from 'node:fs';
import { C, mark } from '../../../brand/src/mark.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const OUT = `${ROOT}docs/readme/`;
const SHOTS = `${ROOT}docs/readme/src/shots/`;
const font = fs.readFileSync(`${ROOT}client/simple/src/fonts/inter-latin-wght-normal.woff2`).toString('base64');
const nameFont = fs.readFileSync(`${ROOT}client/simple/src/fonts/dm-serif-display-latin-400.woff2`).toString('base64');
const CSS = `
@font-face{font-family:Inter;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format('woff2')}
@font-face{font-family:Name;src:url(data:font/woff2;base64,${nameFont}) format('woff2')}
*{box-sizing:border-box} body{margin:0;font-family:Inter,"Segoe UI",Roboto,Arial,sans-serif}
.serif{font-family:Inter,sans-serif;font-weight:600;letter-spacing:-0.04em}
.name{font-family:Name,serif;font-weight:400;letter-spacing:-0.01em;background:linear-gradient(100deg,#fff1c7 0%,#f5c76a 45%,#e8707a 100%);-webkit-background-clip:text;background-clip:text;color:transparent;padding-bottom:.08em}
`;
// the logo as it is in the page: gold scrolls on a plum tile, whatever the background (fg kept for the callers)
const markSvg = (_fg, w) => `<svg viewBox="0 0 100 100" width="${w}" height="${w}"><rect width="100" height="100" rx="22" fill="${C.plum}"/><g transform="translate(9 9) scale(.82)">${mark(C.gold, C.gold)}</g></svg>`;
const img = (file) => `data:image/png;base64,${fs.readFileSync(SHOTS + file).toString('base64')}`;

/* ------------------------------------------------------------------ banner */
const banner = `
<div style="width:1600px;height:520px;background:radial-gradient(ellipse at 30% 40%, #6b1d52 0%, ${C.deep} 70%);display:flex;align-items:center;padding:0 110px;gap:90px;position:relative;overflow:hidden">
  <div style="position:absolute;left:150px;top:120px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle, rgba(201,162,74,.35), transparent 70%)"></div>
  <div style="display:flex;flex-direction:column;gap:26px;position:relative">
    <div style="display:flex;align-items:center"><span class="name" style="font-size:150px;line-height:1.05">alexandria</span></div>
    <div style="color:#e2d5dc;font-size:28px;max-width:760px;line-height:1.4">Every search engine at once, from your own server.<br><span style="color:${C.gold}">No ads, no tracking, no profile.</span></div>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:18px;position:relative">
    <div style="background:#fff;border-radius:999px;height:74px;display:flex;align-items:center;padding:0 34px;box-shadow:0 12px 40px rgba(0,0,0,.45);font-size:26px;color:#8a7580">
      <span style="flex:1">best walking routes near Leeds</span>
      <svg width="30" height="30" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="${C.plum}" stroke-width="2.4"/><path d="M15.5 15.5 21 21" stroke="${C.plum}" stroke-width="2.4" stroke-linecap="round"/></svg>
    </div>
    <div style="display:flex;gap:12px;padding-left:20px">
      ${['Images', 'Videos', 'News', 'Map'].map((t) => `<span style="border:1.5px solid rgba(244,235,214,.35);color:${C.white};border-radius:999px;padding:9px 20px;font-size:19px">${t}</span>`).join('')}
    </div>
    <div style="display:flex;gap:10px;padding-left:20px;margin-top:6px;color:#a8928f;font-size:17px">Google · Brave · DuckDuckGo · Wikipedia · and 70+ more, merged</div>
  </div>
</div>`;

/* ------------------------------------------------------------- diagrams */
const box = (title, sub, { fill = '#fff', fg = C.ink, border = '#e6dbe2', w = 250, h } = {}) => `
  <div style="width:${w}px;${h ? `height:${h}px;` : ''}background:${fill};border:2px solid ${border};border-radius:20px;padding:20px 22px;color:${fg};overflow-wrap:anywhere">
    <div class="serif" style="font-size:30px;line-height:1.1">${title}</div>
    <div style="font-size:16px;line-height:1.45;margin-top:8px;opacity:.8">${sub}</div>
  </div>`;
const arrow = (label = '', w = 90) => `
  <div style="width:${w}px;display:flex;flex-direction:column;align-items:center;gap:4px;color:#8a7580;font-size:14px;text-align:center">
    <span>${label}</span>
    <svg width="${w}" height="16" viewBox="0 0 ${w} 16"><path d="M2 8 H${w - 10}" stroke="${C.gold}" stroke-width="3" stroke-linecap="round"/><path d="M${w - 16} 2 L${w - 4} 8 L${w - 16} 14" fill="none" stroke="${C.gold}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>`;
const frame = (title, inner, h) => `
<div style="width:1600px;height:${h}px;background:#fff;padding:50px 70px;display:flex;flex-direction:column;gap:34px">
  <div style="display:flex;align-items:center;gap:16px">${markSvg(C.plum, 34)}<span class="serif" style="font-size:46px;color:${C.plum}">${title}</span></div>
  ${inner}
</div>`;

const howSearch = frame(
  'How a search works',
  `<div style="display:flex;align-items:center;gap:6px">
    ${box('Your browser', 'Brave / phone. Keeps your shortcuts, recent searches and city in <b>localStorage</b>, nowhere else.', { w: 260 })}
    ${arrow('https', 110)}
    ${box('Reverse proxy', 'alexandria.epistle.email<br>TLS, Go proxy', { w: 250 })}
    ${arrow('', 80)}
    ${box('Alexandria', 'node2 · :48777<br>Strips your IP + cookies, asks every engine at once, merges + ranks', { fill: C.plum, fg: C.white, border: C.plum, w: 290 })}
    <div style="display:flex;flex-direction:column;gap:16px;margin-left:6px">
      <div style="display:flex;align-items:center">${arrow('query', 90)}${box('Search engines', 'Google, Brave, DuckDuckGo, Wikipedia, Bing, Startpage… only see the server', { w: 300 })}</div>
      <div style="display:flex;align-items:center">${arrow('city', 90)}${box('Open-Meteo', 'Weather widget. No key, no account, only the city you picked', { w: 300 })}</div>
    </div>
  </div>
  <div style="display:flex;gap:18px;color:${C.ink};font-size:18px">
    <span style="background:#f6eef3;border-radius:999px;padding:10px 20px">Results come back as one list, deduplicated</span>
    <span style="background:#f6eef3;border-radius:999px;padding:10px 20px">Site icons + images are fetched by Alexandria, not your browser</span>
    <span style="background:#f6eef3;border-radius:999px;padding:10px 20px">Nothing is logged</span>
  </div>`,
  560
);

const step = (n, title, sub, who) => `
  <div style="width:250px;display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;align-items:center;gap:10px"><span style="width:38px;height:38px;border-radius:50%;background:${C.plum};color:${C.white};display:grid;place-items:center;font-weight:700;font-size:18px">${n}</span><span style="font-size:15px;color:#8a7580;text-transform:uppercase;letter-spacing:.08em">${who}</span></div>
    ${box(title, sub, { w: 250, h: 190 })}
  </div>`;
const howLive = frame(
  'How a change gets live',
  `<div style="display:flex;align-items:flex-end;gap:2px;padding-bottom:4px">
    ${step(1, 'Edit', '<code>client/simple/src</code> (LESS, TS)<br><code>searx/templates/</code><br><code>searx/settings.yml</code>', 'any machine')}
    ${arrow('', 40)}
    ${step(2, 'Build theme', '<code>cd client/simple</code><br><code>npm run build</code><br>writes <code>searx/static/</code>', 'build VM')}
    ${arrow('', 40)}
    ${step(3, 'Push', 'commit source <b>and</b> built static files, push <code>master</code> to Forgejo', 'build VM')}
    ${arrow('', 40)}
    ${step(4, 'Build image', '<code>~/searxng/deploy/<br>build-image.sh</code><br>→ <code>alexandria:latest</code>', 'node2')}
    ${arrow('', 40)}
    ${step(5, 'Redeploy', 'Portainer → Stacks → <b>alexandria</b> (Git stack) → Pull and redeploy', 'node2')}
  </div>
  <div style="color:${C.ink};font-size:18px;background:#f6eef3;border-radius:16px;padding:16px 22px;max-width:1150px">
    Only changing settings (engines, limiter)? Skip 1-4: edit <code>settings.yml</code> in the <b>alexandria-config</b> volume on node2 and restart the <b>alexandria-core</b> container.
  </div>`,
  560
);

const howAccount = frame(
  'The Alexandria account is your Epistle account',
  `<div style="display:flex;align-items:center;gap:6px">
    ${box('You', 'signed in to Epistle mail in this browser', { w: 220 })}
    ${arrow('', 60)}
    ${box('Alexandria', 'first page you open: a split-second hop to the webmail <b>/epistle/alexandria</b>', { w: 300 })}
    ${arrow('who is this?', 110)}
    ${box('Epistle', 'webmail.kodatrade.co.uk · checks its own sign-in cookie, sends back a <b>one-time code</b>', { fill: C.plum, fg: C.white, border: C.plum, w: 330 })}
  </div>
  <div style="display:flex;align-items:center;gap:6px">
    ${box('Alexandria server', 'swaps the code (PKCE) with epistle-api for your address + name', { w: 300 })}
    ${arrow('', 60)}
    ${box('You are in', 'avatar + account card, no click. Your Inbox on the start page; preferences, history, shortcuts sync', { w: 330 })}
    <div style="width:120px;text-align:center;color:#8a7a84;font-size:16px">or, not signed<br>in to Epistle</div>
    ${box('Guest', 'back at once; <b>Sign in</b> opens the Epistle sign-in (password + 2FA) and comes back', { w: 330 })}
  </div>
  <div style="color:${C.ink};font-size:18px;background:#f6eef3;border-radius:16px;padding:16px 22px;max-width:1150px">
    Checked again every 6 h: sign out of Epistle and Alexandria follows. <b>Sign out</b> on Alexandria signs out of Alexandria only (and stops the automatic sign-in until you press Sign in).
  </div>`,
  640
);

/* ------------------------------------------------------------- screens */
const shot = (file, w, label) => `
  <figure style="margin:0;display:flex;flex-direction:column;gap:14px;align-items:center">
    <img src="${img(file)}" style="width:${w}px;border-radius:18px;box-shadow:0 18px 50px rgba(42,8,32,.35);display:block">
    <figcaption style="color:#e2d5dc;font-size:18px">${label}</figcaption>
  </figure>`;
const screens = `
<div style="width:1600px;height:900px;background:${C.deep};display:flex;align-items:center;justify-content:center;gap:34px;padding:40px">
  <div style="display:flex;flex-direction:column;gap:30px">
    ${shot('home-light.png', 560, 'Start page on a photo of the day')}
    ${shot('results-dark.png', 560, 'Results, dark mode')}
  </div>
  ${shot('home-dark-phone.png', 360, 'Phone')}
  <div style="display:flex;flex-direction:column;gap:30px">
    ${shot('launcher.png', 420, 'App launcher: Mail (Epistle), Drive, Bitwarden…')}
    ${shot('prefs.png', 420, 'Preferences')}
  </div>
</div>`;

/* --------------------------------------------- BookStack book cover */
const cover = `
<div style="width:1800px;height:1013px;background:radial-gradient(ellipse at 50% 38%, #6b1d52 0%, ${C.deep} 72%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
  <div style="width:520px;height:520px;border-radius:50%;background:radial-gradient(circle, rgba(201,162,74,.28), transparent 68%);position:absolute;top:120px"></div>
  <span class="name" style="position:relative;font-size:200px;line-height:1.05">alexandria</span>
</div>`;

const pages = {
  cover: [cover, 1800, 1013], banner: [banner, 1600, 520], 'how-search-works': [howSearch, 1600, 560], 'how-a-change-gets-live': [howLive, 1600, 560], 'how-the-account-works': [howAccount, 1600, 640], screens: [screens, 1600, 900] };
const { chromium } = await import(process.env.PW || 'playwright');
const b = await chromium.launch();
for (const [name, [html, w, h]] of Object.entries(pages)) {
  if (name === 'screens' && !fs.existsSync(`${SHOTS}home-light.png`)) continue;
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(`<html><head><style>${CSS}</style></head><body>${html}</body></html>`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: name === 'cover' ? `${OUT}src/cover.png` : `${OUT}${name}.png` });
  await p.close();
}
await b.close();
console.log('readme art written');
