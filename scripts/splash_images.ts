/**
 * Draws the iPhone launch images into public/splash (lib/splash.ts lists them): the opening
 * screen's mark, dead centre on the poster's colour, at each screen's exact size, light and dark.
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

/** The mark as components/splash.tsx draws it: 88 points wide, a white tile with the rising line in the ground's colour. */
const page = (ground: string) => `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:${ground}">
<svg width="88" height="88" viewBox="0 0 64 64" style="border-radius:21px;box-shadow:0 10px 30px rgba(11,26,43,.28)">
<rect width="64" height="64" rx="15" fill="#fff"/>
<polyline points="12,44 26,32 36,38 52,20" fill="none" stroke="${ground}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
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
