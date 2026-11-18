// Times the phone's tab switches (run.sh with E2E_DRIVER=bench.mjs): signs in on an iPhone-sized
// screen with the CPU slowed four times, as a phone is, then taps the tab bar and the More sheet
// round after round, timing each tap until the new page's h1 shows with nothing left loading, until
// its h1 first shows (the tapped link's pending bar may still be fading), and until the first sign
// the tap was taken (the link's pending bar, or the page changing).
// GATEWAY_DELAY_MS adds a round trip's latency to every Supabase request, as from Vercel to a
// hosted project. Prints the times and writes them as JSON to BENCH_REPORT when it is set.
// Before the taps it times the opening itself: a signed-in phone loading the app afresh, until the
// opening screen shows, and until it lifts with the pages one tap away fetched
// (components/preload.tsx). BENCH_PRELOAD=0 turns that fetching off, to time the taps without it.
// BENCH_NET_MS adds that many milliseconds to every request between the phone and the app, as a
// mobile network does (the stand-in runs on the same machine, where a request costs nothing).
import { existsSync, writeFileSync } from 'node:fs';

import { chromium, devices } from 'playwright-core';

const { APP_PORT, CHROMIUM, OWNER_EMAIL, OWNER_PASSWORD, BENCH_REPORT, BENCH_ROUNDS, BENCH_COLD, BENCH_PRELOAD, BENCH_NET_MS, GATEWAY_DELAY_MS } = process.env;
const PRELOAD = BENCH_PRELOAD !== '0';
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
/** A phone's processor and network: four times slower than this machine, BENCH_NET_MS a request. */
async function asPhone(target, tab) {
  const session = await target.newCDPSession(tab);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  if (Number(BENCH_NET_MS) > 0) await session.send('Network.emulateNetworkConditions', { offline: false, latency: Number(BENCH_NET_MS), downloadThroughput: -1, uploadThroughput: -1 });
}
const { defaultBrowserType: _, ...iphone } = devices['iPhone 13'];
const context = await browser.newContext({ ...iphone, timezoneId: 'Asia/Taipei' });
if (!PRELOAD) await context.addInitScript(() => localStorage.setItem('preload', 'off'));
const page = await context.newPage();
await asPhone(context, page);

await page.goto(`${BASE}/login`);
await page.fill('input[name=email]', OWNER_EMAIL);
await page.fill('input[name=password]', OWNER_PASSWORD);
await page.click('main button[type=submit]');
await page.waitForURL(`${BASE}/`);
await page.locator('main h1').first().waitFor();
await page.waitForLoadState('networkidle');

// The opening: the same phone, signed in, loads the app afresh three times.
const opening = { screen: [], lifted: [] };
for (let run = 0; run < 3; run++) {
  const fresh = await browser.newContext({ ...iphone, timezoneId: 'Asia/Taipei', storageState: await context.storageState() });
  if (!PRELOAD) await fresh.addInitScript(() => localStorage.setItem('preload', 'off'));
  const app = await fresh.newPage();
  await asPhone(fresh, app);
  const start = Date.now();
  await app.goto(`${BASE}/`, { waitUntil: 'commit' });
  await app.locator('#splash').waitFor();
  opening.screen.push(Date.now() - start);
  await app.waitForFunction(() => document.querySelector('#splash')?.classList.contains('leaving') || document.documentElement.hasAttribute('data-opened'), null, { timeout: 60_000, polling: 'raf' });
  opening.lifted.push(Date.now() - start);
  await fresh.close();
}

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
const shown = Object.fromEntries(STOPS.map((stop) => [stop.name, []]));
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
    // The new page's title: its figures are on screen, though the pending bar may not have gone yet.
    await page.waitForFunction((want) => location.pathname === want && document.querySelector('main h1') !== null, stop.path, { timeout: 60_000, polling: 'raf' });
    shown[stop.name].push(Date.now() - start);
    await settled(stop.path);
    times[stop.name].push(Date.now() - start);
  }
}

const mean = (list) => Math.round(list.reduce((sum, x) => sum + x, 0) / list.length);
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const all = Object.values(times).flat();
const allFeedback = Object.values(feedback).flat();
const allShown = Object.values(shown).flat();
console.log(`latency per Supabase request: ${GATEWAY_DELAY_MS ?? 0} ms; per request from the phone: ${BENCH_NET_MS ?? 0} ms; CPU ×4; ${ROUNDS} rounds${COLD ? '; cold (page reloaded before each tap)' : ''}${PRELOAD ? '' : '; preloading off'}`);
console.log(`opening: the opening screen at ${opening.screen.join(' / ')} ms · lifted at ${opening.lifted.join(' / ')} ms`);
for (const stop of STOPS) console.log(`${stop.name.padEnd(28)} settled ${times[stop.name].join(' / ')} ms · title ${shown[stop.name].join(' / ')} ms · first change ${feedback[stop.name].join(' / ')} ms`);
console.log(`all taps: settled mean ${mean(all)} ms, median ${median(all)} ms; title mean ${mean(allShown)} ms, median ${median(allShown)} ms; first change mean ${mean(allFeedback)} ms`);
if (BENCH_REPORT) writeFileSync(BENCH_REPORT, JSON.stringify({ cold: COLD, preload: PRELOAD, netMs: Number(BENCH_NET_MS ?? 0), opening, delayMs: Number(GATEWAY_DELAY_MS ?? 0), rounds: ROUNDS, times, shown, feedback, mean: mean(all), median: median(all), shownMean: mean(allShown), shownMedian: median(allShown), feedbackMean: mean(allFeedback) }, null, 2));
await browser.close();
