/**
 * The nightly price and FX job (PRD Phase 1, step 4). It loads daily closes for every security,
 * Bank of Taiwan exchange rates and the gold price into Supabase, with one fallback per feed
 * (PRD Section 9, "free data breaks"), then saves each day's NAV snapshot (F18, step 5) with its
 * 1-week VaR (N4, step 7), evaluates the rules and drafts their proposals (PRD Section 4, step 9),
 * and records the outcome in job_runs. Since Phase 2, step 1 it also loads the monthly market
 * series the windfall planner reads (F3): CAPE, the S&P 500's price and its dividend yield. Since
 * step 2 it loads the Regression Lab's (N1) index closes and the US 3-month bill rate, reaches
 * back over its longest window, and saves the holdings' β once a month. Since step 3 it loads the
 * cost of equity's (F11) 10-year yields and Damodaran's implied ERP. Since step 4 it loads the
 * filings of the single stocks held or watched (F12): SEC EDGAR's company facts for US stocks,
 * FinMind's three statements for Taiwan ones, and values a watched stock again once a new quarter
 * is in, before the rules read it. Since step 5 it reads the red-flag indicator's feeds (N3): each
 * night the TWSE company profiles and material announcements, and on a company's scan day its SEC
 * 8-K items and going-concern search, or its Ministry of Environment penalties; then it saves the
 * week's scan of each company due one, before the rules read it. Everything outside this file
 * is injected, so the whole run can be tested without a network or a database.
 */
import type { ProfileRecord } from '../../../lib/data.ts';
import { BETAS_ERROR, RED_FLAGS_ERROR, RISK_ERROR, RULES_ERROR, SNAPSHOT_ERROR, VALUATIONS_ERROR } from '../../../lib/models/data-health.ts';
import { windowStart as flagWindow, type EventIndicator, type RedFlagSettings } from '../../../lib/models/red-flags.ts';
import { quarterFigures, type Fact, type Figures } from '../../../lib/models/fundamentals.ts';
import { buildSeries, snapshots, type PerformanceInput, type Snapshot } from '../../../lib/models/performance.ts';
import { dailyValueAtRisk, gridStart, lookbackWeeks, type RiskInput } from '../../../lib/models/risk.ts';
import { RISK_FREE_SERIES } from '../../../lib/models/regression.ts';
import { MARKET_SERIES } from '../../../lib/models/windfall.ts';
import { avDaily, avSymbol, avUrl, avWeeklyAdjusted } from '../feeds/alphavantage.ts';
import { adjustForDividends, bankOfTaiwanRates, exDividendFactors, FinMind, goldCloses, splitFactors, taiwanPrices, usPrices } from '../feeds/finmind.ts';
import { FRED_SERIES, fredMonthly, fredRates, fredUrl } from '../feeds/fred.ts';
import { INDICES, indexAttempts, type IndexClose } from '../feeds/indices.ts';
import { downloadLink, ISHARES_FUNDS, navFromProductPage, navHistory } from '../feeds/ishares.ts';
import { multplMonthly, multplUrl } from '../feeds/multpl.ts';
import { SHILLER_PAGE, shillerLink, shillerSeries } from '../feeds/shiller.ts';
import { CBC_CAPITAL_MARKET_RATES, cbcTenYear, DAMODARAN_ERP, damodaranErp, fredTenYear, treasuryTenYear, treasuryUrl, TW_GOVT_10Y, US_IMPLIED_ERP, US_TREASURY_10Y } from '../feeds/yields.ts';
import { companyFactsUrl, SEC_TICKERS, secCiks, secFacts } from '../feeds/sec.ts';
import { finmindStatements, STATEMENT_DATASETS } from '../feeds/statements.ts';
import { auditorChange, fullTextUrl, moenvPenalties, moenvUrl, secGoingConcern, secSubmissions, submissionsUrl, TWSE_MATERIAL, TWSE_PROFILES, twseMaterial, twseProfiles, type FeedEvent } from '../feeds/redflags.ts';
import { STOCK_DAY_ALL, twseCloses } from '../feeds/twse.ts';
import { FeedError, type DailyPrice, type DailyRate, type Get, type GetBytes, type MonthlyPoint } from '../feeds/types.ts';

export const JOB = 'nightly_prices';
/** Recent days of gold prices to load; valuing gold needs only the latest. */
const GOLD_DAYS = 7;
/** Labels of the errors about the database itself rather than a feed (setup problems, no tickers in them). */
export const DATABASE_ERRORS = ['reading the database', 'saving'] as const;

