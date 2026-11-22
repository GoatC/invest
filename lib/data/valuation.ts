/**
 * F12 valuation workbench: the watchlist, filings, saved valuations and the forward P/E check.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import type { CostOutcome } from '../models/capm';
import type { WatchInput } from '../models/engine';
import { estimatesDue, readEstimates, readPeCheckSettings, type Estimates, type PeCheckSettings } from '../models/forward-pe';
import type { Figures, Quarter } from '../models/fundamentals';
import { assumed, readAssumptions as readStockAssumptions, readValuationSettings, valueStock, type Assumed, type StockAssumptions, type Valuation, type ValuationSettings } from '../models/intrinsic';
import { buildPortfolio } from '../models/portfolio';
import type { Close as SeriesClose } from '../models/regression';
import type { Market } from '../models/types';
import { filedSince, readSaved, valuationInput, valuationRows, watchInputs, type InputProblem, type SavedValuation, type StockSeries, type Trigger } from '../models/workbench';
import { loadCapmData } from './capm';
import { allRows, DataError, rows } from './core';
import { loadHoldingsData, type SecurityRecord } from './holdings';
import { loadRules, type RuleRecord } from './rules';

// ---------------------------------------------------------------------------
// F12 valuation workbench
// ---------------------------------------------------------------------------

export interface WatchRecord {
  ticker: string;
  addedOn: string;
  /** The stock's own buy and trim multiples; null takes the rule's. */
  buy: number | null;
  trim: number | null;
  active: boolean;
  assumptions: StockAssumptions;
}

export interface StockBench {
  security: SecurityRecord;
  held: boolean;
  watch?: WatchRecord;
  assumed: Assumed;
  series: StockSeries;
  /** Where the filings came from, and the newest quarter's date. */
  source: string | null;
  /** F11's cost of equity, or why there is none. */
  cost?: CostOutcome;
  /** The valuation now, or why there is none. */
  valuation?: Valuation;
  input?: { quarter: Quarter; price: SeriesClose };
  problem?: InputProblem;
  /** Saved values of every model, newest first. */
  saved: SavedValuation[];
  /** The analysts' newest consensus (F12 forward P/E), from the nightly job or typed in. */
  estimates?: Estimates;
}

export interface WorkbenchData {
  /** config valuation; undefined when missing or malformed (before its migration, say). */
  settings: ValuationSettings | undefined;
  /** BUY_ZONE's and TRIM_ZONE's multiples, and TRIM_ZONE's share sold. */
  rules: { buy: number | null; trim: number | null; sellShare: number | null };
  /** Watched and held single stocks, watched first, valued; then the other single stocks, to add. */
  stocks: StockBench[];
  others: SecurityRecord[];
  /** config pe_check (F12 forward P/E); undefined before its migration. */
  peCheck?: PeCheckSettings;
}

const WATCH_COLUMNS = 'ticker, added_on, buy_threshold, trim_threshold, active, assumptions';

function toWatch(row: { ticker: string; added_on: string; buy_threshold: number | null; trim_threshold: number | null; active: boolean; assumptions: unknown }): WatchRecord {
  return {
    ticker: row.ticker,
    addedOn: row.added_on,
    buy: row.buy_threshold === null ? null : Number(row.buy_threshold),
    trim: row.trim_threshold === null ? null : Number(row.trim_threshold),
    active: row.active,
    assumptions: readStockAssumptions(row.assumptions),
  };
}

async function loadValuationConfig(supabase: SupabaseClient): Promise<ValuationSettings | undefined> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'valuation'));
  return readValuationSettings(found[0]?.value);
}

async function loadSavedValuations(supabase: SupabaseClient, tickers?: readonly string[]): Promise<SavedValuation[]> {
  const found = await allRows<Parameters<typeof readSaved>[0]>('valuations', (from, to) => {
    const query = supabase.from('valuations').select('ticker, valuation_date, model, iv_bear, iv_base, iv_bull, inputs');
    return (tickers ? query.in('ticker', [...tickers]) : query).order('valuation_date', { ascending: false }).range(from, to);
  });
  return found.flatMap((row) => readSaved(row) ?? []);
}

