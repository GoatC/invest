/**
 * The nightly price and FX job (PRD Phase 1, step 4). It loads daily closes for every security,
 * Bank of Taiwan exchange rates and the gold price into Supabase, with one fallback per feed
 * (PRD Section 9, "free data breaks"), then saves each day's NAV snapshot (F18, step 5) with its
 * 1-week VaR (N4, step 7), evaluates the rules and drafts their proposals (PRD Section 4, step 9),
 * and records the outcome in job_runs. Since Phase 2, step 1 it also loads the monthly market
 * series the windfall planner reads (F3): CAPE, the S&P 500's price and its dividend yield. Since
 * step 2 it loads the Regression Lab's (N1) index closes and the US 3-month bill rate, reaches
 * back over its longest window, and saves the holdings' β once a month. Everything outside this
 * file is injected, so the whole run can be tested without a network or a database.
 */
import { BETAS_ERROR, RISK_ERROR, RULES_ERROR, SNAPSHOT_ERROR } from '../../../lib/models/data-health.ts';
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
  try {
    const [found, years, earliestTrade, riskProxies, regression] = await Promise.all([
      store.securities(),
      store.lookbackYears(),
      store.earliestTradeDate(),
      store.riskProxies(),
      store.regressionYears(),
    ]);
    securities = found;
    regressionYears = regression;
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

  try {
    await store.savePrices(unique(prices, (row) => `${row.ticker}|${row.date}`));
    await store.savePrices(unique(fills, (row) => `${row.ticker}|${row.date}`), { fillOnly: true });
    await store.saveRates(unique(rates, (row) => `${row.pair}|${row.date}`));
    await store.saveSeries(unique(series, (point) => `${point.series}|${point.month}`));
    if (indexRows.length > 0) await store.saveIndexPrices(unique(indexRows, (row) => `${row.index}|${row.date}`));
    if (indexFills.length > 0) await store.saveIndexPrices(unique(indexFills, (row) => `${row.index}|${row.date}`), { fillOnly: true });
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
