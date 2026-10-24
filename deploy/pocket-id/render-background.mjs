// Alexandria sign-in background: deep plum with the logo gradient glowing through, a big outline compass star
// Re-render: PW=<path to playwright/index.mjs> node deploy/pocket-id/render-background.mjs
const { chromium } = await import(process.env.PW || 'playwright');
const OUT = new URL('./background.jpg', import.meta.url).pathname;
const markPath = 'M57.1 42.9 L84.0 50.0 L57.1 57.1 L50.0 84.0 L42.9 57.1 L16.0 50.0 L42.9 42.9 L50.0 16.0 Z';
const html = `<html><body style="margin:0;width:1600px;height:2000px;background:#2a0820;overflow:hidden;position:relative">
<div style="position:absolute;inset:-20%;background:
 radial-gradient(40% 30% at 30% 25%, rgba(66,133,244,.55), transparent 70%),
 radial-gradient(35% 30% at 75% 40%, rgba(155,114,203,.55), transparent 70%),
 radial-gradient(40% 35% at 40% 75%, rgba(217,101,112,.45), transparent 70%),
 radial-gradient(30% 25% at 80% 85%, rgba(244,180,0,.35), transparent 70%);filter:blur(30px)"></div>
<svg viewBox="14 14 72 72" style="position:absolute;width:1500px;height:1500px;left:50px;top:250px;opacity:.16">
<path d="${markPath}" fill="none" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/>
<path d="M42.9 42.9 L50 16 L57.1 42.9" fill="none" stroke="#f4b400" stroke-width="1.1" stroke-linejoin="round"/></svg>
</body></html>`;
const run = async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 2000 } });
  await p.setContent(html); await p.screenshot({ path: OUT, type: 'jpeg', quality: 86 }); await b.close(); };
await run();
