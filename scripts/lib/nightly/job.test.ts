import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as XLSX from 'xlsx';

import type { ProfileRecord } from '../../../lib/data.ts';
import type { PriceRow } from '../../../lib/models/market.ts';
import type { PerformanceInput, Snapshot } from '../../../lib/models/performance.ts';
import { readLookThroughSettings } from '../../../lib/models/look-through.ts';
import { readRedFlagSettings } from '../../../lib/models/red-flags.ts';
import { fridays, gridStart, type RiskInput } from '../../../lib/models/risk.ts';
import type { IndexClose } from '../feeds/indices.ts';
import type { FeedEvent } from '../feeds/redflags.ts';
import { FeedError, type DailyPrice, type DailyRate, type Get, type GetBytes, type MonthlyPoint } from '../feeds/types.ts';
import { goldInTwd, riskWindowStart, runNightly, windowStart, type FundamentalRow, type FundFileRow, type JobRun, type Security, type Store } from './job.ts';

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
  'USStockPrice XLK': ok([{ date: '2026-10-20', Close: 250.5, Adj_Close: 249.8 }]),
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
  // The Regression Lab's indices (N1): the S&P 500, TAIEX's total return index, and the bill rate.
  'USStockPrice ^GSPC': ok([
    { date: '2026-10-19', Close: 7690.73 },
    { date: '2026-10-20', Close: 7712.57 },
  ]),
  'TaiwanStockTotalReturnIndex TAIEX': ok([
    { date: '2026-10-20', price: 107046.57 },
    { date: '2026-10-21', price: 108422.07 },
  ]),
  'id=SP500': 'observation_date,SP500\n2026-10-19,7690.73\n2026-10-20,.\n',
  MI_INDEX: JSON.stringify([
    { 日期: '1151021', 指數: '發行量加權股價指數', 收盤指數: '46096.23' },
    { 日期: '1151021', 指數: '發行量加權股價報酬指數', 收盤指數: '108,422.07' },
    { 日期: '1151021', 指數: '半導體類指數', 收盤指數: '1,564.79' },
  ]),
  'id=TB3MS': 'observation_date,TB3MS\n2026-08-01,3.72\n2026-09-01,3.94\n',
  // The cost of equity's inputs (F11): the US 10-year from FRED, else the Treasury, and Taiwan's from the Central Bank.
  'id=DGS10': 'observation_date,DGS10\n2025-08-29,4.23\n2025-09-30,4.16\n2026-09-30,5.29\n2026-10-20,.\n2026-10-21,5.00\n',
  'home.treasury.gov': 'Date,"3 Mo","10 Yr"\n10/21/2026,4.22,4.99\n09/30/2026,4.30,5.29\n',
  'cbc.gov.tw': '\uFEFF"月","政府公債-10年期(%)","十年期政府公債次級市場利率(%)"\n"2025-08","-","-"\n"2025M08","1.5","1.50000"\n"2026M07","-","1.90030"\n"2026M08","1.969","1.95500"\n',
  fredgraph: 'observation_date,DEXTAUS\n2026-10-16,32.34\n',
  alphavantage: JSON.stringify({ 'Time Series (Daily)': { '2026-10-20': { '4. close': '157.80' } } }),
  'shillerdata.com': '<a href="https://img1.wsimg.com/blobby/go/x/downloads/ie_data.xls?ver=1">ie_data.xls</a>',
  // One by-month table answers for each series: for the yield, 40.81% and 40.42%.
  'multpl.com': '<table id="datatable"><tr><td>Oct 1, 2026</td><td>40.81</td></tr><tr><td>Sep 1, 2026</td><td>40.42</td></tr></table>',
  // The valuation workbench's filings (F12): SEC's ticker list and a company's facts, FinMind's statements.
  company_tickers: JSON.stringify({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } }),
  // The red-flag feeds (N3): an auditor change in AAPL's 8-Ks, no going-concern 10-K, 2330's TWSE
  // profile with a new audit firm, a restatement among the day's announcements, one penalty.
  'submissions/CIK': JSON.stringify({
    cik: '320193',
    sic: '3571',
    sicDescription: 'Electronic Computers',
    filings: { recent: { accessionNumber: ['0000320193-26-000100'], filingDate: ['2026-09-02'], reportDate: ['2026-09-01'], form: ['8-K'], items: ['4.01,9.01'], primaryDocument: ['a.htm'] } },
  }),
  'efts.sec.gov': JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }),
  t187ap03_L: JSON.stringify([{ 公司代號: '2330', 產業別: '24', 營利事業統一編號: '22099131', 簽證會計師事務所: 'B 事務所' }]),
  t187ap04_L: JSON.stringify([{ 發言日期: '1151019', 發言時間: '170000', 公司代號: '2330', '主旨 ': '公告本公司重編財務報告', 說明: '' }]),
  // The look-through's holdings files (F14): VT's 501 lines over two pages (cut down here), 00692 on Fubon's page.
  'portfolio-holding/stock.json?start=1&': JSON.stringify({ size: 501, asOfDate: '2026-09-30T00:00:00-04:00', fund: { entity: [
    { longName: 'Apple Inc.', ticker: 'AAPL', isin: 'US0378331005', percentWeight: '4.0' },
    { longName: 'Taiwan Semiconductor Manufacturing Co. Ltd.', ticker: '2330', isin: 'TW0002330008', percentWeight: '1.5' },
  ] } }),
  'portfolio-holding/stock.json?start=501&': JSON.stringify({ size: 501, fund: { entity: [{ longName: 'Toyota Motor Corp.', ticker: '7203', isin: 'JP3633400001', percentWeight: '0.3' }] } }),
  'websys.fsit.com.tw': '<p>資料日期：2026/10/28</p><table><tr><td>2330</td><td>台積電</td><td>1,000</td><td>2,000,000</td><td>52.5</td></tr></table>',
  'data.moenv.gov.tw': JSON.stringify([{ document_no: '40-115-070014', penalty_date: '2026-07-28', penalty_money: '6000', transgress_type: '事業廢棄物', fac_name: '台積電' }]),
  companyfacts: JSON.stringify({
    entityName: 'Apple Inc.',
    facts: {
      'us-gaap': {
        NetIncomeLoss: { units: { USD: [{ start: '2025-06-29', end: '2026-06-27', val: 128930, form: '10-Q', filed: '2026-07-31' }, { start: '2012-09-30', end: '2013-09-28', val: 37037, form: '10-K', filed: '2013-10-30' }] } },
        WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [{ start: '2026-03-29', end: '2026-06-27', val: 14715, form: '10-Q', filed: '2026-07-31' }] } },
      },
    },
  }),
  'TaiwanStockFinancialStatements 2330': ok([
    { date: '2026-06-30', type: 'EquityAttributableToOwnersOfParent', origin_name: '淨利（淨損）歸屬於母公司業主', value: 707 },
    { date: '2026-06-30', type: 'EPS', origin_name: '基本每股盈餘', value: 27.27 },
  ]),
  'TaiwanStockBalanceSheet 2330': ok([{ date: '2026-06-30', type: 'EquityAttributableToOwnersOfParent', origin_name: '歸屬於母公司業主之權益合計', value: 6432 }]),
  'TaiwanStockCashFlowsStatement 2330': ok([]),
  'TaiwanStockDividendResult 2330': ok([]),
};

