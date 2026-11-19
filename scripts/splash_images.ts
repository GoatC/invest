/**
 * Draws the iPhone launch images into public/splash (lib/splash.ts lists them): opening screen B's
 * first still, at each screen's exact size, light and dark alike.
 * Run it again only when the mark, the colour or the list of screens changes:
 * `npm run splash-images`. It needs a Chromium for playwright-core (CHROMIUM names it; Claude Code
 * cloud sessions have one at /opt/pw-browsers/chromium). Hugo does not need to run it.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { LAUNCH_IMAGES, SPLASH_GROUND } from '../lib/splash.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const executablePath = process.env['CHROMIUM'] ?? '/opt/pw-browsers/chromium';

/**
 * Opening screen B's first still, as components/splash.tsx draws it before anything moves: the ink
 * ground, the glow from the top right, the mark (120 points, dead centre) with its faint track; the page
 * then draws the line along it. The glow is drawn here at full strength, where the page fades it in.
 */
const page = (ground: string) => `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:${ground};background-image:radial-gradient(110% 70% at 100% -6%,rgba(111,163,219,.62) 0%,rgba(52,104,156,.28) 40%,rgba(7,11,9,0) 74%)">
<svg width="120" height="120" viewBox="0 0 64 64">
<rect x="1.5" y="1.5" width="61" height="61" rx="15" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.22)" stroke-width="1.5"/>
<polyline points="12,44 26,32 36,38 52,20" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg></body></html>`;

const browser = await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
for (const image of LAUNCH_IMAGES) {
  const context = await browser.newContext({ viewport: { width: image.width, height: image.height }, deviceScaleFactor: image.ratio });
  const tab = await context.newPage();
  await tab.setContent(page(SPLASH_GROUND[image.scheme]));
  const path = join(out, image.url);
  mkdirSync(dirname(path), { recursive: true });
  await tab.screenshot({ path });
  await context.close();
  console.log(image.url);
}
await browser.close();
