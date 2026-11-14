/**
 * Draws the iOS shell's images into ios/Shell/Assets.xcassets: the app icon (app/icon.svg, square
 * to the edge: iOS rounds the corners itself) and the launch screen's mark, the same one the web
 * app's opening screen and launch images show (components/splash.tsx, scripts/splash_images.ts),
 * light and dark. Run it again only when the icon, the mark or the colour changes:
 * `npm run ios-images`. It needs a Chromium for playwright-core (CHROMIUM names it). Hugo does not
 * need to run it.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { SPLASH_GROUND } from '../lib/splash.ts';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'ios', 'Shell', 'Assets.xcassets');
const executablePath = process.env['CHROMIUM'] ?? '/opt/pw-browsers/chromium';

const icon = `<!doctype html><html><body style="margin:0"><svg width="1024" height="1024" viewBox="0 0 64 64" style="display:block">
<rect width="64" height="64" fill="#1f5fbf"/>
<polyline points="12,44 26,32 36,38 52,20" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg></body></html>`;

/** 88 points wide on a clear ground, with room for its shadow: the launch screen centres it on the colour. */
const mark = (ground: string) => `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:transparent">
<svg width="88" height="88" viewBox="0 0 64 64" style="border-radius:21px;box-shadow:0 10px 30px rgba(11,26,43,.28)">
<rect width="64" height="64" rx="15" fill="#fff"/>
<polyline points="12,44 26,32 36,38 52,20" fill="none" stroke="${ground}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg></body></html>`;

const browser = await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
const draw = async (html: string, size: number, ratio: number, file: string, clear: boolean) => {
  const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: ratio });
  const tab = await context.newPage();
  await tab.setContent(html);
  await tab.screenshot({ path: join(assets, file), omitBackground: clear });
  await context.close();
  console.log(file);
};
await draw(icon, 1024, 1, 'AppIcon.appiconset/icon-1024.png', false);
for (const scheme of ['light', 'dark'] as const) {
  for (const ratio of [2, 3]) await draw(mark(SPLASH_GROUND[scheme]), 168, ratio, `LaunchMark.imageset/mark${scheme === 'dark' ? '-dark' : ''}@${ratio}x.png`, true);
}
await browser.close();
