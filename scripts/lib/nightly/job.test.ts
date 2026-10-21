import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FeedError, type DailyPrice, type DailyRate, type Get } from '../feeds/types.ts';
import { goldInTwd, runNightly, windowStart, type JobRun, type Security, type Store } from './job.ts';

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

class MemoryStore implements Store {
  prices: DailyPrice[] = [];
  fills: DailyPrice[] = [];
  rates: DailyRate[] = [];
  runs: JobRun[] = [];
  constructor(private readonly options: { failRead?: boolean; earliestAggu?: string } = {}) {}
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
  async earliestPriceDate(ticker: string) {
    return ticker === 'AGGU' ? this.options.earliestAggu : undefined;
  }
  async savePrices(rows: readonly DailyPrice[], options: { fillOnly?: boolean } = {}) {
    (options.fillOnly ? this.fills : this.prices).push(...rows);
  }
  async saveRates(rows: readonly DailyRate[]) {
    this.rates.push(...rows);
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
    assert.deepEqual(run.detail.window, { start: '2023-10-07', end: TODAY });
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
