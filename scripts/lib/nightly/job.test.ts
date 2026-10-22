import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PriceRow } from '../../../lib/models/market.ts';
import type { PerformanceInput, Snapshot } from '../../../lib/models/performance.ts';
import { fridays, gridStart, type RiskInput } from '../../../lib/models/risk.ts';
import { FeedError, type DailyPrice, type DailyRate, type Get } from '../feeds/types.ts';
import { goldInTwd, riskWindowStart, runNightly, windowStart, type JobRun, type Security, type Store } from './job.ts';

const TODAY = '2026-10-21';
const SECURITIES: Security[] = [
  { ticker: '0050', market: 'TW', currency: 'TWD' },
  { ticker: 'VT', market: 'US', currency: 'USD' },
  { ticker: 'AGGU', market: 'UK', currency: 'USD' },
];

const ok = (data: unknown[]) => JSON.stringify({ msg: 'success', status: 200, data });

/** Replies keyed by FinMind dataset (and data_id), or by a piece of the URL for the other feeds. */
const REPLIES: Record<string, string> = {
  'TaiwanStockPrice 0050': ok([
    { date: '2026-07-18', close: 99.2 },
    { date: '2026-07-21', close: 98.6 },
    { date: '2026-10-21', close: 108.15 },
  ]),
  'TaiwanStockDividendResult 0050': ok([{ date: '2026-07-21', before_price: 99.2, after_price: 98.6 }]),
  'USStockPrice VT': ok([{ date: '2026-10-20', Close: 157.8, Adj_Close: 157.8 }]),
  'TaiwanExchangeRate USD': ok([
    { date: '2026-10-20', spot_buy: 32.58, spot_sell: 32.68, cash_buy: 32.2, cash_sell: 32.9 },
    { date: '2026-10-21', spot_buy: 32.435, spot_sell: 32.535, cash_buy: 32.085, cash_sell: 32.755 },
  ]),
  GoldPrice: ok([
    { date: '2026-10-20 23:55:00', Price: 4115.29 },
    { date: '2026-10-21 10:30:00', Price: 4118.39 },
  ]),
  'ishares.com': '<span>NAV as of 20/Oct/2026</span> <span>USD 5.77</span>',
  'get-fund-document': `<ss:Worksheet ss:Name="Historical NAVs"><ss:Table>
    <ss:Row><ss:Cell><ss:Data>As Of</ss:Data></ss:Cell><ss:Cell><ss:Data>NAV per Share</ss:Data></ss:Cell></ss:Row>
    <ss:Row><ss:Cell><ss:Data>20/Oct/2026</ss:Data></ss:Cell><ss:Cell><ss:Data>5.77</ss:Data></ss:Cell></ss:Row>
    <ss:Row><ss:Cell><ss:Data>19/Oct/2026</ss:Data></ss:Cell><ss:Cell><ss:Data>5.76</ss:Data></ss:Cell></ss:Row>
    <ss:Row><ss:Cell><ss:Data>21/Nov/2017</ss:Data></ss:Cell><ss:Cell><ss:Data>5.00</ss:Data></ss:Cell></ss:Row>
  </ss:Table></ss:Worksheet>`,
  STOCK_DAY_ALL: JSON.stringify([{ Date: '1151021', Code: '0050', ClosingPrice: '108.15' }]),
  fredgraph: 'observation_date,DEXTAUS\n2026-10-16,32.34\n',
  alphavantage: JSON.stringify({ 'Time Series (Daily)': { '2026-10-20': { '4. close': '157.80' } } }),
};

/** The reply keys that are not FinMind datasets. */
const OTHER_FEEDS = new Set(['ishares.com', 'get-fund-document', 'STOCK_DAY_ALL', 'fredgraph', 'alphavantage']);
const finmindDown = (key: string) => !OTHER_FEEDS.has(key);

/** A fake fetch: `fail` picks the reply keys that answer with an error instead. */
function fakeGet(fail: (key: string) => boolean = () => false): { get: Get; urls: string[] } {
  const urls: string[] = [];
  const get: Get = async (url) => {
    urls.push(url);
    const parsed = new URL(url);
    const dataset = parsed.searchParams.get('dataset');
    const key = dataset ? [dataset, parsed.searchParams.get('data_id')].filter(Boolean).join(' ') : [...OTHER_FEEDS].find((piece) => url.includes(piece));
    const reply = key === undefined ? undefined : REPLIES[key];
    if (key === undefined || reply === undefined || fail(key)) throw new FeedError(`HTTP 503 for ${key ?? url}`);
    return reply;
  };
  return { get, urls };
}