/** The reply keys that are not FinMind datasets. */
const OTHER_FEEDS = new Set(['company_tickers', 'companyfacts', 'portfolio-holding/stock.json?start=1&', 'portfolio-holding/stock.json?start=501&', 'websys.fsit.com.tw', 'submissions/CIK', 'efts.sec.gov', 't187ap03_L', 't187ap04_L', 'data.moenv.gov.tw', 'ishares.com', 'get-fund-document', 'STOCK_DAY_ALL', 'MI_INDEX', 'id=SP500', 'id=TB3MS', 'id=DGS10', 'home.treasury.gov', 'cbc.gov.tw', 'fredgraph', 'alphavantage', 'shillerdata.com', 'multpl.com']);
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

/** Shiller's workbook with two months: its Data sheet's header row, then September and October 2026. */
function shillerWorkbook(): Uint8Array {
  const book = XLSX.utils.book_new();
  const rows = [['Date', 'P', 'D', 'E', 'CPI', 'Fraction', 'Rate GS10', 'Price', 'Dividend', 'Price', 'Earnings', 'Earnings', 'CAPE'], [2026.09, 7669.41, 82, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40.42], [2026.1, 7766.95, 82.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40.81]];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Data');
  return new Uint8Array(XLSX.write(book, { bookType: 'xls', type: 'array' }) as ArrayBuffer);
}
/** Damodaran's ERP by month, dated in Excel's 1904 system: September and October 2026. */
function erpWorkbook(): Uint8Array {
  const book = XLSX.utils.book_new();
  book.Workbook = { WBProps: { date1904: true } };
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Start of month', 'S&P 500', 'T.Bond Rate', 'ERP (T12m)'], [44804, 7686.14, 0.0475, 0.0409], [44834, 7652, 0.0529, 0.037]]), 'Historical ERP');
  return new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
}
/** A Select Sector SPDR holdings file: XLK holds AAPL; the others hold nothing the tests ask about. */
function sectorWorkbook(url: string): Uint8Array {
  const book = XLSX.utils.book_new();
  const rows = [['Fund Name:', 'Select Sector SPDR'], [], ['Name', 'Ticker', 'Identifier', 'Weight'], ...(url.includes('-xlk.') ? [['APPLE INC', 'AAPL', '037833100', 14.6]] : [['OTHER', 'ZZZ', '', 1]])];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'holdings');
  return new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
}
const getBytes: GetBytes = async (url) => (url.includes('ssga.com') ? sectorWorkbook(url) : url.includes('adamodar') ? erpWorkbook() : shillerWorkbook());
const bytesDown: GetBytes = async () => {
  throw new FeedError('HTTP 403 from img1.wsimg.com');
};

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