/** Each stock's saved quarters (fundamentals), oldest first, with its reporting currency and source. */
export async function loadQuarters(supabase: SupabaseClient, tickers: readonly string[]): Promise<Map<string, { quarters: Quarter[]; currency: string; source: string }>> {
  if (tickers.length === 0) return new Map();
  const found = await allRows<{ ticker: string; period_end: string; figures: Figures; currency: string; filed_on: string | null; source: string }>('fundamentals', (from, to) =>
    supabase.from('fundamentals').select('ticker, period_end, figures, currency, filed_on, source').in('ticker', [...tickers]).order('ticker').order('period_end').range(from, to),
  );
  const out = new Map<string, { quarters: Quarter[]; currency: string; source: string }>();
  for (const row of found) {
    const entry = out.get(row.ticker) ?? { quarters: [], currency: row.currency, source: row.source };
    entry.quarters.push({ periodEnd: row.period_end, figures: row.figures ?? {}, filed: row.filed_on });
    entry.currency = row.currency;
    entry.source = row.source;
    out.set(row.ticker, entry);
  }
  return out;
}

/** Quoted closes (not adjusted: multiples set a day's price against that day's figures), from `from` on. */
async function loadQuotedCloses(supabase: SupabaseClient, tickers: readonly string[], from: string): Promise<Map<string, SeriesClose[]>> {
  const lists = await Promise.all(
    tickers.map((ticker) =>
      allRows<{ price_date: string; close: number }>('prices', (start, end) => supabase.from('prices').select('price_date, close').eq('ticker', ticker).gte('price_date', from).order('price_date').range(start, end)),
    ),
  );
  return new Map(tickers.map((ticker, i) => [ticker, (lists[i] ?? []).map((row) => ({ date: row.price_date, close: Number(row.close) }))]));
}

function zoneRules(rules: readonly RuleRecord[]): WorkbenchData['rules'] {
  const number = (id: string, key: string) => {
    const rule = rules.find((candidate) => candidate.id === id);
    const value = rule && typeof rule.threshold === 'object' && rule.threshold !== null ? (rule.threshold as Record<string, unknown>)[key] : undefined;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  return { buy: number('BUY_ZONE', 'multiple'), trim: number('TRIM_ZONE', 'multiple'), sellShare: number('TRIM_ZONE', 'sell_share') };
}

/**
 * The workbench: every watched or held single stock valued now by all three models from its saved
 * quarters, its newest close and F11's cost of equity, with its saved values; `only` limits the
 * valuing to those tickers (the nightly job's re-run, a save).
 */
async function loadWorkbenchUncached(supabase: SupabaseClient, today: string, only?: readonly string[]): Promise<WorkbenchData> {
  // F11's cost of equity may first regress a β; it runs while the filings and closes load.
  const capmLoad = loadCapmData(supabase, today);
  capmLoad.catch(() => undefined);
  const [settings, watchRows, holdings, rules] = await Promise.all([
    loadValuationConfig(supabase),
    rows<Parameters<typeof toWatch>[0]>('watchlist', supabase.from('watchlist').select(WATCH_COLUMNS).order('ticker')),
    loadHoldingsData(supabase),
    loadRules(supabase),
  ]);
  const watch = new Map(watchRows.map((row) => [row.ticker, toWatch(row)]));
  const held = new Set(buildPortfolio(holdings).holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])));
  const stocks = holdings.securities.filter((security) => security.productType === 'stock');
  const benched = stocks
    .filter((security) => watch.has(security.ticker) || held.has(security.ticker))
    .filter((security) => !only || only.includes(security.ticker))
    .sort((a, b) => Number(watch.has(b.ticker)) - Number(watch.has(a.ticker)) || Number(held.has(b.ticker)) - Number(held.has(a.ticker)) || a.ticker.localeCompare(b.ticker));
  const others = stocks.filter((security) => !watch.has(security.ticker) && !held.has(security.ticker));
  if (!settings) return { settings, rules: zoneRules(rules), stocks: [], others };
  const assumedOf = (ticker: string) => assumed(settings, watch.get(ticker)?.assumptions ?? {});
  const known = new Map(holdings.securities.map((security) => [security.ticker, security]));
  const peers = [...new Set(benched.flatMap((security) => assumedOf(security.ticker).peers))].filter((ticker) => known.has(ticker));
  const tickers = [...new Set([...benched.map((security) => security.ticker), ...peers])];
  const from = `${Number(today.slice(0, 4)) - settings.historyYears - 1}${today.slice(4)}`;
  const [quarters, closes, saved, capm, estimates, peCheck] = await Promise.all([
    loadQuarters(supabase, tickers),
    loadQuotedCloses(supabase, tickers, from),
    loadSavedValuations(supabase, benched.map((security) => security.ticker)),
    capmLoad,
    // Before the forward P/E's migration the valuations still show, without it.
    loadEstimates(supabase, benched.map((security) => security.ticker)).catch(() => new Map<string, Estimates>()),
    loadPeCheckSettings(supabase).catch(() => undefined),
  ]);
  const seriesOf = (security: SecurityRecord): StockSeries => {
    const filings = quarters.get(security.ticker);
    return { ticker: security.ticker, market: security.market, currency: security.currency, reportCurrency: filings?.currency ?? null, quarters: filings?.quarters ?? [], closes: closes.get(security.ticker) ?? [] };
  };
  const costs = new Map(capm.stocks.map((stock) => [stock.security.ticker, stock.outcome]));
  return {
    settings,
    rules: zoneRules(rules),
    others,
    ...(peCheck ? { peCheck } : {}),
    stocks: benched.map((security) => {
      const series = seriesOf(security);
      const choice = assumedOf(security.ticker);
      const cost = costs.get(security.ticker);
      const built = valuationInput(
        series,
        choice.peers.flatMap((ticker) => (known.has(ticker) && ticker !== security.ticker ? [seriesOf(known.get(ticker) as SecurityRecord)] : [])),
        cost?.ok ? { costOfEquity: cost.result.rate, riskFree: cost.result.riskFree.value } : undefined,
        choice,
        settings,
      );
      const watched = watch.get(security.ticker);
      return {
        security,
        held: held.has(security.ticker),
        ...(watched ? { watch: watched } : {}),
        assumed: choice,
        series,
        source: quarters.get(security.ticker)?.source ?? null,
        ...(cost ? { cost } : {}),
        ...(built.ok ? { valuation: valueStock(built.input), input: { quarter: built.quarter, price: built.price } } : { problem: built.problem }),
        saved: saved.filter((row) => row.ticker === security.ticker),
        ...(estimates.has(security.ticker) ? { estimates: estimates.get(security.ticker) as Estimates } : {}),
      };
    }),
  };
}