/** Weekly 0050 closes to 16 October 2026, three years of them, moving ±a so their sample σ is exactly 2%. */
function weeklyHistory(): PriceRow[] {
  const grid = fridays(gridStart('2026-10-16', 156), '2026-10-16');
  const a = 0.02 * Math.sqrt(155 / 156);
  let close = 100;
  return grid.map((date, week) => {
    if (week > 0) close *= week % 2 === 0 ? 1 + a : 1 - a;
    return { ticker: '0050', date, close, adjClose: close };
  });
}

class MemoryStore implements Store {
  prices: DailyPrice[] = [];
  fills: DailyPrice[] = [];
  rates: DailyRate[] = [];
  runs: JobRun[] = [];
  snapshots: Snapshot[] = [];
  constructor(
    private readonly options: { failRead?: boolean; earliestAggu?: string; failSnapshots?: boolean; proxies?: string[]; riskHistory?: PriceRow[]; failRisk?: boolean } = {},
  ) {}
  async securities() {
    if (this.options.failRead) throw new Error('connection refused');
    return SECURITIES;
  }
  async earliestTradeDate() {
    return '2026-05-07';
  }
  async lookbackYears() {
    return 3;
  }
  async riskProxies() {
    return this.options.proxies ?? [];
  }
  /** 0050 as the Taiwan proxy, with the weekly history the test gives it (none by default). */
  async riskInput(): Promise<RiskInput> {
    if (this.options.failRisk) throw new Error('weekly_prices: permission denied');
    return {
      settings: { confidence: 0.95, horizonWeeks: 1, monthWeeks: 4.33, lookbackYears: 3 },
      benchmarks: new Map([['tw_market_cap', '0050']]),
      proxies: new Map([['0050', 'TWD']]),
      prices: this.options.riskHistory ?? [],
      rates: [],
    };
  }
  async earliestPriceDate(ticker: string) {
    return ticker === 'AGGU' ? this.options.earliestAggu : undefined;
  }
  async savePrices(rows: readonly DailyPrice[], options: { fillOnly?: boolean } = {}) {
    (options.fillOnly ? this.fills : this.prices).push(...rows);
  }
  async saveRates(rows: readonly DailyRate[]) {
    this.rates.push(...rows);
  }
  /** 10 shares of 0050 bought the day before, valued at the closes this run saved. */
  async performanceInput(end: string): Promise<PerformanceInput> {
    if (this.options.failSnapshots) throw new Error('transactions: permission denied');
    return {
      end,
      trades: [{ tradeDate: '2026-10-20', ticker: '0050', side: 'buy', qty: 10, price: 100, currency: 'TWD', fee: 0, tax: 0, fxRate: 1, pool: 'regular' }],
      cashFlows: [],
      manualAssets: [],
      securities: [{ ticker: '0050', name: '元大台灣50', market: 'TW', productType: 'equity_etf', assetClassId: 'tw_market_cap', sleeve: 'core', currency: 'TWD' }],
      benchmark: [],
      prices: this.prices.map((p) => ({ ticker: p.ticker, date: p.date, close: p.close, adjClose: p.adjClose })),
      rates: this.rates.map((r) => ({ pair: r.pair, date: r.date, rate: r.rate })),
    };
  }
  async saveSnapshots(rows: readonly Snapshot[]) {
    this.snapshots.push(...rows);
  }
  async recordRun(run: JobRun) {
    this.runs.push(run);
  }
}

let clock = 0;
const deps = (get: Get, store: Store, alphaVantageKey?: string) => ({
  get,
  store,
  finmindToken: 'token',
  alphaVantageKey,
  today: TODAY,
  now: () => new Date(Date.UTC(2026, 9, 20, 22, 37, clock++)),
});