/** config red_flags as seeded, the parts the job reads. */
const RED_FLAG_SETTINGS = {
  lookback_years: 3,
  scan_days: 7,
  beneish: { red_above: -1.78 },
  altman: { z: { red_below: 1.81, amber_below: 2.99 }, z2: { red_below: 1.1, amber_below: 2.6 } },
  cash_flow_years: 3,
  governance: { bottom_share: 0.35 },
  manufacturing: { sic: [[2000, 3999]], tw_industries: ['24'] },
  financial: { sic: [[6000, 6799]], tw_industries: ['17'] },
  excluded: { industries: [], tickers: [] },
  last_verified: null,
};

class MemoryStore implements Store {
  prices: DailyPrice[] = [];
  fills: DailyPrice[] = [];
  rates: DailyRate[] = [];
  series: MonthlyPoint[] = [];
  indices: IndexClose[] = [];
  indexFills: IndexClose[] = [];
  betaRuns: string[] = [];
  fundamentals: FundamentalRow[] = [];
  /** When the watched stocks were valued again, and how many quarters were saved by then. */
  revalues: Array<{ today: string; quartersSaved: number }> = [];
  runs: JobRun[] = [];
  snapshots: Snapshot[] = [];
  /** When the rules were evaluated, and how many snapshots were saved by then. */
  ruleRuns: Array<{ today: string; now: string; snapshotsSaved: number }> = [];
  constructor(
    private readonly options: {
      failRead?: boolean;
      earliestAggu?: string;
      failSnapshots?: boolean;
      proxies?: string[];
      riskHistory?: PriceRow[];
      failRisk?: boolean;
      failRules?: boolean;
      /** config regression's longest window plus a year (N1); undefined before its migration. */
      regressionYears?: number;
      failBetas?: boolean;
      /** Whether config capm exists (F11). */
      capm?: boolean;
      /** The single stocks whose filings to load (F12); undefined before config valuation exists. */
      filings?: Array<{ ticker: string; market: string }>;
      failRevalue?: boolean;
      /** The companies N3 lights (undefined before config red_flags), with the profile saved for each. */
      flags?: Array<{ ticker: string; market: string; due: boolean; profile: ProfileRecord | null }>;
      /** The look-through's plan (F14); undefined before config look_through. */
      look?: { due: Array<{ fund: string; source: 'vanguard' | 'fubon'; id: string }>; stocks: Array<{ ticker: string; market: string; sector: string | null }> };
      /** The sector tab's proxies (N7); undefined before config sectors. */
      sectors?: Array<{ id: string; market: 'US' | 'TW'; symbol: string; name: string }>;
    } = {},
  ) {}
  async sectorProxies() {
    return this.options.sectors;
  }
  fundFiles: FundFileRow[] = [];
  sectors: Array<{ ticker: string; market: string; sector: string }> = [];
  async lookThroughPlan() {
    const settings = readLookThroughSettings({ sources: {}, fund_country: {}, refresh_days: 28, top_companies: 30, tw_sectors: { '24': 'Information Technology' }, last_verified: null });
    return this.options.look && settings ? { settings, ...this.options.look } : undefined;
  }
  async saveFundFile(file: FundFileRow) {
    this.fundFiles.push(file);
  }
  async saveSectors(rows: ReadonlyArray<{ ticker: string; market: string; sector: string }>) {
    this.sectors.push(...rows);
  }
  profiles: ProfileRecord[] = [];
  flagEvents: FeedEvent[] = [];
  /** When the red flags were scanned, and whether the rules had run by then. */
  scans: Array<{ today: string; tickers: string[]; rulesRun: number }> = [];
  async redFlagCompanies() {
    const settings = readRedFlagSettings(RED_FLAG_SETTINGS);
    return this.options.flags && settings ? { settings, companies: this.options.flags } : undefined;
  }
  async saveProfiles(rows: readonly ProfileRecord[]) {
    this.profiles.push(...rows);
  }
  async saveFlagEvents(rows: readonly FeedEvent[]) {
    this.flagEvents.push(...rows);
  }
  async scanRedFlags(today: string, tickers: readonly string[]) {
    this.scans.push({ today, tickers: [...tickers], rulesRun: this.ruleRuns.length });
    return { scanned: [...tickers] };
  }
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
  async saveSeries(rows: readonly MonthlyPoint[]) {
    this.series.push(...rows);
  }
  async regressionYears() {
    return this.options.regressionYears;
  }
  async capmReady() {
    return this.options.capm ?? false;
  }
  async saveIndexPrices(rows: readonly IndexClose[], options: { fillOnly?: boolean } = {}) {
    (options.fillOnly ? this.indexFills : this.indices).push(...rows);
  }
  async filingTickers() {
    return this.options.filings;
  }
  async saveFundamentals(rows: readonly FundamentalRow[]) {
    this.fundamentals.push(...rows);
  }
  async revalue(today: string) {
    if (this.options.failRevalue) throw new Error('valuations: permission denied');
    this.revalues.push({ today, quartersSaved: this.fundamentals.length });
    return { valued: this.fundamentals.length > 0 ? ['AAPL'] : [] };
  }
  async refreshBetas(today: string) {
    if (this.options.failBetas) throw new Error('beta_results: permission denied');
    this.betaRuns.push(today);
    return { saved: 4, runDate: today };
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
  async evaluateRules(today: string, now: string) {
    if (this.options.failRules) throw new Error('proposals: permission denied');
    this.ruleRuns.push({ today, now, snapshotsSaved: this.snapshots.length });
    return { created: 1, closed: 0 };
  }
  async recordRun(run: JobRun) {
    this.runs.push(run);
  }
}

let clock = 0;
const deps = (get: Get, store: Store, alphaVantageKey?: string, bytes: GetBytes = getBytes) => ({
  get,
  getBytes: bytes,
  store,
  finmindToken: 'token',
  alphaVantageKey,
  today: TODAY,
  now: () => new Date(Date.UTC(2026, 9, 20, 22, 37, clock++)),
});

describe('filings (F12)', () => {
  const filers = [
    { ticker: 'AAPL', market: 'US' },
    { ticker: '2330', market: 'TW' },
  ];

  it("loads US filings from SEC with the contact User-Agent and Taiwan ones from FinMind, then values the watched stocks before the rules", async () => {
    const store = new MemoryStore({ filings: filers });
    const { get } = fakeGet();
    const agents: Array<string | undefined> = [];
    const spy: Get = async (url, headers) => {
      if (url.includes('sec.gov')) agents.push(headers?.['User-Agent']);
      return get(url, headers);
    };
    const run = await runNightly({ ...deps(spy, store), secUserAgent: 'LongViewInvest hugo@example.com' });
    assert.equal(run.status, 'ok', JSON.stringify(run.detail.errors));
    assert.deepEqual(agents, ['LongViewInvest hugo@example.com', 'LongViewInvest hugo@example.com']);
    // The 2013 year is older than the seven years loaded.
    assert.deepEqual(
      store.fundamentals.map((row) => [row.ticker, row.periodEnd, row.currency, row.filed, row.source, row.figures.netIncome, row.figures.shares]),
      [
        ['AAPL', '2026-06-27', 'USD', '2026-07-31', 'sec', 128930, 14715],
        ['2330', '2026-06-30', 'TWD', null, 'finmind', undefined, 26],
      ],
    );
    assert.deepEqual(run.detail.filings, { AAPL: { source: 'sec', rows: 1, latest: '2026-06-27' }, '2330': { source: 'finmind', rows: 1, latest: '2026-06-30' } });
    assert.deepEqual(store.revalues, [{ today: TODAY, quartersSaved: 2 }]);
    assert.deepEqual(run.detail.valued, ['AAPL']);
    assert.equal(store.ruleRuns.length, 1);
  });

  it('skips US filings without SEC_USER_AGENT and says so, and loads nothing before config valuation exists', async () => {
    const store = new MemoryStore({ filings: filers });
    const run = await runNightly(deps(fakeGet().get, store));
    assert.equal(run.status, 'partial');
    assert.ok(run.detail.errors.some((line) => line.startsWith('US filings: SEC_USER_AGENT is not set')));
    assert.deepEqual(Object.keys(run.detail.filings ?? {}), ['2330']);
    const before = new MemoryStore();
    const quiet = await runNightly(deps(fakeGet().get, before));
    assert.equal(quiet.detail.filings, undefined);
    assert.deepEqual(before.revalues, []);
  });

  it('records a failed re-valuation and still checks the rules', async () => {
    const store = new MemoryStore({ filings: filers, failRevalue: true });
    const run = await runNightly({ ...deps(fakeGet().get, store), secUserAgent: 'LongViewInvest hugo@example.com' });
    assert.equal(run.status, 'partial');
    assert.ok(run.detail.errors.includes('Valuations: valuations: permission denied'));
    assert.equal(store.ruleRuns.length, 1);
  });
});

describe('red flags (N3)', () => {
  const twProfile: ProfileRecord = { ticker: '2330', industryCode: '24', industry: '半導體業', sic: null, auditor: 'A 事務所', businessId: '22099131', checked: { restatement: { on: '2026-10-19', since: '2026-10-12' } }, source: 'twse' };
  const flags = [
    { ticker: 'AAPL', market: 'US', due: true, profile: null },
    { ticker: '2330', market: 'TW', due: true, profile: twProfile },
  ];

  it("reads each company's events and profile, then saves the week's scan before the rules", async () => {
    const store = new MemoryStore({ flags });
    const run = await runNightly({ ...deps(fakeGet().get, store), secUserAgent: 'LongViewInvest hugo@example.com', moenvKey: 'KEY' });
    assert.deepEqual(run.detail.errors, []);
    assert.deepEqual(
      store.flagEvents.map((event) => [event.ticker, event.indicator, event.source, event.date]).sort(),
      [
        ['2330', 'auditor_change', 'twse', TODAY],
        ['2330', 'environmental_penalties', 'moenv', '2026-07-28'],
        ['2330', 'restatement', 'twse', '2026-10-19'],
        ['AAPL', 'auditor_change', 'sec', '2026-09-01'],
      ],
    );
    const [aapl, tw] = [store.profiles.find((row) => row.ticker === 'AAPL'), store.profiles.find((row) => row.ticker === '2330')];
    assert.deepEqual([aapl?.sic, aapl?.industry, aapl?.source], [3571, 'Electronic Computers', 'sec']);
    assert.deepEqual(aapl?.checked, { auditor_change: { on: TODAY }, restatement: { on: TODAY }, going_concern: { on: TODAY } });
    // The announcements reach forward only: since keeps the first night they were read.
    assert.deepEqual(tw?.checked, { restatement: { on: TODAY, since: '2026-10-12' }, auditor_change: { on: TODAY, since: TODAY }, going_concern: { on: TODAY, since: TODAY }, environmental_penalties: { on: TODAY } });
    assert.equal(tw?.auditor, 'B 事務所');
    assert.deepEqual(store.scans, [{ today: TODAY, tickers: ['AAPL', '2330'], rulesRun: 0 }]);
    assert.deepEqual(run.detail.redFlags, { scanned: ['AAPL', '2330'], events: 4 });
  });

  it('checks SEC and the penalties only on a scan day, says when the MOENV key is missing, and does nothing before config red_flags', async () => {
    const store = new MemoryStore({ flags: flags.map((flag) => ({ ...flag, due: flag.ticker === '2330' })) });
    const { get, urls } = fakeGet();
    const run = await runNightly({ ...deps(get, store), secUserAgent: 'LongViewInvest hugo@example.com' });
    assert.ok(!urls.some((url) => url.includes('submissions') || url.includes('moenv')));
    assert.ok(run.detail.warnings.some((line) => line.startsWith('red flags: MOENV_API_KEY is not set')));
    assert.deepEqual(store.scans.map((row) => row.tickers), [['2330']]);
    const before = new MemoryStore();
    await runNightly(deps(fakeGet().get, before));
    assert.deepEqual([before.profiles, before.scans], [[], []]);
  });
});

describe('look-through (F14)', () => {
  it("reads each due fund's file from its issuer, page by page, with the sectors of its lines, and the held stocks' sectors", async () => {
    const store = new MemoryStore({
      look: {
        due: [
          { fund: 'VT', source: 'vanguard', id: 'VT' },
          { fund: '00692', source: 'fubon', id: '00692' },
        ],
        stocks: [
          { ticker: 'AAPL', market: 'US', sector: null },
          { ticker: '2330', market: 'TW', sector: 'Information Technology' },
        ],
      },
    });
    const run = await runNightly(deps(fakeGet().get, store));
    assert.ok(!run.detail.errors.some((line) => line.includes('holdings')), JSON.stringify(run.detail.errors));
    const vt = store.fundFiles.find((file) => file.fund === 'VT');
    assert.deepEqual(vt?.constituents.map((row) => [row.key, row.sector, row.weight]), [
      ['US:AAPL', 'Information Technology', 0.04],
      ['TW:2330', 'Information Technology', 0.015],
      ['JP:7203', null, 0.003],
    ]);
    assert.equal(vt?.asOf, '2026-09-30');
    assert.deepEqual(store.fundFiles.find((file) => file.fund === '00692')?.constituents.map((row) => [row.key, row.weight]), [['TW:2330', 0.525]]);
    assert.deepEqual(run.detail.holdings, { VT: { source: 'vanguard', rows: 3, latest: '2026-09-30' }, '00692': { source: 'fubon', rows: 1, latest: '2026-10-28' } });
    // 2330's sector is already saved; AAPL's is new.
    assert.deepEqual(store.sectors, [{ ticker: 'AAPL', market: 'US', sector: 'Information Technology' }]);
  });

  it('reads nothing when no file is due and every held stock has its sector', async () => {
    const store = new MemoryStore({ look: { due: [], stocks: [{ ticker: '2330', market: 'TW', sector: 'Information Technology' }] } });
    const { get, urls } = fakeGet();
    await runNightly(deps(get, store));
    assert.ok(!urls.some((url) => url.includes('vanguard') || url.includes('fsit')));
    assert.deepEqual([store.fundFiles, store.sectors], [[], []]);
  });
});

describe('sector proxies (N7)', () => {
  it("loads each Select Sector SPDR fund's and TWSE industry index's closes into the index closes, TWSE's last day filling in for FinMind", async () => {
    const store = new MemoryStore({
      sectors: [
        { id: 'XLK', market: 'US', symbol: 'XLK', name: 'XLK' },
        { id: 'TW_SEMICONDUCTOR', market: 'TW', symbol: 'Semiconductor', name: '半導體類指數' },
      ],
    });
    const run = await runNightly(deps(fakeGet().get, store));
    assert.deepEqual(store.indices.filter((row) => row.index === 'XLK').map((row) => [row.date, row.close, row.source]), [['2026-10-20', 249.8, 'finmind']]);
    assert.deepEqual(store.indexFills.filter((row) => row.index === 'TW_SEMICONDUCTOR').map((row) => [row.date, row.close, row.source]), [['2026-10-21', 1564.79, 'twse']]);
    assert.deepEqual(run.detail.indices?.['XLK'], { source: 'finmind', rows: 1, latest: '2026-10-20' });
    assert.ok(run.detail.warnings.some((line) => line.startsWith('TW_SEMICONDUCTOR: finmind')), JSON.stringify(run.detail.warnings));
  });
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

  it('evaluates the rules once the prices and snapshots are saved, and records what they drafted', async () => {
    const store = new MemoryStore();
    const run = await runNightly(deps(fakeGet().get, store));
    assert.equal(store.ruleRuns.length, 1);
    assert.equal(store.ruleRuns[0]?.today, TODAY);
    assert.equal(store.ruleRuns[0]?.snapshotsSaved, 2);
    assert.match(store.ruleRuns[0]?.now ?? '', /^2026-10-20T22:37:\d{2}\.000Z$/);
    assert.deepEqual(run.detail.rules, { created: 1, closed: 0 });
    assert.equal(run.status, 'ok');
  });

  it('keeps everything saved and reports a partial run when the rules fail', async () => {
    const store = new MemoryStore({ failRules: true });
    const run = await runNightly(deps(fakeGet().get, store));
    assert.equal(run.status, 'partial');
    assert.deepEqual(run.detail.errors, ['Rules: proposals: permission denied']);
    assert.equal(run.detail.rules, undefined);
    assert.ok(store.prices.length > 0 && store.snapshots.length === 2);
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

  it("loads CAPE, the S&P 500's price and its yield from Shiller's workbook, else from multpl", async () => {
    const store = new MemoryStore();
    const run = await runNightly(deps(fakeGet().get, store));
    assert.deepEqual(run.detail.series?.['us_cape'], { source: 'shiller', rows: 2, latest: '2026-10' });
    assert.deepEqual(
      store.series.filter((point) => point.month === '2026-10').map((point) => [point.series, Math.round(point.value * 1e4) / 1e4]),
      [
        ['us_cape', 40.81],
        ['sp500_price', 7766.95],
        ['sp500_yield', 0.0106],
      ],
    );
    const fallback = new MemoryStore();
    const second = await runNightly(deps(fakeGet().get, fallback, undefined, bytesDown));
    assert.equal(second.status, 'ok');
    assert.deepEqual(second.detail.series?.['sp500_price'], { source: 'multpl', rows: 2, latest: '2026-10' });
    assert.match(second.detail.warnings.join('\n'), /us_cape: shiller: HTTP 403/);
  });

  it('loads the indices and the bill rate over the Regression Lab window, then saves the month\'s β (N1)', async () => {
    const store = new MemoryStore({ regressionYears: 6 });
    const { get, urls } = fakeGet();
    const run = await runNightly(deps(get, store));
    assert.equal(run.status, 'ok', JSON.stringify(run.detail));
    // Six years back with two weeks to spare reaches before the VaR proxies' window.
    assert.deepEqual(run.detail.window, { start: '2020-10-07', end: TODAY });
    assert.equal(new URL(urls.find((url) => url.includes('USStockPrice') && url.includes('VT')) ?? 'http://none').searchParams.get('start_date'), '2020-10-07');
    assert.deepEqual(
      store.indices.map((row) => `${row.index} ${row.date} ${row.close} ${row.source}`),
      ['SPX 2026-10-19 7690.73 finmind', 'SPX 2026-10-20 7712.57 finmind', 'TAIEX 2026-10-20 107046.57 finmind', 'TAIEX 2026-10-21 108422.07 finmind'],
    );
    assert.deepEqual(run.detail.indices?.['TAIEX'], { source: 'finmind', rows: 2, latest: '2026-10-21' });
    assert.deepEqual(
      store.series.filter((point) => point.series === 'us_tbill_3m').map((point) => [point.month, point.value]),
      [
        ['2026-08', 0.0372],
        ['2026-09', 0.0394],
      ],
    );
    assert.deepEqual(store.betaRuns, [TODAY]);
    assert.deepEqual(run.detail.betas, { saved: 4, runDate: TODAY });
  });

  it("falls back to FRED for the S&P 500 and to TWSE's daily report for TAIEX, filling missing days only", async () => {
    const store = new MemoryStore({ regressionYears: 6 });
    const run = await runNightly(deps(fakeGet((key) => key === 'USStockPrice ^GSPC' || key === 'TaiwanStockTotalReturnIndex TAIEX').get, store));
    assert.deepEqual(store.indices.map((row) => `${row.index} ${row.date} ${row.source}`), ['SPX 2026-10-19 fred']);
    assert.deepEqual(store.indexFills.map((row) => `${row.index} ${row.date} ${row.close} ${row.source}`), ['TAIEX 2026-10-21 108422.07 twse']);
    assert.match(run.detail.warnings.join('\n'), /SPX: finmind: HTTP 503[\s\S]*TAIEX: finmind: HTTP 503/);
  });

  it('keeps everything else and reports a partial run when the β cannot be saved', async () => {
    const run = await runNightly(deps(fakeGet().get, new MemoryStore({ regressionYears: 6, failBetas: true })));
    assert.equal(run.status, 'partial');
    assert.deepEqual(run.detail.errors, ['Betas: beta_results: permission denied']);
  });

  it('leaves the indices, the bill rate and the β alone before the Regression Lab migration', async () => {
    const store = new MemoryStore();
    const { get, urls } = fakeGet();
    const run = await runNightly(deps(get, store));
    assert.ok(!urls.some((url) => url.includes('GSPC') || url.includes('TB3MS') || url.includes('MI_INDEX')));
    assert.equal(run.detail.indices, undefined);
    assert.deepEqual(store.betaRuns, []);
  });

  it("loads a year of the 10-year yields and Damodaran's implied ERP for the cost of equity (F11)", async () => {
    const store = new MemoryStore({ capm: true });
    const { get, urls } = fakeGet();
    const run = await runNightly(deps(get, store));
    assert.equal(run.status, 'ok', JSON.stringify(run.detail));
    assert.equal(new URL(urls.find((url) => url.includes('id=DGS10')) ?? 'http://none').searchParams.get('cosd'), '2025-09-01');
    const of = (name: string) => store.series.filter((point) => point.series === name).map((point) => [point.month, point.value, point.source]);
    // Months from September 2025 on: August 2025 is left out, October 2026 is its newest day so far.
    assert.deepEqual(of('us_treasury_10y'), [
      ['2025-09', 0.0416, 'fred'],
      ['2026-09', 0.0529, 'fred'],
      ['2026-10', 0.05, 'fred'],
    ]);
    assert.deepEqual(of('tw_govt_10y'), [
      ['2026-07', 0.019003, 'cbc'],
      ['2026-08', 0.01955, 'cbc'],
    ]);
    assert.deepEqual(of('us_implied_erp'), [
      ['2026-09', 0.0409, 'damodaran'],
      ['2026-10', 0.037, 'damodaran'],
    ]);
    assert.deepEqual(run.detail.series?.['tw_govt_10y'], { source: 'cbc', rows: 2, latest: '2026-08' });
  });

  it("falls back to the Treasury's yield curve for the US 10-year, and reports the yields it could not load", async () => {
    const store = new MemoryStore({ capm: true });
    const { get, urls } = fakeGet((key) => key === 'id=DGS10' || key === 'cbc.gov.tw');
    const run = await runNightly(deps(get, store, undefined, async () => {
      throw new FeedError('HTTP 403 from pages.stern.nyu.edu');
    }));
    assert.equal(run.status, 'partial');
    assert.deepEqual(urls.filter((url) => url.includes('home.treasury.gov')).map((url) => url.split('/')[7]), ['2025', '2026']);
    assert.deepEqual(store.series.filter((point) => point.series === 'us_treasury_10y').map((point) => [point.month, point.value, point.source]), [
      ['2026-09', 0.0529, 'treasury'],
      ['2026-10', 0.0499, 'treasury'],
    ]);
    assert.match(run.detail.warnings.join('\n'), /us_treasury_10y: fred: HTTP 503/);
    assert.deepEqual(run.detail.errors.map((line) => line.split(':')[0]).filter((label) => label !== 'us_cape' && label !== 'sp500_price' && label !== 'sp500_yield'), ['tw_govt_10y', 'us_implied_erp']);
  });

  it('leaves the yields and the ERP alone before the cost of equity migration', async () => {
    const { get, urls } = fakeGet();
    await runNightly(deps(get, new MemoryStore()));
    assert.ok(!urls.some((url) => url.includes('DGS10') || url.includes('treasury.gov') || url.includes('cbc.gov.tw')));
  });

  it('records a failed run when nothing could be loaded', async () => {
    const store = new MemoryStore();
    const run = await runNightly(deps(fakeGet(() => true).get, store));
    assert.equal(run.status, 'failed');
    assert.equal(store.runs.length, 1);
    assert.deepEqual([...new Set(run.detail.errors.map((line) => line.split(':')[0]))], ['0050', 'VT', 'AGGU', 'USD/TWD', 'XAU/USD', 'us_cape', 'sp500_price', 'sp500_yield']);
  });

  it('records a failed run when the database cannot be read', async () => {
    const store = new MemoryStore({ failRead: true });
    const run = await runNightly(deps(fakeGet().get, store));
    assert.equal(run.status, 'failed');
    assert.deepEqual(run.detail.errors, ['reading the database: connection refused']);
  });
});
