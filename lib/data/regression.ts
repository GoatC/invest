/**
 * N1 Regression Lab: closes, indices and rates for β, the saved monthly betas, and the five-factor mode.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { addDays } from '../dates';
import { fiveFactor, portfolioReturns, readFactorSettings, REGIONS, seriesName, type FactorFit, type FactorMonth, type FactorSettings, type Region } from '../models/five-factor';
import { buildPortfolio } from '../models/portfolio';
import { loadFrom, periodReturns, readRegressionSettings, regressTicker, RISK_FREE_SERIES, type Close as SeriesClose, type Point as ReturnPoint, type RegressionSettings } from '../models/regression';
import { allRows, DataError, rows } from './core';
import { loadHoldingsData, loadSecurities, type SecurityRecord } from './holdings';

// ---------------------------------------------------------------------------
// N1 Regression Lab
// ---------------------------------------------------------------------------

export interface RegressionSetup {
  /** config regression; undefined when missing or malformed (before the migration, say). */
  settings: RegressionSettings | undefined;
  securities: SecurityRecord[];
  /** Every ticker with a close, and its newest close's date. */
  priced: Map<string, string>;
}

export interface RegressionData extends RegressionSetup {
  closes: Map<string, SeriesClose[]>;
  indices: Map<string, SeriesClose[]>;
  fx: Map<string, SeriesClose[]>;
  riskFree: Map<string, Map<string, number>>;
}

/** config regression's raw value; undefined when the row is missing. */
async function regressionConfig(supabase: SupabaseClient): Promise<unknown> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'regression'));
  return found[0]?.value;
}

/** The settings, the securities and which of them have closes. */
async function loadRegressionSetupUncached(supabase: SupabaseClient): Promise<RegressionSetup> {
  const [config, securities, latest] = await Promise.all([
    regressionConfig(supabase),
    loadSecurities(supabase),
    rows<{ ticker: string; price_date: string }>('latest_prices', supabase.from('latest_prices').select('ticker, price_date')),
  ]);
  return { settings: readRegressionSettings(config), securities, priced: new Map(latest.map((row) => [row.ticker, row.price_date])) };
}

/** The tickers' adjusted closes, the indices', the TWD rates and the bill rate from `from` on. */
export async function loadRegressionData(supabase: SupabaseClient, tickers: readonly string[], from: string, setup?: RegressionSetup): Promise<RegressionData> {
  const base = setup ?? (await loadRegressionSetup(supabase));
  const { settings, securities } = base;
  const known = new Map(securities.map((security) => [security.ticker, security]));
  const wanted = [...new Set(tickers)].filter((ticker) => known.has(ticker));
  const currencies = [...new Set([...wanted.map((ticker) => known.get(ticker)?.currency ?? 'TWD'), ...(settings?.benchmarks.map((benchmark) => benchmark.currency) ?? [])])].filter((currency) => currency !== 'TWD');
  const [closeRows, indexRows, rateRows, billRows] = await Promise.all([
    Promise.all(
      wanted.map((ticker) =>
        allRows<{ price_date: string; close: number; adj_close: number | null }>('prices', (start, end) =>
          supabase.from('prices').select('price_date, close, adj_close').eq('ticker', ticker).gte('price_date', from).order('price_date').range(start, end),
        ),
      ),
    ),
    settings
      ? allRows<{ index_id: string; price_date: string; close: number }>('index_prices', (start, end) =>
          supabase.from('index_prices').select('index_id, price_date, close').gte('price_date', from).order('index_id').order('price_date').range(start, end),
        )
      : Promise.resolve([]),
    Promise.all(
      currencies.map((currency) =>
        allRows<{ rate_date: string; rate: number }>('fx_rates', (start, end) =>
          supabase.from('fx_rates').select('rate_date, rate').eq('pair', `${currency}/TWD`).gte('rate_date', addDays(from, -14)).order('rate_date').range(start, end),
        ),
      ),
    ),
    rows<{ series: string; obs_month: string; value: number }>(
      'market_series',
      supabase.from('market_series').select('series, obs_month, value').in('series', Object.values(RISK_FREE_SERIES)).gte('obs_month', `${from.slice(0, 7)}-01`).order('obs_month'),
    ),
  ]);
  const indices = new Map<string, SeriesClose[]>();
  for (const row of indexRows) {
    const list = indices.get(row.index_id) ?? [];
    list.push({ date: row.price_date, close: Number(row.close) });
    indices.set(row.index_id, list);
  }
  const riskFree = new Map<string, Map<string, number>>();
  for (const [currency, series] of Object.entries(RISK_FREE_SERIES)) {
    riskFree.set(currency, new Map(billRows.filter((row) => row.series === series).map((row) => [row.obs_month.slice(0, 7), Number(row.value)])));
  }
  return {
    ...base,
    closes: new Map(wanted.map((ticker, i) => [ticker, (closeRows[i] ?? []).map((row) => ({ date: row.price_date, close: Number(row.adj_close ?? row.close) }))])),
    indices,
    fx: new Map(currencies.map((currency, i) => [currency, (rateRows[i] ?? []).map((row) => ({ date: row.rate_date, close: Number(row.rate) }))])),
    riskFree,
  };
}

