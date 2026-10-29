// Drives the app in Chromium against the local Supabase stand-in (run.sh), step by step, with a
// screenshot of each screen. The expected figures come from supabase/seed.sql (demo data). With a
// FINMIND_TOKEN in the environment, the last steps also run the real nightly job against the
// stand-in and check what it loaded (E2E_NIGHTLY=0 skips them).
import { execFile } from 'node:child_process';
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { promisify } from 'node:util';

import { chromium } from 'playwright-core';

// DOCS_SHOTS, when set, also saves the README screenshots there (npm run test:e2e with DOCS_SHOTS=$PWD/docs/images).
const { APP_PORT, SHOTS, CSV, CHROMIUM, OWNER_EMAIL, OWNER_PASSWORD, DOCS_SHOTS, TEXT_REPORT, GATEWAY_PORT, SECRET_KEY, FINMIND_TOKEN, E2E_NIGHTLY, REPO, PUSH_PORT, PUSH_KEY, PUSH_CERT, VAPID_PUBLIC_KEY } =
  process.env;
const BASE = `http://127.0.0.1:${APP_PORT}`;

const browser = await chromium.launch(CHROMIUM && existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Taipei' });
const page = await context.newPage();
const problems = [];
page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
page.on('dialog', (dialog) => dialog.accept());

const results = [];
let shot = 0;
// Not-found responses the scenario asks for on purpose (a deleted trade's page).
let expectedNotFound = 0;
async function snap(name, target = page, fullPage = true) {
  shot += 1;
  await target.screenshot({ path: `${SHOTS}/${String(shot).padStart(2, '0')}-${name}.png`, fullPage });
}
/** A README image: the visible screen, or one element, never the full page. */
async function docShot(name, target) {
  if (DOCS_SHOTS) await target.screenshot({ path: `${DOCS_SHOTS}/${name}.png` });
}
async function step(name, fn) {
  try {
    await fn();
    results.push(`ok    ${name}`);
  } catch (err) {
    results.push(`FAIL  ${name}: ${String(err.message ?? err).split('\n')[0]}`);
    await snap(`FAIL-${name.replace(/\W+/g, '-')}`).catch(() => {});
  }
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}
const body = (target = page) => target.locator('body').innerText();
/** A summary tile (components/facts.tsx) as one line: its icon, label, figure and note. */
const fact = async (label) => (await page.locator('.fact', { hasText: label }).first().innerText()).replace(/\s+/g, ' ');

await step('installable: manifest, icons and robots.txt load without a session; pages send the security headers', async () => {
  const manifest = await page.request.get(`${BASE}/manifest.webmanifest`, { maxRedirects: 0 });
  check(manifest.status() === 200, `manifest HTTP ${manifest.status()}`);
  const json = await manifest.json();
  check(json.display === 'standalone' && json.start_url === '/', 'standalone, opens on the dashboard');
  // The service worker loads without a session, fresh each time, as a phone fetches it.
  const worker = await page.request.get(`${BASE}/sw.js`, { maxRedirects: 0 });
  check(worker.status() === 200 && worker.headers()['content-type']?.includes('javascript') && worker.headers()['cache-control']?.includes('no-cache'), `sw.js HTTP ${worker.status()}`);
  check((await worker.text()).includes("addEventListener('push'"), 'the worker shows pushes');
  for (const icon of [...json.icons.map((i) => i.src), '/apple-icon.png']) {
    const res = await page.request.get(`${BASE}${icon}`, { maxRedirects: 0 });
    check(res.status() === 200 && res.headers()['content-type'] === 'image/png', `${icon} HTTP ${res.status()}`);
  }
  const robots = await page.request.get(`${BASE}/robots.txt`, { maxRedirects: 0 });
  check(robots.status() === 200 && (await robots.text()).includes('Disallow: /'), 'robots.txt disallows everything');
  const login = await page.request.get(`${BASE}/login`);
  const headers = login.headers();
  check(headers['x-frame-options'] === 'DENY' && headers['x-content-type-options'] === 'nosniff', 'framing and sniffing refused');
  const html = await login.text();
  check(/<link rel="manifest" href="\/manifest.webmanifest"/.test(html), 'manifest linked');
  check(html.includes('name="mobile-web-app-capable"') || html.includes('name="apple-mobile-web-app-capable"'), 'home-screen app meta');
  check(html.includes('rel="apple-touch-icon"') && /name="robots" content="noindex, nofollow"/.test(html), 'apple icon and noindex');
});

await step('an unsigned visit goes to sign-in', async () => {
  await page.goto(`${BASE}/holdings`);
  await page.waitForURL('**/login');
  check((await body()).includes('Sign in') && (await body()).includes('登入'), 'bilingual sign-in page');
  await snap('login');
});

await step('a wrong password is refused with one generic message', async () => {
  await page.fill('input[name=email]', OWNER_EMAIL);
  await page.fill('input[name=password]', 'not-the-password');
  await page.click('main button[type=submit]');
  await page.getByText('Sign-in failed').waitFor();
  check((await body()).includes('登入失敗'), 'Chinese error');
  check((await page.inputValue('input[name=email]')) === OWNER_EMAIL, 'the email stays filled in');
});

await step('the owner signs in and lands on the weekly dashboard', async () => {
  await page.fill('input[name=password]', OWNER_PASSWORD);
  await page.click('main button[type=submit]');
  await page.waitForURL(`${BASE}/`);
  await page.getByRole('heading', { level: 1, name: /This week/ }).waitFor();
  await page.goto(`${BASE}/holdings`);
  await page.getByRole('heading', { name: /Listed holdings/ }).waitFor();
});

await step('holdings: demo pool total, R1 breaches with trims, satellite share, gold not valued yet', async () => {
  const text = await body();
  // Seed: seven ETFs and stocks at the demo closes and USD/TWD 32.40, plus NT$20,000 savings.
  check(text.includes('NT$79,203'), 'regular pool NT$79,203');
  check((await fact('R1 AAPL')).includes('9.7% > 5% sell ≈ NT$3,686'), `R1 AAPL with trim, got ${await fact('R1 AAPL')}`);
  check((await fact('R1 2330')).includes('9.1% > 5% sell ≈ NT$3,255'), `R1 2330 with trim, got ${await fact('R1 2330')}`);
  check(text.includes('18.8%'), 'satellite share 18.8%');
  check(text.includes('Not valued yet') && text.includes('Gold bar (demo)'), 'gold bar listed as not valued');
  check(text.includes('The nightly price job has not run yet'), 'no nightly run yet');
  check(text.includes('持倉') && text.includes('實際與目標權重'), 'Chinese labels');
  await snap('holdings');
});

await step('holdings: R1 and R2 are worked out on screen with the demo figures', async () => {
  await page.getByText('How R1 and R2 are worked out').click();
  const text = await body();
  // 5% of NT$79,203.12; the satellite is 2330 (NT$7,215) plus AAPL (NT$7,646.40).
  check(text.includes('One stock may hold up to NT$3,960'), 'R1 limit in NT$');
  check(text.includes('NT$14,861 ÷ NT$79,203 = 18.8%'), 'R2 inputs');
  check(text.includes('單一個股最多可持有 NT$3,960'), 'Chinese R1 line');
});

await step("trade form: picking VT fills USD and the trade date's rate; an existing breach is shown as such", async () => {
  await page.goto(`${BASE}/holdings/new`);
  await page.fill('input[name=tradeDate]', '2026-10-20');
  await page.fill('input[name=ticker]', 'VT');
  check((await page.inputValue('input[name=currency]')) === 'USD', 'currency USD');
  check((await page.inputValue('input[name=fxRate]')) === '32.4', `fx 32.4, got ${await page.inputValue('input[name=fxRate]')}`);
  check((await body()).includes('Rate of 2026-10-20: 32.4'), "the hint names the rate's date");
  await page.fill('input[name=qty]', '1');
  await page.fill('input[name=price]', '158');
  await page.fill('input[name=fee]', '1');
  await page.getByText('Already above a limit before this trade').waitFor();
  await snap('trade-form');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=added');
  await page.getByText('Trade added.').waitFor();
});

await step('trade form: a new date brings its own rate, the newest within 10 days, until a rate is typed', async () => {
  await page.goto(`${BASE}/holdings/new`);
  await page.fill('input[name=tradeDate]', '2026-10-20');
  await page.fill('input[name=ticker]', 'VT');
  const rate = () => page.inputValue('input[name=fxRate]');
  // The seed has rates for 2026-10-08 and 2026-10-20 only.
  await page.fill('input[name=tradeDate]', '2026-10-10');
  check((await rate()) === '32.3', `rate of 2026-10-08 for 2026-10-10, got ${await rate()}`);
  await page.fill('input[name=tradeDate]', '2026-09-01');
  check((await rate()) === '', `no rate within 10 days of 2026-09-01, got ${await rate()}`);
  check((await body()).includes('No rate loaded for this date'), 'the hint says so');
  await page.fill('input[name=fxRate]', '32.55');
  await page.fill('input[name=tradeDate]', '2026-10-20');
  check((await rate()) === '32.55', 'a typed rate stays');
});

await step('a typo in the FX rate warns', async () => {
  await page.goto(`${BASE}/holdings/new`);
  await page.fill('input[name=tradeDate]', '2026-10-20');
  await page.fill('input[name=ticker]', 'VT');
  await page.fill('input[name=fxRate]', '3.24');
  await page.getByText('more than 20% away from 32.4 (2026-10-20)').waitFor();
});

await step('a sell larger than the holding is refused, live and on the server', async () => {
  await page.goto(`${BASE}/holdings/new`);
  await page.fill('input[name=ticker]', 'AAPL');
  await page.selectOption('select[name=side]', 'sell');
  await page.fill('input[name=qty]', '5');
  await page.fill('input[name=price]', '240');
  await page.getByText('4 units larger than the holding').first().waitFor();
  await snap('shortfall');
  await page.click('main button[type=submit]');
  await page.getByText('Check the highlighted fields.').waitFor();
  check(page.url().endsWith('/holdings/new'), 'stays on the form');
  check((await page.inputValue('input[name=qty]')) === '5' && (await page.inputValue('input[name=ticker]')) === 'AAPL', 'typed values survive the refusal');
});

let editedId;
await step('editing a trade records the change in its history', async () => {
  await page.goto(`${BASE}/holdings`);
  // The newest trade is listed first: the VT buy added above.
  await page.locator('#trades tbody tr').first().getByRole('link').click();
  await page.waitForURL(/\/holdings\/\d+$/);
  editedId = page.url().split('/').pop();
  await page.fill('input[name=qty]', '2');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=updated');
  await page.goto(`${BASE}/holdings/${editedId}`);
  const text = await body();
  check(text.includes('Changed') && /Quantity\s*數量: 1 → 2/.test(text), 'history shows qty 1 → 2');
  await snap('edit-history');
});

await step('deleting a trade asks first, then removes it', async () => {
  await page.goto(`${BASE}/holdings/${editedId}`);
  await page.getByRole('button', { name: /Delete/ }).click();
  await page.waitForURL('**/holdings?saved=deleted');
  await page.getByText('Trade deleted').waitFor();
  expectedNotFound += 1;
  const missing = await page.goto(`${BASE}/holdings/${editedId}`);
  check(missing?.status() === 404, `deleted trade page is 404, got ${missing?.status()}`);
  check((await body()).includes('找不到這個頁面或資料'), 'bilingual not-found page');
});

await step('the edit history keeps the change and the deleted trade', async () => {
  await page.goto(`${BASE}/history`);
  const text = await body();
  check(/Deleted\s*刪除[\s\S]*buy 2 VT at 158 USD/.test(text), 'deleted trade listed with what it held');
  check(text.includes('買進 VT 2 單位，價格 158 USD'), 'Chinese description');
  check(/Quantity\s*數量: 1 → 2/.test(text), 'the earlier quantity change');
  await snap('history');
});

await step('gold: grams × price per gram gives the value, and it joins the pool', async () => {
  await page.goto(`${BASE}/holdings`);
  await page.getByRole('link', { name: 'Enter a value' }).click();
  await page.waitForURL(/\/assets\/\d+$/);
  await page.getByLabel('Gold price per gram').fill('3000');
  check((await page.inputValue('input[name=lastValueTwd]')) === '15000', 'value 5 g × 3,000 = 15,000');
  await snap('gold');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=asset-updated');
  check((await body()).includes('NT$15,000'), 'gold valued at NT$15,000');
});

await step('a cash balance can be added in the windfall pool, outside R1 and R2', async () => {
  await page.goto(`${BASE}/assets/new`);
  await page.fill('input[name=name]', 'Money-market fund (demo)');
  await page.selectOption('select[name=productType]', 'cash_mmf');
  check((await page.inputValue('select[name=assetClassId]')) === 'strategic_cash', 'cash defaults to strategic cash');
  await page.fill('input[name=quantity]', '50000');
  await page.selectOption('select[name=pool]', 'windfall');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=asset-added');
  const text = await body();
  check(text.includes('Windfall pool') && text.includes('NT$50,000'), 'windfall NT$50,000');
});

await step("cash flows: the seed's contributions and dividend are listed, with totals in TWD", async () => {
  await page.goto(`${BASE}/holdings`);
  const section = page.locator('#cash-flows');
  const text = await section.innerText();
  // Six NT$10,000 contributions and 0.62 USD of VT dividends at 32.20.
  check(/Contribution[\s\S]*?NT\$60,000/.test(text) && /Dividend[\s\S]*?NT\$20\b/.test(text), `totals per type, got ${text.slice(0, 300)}`);
  check(text.includes('投入資金') && text.includes('股利'), 'Chinese type labels');
});

let flowId;
await step("cash flows: a USD dividend takes its security's currency and the date's rate; an edit is logged", async () => {
  await page.goto(`${BASE}/cash-flows/new`);
  await page.selectOption('select[name=type]', 'dividend');
  await page.fill('input[name=flowDate]', '2026-10-20');
  await page.fill('input[name=ticker]', 'VT');
  check((await page.inputValue('input[name=currency]')) === 'USD', 'currency from VT');
  check((await page.inputValue('input[name=fxRate]')) === '32.4', `rate of 2026-10-20, got ${await page.inputValue('input[name=fxRate]')}`);
  check((await page.inputValue('select[name=pool]')) === 'regular', 'the pool that holds VT');
  await page.fill('input[name=amount]', '0.55');
  await page.getByText('In USD = NT$18').waitFor();
  await snap('cash-flow-form');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=flow-added**');
  await page.getByText('Cash flow added.').waitFor();
  const row = page.locator('#cash-flows tbody tr').first();
  check((await row.innerText()).includes('0.55 USD'), 'the dividend listed first, as the newest');
  await row.getByRole('link').click();
  await page.waitForURL(/\/cash-flows\/\d+$/);
  flowId = page.url().split('/').pop();
  await page.fill('input[name=amount]', '0.6');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=flow-updated**');
  await page.goto(`${BASE}/cash-flows/${flowId}`);
  check(/Amount\s*金額: 0\.55 → 0\.6/.test(await body()), 'history shows 0.55 → 0.6');
});

await step('cash flows: the windfall arriving always lands in the windfall pool, and an entry can be deleted', async () => {
  await page.goto(`${BASE}/cash-flows/new`);
  await page.selectOption('select[name=type]', 'windfall');
  check(await page.locator('select[name=pool]').isDisabled(), 'pool fixed');
  check((await page.inputValue('select[name=pool]')) === 'windfall', 'windfall pool');
  await page.fill('input[name=amount]', '1000000');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=flow-added**');
  const row = page.locator('#cash-flows tbody tr', { hasText: 'Windfall arrives' });
  check((await row.innerText()).includes('NT$1,000,000'), 'listed in TWD');
  await row.getByRole('link').click();
  await page.waitForURL(/\/cash-flows\/\d+$/);
  await page.getByRole('button', { name: /Delete/ }).click();
  await page.waitForURL('**/holdings?saved=flow-deleted**');
  await page.getByText('Cash flow deleted').waitFor();
  check((await page.locator('#cash-flows tbody tr', { hasText: 'Windfall arrives' }).count()) === 0, 'gone from the list');
});

await step('adding a security leads to a new trade in it', async () => {
  await page.goto(`${BASE}/securities/new?ticker=msft`);
  check((await page.inputValue('input[name=ticker]')) === 'MSFT', 'ticker prefilled upper-case');
  await page.fill('input[name=name]', 'Microsoft Corp.');
  check((await page.inputValue('select[name=assetClassId]')) === 'us_stocks', 'US stock → US stocks class, from AAPL');
  await snap('add-security');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings/new?ticker=MSFT');
  check((await page.inputValue('input[name=currency]')) === 'USD', 'currency carried over');
  check((await page.inputValue('input[name=fxRate]')) === '32.4', 'rate carried over');
});

await step('securities: an edit is logged; one in use cannot be deleted, an unused one can', async () => {
  await page.goto(`${BASE}/securities`);
  check((await body()).includes('Microsoft Corp.'), 'MSFT listed');
  await page.goto(`${BASE}/securities/MSFT`);
  check(await page.locator('input[name=ticker]').getAttribute('readonly') !== null, 'ticker fixed');
  await page.selectOption('select[name=productType]', 'equity_etf');
  await page.getByText('re-files every trade in this security').waitFor();
  await page.selectOption('select[name=productType]', 'stock');
  await page.fill('input[name=name]', 'Microsoft Corporation');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/securities?saved=updated');
  await page.goto(`${BASE}/securities/MSFT`);
  check(/Name\s*名稱: Microsoft Corp\. → Microsoft Corporation/.test(await body()), 'name change in its history');
  await snap('security-edit');
  await page.getByRole('button', { name: /Delete/ }).click();
  await page.waitForURL('**/securities?saved=deleted');
  await page.goto(`${BASE}/securities/VT`);
  await page.getByRole('button', { name: /Delete/ }).click();
  await page.getByText('still in use').waitFor();
  check((await body()).includes('仍在使用中'), 'Chinese refusal');
});

await step('CSV import: Big5 statement, title lines, guessed columns, every row explained', async () => {
  await page.goto(`${BASE}/import`);
  await page.getByLabel('Broker name').fill('國泰複委託（示範）');
  await page.setInputFiles('input[type=file]', CSV);
  await page.getByText('Read as Big5').waitFor();
  check((await page.locator('input[type=number]').inputValue()) === '3', 'header row 3');
  // No rate column and none typed: each row takes the rate of its trade date, here the newest within 10 days.
  // The 股利 row becomes a dividend cash flow; the totals row is skipped.
  await page.getByText('2 new trades · 1 new dividend · 0 already saved · 1 with an unknown ticker · 1 skipped').waitFor();
  const text = await body();
  check(text.includes('不是交易列'), 'totals row explained');
  const dividend = await page.locator('tr', { hasText: 'Dividend' }).first().innerText();
  check(dividend.includes('1.24 USD') && dividend.includes('32.3'), `dividend row with its amount and rate, got ${dividend}`);
  check((await page.getByText('2026-10-08', { exact: true }).count()) === 3, "both trades and the dividend show their rate's date");
  await snap('import-preview');
  await docShot('import-preview', page.locator('[aria-live="polite"]').last());
});

await step('CSV import: an unknown ticker is added in a new tab, then "Check again"', async () => {
  const [tab] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Add NVDA' }).click()]);
  await tab.waitForLoadState();
  await tab.fill('input[name=name]', 'NVIDIA Corp.');
  await tab.click('main button[type=submit]');
  await tab.getByText('Added NVDA.').waitFor();
  await snap('security-added-tab', tab, false);
  await tab.close();
  await page.getByRole('button', { name: /Check again/ }).click();
  await page.getByText('3 new trades · 1 new dividend · 0 already saved · 0 with an unknown ticker · 1 skipped').waitFor();
  await page.getByRole('button', { name: /Import 3 trades and 1 dividend/ }).click();
  await page.waitForURL('**/holdings?saved=imported**');
  await page.getByText('Imported 3 trades and 1 dividend; 1 row of the file skipped.').waitFor();
  check((await body()).includes('CSV import'), 'imported trades marked as CSV');
  check((await page.locator('#cash-flows tr', { hasText: '2026-10-18' }).innerText()).includes('1.24 USD'), 'the dividend is a cash flow');
  await snap('after-import');
});

await step('CSV import again: the broker mapping is remembered and nothing is imported twice', async () => {
  await page.goto(`${BASE}/import`);
  check((await page.locator('select').first().inputValue()) === '國泰複委託（示範）', 'saved broker selected');
  await page.setInputFiles('input[type=file]', CSV);
  await page.getByText('0 new trades · 0 new dividends · 4 already saved').waitFor();
  check(await page.getByRole('button', { name: /Import 0 trades/ }).isDisabled(), 'import disabled');
  // A saved row can still be imported again on purpose, at its trade date's rate.
  await page.getByLabel('Import anyway').first().check();
  await page.getByRole('button', { name: /Import 1 trade 匯入/ }).waitFor();
});

await step('performance: TWR against the SAA benchmark, XIRR, monthly FX split and per-holding split', async () => {
  await page.goto(`${BASE}/performance`);
  await page.getByRole('heading', { name: /Performance/ }).waitFor();
  // ECharts draws both charts as SVG once the page is in the browser.
  await page.locator('.chart svg').nth(1).waitFor();
  const text = await body();
  // The seed's first trade is the VT buy of 2026-05-07; its demo closes run from that day.
  check(text.includes('2026-05-07 (first purchase) →'), 'measured from the first demo purchase');
  // A tile reads: the label in English and Chinese on one line, then the figure.
  const tile = (label) => new RegExp(`${label}[^\\n]*\\n\\s*[+−]?\\d+\\.\\d%`).test(text);
  check(tile('Time-weighted return \\(TWR\\)'), 'TWR tile');
  check(tile('SAA benchmark') && text.includes('Portfolio minus benchmark'), 'benchmark tile with the difference');
  check(tile('Money-weighted return \\(XIRR\\)'), 'XIRR tile');
  check(text.includes('Since the start') && text.includes('Returns by period'), 'period table');
  const splits = await page.locator('section', { hasText: 'FX split per foreign holding' }).innerText();
  for (const ticker of ['VT', 'BNDW', 'GLDM', 'BIL']) check(splits.includes(ticker), `FX split lists ${ticker}`);
  // AAPL was sold by the CSV import; 2330 and 00692 trade in TWD.
  check(!/\b(AAPL|2330|00692)\b/.test(splits), 'sold-out and TWD holdings are not split');
  check(text.includes('時間加權報酬') && text.includes('資金加權報酬') && text.includes('匯率拆解'), 'Chinese labels');
  await snap('performance');
  // The README image: the headline figures and the whole cumulative chart.
  await page.setViewportSize({ width: 1280, height: 1360 });
  await docShot('performance', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Hovering the line shows every series at that date; the table views hold the same values.
  const chart = page.locator('.chart').first();
  const box = await chart.boundingBox();
  check(box !== null, 'chart has a size');
  // hover scrolls the chart into view before moving the pointer over it.
  await chart.hover({ position: { x: Math.round(box.width * 0.6), y: Math.round(box.height * 0.5) } });
  const tip = page.locator('.chart-tip').first();
  await tip.waitFor();
  const tipText = await tip.innerText();
  check(tipText.includes('Portfolio (TWR)') && tipText.includes('SAA benchmark'), `tooltip lists both lines, got ${tipText}`);
  await snap('performance-tooltip', page, false);
  for (const summary of await page.getByText('Show as a table').all()) await summary.click();
  const tables = await body();
  check(tables.includes('2026-05') && tables.includes('2026-09'), 'monthly table from May to September');
  await snap('performance-tables');
});

await step('performance: the windfall pool alone, year to date, and dark mode', async () => {
  // The e2e added a windfall cash balance today: a value, but no return until the next close.
  await page.goto(`${BASE}/performance?scope=windfall`);
  check((await body()).includes('The windfall pool’s holdings were added today'), 'windfall pool new today');
  await page.goto(`${BASE}/performance?range=ytd&scope=regular`);
  await page.locator('.chart svg').nth(1).waitFor();
  check((await page.locator('.segmented a[aria-current=true]').allInnerTexts()).join(' ').includes('Year to date'), 'year to date selected');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${BASE}/performance`);
  await page.locator('.chart svg').nth(1).waitFor();
  await snap('performance-dark');
  await page.emulateMedia({ colorScheme: 'light' });
});

await step('allocation: drift from the targets coloured by the 5/25 rule, satellite left to R2', async () => {
  await page.goto(`${BASE}/allocation`);
  await page.getByRole('heading', { level: 1, name: /Allocation/ }).waitFor();
  await page.locator('.chart svg').first().waitFor();
  const rows = page.locator('table').first().locator('tbody tr');
  check((await rows.count()) === 8, `eight asset classes, got ${await rows.count()}`);
  const row = (name) => page.locator('table').first().locator('tbody tr', { hasText: name }).innerText();
  // Demo: savings and BIL, and the gold bar with GLDM, sit far above the 8% and 10% targets.
  check((await row('Strategic cash')).includes('Rebalance'), `strategic cash red, got ${await row('Strategic cash')}`);
  check((await row('Real assets')).includes('Rebalance'), 'real assets red');
  check((await row('US stocks')).includes('Left to R2'), 'satellite classes left to R2');
  check((await page.locator('tfoot').first().innerText()).includes('Satellite sleeve (R2)'), 'satellite sleeve row');
  check((await body()).includes('需再平衡') && (await body()).includes('與目標權重的偏離'), 'Chinese labels');
  await snap('allocation');
  await page.setViewportSize({ width: 1280, height: 1300 });
  await docShot('allocation', page);
  await page.setViewportSize({ width: 1280, height: 900 });
});

await step('allocation donuts: three lenses, the 80/20 target ring, a slice lists its holdings', async () => {
  await page.goto(`${BASE}/allocation`);
  const donut = page.locator('.chart-donut svg');
  await donut.waitFor();
  const slices = page.locator('table.slices');
  check((await slices.innerText()).includes('Gold (ETF and physical)'), 'product lens: gold slice');
  await page.getByRole('button', { name: /Gold \(ETF and physical\)/ }).click();
  const listed = await page.locator('.slice-holdings').innerText();
  check(listed.includes('GLDM') && listed.includes('Gold bar (demo)'), `gold slice lists GLDM and the gold bar, got ${listed}`);
  await page.getByRole('tab', { name: /Listing country/ }).click();
  check((await slices.innerText()).includes('Not listed'), 'country lens: not listed');
  await page.getByRole('tab', { name: /Active vs passive/ }).click();
  const sleeve = await slices.innerText();
  check(sleeve.includes('Passive core') && sleeve.includes('80.0%') && sleeve.includes('20.0%'), `sleeve lens with targets, got ${sleeve}`);
  check((await body()).includes('Inner ring: the SAA target'), 'target ring explained');
  await snap('allocation-donut');
  await page.goto(`${BASE}/allocation?scope=windfall`);
  await page.locator('.chart-donut svg').waitFor();
  check(!(await body()).includes('Inner ring'), 'no target ring for the windfall pool');
});

await step('targets: must add up to 100%, are saved together and logged', async () => {
  await page.goto(`${BASE}/allocation/targets`);
  await page.fill('input[name=target_us_global_equity]', '27');
  check((await body()).includes('The targets add up to 99%'), 'live total check');
  await page.fill('input[name=target_tw_market_cap]', '13');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/allocation?saved=targets');
  check((await page.locator('table').first().locator('tbody tr', { hasText: 'Taiwan market-cap' }).innerText()).includes('13.0%'), 'new Taiwan target shown');
  await page.goto(`${BASE}/allocation/targets`);
  const log = (await page.locator('section', { hasText: 'Edit history' }).textContent()) ?? '';
  check(/Changed[\s\S]*US \/ global equity[\s\S]*Target\s*目標: 0\.28 → 0\.27/.test(log), 'edit history shows 0.28 → 0.27');
  await snap('targets');
  // Back to the Investment Principles, for the steps that follow.
  await page.fill('input[name=target_us_global_equity]', '28');
  await page.fill('input[name=target_tw_market_cap]', '12');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/allocation?saved=targets');
});

await step('capital market assumptions: a source is required, then they show with the date reviewed', async () => {
  await page.goto(`${BASE}/allocation/assumptions`);
  await page.fill('input[name=return_us_global_equity]', '6.5');
  await page.fill('input[name=volatility_us_global_equity]', '16');
  await page.click('main button[type=submit]');
  await page.getByText('Say where the assumption comes from.').waitFor();
  const demo = { us_global_equity: ['6.5', '16'], tw_market_cap: ['6', '20'], global_bonds: ['3.5', '6'], real_assets: ['4', '15'], strategic_cash: ['1.5', '1'] };
  for (const [id, [expected, volatility]] of Object.entries(demo)) {
    await page.fill(`input[name=return_${id}]`, expected);
    await page.fill(`input[name=volatility_${id}]`, volatility);
    await page.fill(`input[name=source_${id}]`, 'Demo values, not advice 示範數值');
  }
  await page.click('main button[type=submit]');
  await page.waitForURL('**/allocation?saved=assumptions');
  const card = await page.locator('section').filter({ has: page.getByRole('heading', { name: /^Capital market assumptions/ }) }).innerText();
  // What is folded behind ⓘ is read from the page's text rather than what is drawn.
  const folded = (await page.locator('section').filter({ has: page.getByRole('heading', { name: /^Capital market assumptions/ }) }).textContent()) ?? '';
  check(card.includes('6.5%') && card.includes('16.0%') && folded.includes('Last reviewed on'), `assumptions shown, got ${card}`);
  // The satellite classes have targets but no assumptions yet.
  check(folded.includes('Expected return: once every class has an assumption'), 'no target-mix return yet');
});

/** The VaR figure the card shows, in NT$, and its share of the portfolio in %. */
async function varFigure(card) {
  const value = Number((await card.locator('.var-value').innerText()).replace(/[^\d]/g, ''));
  const share = Number(/\(([\d.]+)% of portfolio\)/.exec(await card.innerText())?.[1]);
  return { value, share };
}

await step('risk card on holdings: the 95% 1-week VaR in NT$ and % of the portfolio, the 1-in-20 line, the 1-month toggle', async () => {
  await page.goto(`${BASE}/holdings`);
  const card = page.locator('#value-at-risk');
  await card.waitFor();
  const text = await card.innerText();
  check(text.includes('95% 1-week VaR') && text.includes('95% 一週風險值'), 'bilingual label');
  check(text.includes('In about 1 week in 20, losses could exceed this.') && text.includes('每 20 週約有 1 週，損失可能超過此金額。'), 'the 1-in-20 line');
  // The seed's three years of weekly demo closes give the proxies their covariance.
  const week = await varFigure(card);
  check(week.value > 0 && week.share > 0.2 && week.share < 6, `a plausible weekly VaR, got NT$${week.value} (${week.share}%)`);
  const folded = (await card.textContent()) ?? '';
  check(folded.includes('Weekly returns from') && folded.includes('both pools'), 'the window and the value it is a share of, behind ⓘ');
  // No NAV snapshot carries a VaR until the nightly job runs.
  check(text.includes('The 52-week line fills in'), 'no saved line yet');
  await card.getByRole('button', { name: /1 month/ }).click();
  await card.getByText('95% 1-month VaR').waitFor();
  const month = await varFigure(card);
  check(Math.abs(month.value - week.value * Math.sqrt(4.33)) <= 2, `1 month = 1 week × √4.33: ${month.value} vs ${week.value}`);
  check((await card.innerText()).includes('In about 1 month in 20'), 'the month line');
  await snap('holdings-risk', card, false);
});

await step('risk page: the histogram with its cutoff, the weeks beyond it, what the VaR is made of, the formula', async () => {
  await page.goto(`${BASE}/risk`);
  await page.getByRole('heading', { level: 1, name: /Value at Risk/ }).waitFor();
  await page.locator('.chart-histogram svg').waitFor();
  const text = await body();
  check(text.includes('Where the VaR sits among the last 156 weeks'), 'three years of weekly returns');
  check(/Weeks beyond the VaR[\s\S]*?\d+ \/ 156[\s\S]*?≈ [\d.]+ expected/.test(text), `the weeks beyond the VaR are counted, got ${text.slice(0, 800)}`);
  const inputs = await page.locator('section', { hasText: 'What the VaR is made of' }).innerText();
  // Each holding by its class proxy: 00692 and 2330 by 0050, NVDA by VOO; gold by GLDM; TWD balances add no risk.
  check(/0050\s+(00692, 2330|2330, 00692)/.test(inputs), `0050 measures 00692 and 2330, got ${inputs}`);
  check(/VOO\s+NVDA/.test(inputs) && /GLDM\s+(GLDM, Gold bar|Gold bar \(demo\)[^,\n]*, GLDM)/.test(inputs), 'NVDA by VOO, the gold bar with GLDM');
  check(/TWD balances[\s\S]*Money-market fund \(demo\)[\s\S]*High-yield savings/.test(inputs), 'both TWD balances, windfall included, without risk');
  const figure = await varFigure(page.locator('#value-at-risk'));
  const formula = (await page.locator('#formula').textContent()) ?? '';
  check(formula.includes(`× √1 × NT$`) && formula.includes(`= NT$${figure.value.toLocaleString('en-US')}.`), 'the formula, behind ⓘ, ends at the figure shown');
  check(text.includes('風險值的組成') && text.includes('公式與今天的數值'), 'Chinese labels');
  await snap('risk');
  // The README image, from the seed's invented history; a run with the nightly job replaces it with one that has the 52-week line.
  await page.setViewportSize({ width: 1280, height: 1250 });
  await docShot('risk', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Hovering a bar names its range and how many weeks fell in it.
  const chart = page.locator('.chart-histogram');
  const box = await chart.boundingBox();
  check(box !== null, 'histogram has a size');
  // Just above the axis in the middle, where the bins around 0% stand tallest.
  await chart.hover({ position: { x: Math.round(box.width * 0.55), y: Math.round(box.height * 0.85) } });
  await page.locator('.chart-tip').first().waitFor();
  check(/weeks?/.test(await page.locator('.chart-tip').first().innerText()), 'bar tooltip');
  for (const summary of await page.getByText('Show as a table').all()) await summary.click();
  await page.getByText('Correlations of the proxies').click();
  check(/beyond the VaR/.test(await body()), 'the table marks the bins beyond the VaR');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${BASE}/risk`);
  await page.locator('.chart-histogram svg').waitFor();
  await snap('risk-dark');
  await page.emulateMedia({ colorScheme: 'light' });
});

/** The figure a stat tile on the calculator shows, in NT$. */
async function statValue(label, scope = page) {
  const stat = scope.locator('.stat').filter({ hasText: label }).first();
  return Number((await stat.locator('.value').innerText()).replace(/[^\d−-]/g, '').replace('−', '-'));
}

await step('calculator: the target mix and the DCA amount to start from; the PRD case live; the start month fills in PV', async () => {
  await page.goto(`${BASE}/plan`);
  await page.getByRole('heading', { level: 1, name: /Calculator/ }).waitFor();
  await page.locator('.chart svg').first().waitFor();
  // The assumptions entered above cover the five core classes: (0.28·6.5 + 0.12·6 + 0.22·3.5 + 0.10·4 + 0.08·1.5) ÷ 0.80 = 4.7875%.
  check((await page.inputValue('input[name=expectedReturn]')) === '4.79', 'the target mix return over the core');
  check((await body()).includes('Target mix: 4.79% (80% of targets assumed)'), 'the mix says what it covers');
  check((await page.inputValue('input[name=pmt]')) === '10000', 'dca.amount_twd as the monthly contribution');
  check(/^\d{4}-\d{2}$/.test(await page.inputValue('input[name=start]')) && Number(await page.inputValue('input[name=pv]')) > 0, 'next month, from today’s regular pool');
  check((await body()).includes('Save a plan above to compare'), 'no plan saved yet');
  // Before the first demo trade the pool held nothing; at the end of June it held May's and June's buys.
  await page.fill('input[name=start]', '2026-05');
  check((await page.inputValue('input[name=pv]')) === '0', 'PV at the end of April is 0');
  await page.fill('input[name=start]', '2026-07');
  const june = Number(await page.inputValue('input[name=pv]'));
  check(june > 15_000 && june < 25_000 && (await body()).includes('Regular pool 2026-06-30'), `PV at the end of June, got ${june}`);
  // PRD Section 11: PV 0, PMT NT$10,000, 6% a year compounded monthly, 30 years, no step-up ≈ NT$10,045,000.
  await page.fill('input[name=start]', '2026-05');
  await page.fill('input[name=pv]', '0');
  await page.fill('input[name=stepUp]', '0');
  await page.fill('input[name=expectedReturn]', '6');
  await page.fill('input[name=inflation]', '2');
  await page.fill('input[name=years]', '30');
  check((await statValue('Value after 30 years')) === 10_045_150, `the acceptance value, got ${await statValue('Value after 30 years')}`);
  check((await statValue('Put in')) === 3_600_000 && (await statValue('Growth')) === 6_445_150, 'put in and growth');
  // In today's money at 2%: 10,045,150 ÷ 1.02^30.
  check(Math.abs((await statValue("Value in today's money")) - 10_045_150.42 / 1.02 ** 30) <= 1, 'the real value');
  check((await body()).includes('3.92%') && (await body()).includes('實質年報酬'), 'real return (1.06 ÷ 1.02 − 1), bilingual');
  await page.fill('input[name=stepUp]', '3');
  check((await statValue('Value after 30 years')) > 10_045_150 && (await body()).includes('Stepped up 3.00% a year'), 'a step-up raises the value');
  check(Math.abs((await statValue('Last monthly contribution')) - 10_000 * 1.03 ** (359 / 12)) <= 1, 'the last contribution after 29 years and 11 months of step-ups');
  await page.fill('input[name=years]', '0');
  await page.getByText('Enter a whole number of years from 1 to 60.').waitFor();
  check((await body()).includes('Fix the highlighted fields to see the projection.'), 'no projection from a bad field');
  await page.fill('input[name=years]', '30');
  await page.fill('input[name=stepUp]', '0');
  // Hovering a bar names its year and the four figures.
  const chart = page.locator('.chart').first();
  const box = await chart.boundingBox();
  check(box !== null, 'chart has a size');
  await chart.hover({ position: { x: Math.round(box.width * 0.97), y: Math.round(box.height * 0.5) } });
  await page.locator('.chart-tip').first().waitFor();
  const tip = await page.locator('.chart-tip').first().innerText();
  check(tip.includes('year 30') && tip.includes('NT$10,045,150') && tip.includes("Value in today's money"), `year tooltip, got ${tip}`);
  await page.getByText('Show as a table').first().click();
  check(/30\s+2056-04\s+NT\$10,045,150\s+NT\$3,600,000/.test(await body()), 'the year table');
  await snap('calculator');
});

await step('calculator: saving the plan compares the regular pool with it at each month end, the gap split', async () => {
  await page.click('main button[type=submit]');
  await page.waitForURL('**/plan?saved=plan');
  await page.getByText('Plan saved').waitFor();
  const section = page.locator('#actual-vs-plan');
  await section.locator('.chart svg').waitFor();
  const text = await section.innerText();
  check(text.includes('The plan from 2026-05: NT$0 to start, NT$10,000 a month stepped up 0.00% a year, at 6.00% a year for 30 years.'), `the plan, got ${text}`);
  // NT$10,000 at each month end, growing 0.5% a month: 10,000, then 20,050.
  await section.getByText('Show as a table').click();
  const table = await section.locator('table').innerText();
  check(/2026-05-31\s+NT\$[\d,]+\s+NT\$10,000\s/.test(table) && /2026-06-30\s+NT\$[\d,]+\s+NT\$20,050\s/.test(table), `planned month ends, got ${table}`);
  check(/2026-04-30\s+NT\$0\s+NT\$0\s+NT\$0/.test(table), 'the start: nothing held, nothing planned');
  const total = await statValue(/Ahead of the plan|Behind the plan/, section);
  const money = await statValue('Of which money put in', section);
  const growth = await statValue('Of which growth', section);
  check(Math.abs(total - money - growth) <= 1, `gap = money + growth: ${total} vs ${money} + ${growth}`);
  check(text.includes('實際與計畫對照') && text.includes('其中：投入金額'), 'Chinese labels');
  const chart = section.locator('.chart');
  const box = await chart.boundingBox();
  check(box !== null, 'chart has a size');
  await chart.hover({ position: { x: Math.round(box.width * 0.6), y: Math.round(box.height * 0.5) } });
  await page.locator('.chart-tip').first().waitFor();
  check(/Actual[\s\S]*Plan/.test(await page.locator('.chart-tip').first().innerText()), 'month-end tooltip');
  check((await page.inputValue('input[name=start]')) === '2026-05' && (await page.inputValue('input[name=expectedReturn]')) === '6', 'the form shows the saved plan');
  const history = (await page.locator('section', { hasText: 'Edit history of the plan' }).textContent()) ?? '';
  check(history.includes('Changed') && history.includes('2026-05'), 'the save is logged');
  await snap('calculator-saved');
  // The README image: the calculator from the top, its chart and the start of the comparison.
  await page.setViewportSize({ width: 1280, height: 1500 });
  await page.goto(`${BASE}/plan`);
  await page.locator('.chart svg').first().waitFor();
  await docShot('calculator', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${BASE}/plan`);
  await page.locator('#actual-vs-plan .chart svg').waitFor();
  await snap('calculator-dark');
  await page.emulateMedia({ colorScheme: 'light' });
});

/** Yesterday in Taipei, YYYY-MM-DD: a DCA debit then makes the monthly rule fire today. */
const taipeiYesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 86_400_000));
const taipeiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

await step('rules: each rule says what it finds now; the monthly contribution waits for the DCA day, which is set here', async () => {
  await page.goto(`${BASE}/rules`);
  await page.getByRole('heading', { level: 1, name: /^Rules/ }).waitFor();
  const monthly = await page.locator('#rule-MONTHLY_CONTRIBUTION').innerText();
  check(monthly.includes('Waiting for the DCA debit day'), `monthly waits, got ${monthly}`);
  // The engine's finding sits in the rule's status line.
  const fires = async (id) => /^\S*\s*Fires/.test(await page.locator(`#rule-${id} .rule-check`).innerText());
  check(await fires('R1'), 'R1 fires on the demo holdings');
  check((await page.locator('#rule-R2').innerText()).includes('Not firing'), 'R2 quiet at the demo satellite share');
  check((await page.locator('#rule-RED_FLAG_RED').innerText()).includes('Not firing'), "N3's rules read the seed's green scans");
  check((await page.locator('#rule-BUY_ZONE').innerText()).includes('Waiting for a saved valuation'), 'the F12 rules wait for a saved valuation');
  check((await page.locator('#rule-R1').textContent())?.includes('單一個股'), 'Chinese text');
  await page.fill('input[name=dcaDay]', '32');
  await page.getByText('Enter a day of the month from 1 to 31').waitFor();
  await page.fill('input[name=dcaDay]', String(Number(taipeiYesterday.slice(8))));
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/rules?saved=settings*');
  check(await fires('MONTHLY_CONTRIBUTION'), 'the monthly rule fires the day after the debit');
  // A threshold edit is logged with its old and new value, then put back.
  await page.locator('#rule-R1 summary', { hasText: 'Thresholds' }).click();
  await page.fill('#rule-R1 input[name=threshold_max_weight]', '0.5');
  await page.locator('#rule-R1 input[name=threshold_max_weight]').blur();
  check((await page.locator('#rule-R1').innerText()).includes('= 50.00%'), 'the share shown as a percentage');
  await page.locator('#rule-R1 button[type=submit]').click();
  await page.waitForURL('**/rules?saved=R1*');
  check((await page.locator('#rule-R1').innerText()).includes('Not firing'), 'with a 50% cap R1 stops firing');
  const log = (await page.locator('section', { hasText: 'Edit history of the rules' }).textContent()) ?? '';
  check(/R1[\s\S]*max_weight[\s\S]*0\.05[\s\S]*0\.5/.test(log), `the edit is logged, got ${log}`);
  // From a fresh address, so the redirect after saving is a new one to wait for.
  await page.goto(`${BASE}/rules`);
  await page.locator('#rule-R1 summary', { hasText: 'Thresholds' }).click();
  await page.fill('#rule-R1 input[name=threshold_max_weight]', '0.05');
  await page.locator('#rule-R1 button[type=submit]').click();
  await page.waitForURL('**/rules?saved=R1*');
  check(await fires('R1'), 'back to 5%');
  await snap('rules');
});

await step('proposals: checking the rules drafts R1, F8 and the monthly contribution, each explained, with whole-share orders', async () => {
  await page.goto(`${BASE}/proposals`);
  check((await body()).includes('No open proposals'), 'none before a check');
  await page.getByRole('button', { name: /Check the rules now/ }).click();
  await page.waitForURL('**/proposals?saved=checked*');
  check(/Rules checked: [3-9] new proposals, 0 closed\./.test(await body()), `three or more drafted, got ${await body()}`);
  const open = page.locator('article.proposal');
  const titles = await open.locator('h3').allInnerTexts();
  check(titles.some((title) => title.startsWith('R1 · Single-stock trim')), `R1 drafted, got ${titles}`);
  check(titles.some((title) => title.startsWith('F8_DRIFT · Drift rebalance')), 'F8 drafted');
  check(titles.some((title) => title.startsWith('MONTHLY_CONTRIBUTION · Monthly contribution')), 'monthly drafted');
  const r1 = open.filter({ hasText: 'Single-stock trim' });
  const r1Text = await r1.innerText();
  check(/: [\d.]+% of the regular pool \(NT\$[\d,]+ of NT\$[\d,]+\) > 5% cap · sell ≈ NT\$[\d,]+/.test(r1Text) && !r1Text.includes('Trim = '), `R1 explained, the method folded, got ${r1Text}`);
  check(/Sell 賣出\s+\S+\s+\d+/.test(r1Text) && r1Text.includes('單一個股減碼'), 'a sell order with its shares, bilingual');
  // The demo savings (NT$20,000) put strategic cash far over its 8%: money out of the balance funds the buys.
  const f8Text = await open.filter({ hasText: 'Drift rebalance' }).innerText();
  check(/Strategic cash: [\d.]+% \/ 8% target/.test(f8Text) && f8Text.includes('Take out'), `F8 explained with a balance order, got ${f8Text}`);
  const monthlyText = await open.filter({ hasText: 'Monthly contribution' }).innerText();
  check(monthlyText.includes(`NT$10,000 debited on ${taipeiYesterday} → the core classes furthest below target`) && /Buy 買進\s+\S+\s+\d+/.test(monthlyText), `monthly explained, got ${monthlyText.replace(/\s+/g, ' ')}`);
  await snap('proposals');
  await page.setViewportSize({ width: 1280, height: 1300 });
  await docShot('proposals', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Checking again drafts nothing twice (from a fresh page, so the redirect is a new address).
  await page.goto(`${BASE}/proposals`);
  await page.getByRole('button', { name: /Check the rules now/ }).click();
  await page.waitForURL('**/proposals?saved=checked*');
  check((await body()).includes('Rules checked: 0 new proposals, 0 closed.'), 'no duplicates');
});

await step('proposals: edit the orders, approve, record the trade from the checklist, mark filled; dismiss with a reason', async () => {
  await page.goto(`${BASE}/proposals`);
  const monthly = page.locator('article.proposal').filter({ hasText: 'Monthly contribution' });
  await monthly.getByRole('link', { name: /Edit the orders/ }).click();
  await page.waitForURL(/\/proposals\/\d+$/);
  // US funds are ordered in fractions, to four decimals (config orders).
  await page.fill('input[name=size_0]', '1.23456');
  await page.getByText('with at most 4 decimals').waitFor();
  await page.fill('input[name=size_0]', '1.2345');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/proposals?saved=edited*');
  check((await body()).includes('Orders saved'), 'edited');

  const r1 = page.locator('article.proposal').filter({ hasText: 'Single-stock trim' });
  const id = (await r1.getAttribute('id'))?.replace('proposal-', '');
  await r1.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL('**/proposals?saved=approved*');
  const approved = page.locator(`#proposal-${id}`);
  check((await approved.innerText()).includes('Execution checklist'), 'the checklist');
  await approved.getByRole('link', { name: /Record the trade/ }).first().click();
  await page.waitForURL(/\/holdings\/new\?/);
  check((await page.inputValue('select[name=side]')) === 'sell', 'a sell');
  check(Number(await page.inputValue('input[name=qty]')) > 0 && Number(await page.inputValue('input[name=price]')) > 0, 'shares and the latest close filled in');
  // R1's first sale is 2330: the Taiwan minimum commission, and the 0.3% transaction tax on one share at 2,405.
  check((await page.inputValue('input[name=fee]')) === '20' && (await page.inputValue('input[name=tax]')) === '7', `the estimated fee and tax, got ${await page.inputValue('input[name=fee]')} and ${await page.inputValue('input[name=tax]')}`);
  check((await body()).includes(`Filled in from proposal #${id}`), 'says where it came from');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/proposals?saved=trade*');
  check((await body()).includes('Trade recorded'), 'back at the proposal');
  await page.locator(`#proposal-${id}`).getByRole('button', { name: /Mark filled/ }).click();
  await page.waitForURL('**/proposals?saved=filled*');

  const f8 = page.locator('article.proposal').filter({ hasText: 'Drift rebalance' });
  await f8.locator('input[name=reason]').fill('Demo: keep the savings 示範');
  await f8.getByRole('button', { name: /^Dismiss/ }).click();
  await page.waitForURL('**/proposals?saved=dismissed*');
  const decided = await page.locator('section', { hasText: 'Decided and closed' }).innerText();
  check(/Filled/.test(decided) && /Dismissed[\s\S]*Demo: keep the savings/.test(decided), `decided listed, got ${decided}`);
  // A dismissed state is held back for its cooldown.
  await page.goto(`${BASE}/rules`);
  check(/held back until \d{4}-\d{2}-\d{2}/.test(await page.locator('#rule-F8_DRIFT').innerText()), 'F8 in its cooldown');
  await page.goto(`${BASE}/history`);
  const history = await body();
  check(history.includes('Proposal') && history.includes('Demo: keep the savings'), 'proposal changes in the edit history');
});

await step('holdings: the open proposals come first; dark mode and the proposals page', async () => {
  await page.goto(`${BASE}/holdings`);
  const banner = await page.locator('#open-proposals').innerText();
  check(banner.includes('to decide') && banner.includes('MONTHLY_CONTRIBUTION'), `open proposals banner, got ${banner}`);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${BASE}/proposals`);
  await snap('proposals-dark');
  await page.emulateMedia({ colorScheme: 'light' });
});

await step('costs: the yearly drag, each fund and broker over the plan, the Taiwan tax checks; choosing a broker prices the orders', async () => {
  await page.goto(`${BASE}/costs`);
  await page.locator('#fund-choices .chart svg').waitFor();
  const text = await body();
  // The summary tiles: each a label, its figure and, where it is a check, ✓ or !.
  const tile = fact;
  check(/Holding costs a year [^\n]*[\d.]+% · NT\$[\d,]+/.test(await tile('Holding costs a year')), `the yearly drag, got ${await tile('Holding costs a year')}`);
  check(/✓ ?US estate tax [^\n]*[\d,]+ USD \/ 60,000 USD/.test(await tile('US estate tax')), `the estate-tax tile, got ${await tile('US estate tax')}`);
  // The VT dividends recorded and the gain on the AAPL sale: far under the floor.
  check(/✓ ?Overseas income \(minimum tax\)[^\n]*NT\$[\d,]+ \/ NT\$1,000,000/.test(await tile('Overseas income (minimum tax)')), 'overseas income');
  check((await tile('Supplementary premium')).includes('NT$0'), 'no supplementary premium');
  check(/! ?Order fees[\s\S]*choose your broker below/.test(await tile('Order fees')), 'no broker chosen yet');
  const row = (ticker) => page.locator('#fund-choices tbody tr').filter({ has: page.locator('strong', { hasText: new RegExp(`^${ticker}$`) }) });
  // VT: TER 0.06% + 1.8% × 30% withheld; VWRA: TER 0.19% + 1.8% × 9% inside the fund.
  check((await row('VT').innerText()).includes('0.6%') && (await row('VWRA').innerText()).includes('0.352%'), `the drags, got ${await row('VT').innerText()} / ${await row('VWRA').innerText()}`);
  await snap('costs');

  await page.selectOption('#fee-settings + form select[name=broker]', 'cathay');
  await page.locator('#fee-settings + form button[type=submit]').click();
  await page.waitForURL('**/costs?saved=fees*');
  check((await page.locator('.fact', { hasText: 'Order fees priced with' }).innerText()).includes('Cathay Securities'), 'the broker chosen');
  // A typical order is NT$5,000 (NT$10,000 over two classes): US$3 at 32.4 plus 0.1% FX is 2.044% of it.
  check((await row('VT').innerText()).includes('2.044%'), `VT's order cost, got ${await row('VT').innerText()}`);
  const brokers = await page.locator('#brokers table').innerText();
  check(/Cathay Securities[\s\S]*yours/.test(brokers) && brokers.includes('35.00 USD · 22.78%'), `the minimum fee on a small order, got ${brokers}`);
  await page.setViewportSize({ width: 1280, height: 1400 });
  await docShot('costs', page);
  await page.setViewportSize({ width: 1280, height: 900 });

  // A fund's costs are edited in place, and the box records today as the day checked.
  await page.locator('#fund-costs > summary').click();
  await page.locator('#fund-VT > summary').click();
  await page.fill('#fund-VT input[name=yield]', '2');
  await page.locator('#fund-VT input[name=checked]').check();
  await page.locator('#fund-VT button[type=submit]').first().click();
  await page.waitForURL('**/costs?saved=fund*');
  check((await row('VT').innerText()).includes('0.66%'), 'VT: 0.06% + 2% × 30%');
  // The reloaded page has the settings folded again, so read the text rather than what is drawn.
  check(((await page.locator('#fund-VT > summary').textContent()) ?? '').includes(`checked ${taipeiToday}`), 'checked today');

  await page.goto(`${BASE}/proposals`);
  const monthly = await page.locator('article.proposal').filter({ hasText: 'Monthly contribution' }).innerText();
  check(monthly.includes('3.00 USD') && /Est\. fees and tax ≈ NT\$[\d,]+ \(Cathay Securities\)/.test(monthly), `fees on the orders, got ${monthly.replace(/\s+/g, ' ')}`);
});

await step('US estate tax: a windfall buy takes US-situs assets past US$60,000; the rule suggests Irish ETFs, with no orders', async () => {
  await page.goto(`${BASE}/holdings/new`);
  await page.fill('input[name=ticker]', 'VT');
  await page.fill('input[name=qty]', '380');
  await page.fill('input[name=price]', '157.80');
  await page.selectOption('select[name=pool]', 'windfall');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=added');
  await page.goto(`${BASE}/proposals`);
  await page.getByRole('button', { name: /Check the rules now/ }).click();
  await page.waitForURL('**/proposals?saved=checked*');
  const estate = page.locator('article.proposal').filter({ hasText: 'US estate tax' });
  const text = await estate.innerText();
  check(/US-situs assets: 6\d,\d{3} USD > 60,000 USD exempt/.test(text) && text.includes('Irish-domiciled equivalents') && text.includes('No orders'), `explained, got ${text.replace(/\s+/g, ' ')}`);
  await page.goto(`${BASE}/costs#estate-tax`);
  const section = await page.locator('#estate-tax').innerText();
  check(section.includes('VWRA') && section.includes('AGGU') && (await page.locator('#estate-tax .meter.over').count()) === 1, `over the exemption, alternatives named, got ${section}`);
  await snap('costs-estate');
  // Leave the later steps the demo as it was: dismiss the suggestion and delete the windfall buy.
  await page.goto(`${BASE}/proposals`);
  const open = page.locator('article.proposal').filter({ hasText: 'US estate tax' });
  await open.locator('input[name=reason]').fill('Demo: a test buy 示範');
  await open.getByRole('button', { name: /^Dismiss/ }).click();
  await page.waitForURL('**/proposals?saved=dismissed*');
  await page.goto(`${BASE}/holdings`);
  await page.locator('#trades tbody tr').first().getByRole('link').click();
  await page.waitForURL(/\/holdings\/\d+$/);
  check((await page.inputValue('input[name=qty]')) === '380', 'the windfall buy');
  await page.getByRole('button', { name: /Delete/ }).click();
  await page.waitForURL('**/holdings?saved=deleted');
});

/** The same day `months` later, or that month's last day: when F3's monthly tranches fall due. */
function monthsLater(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  target.setUTCDate(Math.min(day, new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()));
  return target.toISOString().slice(0, 10);
}

await step("windfall: CAPE's percentile sets the pace, ACWI's fall from its high, and the backtest against a lump sum", async () => {
  await page.goto(`${BASE}/windfall`);
  await page.locator('.chart-backtest svg').waitFor();
  const text = await body();
  // Seed: CAPE 24.04 in 2026-09, the 74th percentile of its 1,749 months since 1881: above the 70th, so 24 tranches.
  check((await fact('CAPE 2026-09')).includes('24.0 · 74th → 24 tranches → 分 24 批'), `the gauge, got ${await fact('CAPE 2026-09')}`);
  // ACWI's demo closes peak at 137.95 on 2026-09-17 and end at 130.28 on 2026-10-20: 5.6% below, short of the 15% tier.
  check((await fact('ACWI below 52-week high')).includes('−5.6% high 137.95 · 2026-09-17 · next tier 15%'), `the drawdown gauge, got ${await fact('ACWI below 52-week high')}`);
  check((await fact('Plan')).includes('— start one below') && (await fact('Waiting as cash')).includes('NT$50,000 of NT$50,000'), 'no plan; the money-market fund added above waits');
  check(!text.includes('The windfall goes into the core classes only'), 'the explanation folded away');
  const backtest = await page.locator('#backtest').textContent();
  check(backtest.includes('Every start month from 1900-01 to 2021-09 (1,461 of them)') && backtest.includes('(Demo data)'), `the start months, got ${backtest.slice(0, 400)}`);
  // Of the 1,461 starts the rule beat a lump sum in 38%, by −2.2% at the median: it costs in rising markets and saves after falls.
  const cells = async (label) => (await page.locator('#backtest tbody tr', { hasText: label }).locator('td').allInnerTexts()).slice(1).join(' | ');
  check((await cells('This rule vs lump sum')) === '38% | −2.2% | −11.7% … +9.5% | −25.3% | +34.4%', `the rule against a lump sum, got ${await cells('This rule vs lump sum')}`);
  check((await cells('This rule vs the pace alone')).startsWith('28% | 0.0% |'), `acceleration against the pace alone, got ${await cells('This rule vs the pace alone')}`);
  await snap('windfall');
});

let windfallFlowId;
let depositId;
let trancheProposal;
await step('windfall: the money arrives as a cash flow and a TWD balance; the plan splits it into the tranches CAPE sets', async () => {
  await page.goto(`${BASE}/cash-flows/new`);
  await page.selectOption('select[name=type]', 'windfall');
  await page.fill('input[name=amount]', '1200000');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=flow-added**');
  await page.locator('#cash-flows tbody tr', { hasText: 'Windfall arrives' }).getByRole('link').click();
  await page.waitForURL(/\/cash-flows\/\d+$/);
  windfallFlowId = page.url().split('/').pop();
  // Kept in a TWD time deposit until it is deployed; with the money-market fund, NT$1,200,000 waits.
  await page.goto(`${BASE}/assets/new`);
  await page.fill('input[name=name]', 'Time deposit (demo) 定存（示範）');
  await page.selectOption('select[name=productType]', 'cash_mmf');
  await page.fill('input[name=quantity]', '1150000');
  await page.selectOption('select[name=pool]', 'windfall');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=asset-added');
  await page.locator('tr', { hasText: 'Time deposit (demo)' }).getByRole('link', { name: /Edit/ }).click();
  await page.waitForURL(/\/assets\/\d+$/);
  depositId = page.url().split('/').pop();

  await page.goto(`${BASE}/windfall`);
  const form = page.locator('#plan form').first();
  check((await form.locator('input[name=totalTwd]').inputValue()) === '1200000', 'the amount from the windfall recorded');
  check((await form.locator('input[name=startDate]').inputValue()) === taipeiToday, 'the first tranche on the day it arrived');
  const preview = await form.locator('[role=status]').innerText();
  check(preview.includes(`24 × ≈ NT$50,000 · ${taipeiToday} → ${monthsLater(taipeiToday, 23)} (CAPE 24.0, 74th percentile)`), `the pace as typed, got ${preview}`);
  await form.getByRole('button', { name: /Start the plan/ }).click();
  await page.waitForURL('**/windfall?saved=plan**');
  const text = await body();
  check(text.includes('Plan saved: each tranche is proposed when it falls due.'), 'saved');
  check((await fact('Plan')).includes(`0 / 24 NT$1,200,000 · next ${taipeiToday}`), `the plan in a tile, got ${await fact('Plan')}`);
  const rows = await page.locator('#plan tbody tr').allInnerTexts();
  check(rows.length === 24 && /^1\s+\S+\s+NT\$50,000\s+Scheduled/.test(rows[0]) && rows[23].includes(monthsLater(taipeiToday, 23)), `24 tranches of NT$50,000, got ${rows[0]} … ${rows[23]}`);

  // The dashboard has the tranche in its coming week, and the plan under the windfall's progress.
  await page.goto(`${BASE}/`);
  const home = await body();
  check(home.includes(`Plan 0/24 · on schedule · 1 due now · next ${monthsLater(taipeiToday, 1)}`), `the plan on the dashboard, got ${home}`);
  check(/Coming week[\s\S]*Windfall tranche due/.test(home), 'the tranche in the coming week');
});

await step('windfall: the tranche due drafts its proposal in the windfall pool, core classes only; filled, the tranche is done', async () => {
  await page.goto(`${BASE}/proposals`);
  await page.getByRole('button', { name: /Check the rules now/ }).click();
  await page.waitForURL('**/proposals?saved=checked*');
  check(/Rules checked: 1 new proposals?, 0 closed\./.test(await body()), 'only the tranche: ACWI is 5.6% down, no tier');
  const proposal = page.locator('article.proposal').filter({ hasText: 'Windfall tranche' });
  trancheProposal = (await proposal.getAttribute('id'))?.replace('proposal-', '');
  const text = await proposal.innerText();
  check(text.includes('WINDFALL_TRANCHE_DUE · Windfall tranche'), 'its rule and title');
  check(text.includes(`Tranche due ${taipeiToday}: NT$1,200,000 ÷ 24 tranches = NT$50,000, by the core targets`), `explained, got ${text.replace(/\s+/g, ' ')}`);
  // Strategic cash's 8 of the core's 80 stays in the deposit, which is strategic cash already.
  check(text.includes("Strategic cash's share, NT$5,000, stays in the balance"), 'strategic cash stays');
  const orders = await proposal.locator('tbody tr').allInnerTexts();
  const tickers = orders.map((row) => row.split('\t')[1]?.trim());
  check(/^Take out/.test(orders[0] ?? '') && (orders[0] ?? '').includes('Time deposit (demo)'), `paid from the largest windfall balance, got ${orders[0]}`);
  check(['VT', '0050', 'BNDW', 'GLDM'].every((ticker) => tickers.includes(ticker)) && !tickers.some((ticker) => ['AAPL', '2330', 'VOO', 'NVDA'].includes(ticker)), `the core benchmarks, no satellite, got ${tickers}`);
  await proposal.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL('**/proposals?saved=approved*');
  // The checklist records each trade in the windfall pool, so R1 and R2 never count it.
  await page.locator(`#proposal-${trancheProposal}`).getByRole('link', { name: /Record the trade/ }).first().click();
  await page.waitForURL(/\/holdings\/new\?/);
  check(page.url().includes('pool=windfall') && (await page.inputValue('select[name=pool]')) === 'windfall', 'the trade form in the windfall pool');
  await page.goto(`${BASE}/proposals`);
  await page.locator(`#proposal-${trancheProposal}`).getByRole('button', { name: /Mark filled/ }).click();
  await page.waitForURL('**/proposals?saved=filled*');

  await page.goto(`${BASE}/windfall`);
  await page.locator('.chart-backtest svg').waitFor();
  const first = await page.locator('#plan tbody tr').first().innerText();
  check(first.includes('Done') && first.includes(`#${trancheProposal}`), `the first tranche done, with its proposal, got ${first}`);
  check((await fact('Plan')).includes(`1 / 24 NT$1,200,000 · next ${monthsLater(taipeiToday, 1)}`), `the plan moves on, got ${await fact('Plan')}`);
  await snap('windfall-plan');
  await page.setViewportSize({ width: 1280, height: 1400 });
  await docShot('windfall', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`);
  check((await body()).includes(`Plan 1/24 · on schedule · next ${monthsLater(taipeiToday, 1)}`), 'the dashboard follows');
});

await step('windfall: the demo put back for the steps that follow; the edit history keeps the plan', async () => {
  // The plan, the deposit and the cash flow go: the push and dashboard steps expect one proposal waiting and NT$50,000 in the pool.
  await page.goto(`${BASE}/windfall`);
  await page.locator('#plan details > summary', { hasText: 'Replace or delete the plan' }).click();
  await page.locator('#plan').getByRole('button', { name: /^Delete/ }).click();
  await page.waitForURL('**/windfall?saved=deleted**');
  check((await fact('Plan')).includes('start one below'), 'the plan is gone');
  await page.goto(`${BASE}/assets/${depositId}`);
  await page.getByRole('button', { name: /^Delete/ }).click();
  await page.waitForURL('**/holdings?saved=asset-deleted');
  await page.goto(`${BASE}/cash-flows/${windfallFlowId}`);
  await page.getByRole('button', { name: /^Delete/ }).click();
  await page.waitForURL('**/holdings?saved=flow-deleted**');
  await page.goto(`${BASE}/history`);
  const history = await body();
  check(history.includes('Windfall plan') && history.includes(`NT$1,200,000 from ${taipeiToday}`) && history.includes('Windfall tranche'), 'the plan and its tranches in the edit history');
  await page.goto(`${BASE}/windfall`);
  check((await fact('Waiting as cash')).includes('NT$50,000 of NT$50,000'), 'the pool as it was');
});

/** A Regression panel's figures, in order: β ± SE, the 95% interval, Blume's β, α a year, R², the periods and their dates. */
const figures = (panel) => page.locator(`${panel} table.figures td`).allInnerTexts();

await step('regression: VT against the S&P 500 and TAIEX side by side, β with its interval, Blume and R², the rolling line', async () => {
  await page.goto(`${BASE}/regression`);
  await page.locator('#vs-SPX .chart-scatter svg').waitFor();
  await page.locator('#vs-TAIEX .chart-scatter svg').waitFor();
  await page.locator('#rolling svg').waitFor();
  // Seed: VT's weekly demo closes against the demo S&P 500 (VOO's) and TAIEX (0050's), two years to 23 October 2026.
  const spx = await figures('#vs-SPX');
  check(spx.join(' | ') === '0.93 ± 0.05 | 0.84 … 1.02 | 0.95 | −6.8% | 81% | 105 | 2024-10-25 → 2026-10-23', `VT against the S&P 500, got ${spx.join(' | ')}`);
  const taiex = await figures('#vs-TAIEX');
  check(taiex[0] === '0.69 ± 0.05' && taiex[4] === '61%', `VT against TAIEX, got ${taiex.join(' | ')}`);
  check(/R\s*i\s*− R\s*f\s*= α \+ β \(R\s*m\s*− R\s*f\s*\) \+ ε/.test(await page.locator('.equation').innerText()), `the formula, got ${await page.locator('.equation').innerText()}`);
  await snap('regression');
  await page.setViewportSize({ width: 1280, height: 1350 });
  await docShot('regression', page);
  await page.setViewportSize({ width: 1280, height: 900 });

  // In TWD the dollar's moves come in; monthly returns give 24 periods.
  await page.locator('.segmented', { hasText: 'Currency' }).getByRole('link', { name: /^TWD/ }).click();
  await page.waitForURL(/c=TWD/);
  await page.locator('#vs-SPX .chart-scatter svg').waitFor();
  check((await figures('#vs-SPX'))[0] === '0.90 ± 0.05', `in TWD, got ${(await figures('#vs-SPX'))[0]}`);
  await page.goto(`${BASE}/regression?t=VT&f=monthly&y=2&c=local`);
  await page.locator('#vs-SPX .chart-scatter svg').waitFor();
  check((await figures('#vs-SPX'))[5] === '24', `monthly periods, got ${(await figures('#vs-SPX'))[5]}`);
});

await step('regression: compare up to five against one index, each β with its 95% interval; the settings are logged', async () => {
  await page.goto(`${BASE}/regression?t=VT`);
  const form = page.locator('#compare form');
  for (const ticker of ['0050', 'BNDW', 'GLDM']) await form.getByLabel(ticker, { exact: true }).check();
  await form.locator('select[name=b]').selectOption('SPX');
  await form.getByRole('button', { name: /Compare/ }).click();
  await page.waitForURL(/vs=/);
  await page.locator('#compare .chart-range svg').waitFor();
  const rows = await page.locator('#compare tbody tr').allInnerTexts();
  const betas = Object.fromEntries(rows.map((row) => row.split('\t').map((cell) => cell.trim())).map(([ticker, beta]) => [ticker, beta]));
  check(betas['VT'] === '0.93' && betas['0050'] === '0.85' && betas['BNDW'] === '0.02' && betas['GLDM'] === '0.24', `the four β, got ${JSON.stringify(betas)}`);

  await page.locator('#settings summary').click();
  await page.fill('#settings input[name=rfTWD]', '1.8');
  await page.locator('#settings input[name=checked]').check();
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/regression?saved=settings**');
  await page.locator('#settings summary').click();
  const method = await page.locator('#settings').innerText();
  check(method.includes('Settings saved.') && method.includes(`TWD 1.80% (setting, checked ${taipeiToday})`), `the rate saved and checked, got ${method.slice(0, 600)}`);
  await page.goto(`${BASE}/history`);
  check(/Setting[\s\S]*regression/.test(await body()), 'the settings change in the edit history');
});

/** A stock's row on the Cost of equity page: its cells' text. */
const costRow = async (ticker) => (await page.locator('#stocks tbody tr', { hasText: ticker }).first().locator('td').allInnerTexts()).map((cell) => cell.replace(/\s+/g, ' ').trim());
const pct = (text) => Number(String(text).replace(/[^\d.−-]/g, '').replace('−', '-'));

await step("cost of equity: each market's 10-year yield and Damodaran's ERP, every stock's β and E(R) worked out (F11)", async () => {
  await page.goto(`${BASE}/capm`);
  // Seed: US 10-year 5.00% (2026-10), Taiwan 1.96% (2026-08), ERP 3.70% (2026-10), Taiwan's premium 0.78%.
  check((await fact('R_f US')).includes('5.00%') && (await fact('R_f US')).includes('2026-10'), `US R_f, got ${await fact('R_f US')}`);
  check((await fact('R_f Taiwan')).includes('1.96%') && (await fact('R_f Taiwan')).includes('2026-08'), `Taiwan R_f, got ${await fact('R_f Taiwan')}`);
  check((await fact('ERP')).includes('3.70%') && (await fact('ERP')).includes('Damodaran'), `ERP, got ${await fact('ERP')}`);
  check((await fact('CRP Taiwan')).includes('0.78%'), `Taiwan's premium, got ${await fact('CRP Taiwan')}`);
  check(/E\(R\s*i\s*\) = R\s*f\s*\+ β\s*i\s*\(ERP \+ CRP\)/.test(await page.locator('.equation').innerText()), `the formula, got ${await page.locator('.equation').innerText()}`);
  // The demo stocks have no saved β, so it is worked out from their weekly demo closes; E(R) multiplies out.
  // 2330 is held (the CSV import sold AAPL), and comes first.
  const aapl = await costRow('AAPL');
  const tsmc = await costRow('2330');
  console.log(`  AAPL ${aapl.join(' | ')}\n  2330 ${tsmc.join(' | ')}`);
  check(aapl.join(' | ').startsWith('AAPL Apple Inc. | US 美國 | 1.20 vs SPX · live') && aapl.slice(3).join(' | ') === '5.00% | 3.70% | 9.43%', `AAPL against the S&P 500, live, not held; got ${aapl.join(' | ')}`);
  check(tsmc[0]?.includes('held') && tsmc[2]?.startsWith('0.85 vs TAIEX') && tsmc.slice(3).join(' | ') === '1.96% | 4.48% | 5.75%', `2330 against TAIEX, ERP + CRP 4.48%; got ${tsmc.join(' | ')}`);
  check((await page.locator('#stocks tbody tr').first().innerText()).includes('2330'), 'the held stock first');
  // The worked-out lines carry β to three decimals, so each multiplies out at the precision shown
  // (within the rounding of β and of the result: 0.0005 × the premium + 0.005 points).
  await page.getByText('Each figure worked out').click();
  const lines = await page.locator('#stocks .formula li').allInnerTexts();
  const aaplLine = lines.find((line) => line.startsWith('AAPL:')) ?? '';
  const tsmcLine = lines.find((line) => line.startsWith('2330:')) ?? '';
  const [, b1, r1] = /^AAPL: 5\.00% \+ (\d\.\d{3}) × 3\.70% = (\d+\.\d\d)%$/.exec(aaplLine) ?? [];
  const [, b2, r2] = /^2330: 1\.96% \+ (\d\.\d{3}) × \(3\.70% \+ 0\.78%\) = (\d+\.\d\d)%$/.exec(tsmcLine) ?? [];
  check(b1 && Math.abs(5 + Number(b1) * 3.7 - Number(r1)) < 0.0075 && r1 === '9.43', `AAPL worked out, got ${aaplLine}`);
  check(b2 && Math.abs(1.96 + Number(b2) * 4.48 - Number(r2)) < 0.0075 && r2 === '5.75', `2330 worked out, got ${tsmcLine}`);
  await snap('capm');
  await docShot('capm', page);

  // A typed ERP replaces Damodaran's, and the change is logged; then back to Damodaran's.
  await page.locator('#settings summary').click();
  await page.locator('#settings select[name=erpSource]').selectOption('manual');
  await page.fill('#settings input[name=erpManual]', '5');
  await page.locator('#settings input[name=checked]').check();
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/capm?saved=settings**');
  check((await fact('ERP')).includes('5.00%') && (await fact('ERP')).includes('typed'), `the typed ERP, got ${await fact('ERP')}`);
  // AAPL at 5.00% + β × 5.00%, with β as worked out above.
  const typed = await costRow('AAPL');
  check(Math.abs(5 + Number(b1) * 5 - pct(typed[5])) < 0.0075, `AAPL at the typed ERP, got ${typed[5]}`);
  check((await page.locator('#settings').innerText()).includes(`last ${taipeiToday}`), 'checked today');
  // From the plain page, so the save's redirect is a navigation to wait for.
  await page.goto(`${BASE}/capm`);
  await page.locator('#settings summary').click();
  await page.locator('#settings select[name=erpSource]').selectOption('damodaran');
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/capm?saved=settings**');
  check((await fact('ERP')).includes('3.70%'), `Damodaran's ERP again, got ${await fact('ERP')}`);
  await page.goto(`${BASE}/history`);
  check(/Setting[\s\S]*capm/.test(await body()), 'the settings change in the edit history');
});

await step('valuation: the watchlist, a workbench valued by DCF, the dividend model and multiples from the demo filings; saved, the alerts read it (F12)', async () => {
  await page.goto(`${BASE}/valuation`);
  await page.getByRole('heading', { level: 1, name: /^Valuation/ }).waitFor();
  const list = await page.locator('main table').first().innerText();
  // AAPL is watched (the seed) and 2330 held; neither has a saved value yet.
  check(/AAPL[\s\S]*not saved/.test(list) && /2330[\s\S]*held/.test(list), `the watched and the held stock, got ${list}`);
  await page.getByRole('link', { name: 'AAPL', exact: true }).click();
  await page.waitForURL('**/valuation?t=AAPL');
  await page.locator('.chart-ranges svg').waitFor();
  // Demo filings to 2026-06-30, filed 33 days later; F11's live β gives the cost of equity.
  check((await fact('Newest quarter')).includes('2026-06-30') && (await fact('Newest quarter')).includes('filed 2026-08-02'), `the newest quarter, got ${await fact('Newest quarter')}`);
  check((await fact('Cost of equity')).includes('9.43%'), `R_e from F11, got ${await fact('Cost of equity')}`);
  const models = await page.locator('main table').first().innerText();
  check(/DCF \(FCFF\)[^\n]*alerts[\s\S]*USD[\s\S]*Gordon DDM[\s\S]*USD[\s\S]*Multiples[\s\S]*USD/.test(models), `all three models valued, got ${models}`);
  const dcf = page.locator('section', { has: page.getByRole('heading', { name: /^DCF \(FCFF\)/ }) });
  check(/Year \(base\)[\s\S]*Terminal value/.test(await dcf.innerText()), 'the DCF table with its terminal value');
  await dcf.getByText('Each figure worked out').click();
  const worked = await dcf.locator('.formula').innerText();
  check(/^FCFF = [\d,]+ M USD × \(1 − 15\.00%\) \+ [\d,]+ M USD − [\d,]+ M USD [−+] [\d,]+ M USD = /m.test(worked) && /^WACC = /m.test(worked), `FCFF and WACC worked out, got ${worked}`);
  check((await body()).includes('估值') && (await body()).includes('安全邊際'), 'Chinese labels');
  check((await fact('Alerts: saved value')).includes('save the assumptions'), 'no saved value yet');
  await snap('valuation');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 1280, height: 1400 });
  await docShot('valuation', page);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Scenarios out of order are refused as typed; saved, the valuation is saved with them and logged.
  await page.fill('#assumptions input[name=growth_base]', '12');
  await page.getByText('Bear ≤ base ≤ bull.').waitFor();
  await page.fill('#assumptions input[name=growth_base]', '6');
  await page.fill('#assumptions input[name=trim]', '1.3');
  await page.locator('#assumptions form.form button[type=submit]').click();
  await page.waitForURL('**/valuation?t=AAPL&saved=assumptions**');
  check((await body()).includes('Assumptions saved'), 'saved');
  const alerts = await fact('Alerts: saved value');
  check(/[\d,]+\.\d\d USD/.test(alerts) && alerts.includes(taipeiToday), `the saved value of today, got ${alerts}`);
  await page.getByText(/^Saved values \(\d\)/).click();
  check(/your edit/.test(await body()), 'saved by the edit');
  await page.goto(`${BASE}/history`);
  check(/Watchlist[\s\S]*AAPL/.test(await body()), 'the watchlist edit in the edit history');

  // The rules read the saved value now; the dashboard's watchlist shows how far the price is from each zone.
  await page.goto(`${BASE}/rules`);
  check(!(await page.locator('#rule-BUY_ZONE').innerText()).includes('Waiting for a saved valuation'), 'BUY_ZONE reads the saved value');
  await page.goto(`${BASE}/`);
  const watch = await page.locator('#dashboard-watchlist').innerText();
  check(/AAPL [\d,.]+ USD vs [\d,.]+ USD \([+−][\d.]+%\): /.test(watch), `the dashboard watchlist line, got ${watch}`);

  // The defaults are a logged setting too.
  await page.goto(`${BASE}/valuation`);
  await page.locator('#settings summary').click();
  await page.locator('#settings input[name=checked]').check();
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/valuation?saved=settings**');
  check((await page.locator('#settings').innerText()).includes(`last ${taipeiToday}`), 'the defaults checked today');
});

// A stand-in push service on local HTTPS (run.sh made its certificate, which the app and the push
// job trust): it keeps what it receives, and says a device ending in /gone has unsubscribed.
const pushes = [];
const pushService = createServer({ key: readFileSync(PUSH_KEY), cert: readFileSync(PUSH_CERT) }, (req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    pushes.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(req.url.endsWith('/gone') ? 410 : 201);
    res.end();
  });
});
await new Promise((resolve) => pushService.listen(Number(PUSH_PORT), '127.0.0.1', resolve));