/** Saves a stock's valuation now, one row per model that gave values (upserted by day and model). */
export async function saveValuation(supabase: SupabaseClient, bench: StockBench, trigger: Trigger, today: string): Promise<number> {
  if (!bench.valuation || !bench.input) return 0;
  const cost = bench.cost?.ok ? bench.cost.result.rate : undefined;
  const out = valuationRows(bench.security.ticker, today, bench.valuation, {
    trigger,
    periodEnd: bench.input.quarter.periodEnd,
    filed: bench.input.quarter.filed,
    price: bench.input.price.close,
    currency: bench.security.currency,
    ...(cost !== undefined ? { costOfEquity: cost } : {}),
    assumptions: bench.assumed,
  });
  if (out.length === 0) return 0;
  const { error } = await supabase.from('valuations').upsert(out, { onConflict: 'ticker,valuation_date,model' });
  if (error) throw new DataError('valuations', error.message);
  return out.length;
}

/** The nightly re-run (F12: "re-runs after each filing"): every active watched stock with a quarter newer than its last value. */
export async function revalueOnFilings(supabase: SupabaseClient, today: string): Promise<{ valued: string[] } | undefined> {
  const data = await loadWorkbench(supabase, today);
  if (!data.settings) return undefined;
  const valued: string[] = [];
  for (const bench of data.stocks) {
    if (!bench.watch?.active || !filedSince(bench.series.quarters, bench.saved, bench.security.ticker)) continue;
    if ((await saveValuation(supabase, bench, 'filing', today)) > 0) valued.push(bench.security.ticker);
  }
  return { valued };
}