/**
 * Each holding's β against every benchmark at config regression's defaults, saved in beta_results
 * once a month for F11 (N1's monthly refresh); undefined when this month's are saved already.
 */
export async function refreshBetas(supabase: SupabaseClient, today: string): Promise<{ saved: number; runDate: string } | undefined> {
  const [latest] = await rows<{ run_date: string }>('beta_results', supabase.from('beta_results').select('run_date').eq('model', '1F').order('run_date', { ascending: false }).limit(1));
  if (latest && latest.run_date.slice(0, 7) === today.slice(0, 7)) return undefined;
  const settings = readRegressionSettings(await regressionConfig(supabase));
  if (!settings) throw new DataError('config', 'regression is missing or malformed');
  const portfolio = buildPortfolio(await loadHoldingsData(supabase));
  const tickers = [...new Set(portfolio.holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])))].sort();
  const { defaults } = settings;
  const data = await loadRegressionData(supabase, tickers, loadFrom(today, defaults.years, settings.rollingWeeks));
  const securities = new Map(data.securities.map((security) => [security.ticker, security]));
  const out: Array<Record<string, unknown>> = [];
  for (const ticker of tickers) {
    const security = securities.get(ticker);
    if (!security) continue;
    for (const benchmark of settings.benchmarks) {
      const outcome = regressTicker(data, security, benchmark, { freq: defaults.freq, years: defaults.years, basis: defaults.currency }, settings);
      if (!outcome.ok) continue;
      const { result } = outcome;
      out.push({
        ticker,
        benchmark: benchmark.id,
        model: '1F',
        freq: defaults.freq,
        window_years: defaults.years,
        currency_basis: defaults.currency,
        beta: result.beta,
        alpha: result.alphaAnnual,
        factor_loadings: { adjusted: result.adjusted, ci_low: result.ci[0], ci_high: result.ci[1], n: result.n, adjacent: result.adjacent, slopes: result.slopes, from: result.from, to: result.to },
        r2: Math.min(1, Math.max(0, result.r2)),
        std_err: result.stdErr,
        run_date: today,
      });
    }
  }
  if (out.length > 0) {
    const { error } = await supabase.from('beta_results').upsert(out, { onConflict: 'ticker,benchmark,model,freq,window_years,currency_basis,run_date' });
    if (error) throw new DataError('beta_results', error.message);
  }
  return { saved: out.length, runDate: today };
}

/** The newest β saved for each ticker and benchmark (the monthly refresh), for the Regression page. */
async function loadSavedBetasUncached(supabase: SupabaseClient): Promise<Array<{ ticker: string; benchmark: string; beta: number; runDate: string }>> {
  const found = await rows<{ ticker: string; benchmark: string; beta: number | null; run_date: string }>(
    'beta_results',
    supabase.from('beta_results').select('ticker, benchmark, beta, run_date').eq('model', '1F').order('run_date', { ascending: false }).limit(200),
  );
  const seen = new Set<string>();
  return found.flatMap((row) => {
    const key = `${row.ticker}|${row.benchmark}`;
    if (seen.has(key) || row.beta === null) return [];
    seen.add(key);
    return [{ ticker: row.ticker, benchmark: row.benchmark, beta: Number(row.beta), runDate: row.run_date }];
  });
}

// ---------------------------------------------------------------------------
// N1 Fama-French five-factor mode
// ---------------------------------------------------------------------------

/** One regression: a holding, or the whole portfolio, on a region's factors. */
export interface FactorRow {
  /** A ticker, or "portfolio". */
  key: string;
  name: string;
  region: Region;
  /** The weight in today's portfolio, 0 to 1; null for the portfolio itself. */
  weight: number | null;
  /** Undefined when there were too few months with returns and factors. */
  fit: FactorFit | undefined;
  /** Months with both a return and the region's factors. */
  months: number;
}

export interface FactorData {
  /** config factors; undefined before its migration. */
  settings: FactorSettings | undefined;
  rows: FactorRow[];
  /** The newest month of each region's factors the job has loaded. */
  loaded: Partial<Record<Region, string>>;
  /** Held tickers left out of the portfolio's fit for want of a dollar return, and holdings with no ticker (gold, balances). */
  left: string[];
  noTicker: number;
}

