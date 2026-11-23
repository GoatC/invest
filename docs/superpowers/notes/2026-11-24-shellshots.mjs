// Screens as the iOS shell shows the web view (data-shell, its bar room), before and with prototype CSS.
// node shellshots.mjs <out> <tag> [proto.css] [p-list]  → <out>/<tag>-<page>.png (first screen) and -full.png
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/home/user/Invest/package.json');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3100', PW = fs.readFileSync('/tmp/invest-e2e/pw', 'utf8').trim();
const [OUT, TAG, CSS, PLIST = ''] = process.argv.slice(2);
const pages = (process.env.PAGES ?? '/,/holdings,/performance,/allocation').split(',');
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Asia/Taipei' });
const login = await ctx.newPage();
await login.goto(BASE + '/login'); await login.fill('input[name=email]', 'owner@example.com'); await login.fill('input[name=password]', PW);
await login.click('main button[type=submit]'); await login.waitForURL(BASE + '/'); await login.close();
await ctx.addInitScript(({ plist }) => {
  try { localStorage.setItem('preload', 'off'); sessionStorage.setItem('opened', '1'); } catch {}
  const top = location.pathname === '/' ? 0 : 196;
  const mark = () => {
    const d = document.documentElement; if (!d) return false;
    d.setAttribute('data-shell', 'ios'); for (const a of ['data-shell-top','data-shell-next','data-shell-segmented','data-shell-info']) d.setAttribute(a, '1'); if (plist) d.setAttribute('data-p', plist);
    d.style.setProperty('--shell-bottom', '83px'); d.style.setProperty('--shell-top', `${top}px`); d.style.setProperty('--shell-top-inline', '106px');
    return true;
  };
  if (!mark()) new MutationObserver((_, w) => mark() && w.disconnect()).observe(document, { childList: true });
  window.webkit = { messageHandlers: { shell: { postMessage() {} }, reminders: { postMessage() {} } } };
}, { plist: PLIST });
const css = CSS ? fs.readFileSync(CSS, 'utf8') : '';
const p = await ctx.newPage();
for (const path of pages) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' });
  if (css) await p.addStyleTag({ content: css });
  await p.waitForTimeout(3800);
  const name = path === '/' ? 'dashboard' : path.slice(1).replace(/[/?=]/g, '_');
  await p.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
  await p.screenshot({ path: `${OUT}/${TAG}-${name}-full.png`, fullPage: true });
  if (process.env.VAR && path === '/') {
    const box = await p.locator('#value-at-risk').boundingBox();
    await p.screenshot({ path: `${OUT}/${TAG}-var.png`, clip: box, fullPage: true });
  }
}
await b.close();