describe('windowStart', () => {
  it('reaches back the lookback years with two weeks to spare, or to an older first trade', () => {
    assert.equal(windowStart(TODAY, 3), '2023-10-07');
    assert.equal(windowStart(TODAY, 3, '2026-05-07'), '2023-10-07');
    assert.equal(windowStart(TODAY, 3, '2019-03-01'), '2019-03-01');
  });

  it('reaches back a VaR proxy 156 weeks before a year ago, or before an older first trade', () => {
    // A year ago is Wednesday 22 October 2025; its Friday is the 17th, 156 weeks after 21 October 2022.
    assert.equal(riskWindowStart(TODAY, 156), '2022-10-07');
    assert.equal(riskWindowStart(TODAY, 156, '2026-05-07'), '2022-10-07');
    assert.equal(riskWindowStart(TODAY, 156, '2019-03-01'), '2016-02-19');
  });
});

describe('goldInTwd', () => {
  it("prices an ounce in TWD at the day's rate, or the latest rate before it", () => {
    const gold = [
      { pair: 'XAU/USD', date: '2026-10-19', rate: 4100, source: 'finmind' },
      { pair: 'XAU/USD', date: '2026-10-21', rate: 4118.39, source: 'finmind' },
    ];
    const usd = [{ pair: 'USD/TWD', date: '2026-10-20', rate: 32.63, source: 'finmind' }];
    assert.deepEqual(
      goldInTwd(gold, usd).map((r) => [r.pair, r.date, r.rate]),
      [['XAU/TWD', '2026-10-21', 134383.0657]],
    );
  });
});

