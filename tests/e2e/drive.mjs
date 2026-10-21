// Drives the app in Chromium against the local Supabase stand-in (run.sh), step by step, with a
// screenshot of each screen. The expected figures come from supabase/seed.sql (demo data).
import { existsSync } from 'node:fs';

import { chromium } from 'playwright-core';

// DOCS_SHOTS, when set, also saves the README screenshots there (npm run test:e2e with DOCS_SHOTS=$PWD/docs/images).
const { APP_PORT, SHOTS, CSV, CHROMIUM, OWNER_EMAIL, OWNER_PASSWORD, DOCS_SHOTS } = process.env;
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
  check(text.includes('持倉') && text.includes('實際與目標權重'), 'Chinese labels');
  await snap('holdings');
  await docShot('holdings', page);
});

await step('holdings: R1 and R2 are worked out on screen with the demo figures', async () => {
  await page.getByText('How R1 and R2 are worked out').click();
  const text = await body();
  // 5% of NT$79,203.12; the satellite is 2330 (NT$7,215) plus AAPL (NT$7,646.40).
  check(text.includes('One stock may hold up to NT$3,960'), 'R1 limit in NT$');
  check(text.includes('NT$14,861 ÷ NT$79,203 = 18.8%'), 'R2 inputs');
  check(text.includes('單一個股最多可持有 NT$3,960'), 'Chinese R1 line');
});

await step('trade form: picking VT fills USD and the latest rate; an existing breach is shown as such', async () => {
  await page.goto(`${BASE}/holdings/new`);
  await page.fill('input[name=ticker]', 'VT');
  check((await page.inputValue('input[name=currency]')) === 'USD', 'currency USD');
  check((await page.inputValue('input[name=fxRate]')) === '32.4', `fx 32.4, got ${await page.inputValue('input[name=fxRate]')}`);
  await page.fill('input[name=qty]', '1');
  await page.fill('input[name=price]', '158');
  await page.fill('input[name=fee]', '1');
  await page.getByText('Already above a limit before this trade').waitFor();
  await snap('trade-form');
  await page.click('main button[type=submit]');
  await page.waitForURL('**/holdings?saved=added');
  await page.getByText('Trade added.').waitFor();
});

await step('a typo in the FX rate warns', async () => {
  await page.goto(`${BASE}/holdings/new`);
  await page.fill('input[name=ticker]', 'VT');
  await page.fill('input[name=fxRate]', '3.24');
  await page.getByText('more than 20% away from the latest known 32.4').waitFor();
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
  await page.locator('table').last().locator('tbody tr').first().getByRole('link').click();
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
  await page.getByLabel('FX rate for rows without one').fill('32.3');
  await page.getByText('2 new · 0 already saved · 1 with an unknown ticker · 2 skipped').waitFor();
  const text = await body();
  check(text.includes('不是買進或賣出') && text.includes('不是交易列'), 'dividend and totals rows explained');
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
  await page.getByText('3 new · 0 already saved · 0 with an unknown ticker · 2 skipped').waitFor();
  await page.getByRole('button', { name: /Import 3 trades/ }).click();
  await page.waitForURL('**/holdings?saved=imported**');
  await page.getByText('Imported 3 trades; 2 rows of the file skipped.').waitFor();
  check((await body()).includes('CSV import'), 'imported trades marked as CSV');
  await snap('after-import');
});

await step('CSV import again: the broker mapping is remembered and nothing is imported twice', async () => {
  await page.goto(`${BASE}/import`);
  check((await page.locator('select').first().inputValue()) === '國泰複委託（示範）', 'saved broker selected');
  await page.setInputFiles('input[type=file]', CSV);
  // Without an FX rate the saved rows are still recognised; keeping one needs the rate.
  await page.getByText('0 new · 3 already saved').waitFor();
  check(await page.getByRole('button', { name: /Import 0 trades/ }).isDisabled(), 'import disabled');
  check((await page.getByLabel('Import anyway').count()) === 0, 'nothing to keep without a rate');
  await page.getByLabel('FX rate for rows without one').fill('32.3');
  await page.getByLabel('Import anyway').first().check();
  await page.getByRole('button', { name: /Import 1 trade 匯入/ }).waitFor();
});

await step('phone width: no page scrolls sideways (wide tables scroll inside their box)', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const wide = [];
  for (const path of ['/holdings', '/holdings/new', '/assets/new', '/securities', '/securities/new', '/history', '/import']) {
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