/** What the zone rules read (F12); undefined before config valuation exists, so the rules wait. */
export async function loadWatchInputs(supabase: SupabaseClient, securities: readonly SecurityRecord[]): Promise<WatchInput[] | undefined> {
  const [settings, watchRows] = await Promise.all([
    loadValuationConfig(supabase),
    rows<Parameters<typeof toWatch>[0]>('watchlist', supabase.from('watchlist').select(WATCH_COLUMNS).order('ticker')),
  ]);
  if (!settings) return undefined;
  const entries = watchRows.map(toWatch);
  const saved = await loadSavedValuations(supabase, entries.map((entry) => entry.ticker));
  const known = new Map(securities.map((security) => [security.ticker, security]));
  return watchInputs(
    entries.flatMap((entry) => {
      const security = known.get(entry.ticker);
      return security ? [{ ticker: entry.ticker, active: entry.active, model: assumed(settings, entry.assumptions).model, buy: entry.buy, trim: entry.trim, assetClassId: security.assetClassId, currency: security.currency }] : [];
    }),
    saved,
  );
}

/** The single stocks whose filings the nightly job loads: held or actively watched, and their peers. */
export async function loadFilingTickers(supabase: SupabaseClient): Promise<Array<{ ticker: string; market: Market }>> {
  const [holdings, watchRows] = await Promise.all([loadHoldingsData(supabase), rows<Parameters<typeof toWatch>[0]>('watchlist', supabase.from('watchlist').select(WATCH_COLUMNS))]);
  const held = new Set(buildPortfolio(holdings).holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])));
  const watched = watchRows.map(toWatch).filter((entry) => entry.active);
  const wanted = new Set([...held, ...watched.map((entry) => entry.ticker), ...watched.flatMap((entry) => entry.assumptions.peers ?? [])]);
  return holdings.securities.filter((security) => security.productType === 'stock' && wanted.has(security.ticker)).map((security) => ({ ticker: security.ticker, market: security.market }));
}

// ---------------------------------------------------------------------------
// F12 forward P/E check
// ---------------------------------------------------------------------------

/** config pe_check; undefined before its migration. */
export async function loadPeCheckSettings(supabase: SupabaseClient): Promise<PeCheckSettings | undefined> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'pe_check'));
  return found[0] ? readPeCheckSettings(found[0].value) : undefined;
}

type EstimateRowShape = { ticker: string; as_of: string; currency: string; estimates: unknown; source: string };

/** Each stock's saved consensus (analyst_estimates). */
export async function loadEstimates(supabase: SupabaseClient, tickers: readonly string[]): Promise<Map<string, Estimates>> {
  if (tickers.length === 0) return new Map();
  const found = await rows<EstimateRowShape>('analyst_estimates', supabase.from('analyst_estimates').select('ticker, as_of, currency, estimates, source').in('ticker', [...tickers]));
  return new Map(found.flatMap((row) => {
    const read = readEstimates(row);
    return read ? [[row.ticker, read] as const] : [];
  }));
}

/**
 * The US single stocks held or watched whose consensus the nightly job should load tonight: none
 * saved, or the saved one loaded by the job pe_check.refresh_days or more ago (a typed one is
 * Hugo's and stays). Undefined before config pe_check exists.
 */
export async function loadEstimatePlan(supabase: SupabaseClient, today: string): Promise<Array<{ ticker: string; currency: string }> | undefined> {
  const settings = await loadPeCheckSettings(supabase);
  if (!settings) return undefined;
  const [holdings, watchRows] = await Promise.all([loadHoldingsData(supabase), rows<{ ticker: string; active: boolean }>('watchlist', supabase.from('watchlist').select('ticker, active'))]);
  const held = new Set(buildPortfolio(holdings).holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])));
  const watched = new Set(watchRows.filter((row) => row.active).map((row) => row.ticker));
  const stocks = holdings.securities.filter((security) => security.productType === 'stock' && security.market === 'US' && (held.has(security.ticker) || watched.has(security.ticker)));
  if (stocks.length === 0) return [];
  const saved = await rows<{ ticker: string; as_of: string; source: string }>('analyst_estimates', supabase.from('analyst_estimates').select('ticker, as_of, source').in('ticker', stocks.map((security) => security.ticker)));
  const last = new Map(saved.map((row) => [row.ticker, row]));
  return stocks
    .filter((security) => {
      const row = last.get(security.ticker);
      return !row || (row.source !== 'typed' && estimatesDue(row.as_of, today, settings));
    })
    .map((security) => ({ ticker: security.ticker, currency: security.currency }));
}

// One read per request (core.ts).
export const loadWorkbench = cache(loadWorkbenchUncached);