describe('runNightly', () => {
  it('loads every security, the FX rate and gold, and records an ok run', async () => {
    const store = new MemoryStore();
    const run = await runNightly(deps(fakeGet().get, store));
    assert.equal(run.status, 'ok', JSON.stringify(run.detail));
    // A year ago, less 156 weeks and two weeks to spare: the VaR proxies' window (none here) sets the rates'.
    assert.deepEqual(run.detail.window, { start: '2022-10-07', end: TODAY });
    const byKey = (rows: DailyPrice[]) => rows.map((p) => `${p.ticker} ${p.date} ${p.close} ${p.adjClose} ${p.source}`);
    assert.deepEqual(byKey(store.prices), [
      '0050 2026-07-18 99.2 98.6 finmind',
      '0050 2026-07-21 98.6 98.6 finmind',
      '0050 2026-10-21 108.15 108.15 finmind',
      'VT 2026-10-20 157.8 157.8 finmind',
      // The fund download fills AGGU's history, inside the window only.
      'AGGU 2026-10-20 5.77 5.77 ishares_nav',
      'AGGU 2026-10-19 5.76 5.76 ishares_nav',
    ]);
    assert.deepEqual(
      store.rates.map((r) => `${r.pair} ${r.date} ${r.rate}`),
      ['USD/TWD 2026-10-20 32.63', 'USD/TWD 2026-10-21 32.485', 'XAU/USD 2026-10-20 4115.29', 'XAU/USD 2026-10-21 4118.39', 'XAU/TWD 2026-10-20 134281.9127', 'XAU/TWD 2026-10-21 133785.8992'],
    );
    assert.deepEqual(run.detail.prices['AGGU'], { source: 'ishares_nav', rows: 2, latest: '2026-10-20' });
    assert.deepEqual(store.runs, [run]);
  });

  it("saves each day's NAV snapshot at the closes it just loaded", async () => {
    const store = new MemoryStore();
    const run = await runNightly(deps(fakeGet().get, store));
    // On the 20th 0050 still stood at its 21 July close; the 21st has that day's. No proxy has three
    // years of weekly closes here, so neither day has a VaR.
    assert.deepEqual(store.snapshots, [
      { date: '2026-10-20', totalTwd: 986, weightsByClass: { tw_market_cap: 1 }, valueAtRisk: null },
      { date: '2026-10-21', totalTwd: 1081.5, weightsByClass: { tw_market_cap: 1 }, valueAtRisk: null },
    ]);
    assert.deepEqual(run.detail.snapshots, { days: 2, from: '2026-10-20', to: '2026-10-21', valueAtRisk: 0 });
  });

  it("saves each day's 1-week VaR with its snapshot once the proxy has three years of weekly closes", async () => {
    const store = new MemoryStore({ riskHistory: weeklyHistory() });
    const run = await runNightly(deps(fakeGet().get, store));
    // 1.645 × 2% × the day's value; both days read the weeks to Friday 16 October.
    assert.deepEqual(
      store.snapshots.map((row) => [row.date, row.valueAtRisk]),
      [
        ['2026-10-20', Math.round(0.0329 * 986 * 100) / 100],
        ['2026-10-21', Math.round(0.0329 * 1081.5 * 100) / 100],
      ],
    );
    assert.equal(run.detail.snapshots?.valueAtRisk, 2);
    assert.equal(run.status, 'ok');
  });

  it('saves the snapshots without touching their VaR when its inputs fail, and reports a partial run', async () => {
    const store = new MemoryStore({ failRisk: true });
    const run = await runNightly(deps(fakeGet().get, store));
    assert.equal(run.status, 'partial');
    assert.deepEqual(run.detail.errors, ['VaR: weekly_prices: permission denied']);
    assert.ok(store.snapshots.length === 2 && store.snapshots.every((row) => !('valueAtRisk' in row)));
    assert.deepEqual(run.detail.snapshots, { days: 2, from: '2026-10-20', to: '2026-10-21' });
  });

  it('loads a VaR proxy from further back than the other securities, and the rates with it', async () => {
    const { get, urls } = fakeGet();
    const run = await runNightly(deps(get, new MemoryStore({ proxies: ['0050'] })));
    const startOf = (piece: string) => new URL(urls.find((url) => url.includes(piece)) ?? 'http://none').searchParams.get('start_date');
    assert.equal(startOf('TaiwanStockPrice'), '2022-10-07');
    assert.equal(startOf('USStockPrice'), '2023-10-07');
    assert.equal(startOf('TaiwanExchangeRate'), '2022-10-07');
    assert.deepEqual(run.detail.window, { start: '2022-10-07', end: TODAY });
  });

  it('keeps the prices and reports a partial run when the snapshots fail', async () => {
    const store = new MemoryStore({ failSnapshots: true });
    const run = await runNightly(deps(fakeGet().get, store));
    assert.equal(run.status, 'partial');
    assert.deepEqual(run.detail.errors, ['NAV snapshots: transactions: permission denied']);
    assert.equal(run.detail.snapshots, undefined);
    assert.ok(store.prices.length > 0);
  });

  it('skips the 25 MB fund download once the saved history covers the window', async () => {
    const { get, urls } = fakeGet();
    await runNightly(deps(get, new MemoryStore({ earliestAggu: '2023-01-02' })));
    assert.ok(!urls.some((url) => url.includes('get-fund-document')));
  });

  it("falls back to Alpha Vantage for a US close, only filling days FinMind's adjusted history lacks", async () => {
    const store = new MemoryStore();
    const run = await runNightly(deps(fakeGet((key) => key === 'USStockPrice VT').get, store, 'av-key'));
    assert.equal(run.status, 'ok');
    assert.deepEqual(store.fills.map((p) => `${p.ticker} ${p.date} ${p.source}`), ['VT 2026-10-20 alphavantage']);
    assert.match(run.detail.warnings.join('\n'), /VT: finmind: HTTP 503/);
  });

  it('runs on the fallbacks when FinMind is down, and reports what is still missing', async () => {
    const store = new MemoryStore();
    const run = await runNightly(deps(fakeGet(finmindDown).get, store));
    assert.equal(run.status, 'partial');
    assert.deepEqual(run.detail.prices['0050'], { source: 'twse', rows: 1, latest: '2026-10-21' });
    assert.equal(store.prices.find((p) => p.ticker === '0050')?.adjClose, 108.15);
    assert.deepEqual(run.detail.rates['USD/TWD'], { source: 'fred', rows: 1, latest: '2026-10-16' });
    assert.deepEqual(
      run.detail.errors.map((line) => line.split(':')[0]),
      ['VT', 'XAU/USD'],
    );
  });

  it('records a failed run when nothing could be loaded', async () => {
    const store = new MemoryStore();
    const run = await runNightly(deps(fakeGet(() => true).get, store));
    assert.equal(run.status, 'failed');
    assert.equal(store.runs.length, 1);
    assert.deepEqual([...new Set(run.detail.errors.map((line) => line.split(':')[0]))], ['0050', 'VT', 'AGGU', 'USD/TWD', 'XAU/USD']);
  });

  it('records a failed run when the database cannot be read', async () => {
    const store = new MemoryStore({ failRead: true });
    const run = await runNightly(deps(fakeGet().get, store));
    assert.equal(run.status, 'failed');
    assert.deepEqual(run.detail.errors, ['reading the database: connection refused']);
  });
});