export interface Security {
  ticker: string;
  market: string;
  currency: string;
}

/** One quarter end of a stock's filings, as the fundamentals table keeps it. */
export interface FundamentalRow {
  ticker: string;
  periodEnd: string;
  figures: Figures;
  currency: string;
  filed: string | null;
  source: string;
}

export interface Store {
  securities(): Promise<Security[]>;
  earliestTradeDate(): Promise<string | undefined>;
  /** config var.lookback_years: the years of history the VaR card (N4) reads. */
  lookbackYears(): Promise<number>;
  /** The tickers that can stand as VaR proxies: each class's benchmark ETF and the theme ETFs (N4). */
  riskProxies(): Promise<string[]>;
  earliestPriceDate(ticker: string): Promise<string | undefined>;
  /** fillOnly: add missing days without overwriting saved ones (for feeds without dividend adjustment). */
  savePrices(rows: readonly DailyPrice[], options?: { fillOnly?: boolean }): Promise<void>;
  saveRates(rows: readonly DailyRate[]): Promise<void>;
  /** Upserts monthly market series (market_series), one row per series and month. */
  saveSeries(rows: readonly MonthlyPoint[]): Promise<void>;
  /** The Regression Lab's longest window in years (config regression); undefined before its migration. */
  regressionYears(): Promise<number | undefined>;
  /** Upserts daily index closes (index_prices); fillOnly adds missing days only. */
  saveIndexPrices(rows: readonly IndexClose[], options?: { fillOnly?: boolean }): Promise<void>;
  /** Whether config capm exists (F11, Phase 2 step 3): false before its migration. */
  capmReady(): Promise<boolean>;
  /** The single stocks whose filings to load (F12): held or watched, and their peers; undefined before config valuation exists. */
  filingTickers(): Promise<Array<{ ticker: string; market: string }> | undefined>;
  /** Upserts each stock's quarters (fundamentals), one row per stock and quarter end. */
  saveFundamentals(rows: readonly FundamentalRow[]): Promise<void>;
  /** Values every watched stock with a quarter newer than its last value (revalueOnFilings in lib/data). */
  revalue(today: string): Promise<{ valued: string[] } | undefined>;
  /** The single stocks the red-flag indicator lights (N3), their profiles and whether each is due a scan; undefined before config red_flags. */
  redFlagCompanies(today: string): Promise<{ settings: RedFlagSettings; companies: Array<{ ticker: string; market: string; due: boolean; profile: ProfileRecord | null }> } | undefined>;
  /** Upserts each company's profile (company_profiles). */
  saveProfiles(rows: readonly ProfileRecord[]): Promise<void>;
  /** Adds the events the feeds found (red_flag_events); one already saved is left as it is. */
  saveFlagEvents(rows: readonly FeedEvent[]): Promise<void>;
  /** Saves today's scan of each company asked for (scanRedFlags in lib/data). */
  scanRedFlags(today: string, tickers: readonly string[]): Promise<{ scanned: string[] }>;
  /** Saves each holding's β at the default settings, once a month: undefined when this month's are saved already (refreshBetas in lib/data). */
  refreshBetas(today: string): Promise<{ saved: number; runDate: string } | undefined>;
  /** What F18 needs to value the portfolio on each day up to `end` (loadPerformanceInput in lib/data). */
  performanceInput(end: string): Promise<PerformanceInput>;
  /** What the VaR of each day from `from` to `end` reads besides the holdings (loadRiskInput in lib/data). */
  riskInput(from: string, end: string): Promise<RiskInput>;
  /** Saves one NAV snapshot per day and drops any from before the first (left by trades since deleted). */
  saveSnapshots(rows: readonly Snapshot[]): Promise<void>;
  /** Evaluates every rule as of `now` and saves the proposals it drafts and closes (runRules in lib/data). */
  evaluateRules(today: string, now: string): Promise<{ created: number; closed: number }>;
  recordRun(run: JobRun): Promise<void>;
}

type Loaded = { source: string; rows: number; latest: string };

