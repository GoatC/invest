/**
 * The nightly price and FX job (PRD Phase 1, step 4). It loads daily closes for every security,
 * Bank of Taiwan exchange rates and the gold price into Supabase, with one fallback per feed
 * (PRD Section 9, "free data breaks"), then saves each day's NAV snapshot (F18, step 5), and
 * records the outcome in job_runs. Everything outside this file is injected, so the whole run can
 * be tested without a network or a database.
 */
import { SNAPSHOT_ERROR } from '../../../lib/models/data-health.ts';
import { buildSeries, snapshots, type PerformanceInput, type Snapshot } from '../../../lib/models/performance.ts';
import { avDaily, avSymbol, avUrl, avWeeklyAdjusted } from '../feeds/alphavantage.ts';
import { adjustForDividends, bankOfTaiwanRates, exDividendFactors, FinMind, goldCloses, taiwanPrices, usPrices } from '../feeds/finmind.ts';
import { FRED_SERIES, fredRates, fredUrl } from '../feeds/fred.ts';
import { downloadLink, ISHARES_FUNDS, navFromProductPage, navHistory } from '../feeds/ishares.ts';
import { STOCK_DAY_ALL, twseCloses } from '../feeds/twse.ts';
import type { DailyPrice, DailyRate, Get } from '../feeds/types.ts';

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
  earliestPriceDate(ticker: string): Promise<string | undefined>;
  /** fillOnly: add missing days without overwriting saved ones (for feeds without dividend adjustment). */
  savePrices(rows: readonly DailyPrice[], options?: { fillOnly?: boolean }): Promise<void>;
  saveRates(rows: readonly DailyRate[]): Promise<void>;
  /** What F18 needs to value the portfolio on each day up to `end` (loadPerformanceInput in lib/data). */
  performanceInput(end: string): Promise<PerformanceInput>;
  /** Saves one NAV snapshot per day and drops any from before the first (left by trades since deleted). */
  saveSnapshots(rows: readonly Snapshot[]): Promise<void>;
  recordRun(run: JobRun): Promise<void>;
}

type Loaded = { source: string; rows: number; latest: string };

export interface RunDetail {
  window: { start: string; end: string };
  prices: Record<string, Loaded>;
  rates: Record<string, Loaded>;
  /** Primary feeds that failed while a fallback covered for them. */
  warnings: string[];
  /** Data that could not be loaded at all. */
  errors: string[];
  /** The NAV snapshots saved, once anything was bought or recorded. */
  snapshots?: { days: number; from: string; to: string };
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
  const detail: RunDetail = { window: { start: today, end: today }, prices: {}, rates: {}, warnings: [], errors: [] };
  const finish = async (status: JobRun['status']): Promise<JobRun> => {
    const run: JobRun = { job: JOB, startedAt, finishedAt: deps.now().toISOString(), status, detail };
    await store.recordRun(run);
    return run;
  };

  let securities: Security[];
  let start: string;
  try {
    const [found, years, earliestTrade] = await Promise.all([store.securities(), store.lookbackYears(), store.earliestTradeDate()]);
    securities = found;
    start = windowStart(today, years, earliestTrade);
  } catch (err) {
    detail.errors.push(`${DATABASE_ERRORS[0]}: ${message(err)}`);
    return finish('failed');
  }
  detail.window = { start, end: today };
  const range = { start, end: today };
  const inWindow = (row: { date: string }) => row.date >= start && row.date <= today;

  // TWSE lists every Taiwan close of the last trading day in one reply, fetched only if needed.
  let twseAll: Promise<string> | undefined;
  const twseReply = () => (twseAll ??= get(STOCK_DAY_ALL));

  const prices: DailyPrice[] = [];
  const fills: DailyPrice[] = [];
  for (const { ticker, market } of securities) {
    const attempts: Array<Attempt<DailyPrice>> = [];
    const symbol = avSymbol(ticker, market);
    if (market === 'TW') {
      attempts.push({
        source: 'finmind',
        load: async () => {
          const [closes, dividends] = await Promise.all([
            finmind.rows('TaiwanStockPrice', { dataId: ticker, ...range }),
            finmind.rows('TaiwanStockDividendResult', { dataId: ticker, ...range }),
          ]);
          return adjustForDividends(taiwanPrices(closes, ticker), exDividendFactors(dividends));
        },
      });
      // The last trading day's close is also its adjusted close: no ex-date follows it yet.
      attempts.push({ source: 'twse', load: async () => twseCloses(await twseReply(), new Set([ticker])).map((p) => ({ ...p, adjClose: p.close })) });
    } else if (market === 'US') {
      attempts.push({ source: 'finmind', load: async () => usPrices(await finmind.rows('USStockPrice', { dataId: ticker, ...range }), ticker) });
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
            const earliest = await store.earliestPriceDate(ticker);
            // The 25 MB fund download is needed only while the saved history is shorter than the window.
            if (newest && earliest && earliest <= start) return [newest];
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
    const rows = unique(result?.rows.filter(inWindow) ?? [], (row) => row.date);
    if (result && rows.length > 0) {
      (result.fillOnly ? fills : prices).push(...rows);
      detail.prices[ticker] = { source: result.source, rows: rows.length, latest: latest(rows) };
    } else if (result) {
      detail.errors.push(`${ticker}: ${result.source} had nothing from ${start} on`);
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
    if (series) attempts.push({ source: 'fred', load: async () => fredRates(await get(fredUrl(series, start)), pair) });
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

  try {
    await store.savePrices(unique(prices, (row) => `${row.ticker}|${row.date}`));
    await store.savePrices(unique(fills, (row) => `${row.ticker}|${row.date}`), { fillOnly: true });
    await store.saveRates(unique(rates, (row) => `${row.pair}|${row.date}`));
  } catch (err) {
    detail.errors.push(`${DATABASE_ERRORS[1]}: ${message(err)}`);
    return finish('failed');
  }

  // Every day's NAV from the first trade on, recomputed each night so that an edited trade or a
  // close that arrived late corrects the past. A failure here leaves the prices saved.
  try {
    const rows = snapshots(buildSeries(await store.performanceInput(today)));
    await store.saveSnapshots(rows);
    const [first, last] = [rows[0], rows[rows.length - 1]];
    if (first && last) detail.snapshots = { days: rows.length, from: first.date, to: last.date };
  } catch (err) {
    detail.errors.push(`${SNAPSHOT_ERROR}: ${message(err)}`);
  }
  const saved = prices.length + fills.length + rates.length;
  return finish(saved === 0 ? 'failed' : detail.errors.length > 0 ? 'partial' : 'ok');
}