export async function loadFactorData(supabase: SupabaseClient, today: string, years: number): Promise<FactorData> {
  const settings = readFactorSettings((await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'factors')))[0]?.value);
  if (!settings) return { settings, rows: [], loaded: {}, left: [], noTicker: 0 };
  const holdings = await loadHoldingsData(supabase);
  const held = buildPortfolio(holdings).holdings.filter((holding) => holding.ticker && holding.qty > 0 && (holding.valueTwd ?? 0) > 0);
  const byTicker = new Map<string, number>();
  for (const holding of held) byTicker.set(holding.ticker as string, (byTicker.get(holding.ticker as string) ?? 0) + (holding.valueTwd ?? 0));
  const noTicker = buildPortfolio(holdings).holdings.filter((holding) => !holding.ticker && (holding.valueTwd ?? 0) > 0).length;
  const total = [...byTicker.values()].reduce((sum, value) => sum + value, 0);
  const tickers = [...byTicker.keys()].sort();

  const factorRows = await allRows<{ series: string; obs_month: string; value: number }>('market_series', (from, to) =>
    supabase.from('market_series').select('series, obs_month, value').like('series', 'ff5_%').order('series').order('obs_month').range(from, to),
  );
  const factorsByRegion = new Map<Region, Map<string, Partial<FactorMonth>>>();
  const loaded: Partial<Record<Region, string>> = {};
  for (const region of REGIONS) {
    const months = new Map<string, Partial<FactorMonth>>();
    for (const key of ['mkt', 'smb', 'hml', 'rmw', 'cma', 'rf'] as const) {
      for (const row of factorRows.filter((entry) => entry.series === seriesName(region, key))) {
        const month = row.obs_month.slice(0, 7);
        months.set(month, { ...months.get(month), month, [key]: Number(row.value) });
      }
    }
    factorsByRegion.set(region, months);
    const newest = [...months.keys()].sort().pop();
    if (newest) loaded[region] = newest;
  }
  const factorsOf = (region: Region): FactorMonth[] => [...(factorsByRegion.get(region)?.values() ?? [])].filter((entry): entry is FactorMonth => ['mkt', 'smb', 'hml', 'rmw', 'cma', 'rf'].every((key) => typeof entry[key as keyof FactorMonth] === 'number'));

  // Monthly returns in dollars of each held ticker over the longest window.
  const from = addDays(today, -Math.ceil(years * 366 + 62));
  const regression = await loadRegressionData(supabase, tickers, from);
  const usd = regression.fx.get('USD') ?? [];
  const month = today.slice(0, 7);
  const returns = new Map<string, ReturnPoint[]>();
  const left: string[] = [];
  for (const ticker of tickers) {
    const security = regression.securities.find((entry) => entry.ticker === ticker);
    const closes = regression.closes.get(ticker) ?? [];
    let inUsd: SeriesClose[] | undefined;
    if (security?.currency === 'USD') inUsd = closes;
    else if (security?.currency === 'TWD' && usd.length > 0) {
      // Dollars per share: the close over the day's TWD per dollar.
      const sorted = [...usd].sort((a, b) => a.date.localeCompare(b.date));
      let at = -1;
      inUsd = [];
      for (const close of closes) {
        while (at + 1 < sorted.length && (sorted[at + 1] as SeriesClose).date <= close.date) at += 1;
        const rate = sorted[at];
        if (rate) inUsd.push({ date: close.date, close: close.close / rate.close });
      }
    }
    const monthly = inUsd ? periodReturns(inUsd, 'monthly').filter((point) => point.date.slice(0, 7) < month) : [];
    if (monthly.length === 0) left.push(ticker);
    else returns.set(ticker, monthly);
  }

  const out: FactorRow[] = [];
  const window = years * 12;
  const portfolio = portfolioReturns(tickers.filter((ticker) => returns.has(ticker)).map((ticker) => ({ weight: (byTicker.get(ticker) ?? 0) / total, returns: returns.get(ticker) as ReturnPoint[] })));
  const factors = factorsOf(settings.portfolio);
  out.push({ key: 'portfolio', name: 'portfolio', region: settings.portfolio, weight: null, fit: fiveFactor(portfolio, factors, settings, window), months: portfolio.length });
  for (const ticker of tickers) {
    const security = regression.securities.find((entry) => entry.ticker === ticker);
    const region = settings.regions[security?.market ?? 'US'] ?? 'us';
    const series = returns.get(ticker) ?? [];
    out.push({ key: ticker, name: security?.name ?? ticker, region, weight: (byTicker.get(ticker) ?? 0) / total, fit: fiveFactor(series, factorsOf(region), settings, window), months: series.length });
  }
  return { settings, rows: out, loaded, left, noTicker };
}

// One read per request (core.ts).
export const loadRegressionSetup = cache(loadRegressionSetupUncached);
export const loadSavedBetas = cache(loadSavedBetasUncached);
