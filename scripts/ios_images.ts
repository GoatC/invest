/**
 * Draws the iOS shell's images into ios/Shell/Assets.xcassets: the app icon (app/icon.svg, square
 * to the edge: iOS rounds the corners itself) in the home screen's three looks (Liquid Glass proposal
 * G07, Hugo 2026-11-15: the ground and the line as layers of glass; dark; and a grey one the system
 * tints), and the launch screen's mark, the same one the web
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

/**
 * The icon in one look: a ground, the line's soft shadow (light: a shade below it; dark and tinted: a
 * glow), the line, and a light catching the top edge, as iOS 26 draws an icon's layers. `ground` is two colours, top and foot.
 */
const icon = (ground: readonly [string, string], line: string, glow: string, rim: string) => `<!doctype html><html><body style="margin:0"><svg width="1024" height="1024" viewBox="0 0 64 64" style="display:block">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ground[0]}"/><stop offset="1" stop-color="${ground[1]}"/></linearGradient>
<linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rim}"/><stop offset="0.35" stop-color="${rim}" stop-opacity="0"/></linearGradient>
<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.8"/></filter></defs>
<rect width="64" height="64" fill="url(#g)"/>
<rect width="64" height="64" fill="url(#r)"/>
<polyline points="12,46 26,34 36,40 52,22" fill="none" stroke="${glow}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" filter="url(#b)"/>
<polyline points="12,44 26,32 36,38 52,20" fill="none" stroke="${line}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg></body></html>`;

/** Light, dark, and the grey the system tints (light where the tint shows, dark where it does not). */
const ICONS = [
  { file: 'icon-1024.png', html: icon(['#3c7ad3', '#1d55a9'], '#ffffff', 'rgba(8,30,70,0.45)', 'rgba(255,255,255,0.22)') },
  { file: 'icon-1024-dark.png', html: icon(['#1c2027', '#0d0f13'], '#82b6f5', 'rgba(110,165,240,0.45)', 'rgba(255,255,255,0.08)') },
  { file: 'icon-1024-tinted.png', html: icon(['#2a2a2a', '#000000'], '#ffffff', 'rgba(255,255,255,0.3)', 'rgba(255,255,255,0.06)') },
] as const;

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
for (const { file, html } of ICONS) await draw(html, 1024, 1, `AppIcon.appiconset/${file}`, false);
for (const scheme of ['light', 'dark'] as const) {
  for (const ratio of [2, 3]) await draw(mark(SPLASH_GROUND[scheme]), 168, ratio, `LaunchMark.imageset/mark${scheme === 'dark' ? '-dark' : ''}@${ratio}x.png`, true);
}
await browser.close();
