// Drives the app in Chromium against the local Supabase stand-in (run.sh), step by step, with a
// screenshot of each screen. The expected figures come from supabase/seed.sql (demo data). With a
// FINMIND_TOKEN in the environment, the last steps also run the real nightly job against the
// stand-in and check what it loaded (E2E_NIGHTLY=0 skips them).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

import { chromium } from 'playwright-core';

// DOCS_SHOTS, when set, also saves the README screenshots there (npm run test:e2e with DOCS_SHOTS=$PWD/docs/images).
const { APP_PORT, SHOTS, CSV, CHROMIUM, OWNER_EMAIL, OWNER_PASSWORD, DOCS_SHOTS, GATEWAY_PORT, SECRET_KEY, FINMIND_TOKEN, E2E_NIGHTLY, REPO } = process.env;
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

await step('installable: manifest, icons and robots.txt load without a session; pages send the security headers', async () => {
  const manifest = await page.request.get(`${BASE}/manifest.webmanifest`, { maxRedirects: 0 });
  check(manifest.status() === 200, `manifest HTTP ${manifest.status()}`);
  const json = await manifest.json();
  check(json.display === 'standalone' && json.start_url === '/holdings', 'standalone, opens on holdings');
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

await step('the owner signs in and lands on holdings', async () => {
  await page.fill('input[name=password]', OWNER_PASSWORD);
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings');
  await page.getByRole('heading', { name: /Listed holdings/ }).waitFor();
});

await step('holdings: demo pool total, R1 breaches with trims, satellite share, gold not valued yet', async () => {
  const text = await body();
  // Seed: seven ETFs and stocks at the demo closes and USD/TWD 32.40, plus NT$20,000 savings.
  check(text.includes('NT$79,203'), 'regular pool NT$79,203');
  check(text.includes('R1: AAPL is 9.7% of the regular pool') && text.includes('Selling about NT$3,686'), 'R1 AAPL with trim');
  check(text.includes('R1: 2330 is 9.1%') && text.includes('NT$3,255'), 'R1 2330 with trim');
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
  check(text.includes('contributions NT$60,000') && text.includes('dividends NT$20'), 'totals per type');
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

await step('data status: demo prices listed with their dates, the job not run yet', async () => {
  await page.goto(`${BASE}/data`);
  await page.getByRole('heading', { name: /Data status/ }).waitFor();
  const text = await body();
  check(text.includes('The nightly price job has not run yet'), 'not run yet');
  check(/VT[\s\S]*2026-10-20[\s\S]*157\.8 USD[\s\S]*Demo data/.test(text), 'VT demo close with its date');
  check(/AGGU[\s\S]*Not loaded yet/.test(text), 'AGGU not loaded yet');
  check(text.includes('資料狀態') && text.includes('匯率與金價'), 'Chinese labels');
  await snap('data-status-before');
});

await step('phone width: no page scrolls sideways (wide tables scroll inside their box)', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const wide = [];
  for (const path of ['/holdings', '/holdings/new', '/assets/new', '/cash-flows/new', '/securities', '/securities/new', '/history', '/import', '/data']) {
    await page.goto(`${BASE}${path}`);
    if (path === '/import') {
      await page.setInputFiles('input[type=file]', CSV);
      await page.getByText('already saved').first().waitFor();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) wide.push(`${path} by ${overflow}px`);
    if (path === '/holdings' || path === '/import') await snap(`phone${path.replace('/', '-')}`);
  }
  check(wide.length === 0, `overflows: ${wide.join(', ')}`);
  await page.setViewportSize({ width: 1280, height: 900 });
});

// The real nightly job, against the stand-in, with live feeds: what GitHub Actions runs each night.
const nightly = (extra = {}) =>
  promisify(execFile)(`${REPO}/node_modules/.bin/tsx`, ['scripts/nightly.ts'], {
    cwd: REPO,
    timeout: 15 * 60_000,
    env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`, SUPABASE_SECRET_KEY: SECRET_KEY, NODE_USE_ENV_PROXY: '1', ...extra },
  });
if (FINMIND_TOKEN && E2E_NIGHTLY !== '0') {
  await step('nightly job: loads live prices, rates and gold through the secret key, and records the run', async () => {
    const { stdout } = await nightly();
    console.log(stdout.trim());
    check(/^Nightly prices: (ok|partial)/m.test(stdout), 'run ok or partial');
    check(/VT\s+finmind\s+\d+ rows/.test(stdout) && /0050\s+finmind\s+\d+ rows/.test(stdout), 'VT and 0050 from FinMind');
    check(/USD\/TWD\s+finmind/.test(stdout) && /XAU\/TWD\s+finmind/.test(stdout), 'Bank of Taiwan USD rate and gold in TWD');
  });

  await step('nightly job on GitHub Actions: the public log names no ticker, and a second run only updates', async () => {
    const { stdout } = await nightly({ GITHUB_ACTIONS: 'true' });
    console.log(stdout.trim());
    check(/^::(notice|warning)::Nightly prices: (ok|partial)\. Loaded \d+ securities/m.test(stdout), 'one annotated summary line');
    for (const ticker of ['VT', '0050', 'AGGU', '2330', 'AAPL']) check(!new RegExp(`\\b${ticker}\\b`).test(stdout), `${ticker} kept out of the log`);
  });

  await step('data status after the job: its runs, the feeds per security, and gold priced per gram', async () => {
    await page.goto(`${BASE}/data`);
    const text = await body();
    check(text.includes('Last run') && text.includes('Recent runs'), 'runs listed');
    check(!text.includes('has not run yet'), 'the job has run');
    const vt = await page.locator('tr', { hasText: 'Vanguard Total World Stock ETF' }).innerText();
    check(vt.includes('FinMind') && !vt.includes('Demo data'), `VT from FinMind, got ${vt}`);
    check(text.includes('XAU/TWD') && text.includes('Gold per gram'), 'gold in TWD per gram');
    await snap('data-status-after');
    await docShot('data-status', page);
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
for (; expectedNotFound > 0; expectedNotFound--) {
  const index = problems.findIndex((line) => line.includes('status of 404'));
  if (index !== -1) problems.splice(index, 1);
}
console.log(results.join('\n'));
console.log(problems.length ? `\nbrowser errors:\n${problems.join('\n')}` : '\nno browser errors');
process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