/** A stand-in device: its keys, as a browser makes them when it subscribes. */
function pushDevice() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { ecdh, auth: randomBytes(16) };
}
const phone = pushDevice();
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
/** Decrypts an aes128gcm push (RFC 8188, RFC 8291) as the device would. */
function readPush(body, device) {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const serverKey = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const ikm = hmac(hmac(device.auth, device.ecdh.computeSecret(serverKey)), Buffer.concat([Buffer.from('WebPush: info\0'), device.ecdh.getPublicKey(), serverKey, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const decipher = createDecipheriv('aes-128-gcm', hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16), hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12));
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  return JSON.parse(padded.subarray(0, padded.lastIndexOf(2)).toString('utf8'));
}
const phonePushes = () => pushes.filter((push) => push.path === '/push/phone').map((push) => readPush(push.body, phone));

/** Taipei time now plus `minutes`, as the schedule form's day and HH:MM. */
function taipeiClock(minutes) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(Date.now() + minutes * 60_000))
      .map((part) => [part.type, part.value]),
  );
  return { day: parts.weekday.toLowerCase(), time: `${parts.hour}:${parts.minute}` };
}

const notify = () =>
  promisify(execFile)(`${REPO}/node_modules/.bin/tsx`, ['scripts/notify.ts'], {
    cwd: REPO,
    timeout: 5 * 60_000,
    env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`, SUPABASE_SECRET_KEY: SECRET_KEY },
  });

await step('notifications: a test push reaches a device encrypted to its keys and signed with the app key; a device that left is removed', async () => {
  await page.goto(`${BASE}/notifications`);
  await page.getByRole('heading', { level: 1, name: /Notifications/ }).waitFor();
  await page.locator('#push-status').filter({ hasNotText: 'Checking' }).waitFor();
  const status = await page.locator('#push-status').innerText();
  check(status.includes('Notifications are off on this device') && status.includes('這台裝置尚未開啟推播'), `this browser can turn push on, got ${status}`);
  check((await body()).includes('No device has notifications on yet'), 'no devices yet');
  // Two devices as a browser would save them: this one, and one whose push service now says it is gone.
  const save = async (name, device) => {
    const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/rest/v1/push_subscriptions`, {
      method: 'POST',
      headers: { apikey: SECRET_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: `https://127.0.0.1:${PUSH_PORT}/push/${name}`, keys: { p256dh: device.ecdh.getPublicKey().toString('base64url'), auth: device.auth.toString('base64url') }, device_name: name }),
    });
    check(res.ok, `device ${name}: HTTP ${res.status}`);
  };
  await save('phone', phone);
  await save('gone', pushDevice());
  await page.reload();
  await page.getByRole('button', { name: /Send a test to every device/ }).click();
  await page.getByText('Sent to 1 device').waitFor();
  check(pushes.length === 2, `the push service got ${pushes.length} pushes`);
  const [test] = phonePushes();
  check(test?.title === 'Test 測試推播' && test.url === '/notifications', `the device reads the test, got ${JSON.stringify(test)}`);
  const headers = pushes.find((push) => push.path === '/push/phone')?.headers ?? {};
  check(headers['content-encoding'] === 'aes128gcm' && String(headers.authorization).endsWith(`k=${VAPID_PUBLIC_KEY}`) && headers.ttl === '86400', 'encrypted, signed with the VAPID key, kept a day');
  // The page refreshes after a test: the device that left is gone, and the test is in the log.
  await page.getByText('1 device(s) gone, removed').waitFor();
  check((await page.getByRole('button', { name: /^Remove/ }).count()) === 1 && (await body()).includes('phone since'), 'only this device left');
  check((await page.locator('section', { hasText: 'Recent pushes' }).innerText()).includes('Test 測試推播'), 'the test in the log');
  await snap('notifications');
});