export interface RunDetail {
  window: { start: string; end: string };
  prices: Record<string, Loaded>;
  rates: Record<string, Loaded>;
  /** The monthly market series (F3); `latest` is a month, YYYY-MM. */
  series?: Record<string, Loaded>;
  /** The daily index closes (N1). */
  indices?: Record<string, Loaded>;
  /** The single stocks' quarters (F12); `latest` is a quarter end. */
  filings?: Record<string, Loaded>;
  /** Primary feeds that failed while a fallback covered for them. */
  warnings: string[];
  /** Data that could not be loaded at all. */
  errors: string[];
  /** The NAV snapshots saved, once anything was bought or recorded, and how many carry a VaR. */
  snapshots?: { days: number; from: string; to: string; valueAtRisk?: number };
  /** Proposals the rules drafted and closed after the refresh. */
  rules?: { created: number; closed: number };
  /** The holdings' β saved for the month (N1), on the month's first run. */
  betas?: { saved: number; runDate: string };
  /** The watched stocks valued again after a new filing (F12). */
  valued?: string[];
  /** The red-flag indicator (N3): the companies scanned tonight, and the events the feeds found. */
  redFlags?: { scanned: string[]; events: number };
}

export interface JobRun {
  job: string;
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'partial' | 'failed';
  detail: RunDetail;
}

export interface Deps {
  get: Get;
  /** For Shiller's binary workbook; without it the series come from multpl. */
  getBytes?: GetBytes;
  store: Store;
  finmindToken: string;
  alphaVantageKey?: string;
  /** The User-Agent SEC EDGAR is sent: a name and a contact email (its fair-access policy); without it US filings are skipped. */
  secUserAgent?: string;
  /** The Ministry of Environment open-data key (N3); without it Taiwan penalties are not checked. */
  moenvKey?: string;
  /** Today's date in Taipei. */
  today: string;
  now: () => Date;
}

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The first day to load: the lookback years before today with two weeks to spare, or the earliest trade if that is older. */
export function windowStart(today: string, lookbackYears: number, earliestTrade?: string): string {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - lookbackYears);
  const iso = addDays(start.toISOString().slice(0, 10), -14);
  return earliestTrade && earliestTrade < iso ? earliestTrade : iso;
}

/**
 * The first day to load for a VaR proxy (N4): a whole window of weekly returns before the first
 * trade, or before a year ago if that is earlier, so every snapshot day and the 52-week line have
 * their own three years; two weeks to spare.
 */
export function riskWindowStart(today: string, weeks: number, earliestTrade?: string): string {
  const yearAgo = addDays(today, -364);
  return addDays(gridStart(earliestTrade && earliestTrade < yearAgo ? earliestTrade : yearAgo, weeks), -14);
}

/** Years of filings to load: the own range of multiples (5) and the year before it, with one to spare. */
const FILING_YEARS = 7;

/** Months of F11's yields and ERP to load each night: a year and the month before it. */
const CAPM_MONTHS = 13;

/** The first day of the month `months` before today's. */
export function monthsBefore(today: string, months: number): string {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 - months, 1)).toISOString().slice(0, 10);
}

/** XAU/TWD (TWD per troy ounce) for each gold close, at that day's USD/TWD rate or the latest one before it. */
export function goldInTwd(gold: readonly DailyRate[], usdTwd: readonly DailyRate[]): DailyRate[] {
  const newestFirst = [...usdTwd].sort((a, b) => b.date.localeCompare(a.date));
  return gold.flatMap((close) => {
    const fx = newestFirst.find((rate) => rate.date <= close.date);
    return fx ? [{ pair: 'XAU/TWD', date: close.date, rate: Math.round(close.rate * fx.rate * 1e4) / 1e4, source: close.source }] : [];
  });
}

/** One row per key; the later row wins, as an upsert would. */
function unique<T>(rows: readonly T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Attempt<T> = { source: string; load: () => Promise<T[]>; fillOnly?: boolean };

/** Tries each feed in turn; the first with rows wins, and the failures before it become warnings. */
async function firstWorking<T>(label: string, attempts: ReadonlyArray<Attempt<T>>, detail: RunDetail): Promise<{ rows: T[]; source: string; fillOnly: boolean } | undefined> {
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const rows = await attempt.load();
      if (rows.length > 0) {
        detail.warnings.push(...failures);
        return { rows, source: attempt.source, fillOnly: attempt.fillOnly ?? false };
      }
      failures.push(`${label}: ${attempt.source} returned no data`);
    } catch (err) {
      failures.push(`${label}: ${attempt.source}: ${message(err)}`);
    }
  }
  detail.errors.push(...(failures.length > 0 ? failures : [`${label}: no feed covers it`]));
  return undefined;
}

