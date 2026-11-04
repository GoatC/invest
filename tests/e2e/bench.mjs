// Times the phone's tab switches (run.sh with E2E_DRIVER=bench.mjs): signs in on an iPhone-sized
// screen with the CPU slowed four times, as a phone is, then taps the tab bar and the More sheet
// round after round, timing each tap until the new page's h1 shows with nothing left loading, and
// until the first sign the tap was taken (the link's pending bar, or the page changing).
// GATEWAY_DELAY_MS adds a round trip's latency to every Supabase request, as from Vercel to a
// hosted project. Prints the times and writes them as JSON to BENCH_REPORT when it is set.
import { existsSync, writeFileSync } from 'node:fs';

import { chromium, devices } from 'playwright-core';

const { APP_PORT, CHROMIUM, OWNER_EMAIL, OWNER_PASSWORD, BENCH_REPORT, BENCH_ROUNDS, BENCH_COLD, GATEWAY_DELAY_MS } = process.env;
// BENCH_COLD=1 reloads the page before each tap, so no tap is answered from the router cache.
const COLD = BENCH_COLD === '1';
const BASE = `http://127.0.0.1:${APP_PORT}`;
const ROUNDS = Number(BENCH_ROUNDS ?? 4);
/** Each stop: the tab or sheet link tapped, and the path it opens. */
const STOPS = [
  { name: '持倉 holdings', tab: /Holdings/, path: '/holdings' },
  { name: '績效 performance', tab: /Performance/, path: '/performance' },
  { name: '配置 allocation', tab: /Allocation/, path: '/allocation' },
  { name: '回歸 regression (More)', sheet: /Regression/, path: '/regression' },
  { name: '儀表板 dashboard', tab: /Dashboard/, path: '/' },
];

const browser = await chromium.launch(CHROMIUM && existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const { defaultBrowserType: _, ...iphone } = devices['iPhone 13'];
const context = await browser.newContext({ ...iphone, timezoneId: 'Asia/Taipei' });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

await page.goto(`${BASE}/login`);
await page.fill('input[name=email]', OWNER_EMAIL);
await page.fill('input[name=password]', OWNER_PASSWORD);
await page.click('main button[type=submit]');
await page.waitForURL(`${BASE}/`);
await page.locator('main h1').first().waitFor();
await page.waitForLoadState('networkidle');

const tabs = page.getByRole('navigation', { name: /Tabs/ });
/** Until the page at `path` shows its h1 and no loading placeholder is left. */
async function settled(path) {
  await page.waitForURL((url) => url.pathname === path, { timeout: 60_000 });
  await page.waitForFunction(
    (want) => location.pathname === want && document.querySelector('main h1') !== null && document.querySelector('[data-loading], [data-pending]') === null,
    path,
    { timeout: 60_000, polling: 'raf' },
  );
}

const times = Object.fromEntries(STOPS.map((stop) => [stop.name, []]));
const feedback = Object.fromEntries(STOPS.map((stop) => [stop.name, []]));
for (let round = 0; round < ROUNDS; round++) {
  for (const stop of STOPS) {
    if (COLD) {
      await page.reload();
      await page.locator('main h1').first().waitFor();
    }
    // Let prefetches and the previous page's charts finish, as between two taps by a person.
    await page.waitForTimeout(800);
    if (stop.sheet) {
      await tabs.getByRole('button', { name: /More/ }).click();
      await page.getByRole('dialog', { name: /More/ }).getByRole('link', { name: stop.sheet }).waitFor();
    }
    const link = stop.sheet ? page.getByRole('dialog', { name: /More/ }).getByRole('link', { name: stop.sheet }) : tabs.getByRole('link', { name: stop.tab });
    const before = await page.evaluate(() => document.querySelector('main')?.innerHTML.length ?? 0);
    const start = Date.now();
    await link.click();
    // First feedback: the tapped link's pending bar, a loading placeholder, or the new page.
    await page.waitForFunction((n) => (document.querySelector('main')?.innerHTML.length ?? 0) !== n || document.querySelector('[data-loading], [data-pending]') !== null, before, { timeout: 60_000, polling: 'raf' });
    feedback[stop.name].push(Date.now() - start);
    await settled(stop.path);
    times[stop.name].push(Date.now() - start);
  }
}

const mean = (list) => Math.round(list.reduce((sum, x) => sum + x, 0) / list.length);
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const all = Object.values(times).flat();
const allFeedback = Object.values(feedback).flat();
console.log(`latency per Supabase request: ${GATEWAY_DELAY_MS ?? 0} ms; CPU ×4; ${ROUNDS} rounds${COLD ? '; cold (page reloaded before each tap)' : ''}`);
for (const stop of STOPS) console.log(`${stop.name.padEnd(28)} settled ${times[stop.name].join(' / ')} ms · first change ${feedback[stop.name].join(' / ')} ms`);
console.log(`all taps: settled mean ${mean(all)} ms, median ${median(all)} ms; first change mean ${mean(allFeedback)} ms`);
if (BENCH_REPORT) writeFileSync(BENCH_REPORT, JSON.stringify({ cold: COLD, delayMs: Number(GATEWAY_DELAY_MS ?? 0), rounds: ROUNDS, times, feedback, mean: mean(all), median: median(all), feedbackMean: mean(allFeedback) }, null, 2));
await browser.close();