await step('push job: plans the weekly review and the open proposal, sends each once, and holds pushes in the quiet hours', async () => {
  await page.goto(`${BASE}/notifications`);
  // The review an hour ago today, and quiet hours that start later: both pushes go out now.
  const review = taipeiClock(-60);
  const quietStart = taipeiClock(120).time;
  const quietEnd = taipeiClock(180).time;
  await page.fill('input[name=quietStart]', quietStart);
  await page.fill('input[name=quietEnd]', quietEnd);
  await page.selectOption('select[name=weeklyDay]', review.day);
  await page.fill('input[name=weeklyTime]', review.time);
  await page.locator('section', { hasText: 'When pushes may arrive' }).locator('button[type=submit]').click();
  await page.waitForURL('**/notifications?saved=schedule');
  const before = phonePushes().length;
  const { stdout } = await notify();
  check(/::notice::Web Push: 2 planned, 2 sent \(2 deliveries\)/.test(stdout), `two pushes, got ${stdout}`);
  check(!/MONTHLY|Weekly review|NT\$/.test(stdout), 'the public log has counts only');
  const received = phonePushes().slice(before);
  const weekly = received.find((push) => push.title === 'Weekly review 每週檢視');
  const monthly = received.find((push) => push.title.startsWith('MONTHLY_CONTRIBUTION · Monthly contribution 每月投入'));
  check(weekly && weekly.body.split('\n').length === 3 && weekly.body.startsWith('Rules: 1 proposal waiting.') && weekly.url === '/', `the weekly review's three lines, got ${JSON.stringify(weekly)}`);
  check(monthly && /^Invest the NT\$10,000 debited on \d{4}-\d{2}-\d{2}/.test(monthly.body) && /^\/proposals#proposal-\d+$/.test(monthly.url), `the proposal names its action, got ${JSON.stringify(monthly)}`);
  const again = await notify();
  check(/Web Push: 0 planned, 0 sent/.test(again.stdout) && phonePushes().length === before + 2, 'nothing twice');
  await page.reload();
  const log = await page.locator('section', { hasText: 'Recent pushes' }).innerText();
  check(log.includes('Weekly review') && log.includes('Monthly contribution') && log.includes('to 1 device'), `the log, got ${log}`);
  await page.setViewportSize({ width: 1280, height: 1300 });
  await docShot('notifications', page);
  await page.setViewportSize({ width: 1280, height: 900 });
});

await step('dashboard: the three lines, then proposals, drift, VaR, donut, windfall, watchlist, coming week and actual vs plan, in that order', async () => {
  await page.goto(`${BASE}/`);
  await page.locator('.chart-donut svg').waitFor();
  const text = await body();
  check(text.includes('Rules: 1 proposal waiting.') && text.includes('規則：1 份提案待處理。'), 'the rules line, bilingual');
  check(/Allocation: largest drift [^\n]+ [+−][\d.]+ pp\./.test(text), 'the largest drift');
  check(text.includes('Value: no NAV snapshot yet.'), 'no snapshot before the nightly job');
  const headings = await page.locator('main h2').allInnerTexts();
  const order = ['Open proposals (1)', 'Drift from the targets', 'Value at Risk', 'Allocation, regular pool', 'Windfall progress', 'Watchlist', 'Coming week', 'Actual vs plan'];
  const at = order.map((heading) => headings.findIndex((text) => text.startsWith(heading)));
  check(at.every((index, i) => index >= 0 && (i === 0 || index > (at[i - 1] ?? -1))), `the PRD order, got ${headings.join(' | ')}`);
  check(/Deployed [^\n]*NT\$[\d,]+ [\d.]+%/.test(await fact('Deployed')) && /NT\$[\d,]+/.test(await fact('Waiting as cash')), `windfall deployed and waiting, got ${await fact('Deployed')} / ${await fact('Waiting as cash')}`);
  check(text.includes('No tranche plan yet.'), 'no windfall plan, since the demo was put back');
  check(text.includes('Weekly review push'), 'the coming week lists the review');
  check((await page.locator('#dashboard-proposals').innerText()).includes('Monthly contribution'), 'the open proposal first, with approve and dismiss');
  await snap('dashboard');
  await page.setViewportSize({ width: 1280, height: 1500 });
  await docShot('dashboard', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Approving from the dashboard opens the checklist.
  await page.locator('#dashboard-proposals').getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL('**/proposals?saved=approved*');
  check((await body()).includes('Execution checklist'), 'approved from the dashboard');
  await page.goto(`${BASE}/`);
  check((await body()).includes('Rules: 1 proposal waiting (1 approved, to trade).'), 'the approved one still waits on trades');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await page.locator('.chart-donut svg').waitFor();
  await snap('dashboard-dark');
  await page.emulateMedia({ colorScheme: 'light' });
});

await step('red flags: every indicator by company, coverage, an entry that scans again and a review prompt, the settings logged (N3)', async () => {
  await page.goto(`${BASE}/red-flags`);
  await page.getByRole('heading', { level: 1, name: /^Red flags/ }).waitFor();
  await page.locator('main .chart svg').waitFor();
  const table = page.locator('main table').first();
  const aapl = (await table.locator('tr', { hasText: 'AAPL' }).innerText()).replace(/\s+/g, ' ');
  const tsmc = (await table.locator('tr', { hasText: '2330' }).innerText()).replace(/\s+/g, ' ');
  // AAPL: its invented auditor change makes it amber now; governance does not apply, no feed covers its penalties.
  check(/Amber[\s\S]*88%[\s\S]*7 \/ 8[\s\S]*Auditor change[\s\S]*Green since 2026-10-11/.test(aapl), `AAPL amber, 7 of 8 covered, got ${aapl}`);
  // 2330: every indicator covered, its governance tier from the seed's entry.
  check(/Green[\s\S]*100%[\s\S]*9 \/ 9/.test(tsmc), `2330 green and fully covered, got ${tsmc}`);
  check((await body()).includes('紅旗指標') && (await body()).includes('覆蓋率'), 'Chinese labels');
  await snap('red-flags');
  await docShot('red-flags', page);

  // A company: each indicator with what it read; Beneish and Altman worked out from the demo filings.
  await page.getByRole('link', { name: 'AAPL', exact: true }).click();
  await page.waitForURL('**/red-flags?t=AAPL');
  check((await fact('Industry')).includes('Electronic Computers') && (await fact('Industry')).includes('Altman Z'), `a manufacturer, got ${await fact('Industry')}`);
  const rows = await page.locator('main table').first().innerText();
  check(/Beneish M-Score[\s\S]*Green[\s\S]*−?\d\.\d\d[\s\S]*Twelve months to 2026-06-30 against 2025-06-30/.test(rows), `Beneish from the demo filings, got ${rows}`);
  check(/Auditor change[\s\S]*Amber[\s\S]*2026-10-20 · 8-K Item 4\.01/.test(rows), 'the invented 8-K listed');
  check(/Governance rating[\s\S]*Does not apply/.test(rows) && /Environmental penalties[\s\S]*No data/.test(rows), 'governance n/a, penalties uncovered');
  await page.getByText('Beneish M, worked out').click();
  check(/M = -4\.84 \+ 0\.92 × DSRI [\d.]+ \+ /.test(await page.locator('.formula').first().innerText()), 'the M formula with its figures');
  await snap('red-flags-aapl');

  // An entry for 2330, still held (the CSV import sold AAPL): a penalty found. The company is
  // scanned again, so the rules read it now: amber after green scans prompts a review.
  await page.goto(`${BASE}/red-flags?t=2330`);
  await page.locator('#entries select[name=indicator]').selectOption('environmental_penalties');
  await page.fill('#entries input[name=value]', '1');
  await page.fill('#entries input[name=note]', 'demo: one penalty');
  await page.locator('#entries button[type=submit]', { hasText: 'Add entry' }).click();
  await page.waitForURL('**/red-flags?t=2330&saved=entry**');
  check((await fact('Light')).includes('Amber') && (await fact('Last scan')).includes(taipeiToday), `amber and scanned today, got ${await fact('Light')} / ${await fact('Last scan')}`);
  check((await page.locator('#entries').innerText()).includes('demo: one penalty'), 'the entry listed');
  await page.goto(`${BASE}/proposals`);
  await page.getByRole('button', { name: /Check the rules now/ }).click();
  await page.waitForURL('**/proposals?saved=checked*');
  const review = (await page.locator('article.proposal', { hasText: 'Red flag worsens' }).innerText()).replace(/\s+/g, ' ');
  check(review.includes(`2330: green → amber since ${taipeiToday} · Environmental penalties`) && review.includes('No orders drafted'), `the review prompt, got ${review}`);
  await page.locator('article.proposal', { hasText: 'Red flag worsens' }).getByRole('button', { name: /^Dismiss/ }).click();
  await page.waitForURL('**/proposals?saved=dismissed*');

  // The entry deleted: the edit history keeps it, and 2330 is green again.
  await page.goto(`${BASE}/red-flags?t=2330`);
  await page.locator('#entries button', { hasText: 'Delete' }).first().click();
  await page.waitForURL('**/red-flags?t=2330&saved=deleted**');
  check((await fact('Light')).includes('Green'), `green again, got ${await fact('Light')}`);
  await page.goto(`${BASE}/history`);
  check(/Red flag entry[\s\S]*2330 Environmental penalties/.test(await body()), 'the deleted entry in the edit history');

  // An excluded industry turns 2330 red at once; the setting is logged, then put back.
  await page.goto(`${BASE}/red-flags`);
  await page.fill('#settings textarea[name=industries]', '半導體');
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/red-flags?saved=settings**');
  check(/Red[\s\S]*Excluded business/.test(await page.locator('main table').first().locator('tr', { hasText: '2330' }).innerText()), '2330 red on the exclusion list');
  // From a fresh address, so the redirect after saving is a new one to wait for.
  await page.goto(`${BASE}/red-flags`);
  await page.fill('#settings textarea[name=industries]', '');
  await page.locator('#settings input[name=checked]').check();
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/red-flags?saved=settings**');
  check((await page.locator('#settings').innerText()).includes(`last ${taipeiToday}`), 'checked today');

  // Beside F12's watchlist: the light on the Valuation page and the dashboard.
  await page.goto(`${BASE}/valuation`);
  check(/AAPL[\s\S]*Amber/.test(await page.locator('main table').first().innerText()), 'the light on the watchlist');
  await page.goto(`${BASE}/`);
  check(/AAPL [^\n]*Amber, 88% covered/.test(await page.locator('#dashboard-watchlist').innerText()), 'the light on the dashboard');
});

await step('look-through: every fund opened up, TSMC through VT, 00692 and held directly, countries, sectors, the funds and their overlap (F14)', async () => {
  await page.goto(`${BASE}/look-through`);
  await page.getByRole('heading', { level: 1, name: /^Look-through/ }).waitFor();
  await page.locator('.chart-treemap svg').waitFor();
  const tsmc = (await page.locator('#companies tr', { hasText: 'Taiwan Semiconductor' }).innerText()).replace(/\s+/g, ' ');
  // The seed's invented files: 52.5% of 00692 and 1.6% of VT are TSMC; 2330 is also held directly.
  check(/Taiwan · Information Technology/.test(tsmc) && ['00692 NT$', 'direct NT$', 'VT NT$'].every((route) => tsmc.includes(route)), `TSMC by route, got ${tsmc}`);
  check((await fact('Looked through')).match(/\d+\.\d%/) !== null, `the share looked through, got ${await fact('Looked through')}`);
  check(/00692 × VT\s+1\.6%/.test(await page.locator('#overlaps').innerText()), 'the overlap of 00692 and VT');
  const countries = await page.locator('#countries').innerText();
  check(countries.includes('Taiwan') && countries.includes('台灣') && countries.includes('Funds not looked through'), `countries, got ${countries}`);
  check((await page.locator('#sectors').innerText()).includes('Information Technology'), 'sectors');
  const funds = await page.locator('#funds').innerText();
  check(/VT[\s\S]*2026-09-30 · Demo data · 8 lines[\s\S]*30% withholding/.test(funds) && /BNDW[\s\S]*None: counted whole/.test(funds), `the funds, got ${funds}`);
  check((await body()).includes('合併透視') && (await body()).includes('公司曝險'), 'Chinese labels');
  await snap('look-through');
  await page.setViewportSize({ width: 1280, height: 1300 });
  await docShot('look-through', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // The map from TWSE industries to GICS sectors is a logged setting.
  await page.locator('#settings input[name=checked]').check();
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/look-through?saved=settings**');
  check((await page.locator('#settings').innerText()).includes(`last ${taipeiToday}`), 'the map checked today');
});

await step('sectors: the heatmap of returns by period, one market at a time, the treemap of exposure with a sector\'s companies, the bubbles, the settings logged (N7)', async () => {
  await page.goto(`${BASE}/sectors`);
  await page.getByRole('heading', { level: 1, name: /^Sectors/ }).waitFor();
  await page.locator('.chart-heatmap svg').waitFor();
  check((await body()).includes('Closes to 2026-10-23'), 'the seed\'s newest weekly close');
  const returns = await page.locator('#sector-returns').innerText();
  check(/Information Technology 資訊科技 US · XLK(\s+[+−]\d+\.\d%){5}/.test(returns) && /Information Technology 資訊科技 TW · ELECTRONIC/.test(returns), `both markets' tech rows, every period, got ${returns}`);
  const materials = /Materials 原物料 TW · ([A-Z, ]+)/.exec(returns)?.[1].split(', ') ?? [];
  check(['CEMENT', 'PLASTICS', 'CHEMICAL'].every((id) => materials.includes(id)), `a sector of several Taiwan indices, got ${materials}`);
  await snap('sectors-heatmap');
  await page.setViewportSize({ width: 1280, height: 1300 });
  await docShot('sectors', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('group', { name: /Market/ }).getByRole('link', { name: /Taiwan/ }).click();
  await page.waitForURL('**/sectors?*market=TW*');
  check(!(await page.locator('#sector-returns').innerText()).includes(' US · '), 'Taiwan alone');

  // The treemap: exposure from the look-through, coloured by the chosen period; a sector lists its companies.
  await page.getByRole('group', { name: /Chart/ }).getByRole('link', { name: /Treemap/ }).click();
  await page.waitForURL('**/sectors?view=treemap*');
  await page.locator('.chart-treemap svg').waitFor();
  const exposure = await page.locator('#sector-exposure').innerText();
  check(/Information Technology 資訊科技\s+NT\$[\d,]+\s+[\d.]+%/.test(exposure), `tech exposure, got ${exposure}`);
  await page.locator('#sector-exposure').getByRole('link', { name: /Information Technology/ }).click();
  await page.waitForURL('**/sectors?*sector=Information*');
  check(/NT\$[\d,]+/.test(await page.locator('#sector-companies').innerText()), 'the companies behind the sector');
  await snap('sectors-treemap');

  // The bubbles: 1-year return against volatility, with the portfolio's point.
  await page.getByRole('group', { name: /Chart/ }).getByRole('link', { name: /Bubbles/ }).click();
  await page.waitForURL('**/sectors?view=bubble*');
  await page.locator('.chart-bubbles svg').waitFor();
  check(/Portfolio, by exposure[^\n]*\s+[+−]\d+\.\d%\s+\d+\.\d%/.test(await page.locator('#sector-risk').innerText()), 'the portfolio\'s point');
  await snap('sectors-bubbles');
  check((await body()).includes('產業熱圖') && (await body()).includes('波動度'), 'Chinese labels');

  // The colour convention and the index map are a logged setting.
  await page.goto(`${BASE}/sectors`);
  await page.locator('#settings select[name=colour]').selectOption('green_up');
  await page.locator('#settings input[name=checked]').check();
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/sectors?saved=settings**');
  check((await page.locator('#settings').innerText()).includes(`last ${taipeiToday}`) && (await page.locator('#settings select[name=colour]').inputValue()) === 'green_up', 'saved and checked today');
  await page.goto(`${BASE}/history`);
  check(/Setting[\s\S]*sectors/.test(await body()), 'the setting in the edit history');
});

await step('monte carlo: the fan around the saved plan, the median and the range, the chance of a goal, today\'s money or nominal, the goal and an expected windfall as logged settings (F5)', async () => {
  await page.goto(`${BASE}/monte-carlo`);
  await page.getByRole('heading', { level: 1, name: /^Monte Carlo/ }).waitFor();
  await page.locator('.chart-figure svg').first().waitFor();
  const text = await body();
  check(/Median in year \d+/.test(text) && /Of 10,000 paths/.test(text), `the median and the paths, got ${text.slice(0, 400)}`);
  check(/months drawn from 20\d\d-\d\d to 20\d\d-\d\d \(\d+ months\), 3 at a time/.test(text), 'the history the months are drawn from');
  await page.getByText('The marks, as a table').click();
  check(await page.locator('details table').first().isVisible(), 'the marks table');
  await snap('monte-carlo');
  await page.setViewportSize({ width: 1280, height: 1500 });
  await docShot('monte-carlo', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Nominal values are larger than today's money (inflation over the plan's years).
  const real = Number((/Median in year \d+[^N]*NT\$([\d,]+)/.exec(text) ?? [])[1]?.replace(/,/g, ''));
  await page.getByRole('group', { name: /Values/ }).getByRole('link', { name: /Nominal/ }).click();
  await page.waitForURL('**/monte-carlo?basis=nominal');
  const nominal = Number((/Median in year \d+[^N]*NT\$([\d,]+)/.exec(await body()) ?? [])[1]?.replace(/,/g, ''));
  check(real > 0 && nominal > real, `nominal ${nominal} above today's money ${real}`);

  // A goal gives the chance of reaching it; a blank one takes it away.
  await page.goto(`${BASE}/monte-carlo`);
  await page.locator('#settings input[name=target]').fill('1');
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/monte-carlo?saved=settings**');
  check(/Chance of reaching the goal[^%]*100\.0%/.test(await body()), 'every path reaches NT$1');
  check(await page.locator('#settings input[name=target]').inputValue() === '1', 'the goal kept');
  await page.locator('#settings input[name=windfallAmount]').fill('1200000');
  await page.locator('#settings button[type=submit]').click();
  await page.locator('#settings [role=alert]').first().waitFor();
  check((await page.locator('#settings').innerText()).includes('YYYY-MM'), 'the month asked for with an amount');
  check((await body()).includes('蒙地卡羅') && (await body()).includes('達成目標的機率'), 'Chinese labels');
  await page.goto(`${BASE}/history`);
  check(/Setting[\s\S]*monte_carlo/.test(await body()), 'the setting in the edit history');
});

await step('timeline: the plan, the Monte Carlo band and the actuals on one chart, the phases and a later goal with its chance, the goals logged (F1)', async () => {
  await page.goto(`${BASE}/timeline`);
  await page.getByRole('heading', { level: 1, name: /^Life timeline/ }).waitFor();
  await page.locator('.chart-figure svg').first().waitFor();
  const text = await body();
  check(/Actual now[^]*Plan this month \(F2\)/.test(text), `the actual and the plan, got ${text.slice(0, 500)}`);
  check(/Accumulation 累積期/.test(text), 'the accumulation phase');
  await snap('timeline');
  await page.setViewportSize({ width: 1280, height: 1300 });
  await docShot('timeline', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // A goal with an amount gets the plan's value and the chance of reaching it that month.
  await page.locator('#goals textarea[name=goals]').fill('2046-05 | 3000000 | House 購屋頭期款\n2040-01 |  | Milestone 里程碑');
  await page.locator('#goals button[type=submit]').click();
  await page.waitForURL('**/timeline?saved=goals**');
  const goals = await page.locator('section', { has: page.getByRole('heading', { name: /Goals against the plan/ }) }).first().innerText();
  check(/2040-01\s+Milestone/.test(goals) && /2046-05\s+House[^]*NT\$3,000,000/.test(goals), `both goals in date order, got ${goals}`);
  check(/\d+%/.test((await page.locator('table').filter({ hasText: 'Chance' }).first().innerText())), 'the chance of the goal');
  // A line that is not a goal is refused with the format shown.
  await page.locator('#goals textarea[name=goals]').fill('soon | x');
  await page.locator('#goals button[type=submit]').click();
  await page.locator('#goals [role=alert]').first().waitFor();
  check((await page.locator('#goals').innerText()).includes('YYYY') || (await page.locator('#goals').innerText()).includes('month'), 'the format asked for');
  check((await body()).includes('人生時間軸') && (await body()).includes('目標與計畫對照'), 'Chinese labels');
  await page.goto(`${BASE}/history`);
  check(/Setting[\s\S]*timeline/.test(await body()), 'the setting in the edit history');
});

await step('stress test: three historical scenarios on today\'s holdings with the deepest fall in % and NT$, months to recover and the F3 tiers; a shock of your own (F10)', async () => {
  await page.goto(`${BASE}/stress`);
  await page.getByRole('heading', { level: 1, name: /^Stress test/ }).waitFor();
  await page.locator('.chart-figure svg').first().waitFor();
  const summary = await page.locator('table').first().innerText();
  check(/2008 global financial crisis[^\n]*[−-]\d+\.\d%/.test(summary) && /2020 COVID crash/.test(summary) && /2022 rate shock/.test(summary), `three scenarios with their falls, got ${summary}`);
  const gfc = /2008 global financial crisis[^\n]*/.exec(summary)?.[0] ?? '';
  const fall = Number((/[−-](\d+\.\d)%/.exec(gfc) ?? [])[1]);
  check(fall > 5 && fall < 60, `2008's fall is plausible for a core-satellite mix, got ${gfc}`);
  check(/15%/.test(gfc), `the 2008 gauge fall fires F3's 15% tier, got ${gfc}`);
  await snap('stress');
  await page.setViewportSize({ width: 1280, height: 1500 });
  await docShot('stress', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('group', { name: /Scenario/ }).getByRole('link', { name: /2022 rate shock/ }).click();
  await page.waitForURL('**/stress?s=rates_2022');
  await page.locator('#stress-detail .chart-figure svg').waitFor();
  check((await page.locator('#stress-detail').innerText()).includes('F3 tier'), 'the tiers table');
  // A shock of your own: all stocks fall 30%, then the expected returns bring the portfolio back.
  await page.getByRole('group', { name: /Scenario/ }).getByRole('link', { name: /Your own/ }).click();
  await page.waitForURL('**/stress?s=custom');
  await page.locator('#custom input[name=shock_us_global_equity]').fill('-60');
  await page.locator('#custom button[type=submit]').click();
  await page.waitForURL('**/stress?s=custom&shock_*');
  check(/Your own shock[^\n]*[−-]\d+\.\d%/.test(await page.locator('table').first().innerText()), 'the custom row');
  check((await body()).includes('壓力測試') && (await body()).includes('最大回撤'), 'Chinese labels');
});

await step('efficient frontier: the curve, the capital market line and the tangent portfolio, the current and target mixes, weights along the curve, correlations; the rate and bounds logged (F7)', async () => {
  await page.goto(`${BASE}/frontier`);
  await page.getByRole('heading', { level: 1, name: /^Efficient frontier/ }).waitFor();
  await page.locator('.chart-figure svg').first().waitFor();
  const text = await body();
  check(/Tangent \(best Sharpe\)/.test(text) && /Minimum variance/.test(text) && /Current mix/.test(text) && /Target mix/.test(text), `the four portfolios, got ${text.slice(0, 600)}`);
  const weights = await page.locator('#frontier-weights table').first().innerText();
  check(/US \/ global equity/.test(weights) && /\d+\.\d%/.test(weights), `the weights by class, got ${weights}`);
  await page.locator('#frontier-correlation svg').waitFor();
  check((await page.locator('#frontier-correlation').innerText()).includes('1.00'), 'the correlation of a class with itself');
  await snap('frontier');
  await page.setViewportSize({ width: 1280, height: 1900 });
  await docShot('frontier', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Bounds that cannot sum to 100% are refused; a valid change is saved, checked and logged.
  await page.locator('#settings textarea[name=bounds]').fill('us_global_equity = 0 - 30\ntw_market_cap = 0 - 30');
  await page.locator('#settings button[type=submit]').click();
  await page.locator('#settings [role=alert]').first().waitFor();
  await page.goto(`${BASE}/frontier`);
  await page.locator('#settings input[name=riskFree]').fill('2');
  await page.locator('#settings input[name=checked]').check();
  await page.locator('#settings button[type=submit]').click();
  await page.waitForURL('**/frontier?saved=settings**');
  check((await page.locator('#settings').innerText()).includes(`last ${taipeiToday}`) && (await page.locator('#settings input[name=riskFree]').inputValue()) === '2', 'saved and checked today');
  check((await body()).includes('效率前緣') && (await body()).includes('切線組合'), 'Chinese labels');
  await page.goto(`${BASE}/history`);
  check(/Setting[\s\S]*frontier/.test(await body()), 'the setting in the edit history');
});

await step('attribution: the portfolio against the SAA benchmark by asset class, the effects adding up, the waterfall, the quadrant and the months; level 2 by sector (N2)', async () => {
  await page.goto(`${BASE}/attribution`);
  await page.getByRole('heading', { level: 1, name: /^Attribution/ }).waitFor();
  await page.locator('.chart-figure svg').first().waitFor();
  const text = await body();
  check(/Portfolio return[^]*Benchmark return[^]*(Ahead of|Behind) the benchmark/.test(text), `the return, the benchmark and the gap, got ${text.slice(0, 600)}`);
  const table = await page.locator('table').first().innerText();
  check(/Allocation 配置效果/.test(table) && /US \/ global equity/.test(table) && /All 全部/.test(table), `the effects by class, got ${table}`);
  // The four effects of the last row add up to the gap shown above.
  const row = (/All 全部\s+([^\n]*)/.exec(table) ?? [])[1] ?? '';
  const numbers = [...row.matchAll(/([+−-]?\d+\.\d+)%/g)].map((m) => Number(m[1].replace('−', '-')));
  check(numbers.length === 5 && Math.abs(numbers.slice(0, 4).reduce((a, b) => a + b, 0) - numbers[4]) < 0.03, `the effects add up, got ${row}`);
  await snap('attribution');
  await page.setViewportSize({ width: 1280, height: 1800 });
  await docShot('attribution', page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('group', { name: /Period/ }).getByRole('link', { name: /Last 3 months/ }).click();
  await page.waitForURL('**/attribution?range=3m');
  await page.getByRole('group', { name: /Level/ }).getByRole('link', { name: /Satellite by sector/ }).click();
  await page.waitForURL('**/attribution?range=3m&level=2');
  check((await body()).includes('衛星') || (await body()).includes('Level 2 needs') || (await body()).includes('No satellite'), 'level 2 answers, with sectors or with what it needs');
  check((await body()).includes('績效歸因') && (await body()).includes('層級'), 'Chinese labels');
});

await step('five factors: the factors seeded by the job, none yet in the demo, the page says what it needs (N1)', async () => {
  await page.goto(`${BASE}/regression`);
  await page.getByRole('link', { name: /Five-factor mode/ }).click();
  await page.waitForURL('**/regression/factors');
  await page.getByRole('heading', { level: 1, name: /Five factors/ }).waitFor();
  const text = await body();
  check(/No factor data yet/.test(text), `no factors in the demo, got ${text.slice(0, 400)}`);
  check((await body()).includes('五因子') && (await body()).includes('尚無因子資料'), 'Chinese labels');
});

await step('data status: demo prices listed with their dates, the job not run yet', async () => {
  await page.goto(`${BASE}/data`);
  await page.getByRole('heading', { name: /Data status/ }).waitFor();
  const text = await body();
  check(text.includes('The nightly price job has not run yet'), 'not run yet');
  check(/VT[\s\S]*2026-10-20[\s\S]*157\.8 USD[\s\S]*Demo data/.test(text), 'VT demo close with its date');
  check(/AGGU[\s\S]*Not loaded yet/.test(text), 'AGGU not loaded yet');
  // The windfall planner's monthly series: the seed's invented history to 2026-09.
  const cape = await page.locator('#market-series tr', { hasText: 'us_cape' }).innerText();
  check(/2026-09\s+24\.04\s+Demo data/.test(cape), `the newest CAPE, got ${cape}`);
  check(/2026-09\s+2\.03%/.test(await page.locator('#market-series tr', { hasText: 'sp500_yield' }).innerText()), 'the dividend yield as a percentage');
  check(text.includes('資料狀態') && text.includes('匯率與金價'), 'Chinese labels');
  await snap('data-status-before');
});

// TEXT_REPORT, when set, is a file to write each page's visible text length to: what a person reads
// on arriving, the text folded inside <details> left out (innerText skips what is not rendered).
if (TEXT_REPORT) {
  await step('text report: the visible text on each page', async () => {
    const report = {};
    for (const path of ['/', '/holdings', '/performance', '/allocation', '/allocation/targets', '/allocation/assumptions', '/risk', '/plan', '/costs', '/windfall', '/monte-carlo', '/timeline', '/stress', '/frontier', '/attribution', '/regression', '/regression/factors', '/capm', '/valuation', '/valuation?t=AAPL', '/red-flags', '/red-flags?t=AAPL', '/look-through', '/sectors', '/sectors?view=treemap', '/sectors?view=bubble', '/proposals', '/rules', '/notifications', '/data', '/history', '/import', '/holdings/new', '/assets/new', '/cash-flows/new', '/securities', '/securities/new']) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState('networkidle');
      report[path] = await page.evaluate(() => {
        const main = document.querySelector('main');
        const count = (text) => text.replace(/\s+/g, '').length;
        // Prose: visible paragraphs, list items, hints and banners outside tables, legends and summary tiles, each counted once.
        const prose = [...(main?.querySelectorAll('p, li, .hint, .banner') ?? [])].filter(
          (el) => el.checkVisibility() && !el.closest('table, .chart-legend, .facts') && !el.parentElement?.closest('p, li, .hint, .banner'),
        );
        const tiles = [...(main?.querySelectorAll('.fact') ?? [])].filter((el) => el.checkVisibility());
        return {
          total: count(main?.innerText ?? ''),
          prose: prose.reduce((sum, el) => sum + count(el.innerText), 0),
          tiles: tiles.reduce((sum, el) => sum + count(el.innerText), 0),
          lines: prose.map((el) => el.innerText.replace(/\s+/g, ' ')),
        };
      });
    }
    writeFileSync(TEXT_REPORT, JSON.stringify(report, null, 2));
  });
}

await step('phone width: no page scrolls sideways (wide tables scroll inside their box)', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const wide = [];
  for (const path of ['/', '/notifications', '/holdings', '/performance', '/allocation', '/allocation/targets', '/allocation/assumptions', '/risk', '/plan', '/costs', '/windfall', '/monte-carlo', '/timeline', '/stress', '/frontier', '/attribution', '/regression', '/regression/factors', '/capm', '/valuation', '/valuation?t=AAPL', '/red-flags', '/red-flags?t=AAPL', '/look-through', '/sectors', '/sectors?view=treemap', '/sectors?view=bubble', '/proposals', '/rules', '/holdings/new', '/assets/new', '/cash-flows/new', '/securities', '/securities/new', '/history', '/import', '/data']) {
    await page.goto(`${BASE}${path}`);
    if (path === '/import') {
      await page.setInputFiles('input[type=file]', CSV);
      await page.getByText('already saved').first().waitFor();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) {
      // Name the innermost elements that reach past the screen, so the fix is easy to find.
      const culprits = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return [...document.querySelectorAll('main *')]
          .filter((el) => el.getBoundingClientRect().right > width + 1 && ![...el.children].some((child) => child.getBoundingClientRect().right > width + 1))
          .slice(0, 3)
          .map((el) => {
            const name = (node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.className && typeof node.className === 'string' ? `.${node.className.split(' ').join('.')}` : ''}`;
            const chain = [];
            for (let node = el; node && node.tagName !== 'MAIN'; node = node.parentElement) chain.push(`${name(node)}:${Math.round(node.getBoundingClientRect().width)}`);
            return chain.join(' < ');
          });
      });
      wide.push(`${path} by ${overflow}px (${culprits.join(', ')})`);
    }
    if (path === '/performance') await page.locator('.chart svg').nth(1).waitFor();
    if (path === '/allocation') await page.locator('.chart-donut svg').waitFor();
    if (path === '/risk') await page.locator('.chart-histogram svg').waitFor();
    if (path === '/plan') await page.locator('#actual-vs-plan .chart svg').waitFor();
    if (path === '/') await page.locator('.chart-donut svg').waitFor();
    if (path === '/costs') await page.locator('#fund-choices .chart svg').waitFor();
    if (path === '/windfall') await page.locator('.chart-backtest svg').waitFor();
    if (path === '/regression') await page.locator('.chart-scatter svg').first().waitFor();
    if (path === '/valuation?t=AAPL') await page.locator('.chart-ranges svg').waitFor();
    if (['/', '/holdings', '/performance', '/allocation', '/risk', '/plan', '/costs', '/windfall', '/monte-carlo', '/timeline', '/stress', '/frontier', '/attribution', '/regression', '/regression/factors', '/capm', '/valuation?t=AAPL', '/proposals', '/import'].includes(path)) await snap(`phone${path.replace('/', '-').replace('?t=', '-')}`);
  }
  check(wide.length === 0, `overflows: ${wide.join(', ')}`);
  await page.setViewportSize({ width: 1280, height: 900 });
});

// The real nightly job, against the stand-in, with live feeds: what GitHub Actions runs each night.
const nightly = (extra = {}) =>
  promisify(execFile)(`${REPO}/node_modules/.bin/tsx`, ['scripts/nightly.ts'], {
    cwd: REPO,
    timeout: 15 * 60_000,
    // SEC asks for a contact in the User-Agent (F12's US filings); a test address stands in for Hugo's.
    env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`, SUPABASE_SECRET_KEY: SECRET_KEY, SEC_USER_AGENT: process.env.SEC_USER_AGENT ?? 'LongViewInvest-e2e e2e@example.com', NODE_USE_ENV_PROXY: '1', ...extra },
  });
if (FINMIND_TOKEN && E2E_NIGHTLY !== '0') {
  await step('before the job: the invented weekly history and filings go, as a real project has none', async () => {
    // Its Fridays include market holidays the live feeds have no close for, and its quarter ends
    // are calendar ones where Apple's are not; left in, they would sit among the real figures.
    // Today's red-flag scan (the entry's) goes too, so the job scans both stocks against live feeds.
    for (const path of ['prices?source=eq.demo&price_date=lt.2026-05-07', 'fx_rates?source=eq.demo&rate_date=lt.2026-05-07', 'index_prices?source=eq.demo', 'fundamentals?source=eq.demo', 'fund_holdings?source=eq.demo', `red_flags?flag_date=eq.${taipeiToday}`]) {
      const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/rest/v1/${path}`, { method: 'DELETE', headers: { apikey: SECRET_KEY } });
      check(res.ok, `DELETE ${path}: HTTP ${res.status}`);
    }
  });

  await step('nightly job: loads live prices, rates and gold through the secret key, and records the run', async () => {
    const { stdout } = await nightly();
    console.log(stdout.trim());
    check(/^Nightly prices: (ok|partial)/m.test(stdout), 'run ok or partial');
    check(/VT\s+finmind\s+\d+ rows/.test(stdout) && /0050\s+finmind\s+\d+ rows/.test(stdout), 'VT and 0050 from FinMind');
    check(/USD\/TWD\s+finmind/.test(stdout) && /XAU\/TWD\s+finmind/.test(stdout), 'Bank of Taiwan USD rate and gold in TWD');
    // The Regression Lab's indices, and the holdings' β on the month's first run (the second run skips them).
    check(/SPX\s+finmind/.test(stdout) && /TAIEX\s+finmind/.test(stdout) && /Betas β: \d+ saved for the month/.test(stdout), 'the indices and the monthly β');
  });

  await step('nightly job on GitHub Actions: the public log names no ticker, and a second run only updates', async () => {
    const { stdout } = await nightly({ GITHUB_ACTIONS: 'true' });
    console.log(stdout.trim());
    check(/^::(notice|warning)::Nightly prices: (ok|partial)\. Loaded \d+ securities/m.test(stdout), 'one annotated summary line');
    for (const ticker of ['VT', '0050', 'AGGU', '2330', 'AAPL']) check(!new RegExp(`\\b${ticker}\\b`).test(stdout), `${ticker} kept out of the log`);
  });

  await step('data status after the job: its runs, the feeds per security, gold priced per gram, the NAV snapshots', async () => {
    await page.goto(`${BASE}/data`);
    const text = await body();
    check(text.includes('Last run') && text.includes('Recent runs'), 'runs listed');
    check(/Saved the daily NAV snapshot for each day from 2026-05-07 to \d{4}-\d{2}-\d{2}/.test(text), 'NAV snapshots saved from the first trade');
    check(!text.includes('has not run yet'), 'the job has run');
    const vt = await page.locator('tr', { hasText: 'Vanguard Total World Stock ETF' }).innerText();
    check(vt.includes('FinMind') && !vt.includes('Demo data'), `VT from FinMind, got ${vt}`);
    check(text.includes('XAU/TWD') && text.includes('Gold per gram'), 'gold in TWD per gram');
    // The Regression Lab's indices (N1) from FinMind, and the holdings' β saved for the month.
    const indices = await page.locator('#indices').innerText();
    check(/SPX[\s\S]*FinMind[\s\S]*TAIEX[\s\S]*FinMind/.test(indices), `the indices loaded live, got ${indices.replace(/\s+/g, ' ')}`);
    // The monthly market series from Shiller's workbook, or multpl.com when it cannot be reached.
    const cape = await page.locator('#market-series tr', { hasText: 'us_cape' }).innerText();
    check(/\d{4}-\d{2}\s+[\d.]+\s+(Shiller's data|multpl\.com)/.test(cape) && !cape.includes('Demo data'), `CAPE loaded live, got ${cape.replace(/\s+/g, ' ')}`);
    // After the refresh the job checks the rules, with the secret key, as the owner's Check now does.
    check(/Checked the rules: \d+ new proposals?, \d+ closed\./.test(text), 'the rules checked after the refresh');
    await snap('data-status-after');
    await docShot('data-status', page);
  });

  await step("after the job: the VaR proxies' weekly closes hold no jump a split or a bad price would leave", async () => {
    const jumps = [];
    for (const ticker of ['VT', '0050', 'BNDW', 'GLDM', 'BIL', 'VOO']) {
      const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/rest/v1/weekly_prices?select=price_date,close,adj_close&ticker=eq.${ticker}&order=price_date`, {
        headers: { apikey: SECRET_KEY },
      });
      check(res.ok, `weekly_prices ${ticker}: HTTP ${res.status}`);
      const rows = await res.json();
      check(rows.length > 150, `${ticker}: three years of weeks, got ${rows.length}`);
      for (let i = 1; i < rows.length; i++) {
        const [was, now] = [rows[i - 1], rows[i]];
        const ratio = (now.adj_close ?? now.close) / (was.adj_close ?? was.close);
        if (ratio < 0.6 || ratio > 1.4) jumps.push(`${ticker} ${was.price_date} → ${now.price_date}: ×${ratio.toFixed(3)}`);
      }
    }
    check(jumps.length === 0, `weekly moves beyond ±40%: ${jumps.join('; ')}`);
  });

  await step('risk after the job: each day saved with its VaR, the 52-week line drawn from them', async () => {
    await page.goto(`${BASE}/data`);
    check(/(Each carries its 1-week VaR|of them carry a 1-week VaR)/.test(await body()), 'the snapshots carry their VaR');
    await page.goto(`${BASE}/risk`);
    await page.locator('.sparkline svg').waitFor();
    const text = await body();
    check(text.includes('The last 52 weeks, since 2026-05-'), 'the line starts with the first demo trade');
    const figure = await varFigure(page.locator('#value-at-risk'));
    check(figure.value > 0 && figure.share > 0.2 && figure.share < 6, `a plausible weekly VaR on live closes, got NT$${figure.value} (${figure.share}%)`);
    // The README image: the top of the page, the card with its line and the histogram.
    await page.setViewportSize({ width: 1280, height: 1250 });
    await docShot('risk', page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByText('The 52-week line as a table').click();
    check(/2026-05-\d\d\s+NT\$[\d,]+\s+[\d.]+%/.test(await body()), 'the line as a table, from May');
    await snap('risk-after-job');
  });

  await step('regression after the job: the holdings\' β saved for the month, against both indices, on live closes', async () => {
    await page.goto(`${BASE}/regression`);
    await page.locator('#vs-SPX .chart-scatter svg').waitFor();
    const saved = await page.locator('#saved').innerText();
    check(/VT\s+\d\.\d\d\s+\d\.\d\d\s+\d{4}-\d{2}-\d{2}/.test(saved), `VT's β saved, got ${saved.replace(/\s+/g, ' ')}`);
    const spx = await figures('#vs-SPX');
    const value = Number((spx[0] ?? '').split(' ')[0]);
    check(value > 0.6 && value < 1.3, `a plausible β for VT against the S&P 500 on live closes, got ${spx[0]}`);
  });

  await step('five factors after the job: the factors loaded live from the library, VT and the whole portfolio regressed on them (N1)', async () => {
    await page.goto(`${BASE}/data`);
    check(/ff5_us/.test(await page.locator('#market-series').innerText()), 'the factor series on the data status page');
    await page.goto(`${BASE}/regression/factors`);
    await page.locator('#factor-detail').waitFor();
    const text = await body();
    check(/Factors loaded through: US factors 20\d\d-\d\d/.test(text), `the factors' newest months, got ${text.slice(0, 500)}`);
    const vt = (await page.locator('table').first().innerText()).split('\n').find((line) => line.startsWith('VT')) ?? '';
    const loadings = [...vt.matchAll(/(-?\d\.\d\d)\s*\(/g)].map((m) => Number(m[1]));
    check(loadings.length === 5 && loadings[0] > 0.7 && loadings[0] < 1.3, `VT's market loading is near 1 on live closes, got ${vt}`);
    check(/Whole portfolio/.test(await page.locator('table').first().innerText()), 'the whole portfolio row');
    await snap('five-factors');
    await page.setViewportSize({ width: 1280, height: 1500 });
    await docShot('five-factors', page);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await step("cost of equity after the job: the 10-year yields and Damodaran's ERP loaded live, 2330's β saved for the month (F11)", async () => {
    await page.goto(`${BASE}/data`);
    const series = (await page.locator('#market-series').innerText()).replace(/\s+/g, ' ');
    check(/us_treasury_10y .*? \d{4}-\d{2} [\d.]+% (FRED|US Treasury)/.test(series), `the US 10-year loaded live, got ${series}`);
    check(/tw_govt_10y .*? \d{4}-\d{2} [\d.]+% Central Bank of the ROC/.test(series), `Taiwan's 10-year loaded live, got ${series}`);
    check(/us_implied_erp .*? \d{4}-\d{2} [\d.]+% Damodaran Online/.test(series), `Damodaran's ERP loaded live, got ${series}`);
    await page.goto(`${BASE}/capm`);
    // 2330 is held, so this month's refresh saved its β on live closes.
    const tsmc = await costRow('2330');
    console.log(`  2330 ${tsmc.join(' | ')}`);
    check(tsmc[2]?.includes(`saved ${taipeiToday}`), `2330's β from this month's refresh, got ${tsmc[2]}`);
    const rate = pct(tsmc[5]);
    check(rate > 2 && rate < 15, `a plausible cost of equity for 2330, got ${tsmc[5]}`);
    await snap('capm-after-job');
  });

  await step("valuation after the job: live filings for AAPL (SEC) and 2330 (FinMind), each watched stock valued again on its new quarter (F12)", async () => {
    await page.goto(`${BASE}/data`);
    const filings = (await page.locator('#filings').innerText()).replace(/\s+/g, ' ');
    console.log(`  ${filings}`);
    check(/AAPL \d{4}-\d{2}-\d{2} \d{4}-\d{2}-\d{2} SEC EDGAR \d+/.test(filings), `AAPL's quarters from SEC, got ${filings}`);
    check(/2330 \d{4}-\d{2}-\d{2} — FinMind \d+/.test(filings), `2330's quarters from FinMind, got ${filings}`);
    await page.goto(`${BASE}/valuation?t=AAPL`);
    const quarter = await fact('Newest quarter');
    check(/SEC EDGAR · filed \d{4}-\d{2}-\d{2}/.test(quarter) && !quarter.includes('2026-06-30 demo'), `AAPL's live newest quarter, got ${quarter}`);
    await page.getByText(/^Saved values \(\d+\)/).click();
    check(/filing \d{4}-\d{2}-\d{2}/.test(await body()), 'valued again after the live filing');
    await snap('valuation-after-job');
  });

  await step("red flags after the job: 2330's industry and audit firm from TWSE, AAPL's SIC from SEC, both scanned today (N3)", async () => {
    // The first run scanned them; the second, as on GitHub Actions, found none due.
    const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/rest/v1/job_runs?select=detail&job=eq.nightly_prices&order=id`, { headers: { apikey: SECRET_KEY } });
    const runs = (await res.json()).map((row) => row.detail?.redFlags?.scanned ?? null);
    check(runs.length >= 2 && runs[0]?.includes('AAPL') && runs[0]?.includes('2330') && runs[1]?.length === 0, `scanned by the first run, none due on the second, got ${JSON.stringify(runs)}`);
    await page.goto(`${BASE}/data`);
    check((await body()).includes('Red flags: scanned none due'), 'the latest run says none was due');
    await page.goto(`${BASE}/red-flags?t=2330`);
    check((await fact('Industry')).includes('半導體業') && (await fact('Last scan')).includes(taipeiToday), `2330's live profile and today's scan, got ${await fact('Industry')}`);
    const tsmc = await page.locator('main table').first().innerText();
    check(new RegExp(`Restatement[\\s\\S]*Checked ${taipeiToday}, reading since 2026-10-11`).test(tsmc), "TWSE's announcements read, since the seed's first night");
    if (process.env.MOENV_API_KEY) check(new RegExp(`Environmental penalties[\\s\\S]*Checked ${taipeiToday}`).test(tsmc), 'the penalties checked by business ID');
    await page.goto(`${BASE}/red-flags?t=AAPL`);
    const apple = await page.locator('main table').first().innerText();
    check(new RegExp(`Going-concern opinion[\\s\\S]*Checked ${taipeiToday}`).test(apple), 'the going-concern search ran');
    await snap('red-flags-after-job');
  });

  await step("look-through after the job: VT's live file from Vanguard and 00692's from Fubon, with sectors (F14)", async () => {
    await page.goto(`${BASE}/data`);
    const files = (await page.locator('#holdings-files').innerText().catch(() => '')).replace(/\s+/g, ' ');
    // The first run read them; its line may be under an older run, so the page is the check.
    await page.goto(`${BASE}/look-through`);
    const funds = (await page.locator('#funds').innerText()).replace(/\s+/g, ' ');
    console.log(`  ${files || '(holdings line from an earlier run)'}\n  ${funds}`);
    const vt = /VT NT\$[\d,]+ (\d{4}-\d{2}-\d{2}) · Vanguard · (\d+) lines, (\d+)% named/.exec(funds);
    check(vt !== null && Number(vt[2]) > 5000 && Number(vt[3]) > 90, `VT's live file, got ${funds}`);
    const tw = /00692 NT\$[\d,]+ (\d{4}-\d{2}-\d{2}) · Fubon · (\d+) lines/.exec(funds);
    check(tw !== null && Number(tw[2]) > 50, `00692's live file, got ${funds}`);
    const sectors = await page.locator('#sectors').innerText();
    check(/Information Technology 資訊科技\s+\d+\.\d%/.test(sectors), `sectors from the live files, got ${sectors}`);
    await snap('look-through-after-job');
  });

  await step('sectors after the job: every SPDR fund\'s and TWSE industry index\'s live closes, a year of returns (N7)', async () => {
    await page.goto(`${BASE}/sectors`);
    await page.locator('.chart-heatmap svg').waitFor();
    check(new RegExp(`Closes to (${taipeiToday}|\\d{4}-\\d{2}-\\d{2})`).test(await body()) && !(await body()).includes('Closes to 2026-10-23 '), 'newer than the seed');
    const returns = await page.locator('#sector-returns').innerText();
    console.log(`  ${returns.split('\n').slice(0, 4).join(' | ')}`);
    check(/Information Technology 資訊科技 US · XLK(\s+[+−]\d+\.\d%){5}/.test(returns), `XLK's live returns for every period, got ${returns}`);
    check(/Financials 金融 TW · FINANCIALINSURANCE(\s+[+−]\d+\.\d%){5}/.test(returns), `the TWSE financials index live, got ${returns}`);
    await snap('sectors-after-job');
  });

  await step('holdings after the job: gold valued at the gold price, closes dated', async () => {
    await page.goto(`${BASE}/holdings`);
    const row = page.locator('tr', { hasText: 'Gold bar (demo)' });
    const cells = await row.locator('td').allInnerTexts();
    // 5 g at about NT$4,000+ a gram, no longer the NT$15,000 typed by hand, and not marked estimated.
    const value = Number((cells[3] ?? '').replace(/[^\d]/g, ''));
    check(value > 15000 && !(cells[3] ?? '').includes('*'), `gold at the gold price, got ${cells[3]}`);
    check(/^\d{4}-\d{2}-\d{2}$/.test((cells[4] ?? '').trim()), `gold dated by its price, got ${cells[4]}`);
    await snap('holdings-after-job');
    await page.evaluate(() => window.scrollTo(0, 0));
    await docShot('holdings', page);
  });
} else {
  results.push('skip  nightly job steps: no FINMIND_TOKEN, or E2E_NIGHTLY=0');
}

await step('signing out ends the session', async () => {
  await page.getByRole('button', { name: /Sign out/ }).click();
  await page.waitForURL('**/login');
  await page.goto(`${BASE}/holdings`);
  await page.waitForURL('**/login');
});

await browser.close();
pushService.close();
for (; expectedNotFound > 0; expectedNotFound--) {
  const index = problems.findIndex((line) => line.includes('status of 404'));
  if (index !== -1) problems.splice(index, 1);
}
console.log(results.join('\n'));
console.log(problems.length ? `\nbrowser errors:\n${problems.join('\n')}` : '\nno browser errors');
process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