function latest(rows: ReadonlyArray<{ date: string }>): string {
  return rows.reduce((max, row) => (row.date > max ? row.date : max), '');
}

export async function runNightly(deps: Deps): Promise<JobRun> {
  const startedAt = deps.now().toISOString();
  const { get, store, today } = deps;
  const finmind = new FinMind(get, deps.finmindToken);
  const avKey = deps.alphaVantageKey;
  const detail: RunDetail = { window: { start: today, end: today }, prices: {}, rates: {}, series: {}, warnings: [], errors: [] };
  const finish = async (status: JobRun['status']): Promise<JobRun> => {
    const run: JobRun = { job: JOB, startedAt, finishedAt: deps.now().toISOString(), status, detail };
    await store.recordRun(run);
    return run;
  };

  let securities: Security[];
  let start: string;
  let riskStart: string;
  let proxies: Set<string>;
  let regressionYears: number | undefined;
  let capm: boolean;
  let filingTickers: Array<{ ticker: string; market: string }> | undefined;
  let flagCompanies: Awaited<ReturnType<Store['redFlagCompanies']>>;
  try {
    const [found, years, earliestTrade, riskProxies, regression, capmReady, filers, flagged] = await Promise.all([
      store.securities(),
      store.lookbackYears(),
      store.earliestTradeDate(),
      store.riskProxies(),
      store.regressionYears(),
      store.capmReady(),
      store.filingTickers(),
      store.redFlagCompanies(today),
    ]);
    filingTickers = filers;
    flagCompanies = flagged;
    securities = found;
    regressionYears = regression;
    capm = capmReady;
    // Every security reaches back over the VaR's years or the Regression Lab's longest window (N1).
    start = windowStart(today, Math.max(years, regression ?? 0), earliestTrade);
    riskStart = riskWindowStart(today, lookbackWeeks({ lookbackYears: years }), earliestTrade);
    proxies = new Set(riskProxies);
  } catch (err) {
    detail.errors.push(`${DATABASE_ERRORS[0]}: ${message(err)}`);
    return finish('failed');
  }
  // The VaR proxies reach further back; the rates cover the earliest of both.
  const earliest = riskStart < start ? riskStart : start;
  detail.window = { start: earliest, end: today };
  const range = { start: earliest, end: today };
  const inWindow = (row: { date: string }) => row.date >= earliest && row.date <= today;

  // TWSE lists every Taiwan close of the last trading day in one reply, fetched only if needed.
  let twseAll: Promise<string> | undefined;
  const twseReply = () => (twseAll ??= get(STOCK_DAY_ALL));

  const prices: DailyPrice[] = [];
  const fills: DailyPrice[] = [];
  for (const { ticker, market } of securities) {
    const from = proxies.has(ticker) ? earliest : start;
    const span = { start: from, end: today };
    const attempts: Array<Attempt<DailyPrice>> = [];
    const symbol = avSymbol(ticker, market);
    if (market === 'TW') {
      attempts.push({
        source: 'finmind',
        load: async () => {
          const [closes, dividends] = await Promise.all([
            finmind.rows('TaiwanStockPrice', { dataId: ticker, ...span }),
            finmind.rows('TaiwanStockDividendResult', { dataId: ticker, ...span }),
          ]);
          const prices = taiwanPrices(closes, ticker);
          const events = exDividendFactors(dividends);
          return adjustForDividends(prices, [...events, ...splitFactors(prices, events)]);
        },
      });
      // The last trading day's close is also its adjusted close: no ex-date follows it yet.
      attempts.push({ source: 'twse', load: async () => twseCloses(await twseReply(), new Set([ticker])).map((p) => ({ ...p, adjClose: p.close })) });
    } else if (market === 'US') {
      attempts.push({ source: 'finmind', load: async () => usPrices(await finmind.rows('USStockPrice', { dataId: ticker, ...span }), ticker) });
      if (avKey && symbol) {
        attempts.push({ source: 'alphavantage', fillOnly: true, load: async () => avDaily(await get(avUrl('TIME_SERIES_DAILY', symbol, avKey)), ticker) });
      }
    } else {
      const fund = ISHARES_FUNDS[ticker];
      if (fund) {
        attempts.push({
          source: 'ishares_nav',
          load: async () => {
            const page = await get(fund.productPage);
            const newest = navFromProductPage(page, ticker);
            // The 25 MB fund download is needed only while the saved history is shorter than the window.
            const saved = await store.earliestPriceDate(ticker);
            if (newest && saved && saved <= from) return [newest];
            const history = navHistory(await get(downloadLink(page, fund.productPage) ?? fund.download), ticker);
            return newest ? [...history, newest] : history;
          },
        });
      }
      if (avKey && symbol) {
        attempts.push({ source: 'alphavantage', load: async () => avWeeklyAdjusted(await get(avUrl('TIME_SERIES_WEEKLY_ADJUSTED', symbol, avKey)), ticker) });
      }
    }
    const result = await firstWorking(ticker, attempts, detail);
    const rows = unique(result?.rows.filter((row) => row.date >= from && row.date <= today) ?? [], (row) => row.date);
    if (result && rows.length > 0) {
      (result.fillOnly ? fills : prices).push(...rows);
      detail.prices[ticker] = { source: result.source, rows: rows.length, latest: latest(rows) };
    } else if (result) {
      detail.errors.push(`${ticker}: ${result.source} had nothing from ${from} on`);
    }
  }

  const rates: DailyRate[] = [];
  const currencies = [...new Set(securities.map((security) => security.currency))].filter((currency) => currency !== 'TWD').sort();
  for (const currency of currencies) {
    const pair = `${currency}/TWD`;
    const attempts: Array<Attempt<DailyRate>> = [
      { source: 'finmind', load: async () => bankOfTaiwanRates(await finmind.rows('TaiwanExchangeRate', { dataId: currency, ...range }), currency) },
    ];
    const series = FRED_SERIES[currency];
    if (series) attempts.push({ source: 'fred', load: async () => fredRates(await get(fredUrl(series, earliest)), pair) });
    const result = await firstWorking(pair, attempts, detail);
    const rows = result?.rows.filter(inWindow) ?? [];
    if (result && rows.length > 0) {
      rates.push(...rows);
      detail.rates[pair] = { source: result.source, rows: rows.length, latest: latest(rows) };
    }
  }

  // Gold: USD per ounce, and TWD per ounce at the Bank of Taiwan rate (N5 values physical gold by it).
  const gold = await firstWorking('XAU/USD', [{ source: 'finmind', load: async () => goldCloses(await finmind.rows('GoldPrice', { start: addDays(today, -GOLD_DAYS), end: today })) }], detail);
  if (gold) {
    const inTwd = goldInTwd(gold.rows, rates.filter((rate) => rate.pair === 'USD/TWD'));
    rates.push(...gold.rows, ...inTwd);
    detail.rates['XAU/USD'] = { source: gold.source, rows: gold.rows.length, latest: latest(gold.rows) };
    if (inTwd.length > 0) detail.rates['XAU/TWD'] = { source: gold.source, rows: inTwd.length, latest: latest(inTwd) };
    else detail.errors.push('XAU/TWD: no USD/TWD rate to convert the gold price');
  }

  // Monthly market series (F3): Shiller's workbook once for all three, else multpl's table for each.
  const series: MonthlyPoint[] = [];
  let workbook: Promise<MonthlyPoint[]> | undefined;
  const shiller = () =>
    (workbook ??= (async () => {
      if (!deps.getBytes) throw new FeedError('no binary fetch');
      const link = shillerLink(await get(SHILLER_PAGE));
      if (!link) throw new FeedError('no ie_data.xls link on the data page');
      return shillerSeries(await deps.getBytes(link));
    })());
  for (const name of MARKET_SERIES) {
    const result = await firstWorking(
      name,
      [
        { source: 'shiller', load: async () => (await shiller()).filter((point) => point.series === name) },
        { source: 'multpl', load: async () => multplMonthly(await get(multplUrl(name)), name) },
      ],
      detail,
    );
    if (result) {
      series.push(...result.rows);
      const newest = result.rows.reduce((max, point) => (point.month > max ? point.month : max), '');
      (detail.series ??= {})[name] = { source: result.source, rows: result.rows.length, latest: newest };
    }
  }

  // The Regression Lab (N1): the index closes over its window, and the US bill rate behind R_f.
  const indexRows: IndexClose[] = [];
  const indexFills: IndexClose[] = [];
  if (regressionYears !== undefined) {
    for (const index of INDICES) {
      const result = await firstWorking(index, indexAttempts(index, finmind, get, range), detail);
      const rows = unique(result?.rows.filter(inWindow) ?? [], (row) => row.date);
      if (result && rows.length > 0) {
        (result.fillOnly ? indexFills : indexRows).push(...rows);
        (detail.indices ??= {})[index] = { source: result.source, rows: rows.length, latest: latest(rows) };
      }
    }
    const name = RISK_FREE_SERIES['USD'] as string;
    const bill = await firstWorking(name, [{ source: 'fred', load: async () => fredMonthly(await get(fredUrl('TB3MS', `${earliest.slice(0, 7)}-01`)), name) }], detail);
    if (bill) {
      series.push(...bill.rows);
      (detail.series ??= {})[name] = { source: bill.source, rows: bill.rows.length, latest: bill.rows.reduce((max, point) => (point.month > max ? point.month : max), '') };
    }
  }

  // The cost of equity (F11): each market's 10-year yield behind R_f, and Damodaran's implied ERP.
  if (capm) {
    const since = monthsBefore(today, CAPM_MONTHS);
    const years = [...new Set([since.slice(0, 4), today.slice(0, 4)])].map(Number);
    const feeds: Array<[string, Array<Attempt<MonthlyPoint>>]> = [
      [
        US_TREASURY_10Y,
        [
          { source: 'fred', load: async () => fredTenYear(await get(fredUrl('DGS10', since))) },
          { source: 'treasury', load: async () => (await Promise.all(years.map(async (year) => treasuryTenYear(await get(treasuryUrl(year)))))).flat() },
        ],
      ],
      [TW_GOVT_10Y, [{ source: 'cbc', load: async () => cbcTenYear(await get(CBC_CAPITAL_MARKET_RATES)) }]],
      [
        US_IMPLIED_ERP,
        [
          {
            source: 'damodaran',
            load: async () => {
              if (!deps.getBytes) throw new FeedError('no binary fetch');
              return damodaranErp(await deps.getBytes(DAMODARAN_ERP));
            },
          },
        ],
      ],
    ];
    for (const [name, attempts] of feeds) {
      const result = await firstWorking(name, attempts, detail);
      const rows = unique(result?.rows.filter((point) => point.month >= since.slice(0, 7) && point.month <= today.slice(0, 7)) ?? [], (point) => point.month);
      if (result && rows.length > 0) {
        series.push(...rows);
        (detail.series ??= {})[name] = { source: result.source, rows: rows.length, latest: rows.reduce((max, point) => (point.month > max ? point.month : max), '') };
      } else if (result) {
        detail.errors.push(`${name}: ${result.source} had nothing from ${since.slice(0, 7)} on`);
      }
    }
  }

  // The filings of the single stocks held or watched (F12), each quarter end's figures.
  const fundamentals: FundamentalRow[] = [];
  const secHeaders = deps.secUserAgent ? { 'User-Agent': deps.secUserAgent } : undefined;
  let ciks: Promise<Map<string, number>> | undefined;
  const cikOf = async (ticker: string) => {
    ciks ??= get(SEC_TICKERS, secHeaders).then(secCiks);
    const cik = (await ciks).get(ticker);
    if (cik === undefined) throw new FeedError(`no SEC filer for ${ticker}`);
    return cik;
  };
  if (filingTickers && filingTickers.length > 0) {
    const since = `${Number(today.slice(0, 4)) - FILING_YEARS}${today.slice(4)}`;
    if (!secHeaders && filingTickers.some((stock) => stock.market === 'US')) detail.errors.push('US filings: SEC_USER_AGENT is not set (a name and a contact email); see docs/nightly-job.md');
    for (const { ticker, market } of filingTickers) {
      const attempts: Array<Attempt<Fact>> = [];
      if (market === 'US' && secHeaders) {
        attempts.push({
          source: 'sec',
          load: async () => secFacts(await get(companyFactsUrl(await cikOf(ticker)), secHeaders)).facts,
        });
      } else if (market === 'TW') {
        attempts.push({
          source: 'finmind',
          load: async () => {
            const span = { dataId: ticker, start: since, end: today };
            const [income, balance, cash, dividends] = await Promise.all(
              [STATEMENT_DATASETS.income, STATEMENT_DATASETS.balance, STATEMENT_DATASETS.cash, STATEMENT_DATASETS.dividends].map((dataset) => finmind.rows(dataset, span)),
            );
            return finmindStatements({ income: income ?? [], balance: balance ?? [], cash: cash ?? [], dividends: dividends ?? [] });
          },
        });
      } else {
        continue;
      }
      const result = await firstWorking(`${ticker} filings`, attempts, detail);
      if (!result) continue;
      const quarters = quarterFigures(result.rows).filter((quarter) => quarter.periodEnd >= since && quarter.periodEnd <= today);
      if (quarters.length === 0) {
        detail.errors.push(`${ticker} filings: ${result.source} had no quarter from ${since} on`);
        continue;
      }
      fundamentals.push(...quarters.map((quarter) => ({ ticker, periodEnd: quarter.periodEnd, figures: quarter.figures, currency: market === 'US' ? 'USD' : 'TWD', filed: quarter.filed, source: result.source })));
      (detail.filings ??= {})[ticker] = { source: result.source, rows: quarters.length, latest: quarters[quarters.length - 1]?.periodEnd ?? '' };
    }
  }

  // The red-flag indicator's feeds (N3): each night TWSE's profiles and the day's announcements,
  // and on a company's scan day its SEC 8-K items and going-concern search, or its penalties.
  const flagEvents: FeedEvent[] = [];
  const profiles: ProfileRecord[] = [];
  if (flagCompanies && flagCompanies.companies.length > 0) {
    const { settings, companies } = flagCompanies;
    const since = flagWindow(today, settings.lookbackYears);
    const check = (profile: ProfileRecord, indicators: readonly EventIndicator[], forwardOnly: boolean) => {
      for (const indicator of indicators) profile.checked[indicator] = { on: today, ...(forwardOnly ? { since: profile.checked[indicator]?.since ?? today } : {}) };
    };
    const taiwan = companies.filter((company) => company.market === 'TW');
    const twTickers = new Set(taiwan.map((company) => company.ticker));
    let twProfiles: ReturnType<typeof twseProfiles> | undefined;
    let material: FeedEvent[] | undefined;
    if (taiwan.length > 0) {
      try {
        twProfiles = twseProfiles(await get(TWSE_PROFILES), twTickers);
      } catch (err) {
        detail.errors.push(`red flags: TWSE company profiles: ${message(err)}`);
      }
      try {
        material = twseMaterial(await get(TWSE_MATERIAL), twTickers);
      } catch (err) {
        detail.errors.push(`red flags: TWSE material announcements: ${message(err)}`);
      }
    }
    for (const company of companies) {
      const profile: ProfileRecord = company.profile
        ? { ...company.profile, checked: { ...company.profile.checked } }
        : { ticker: company.ticker, industryCode: null, industry: null, sic: null, auditor: null, businessId: null, checked: {}, source: company.market === 'US' ? 'sec' : 'twse' };
      let touched = false;
      if (company.market === 'TW') {
        const found = twProfiles?.get(company.ticker);
        if (found) {
          const changed = auditorChange(company.ticker, profile.auditor, found.auditor, today);
          if (changed) flagEvents.push(changed);
          Object.assign(profile, { industryCode: found.industryCode ?? profile.industryCode, industry: found.industry ?? profile.industry, auditor: found.auditor ?? profile.auditor, businessId: found.businessId ?? profile.businessId });
          touched = true;
        }
        if (material) {
          flagEvents.push(...material.filter((event) => event.ticker === company.ticker));
          check(profile, ['auditor_change', 'going_concern', 'restatement'], true);
          touched = true;
        }
        if (company.due && deps.moenvKey && profile.businessId) {
          try {
            flagEvents.push(...moenvPenalties(await get(moenvUrl(deps.moenvKey, profile.businessId)), company.ticker, since));
            check(profile, ['environmental_penalties'], false);
            touched = true;
          } catch (err) {
            detail.errors.push(`${company.ticker} red flags: MOENV penalties: ${message(err)}`);
          }
        }
      } else if (company.market === 'US' && company.due && secHeaders) {
        try {
          const cik = await cikOf(company.ticker);
          const found = secSubmissions(await get(submissionsUrl(cik), secHeaders), company.ticker, since);
          flagEvents.push(...found.events);
          Object.assign(profile, { sic: found.sic ?? profile.sic, industryCode: found.sic !== null ? String(found.sic) : profile.industryCode, industry: found.industry ?? profile.industry });
          check(profile, ['auditor_change', 'restatement'], false);
          touched = true;
          flagEvents.push(...secGoingConcern(await get(fullTextUrl(cik, since, today), secHeaders), company.ticker, cik));
          check(profile, ['going_concern'], false);
        } catch (err) {
          detail.errors.push(`${company.ticker} red flags: SEC: ${message(err)}`);
        }
      }
      if (touched) profiles.push(profile);
    }
    if (taiwan.some((company) => company.due) && !deps.moenvKey) detail.warnings.push('red flags: MOENV_API_KEY is not set, so Taiwan environmental penalties are not checked; see docs/nightly-job.md');
  }

  try {
    await store.savePrices(unique(prices, (row) => `${row.ticker}|${row.date}`));
    await store.savePrices(unique(fills, (row) => `${row.ticker}|${row.date}`), { fillOnly: true });
    await store.saveRates(unique(rates, (row) => `${row.pair}|${row.date}`));
    await store.saveSeries(unique(series, (point) => `${point.series}|${point.month}`));
    if (indexRows.length > 0) await store.saveIndexPrices(unique(indexRows, (row) => `${row.index}|${row.date}`));
    if (indexFills.length > 0) await store.saveIndexPrices(unique(indexFills, (row) => `${row.index}|${row.date}`), { fillOnly: true });
    if (fundamentals.length > 0) await store.saveFundamentals(fundamentals);
    if (profiles.length > 0) await store.saveProfiles(profiles);
    if (flagEvents.length > 0) await store.saveFlagEvents(unique(flagEvents, (event) => `${event.ticker}|${event.indicator}|${event.source}|${event.ref}`));
  } catch (err) {
    detail.errors.push(`${DATABASE_ERRORS[1]}: ${message(err)}`);
    return finish('failed');
  }

  // Every day's NAV from the first trade on, recomputed each night so that an edited trade or a
  // close that arrived late corrects the past, each with its 1-week VaR. A failure here leaves the
  // prices saved; a failure of the VaR alone saves the snapshots and leaves their VaR as it was.
  try {
    const input = await store.performanceInput(today);
    const days = buildSeries(input);
    let valueAtRisk: Map<string, number | null> | undefined;
    const firstDay = days[0]?.date;
    if (firstDay) {
      try {
        valueAtRisk = dailyValueAtRisk(days, input, await store.riskInput(firstDay, today));
      } catch (err) {
        detail.errors.push(`${RISK_ERROR}: ${message(err)}`);
      }
    }
    const rows = snapshots(days, valueAtRisk);
    await store.saveSnapshots(rows);
    const [first, last] = [rows[0], rows[rows.length - 1]];
    if (first && last) {
      detail.snapshots = { days: rows.length, from: first.date, to: last.date };
      if (valueAtRisk) detail.snapshots.valueAtRisk = rows.filter((row) => row.valueAtRisk !== null && row.valueAtRisk !== undefined).length;
    }
  } catch (err) {
    detail.errors.push(`${SNAPSHOT_ERROR}: ${message(err)}`);
  }

  // A watched stock with a new quarter is valued again (F12), so the zone rules read its new value.
  if (filingTickers !== undefined) {
    try {
      const revalued = await store.revalue(today);
      if (revalued && revalued.valued.length > 0) detail.valued = revalued.valued;
    } catch (err) {
      detail.errors.push(`${VALUATIONS_ERROR}: ${message(err)}`);
    }
  }

  // The week's red-flag scan of each company due one (N3), so the two N3 rules read it.
  if (flagCompanies) {
    const due = flagCompanies.companies.filter((company) => company.due).map((company) => company.ticker);
    try {
      const { scanned } = due.length > 0 ? await store.scanRedFlags(today, due) : { scanned: [] };
      detail.redFlags = { scanned, events: flagEvents.length };
    } catch (err) {
      detail.errors.push(`${RED_FLAGS_ERROR}: ${message(err)}`);
    }
  }

  // The data is fresh: evaluate the rules (PRD Section 4, L2 step 1), on the closes just saved.
  try {
    detail.rules = await store.evaluateRules(today, deps.now().toISOString());
  } catch (err) {
    detail.errors.push(`${RULES_ERROR}: ${message(err)}`);
  }
  // Each holding's β at the default settings, once a month, for F11 (N1's monthly refresh).
  if (regressionYears !== undefined) {
    try {
      const betas = await store.refreshBetas(today);
      if (betas) detail.betas = betas;
    } catch (err) {
      detail.errors.push(`${BETAS_ERROR}: ${message(err)}`);
    }
  }
  const saved = prices.length + fills.length + rates.length;
  return finish(saved === 0 ? 'failed' : detail.errors.length > 0 ? 'partial' : 'ok');
}
