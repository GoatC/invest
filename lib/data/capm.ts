/**
 * F11 CAPM cost of equity: the 10-year yields, ERP and each stock's β.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { addMonths } from '../dates';
import { CAPM_SERIES, readCapmSettings, stockCostOfEquity, type BetaInput, type CapmSettings, type CostOutcome, type MonthValue } from '../models/capm';
import { buildPortfolio } from '../models/portfolio';
import { loadFrom, regressTicker, type RegressionSettings } from '../models/regression';
import { rows } from './core';
import { loadHoldingsData, type SecurityRecord } from './holdings';
import { loadRegressionData, loadRegressionSetup } from './regression';

/** Months of F11's series the page reads: enough for the newest and the months before it. */
const CAPM_MONTHS = 13;

export interface StockCost {
  security: SecurityRecord;
  /** Held now in either pool. */
  held: boolean;
  outcome: CostOutcome;
  /** Why no β could be worked out live: too few periods, say (N1's problems). */
  betaProblem?: { problem: 'fx' | 'observations' | 'collinear' | 'settings'; n: number };
}

export interface CapmData {
  /** config capm; undefined when missing or malformed (before its migration, say). */
  settings: CapmSettings | undefined;
  regression: RegressionSettings | undefined;
  /** F11's monthly series, oldest first. */
  series: Map<string, MonthValue[]>;
  stocks: StockCost[];
}

/** The newest β saved for each ticker and benchmark (N1's monthly refresh), raw and adjusted, with its R². */
export async function savedBetaInputs(supabase: SupabaseClient): Promise<Map<string, BetaInput & { r2: number | null }>> {
  const found = await rows<{ ticker: string; benchmark: string; beta: number | null; factor_loadings: Record<string, unknown> | null; r2: number | null; run_date: string }>(
    'beta_results',
    supabase.from('beta_results').select('ticker, benchmark, beta, factor_loadings, r2, run_date').eq('model', '1F').order('run_date', { ascending: false }).limit(500),
  );
  const out = new Map<string, BetaInput & { r2: number | null }>();
  for (const row of found) {
    const key = `${row.ticker}|${row.benchmark}`;
    const adjusted = row.factor_loadings?.['adjusted'];
    if (out.has(key) || row.beta === null || typeof adjusted !== 'number') continue;
    out.set(key, { raw: Number(row.beta), adjusted, runDate: row.run_date, r2: row.r2 === null ? null : Number(row.r2) });
  }
  return out;
}

/** F11's monthly series (the 10-year yields and Damodaran's ERP) of the last CAPM_MONTHS, oldest first. */
export async function loadCapmSeries(supabase: SupabaseClient, today: string): Promise<Map<string, MonthValue[]>> {
  const since = `${addMonths(today.slice(0, 7), -CAPM_MONTHS)}-01`;
  const found = await rows<{ series: string; obs_month: string; value: number }>(
    'market_series',
    supabase.from('market_series').select('series, obs_month, value').in('series', Object.values(CAPM_SERIES)).gte('obs_month', since).order('obs_month'),
  );
  const series = new Map<string, MonthValue[]>();
  for (const row of found) {
    const list = series.get(row.series) ?? [];
    list.push({ month: row.obs_month.slice(0, 7), value: Number(row.value) });
    series.set(row.series, list);
  }
  return series;
}

/**
 * Each single stock's cost of equity (F11): its market's 10-year yield and ERP, and its β against
 * the market's index, the newest saved by the monthly refresh, else worked out now at N1's defaults.
 */
async function loadCapmDataUncached(supabase: SupabaseClient, today: string): Promise<CapmData> {
  const [capmRow, setup, saved, series, holdings] = await Promise.all([
    rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'capm')),
    loadRegressionSetup(supabase),
    savedBetaInputs(supabase),
    loadCapmSeries(supabase, today),
    loadHoldingsData(supabase),
  ]);
  const settings = readCapmSettings(capmRow[0]?.value);
  const regression = setup.settings;
  const held = new Set(buildPortfolio(holdings).holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])));
  const stocks = setup.securities.filter((security) => security.productType === 'stock').sort((a, b) => Number(held.has(b.ticker)) - Number(held.has(a.ticker)) || a.ticker.localeCompare(b.ticker));
  if (!settings) return { settings, regression, series, stocks: [] };
  const benchmarkOf = (security: SecurityRecord) => settings.markets[security.market]?.benchmark;
  // A stock with no saved β against its market's index gets one now, as the Regression page would.
  const missing = stocks.filter((security) => setup.priced.has(security.ticker) && benchmarkOf(security) && !saved.has(`${security.ticker}|${benchmarkOf(security)}`));
  const live = new Map<string, { beta?: BetaInput; problem?: StockCost['betaProblem'] }>();
  if (missing.length > 0 && regression) {
    const { defaults } = regression;
    const data = await loadRegressionData(supabase, missing.map((security) => security.ticker), loadFrom(today, defaults.years, regression.rollingWeeks), setup);
    for (const security of missing) {
      const benchmark = regression.benchmarks.find((candidate) => candidate.id === benchmarkOf(security));
      if (!benchmark) continue;
      const outcome = regressTicker(data, security, benchmark, { freq: defaults.freq, years: defaults.years, basis: defaults.currency }, regression);
      live.set(security.ticker, outcome.ok ? { beta: { raw: outcome.result.beta, adjusted: outcome.result.adjusted, runDate: null } } : { problem: { problem: outcome.problem, n: outcome.n } });
    }
  }
  return {
    settings,
    regression,
    series,
    stocks: stocks.map((security) => {
      const benchmark = benchmarkOf(security);
      const found = benchmark ? saved.get(`${security.ticker}|${benchmark}`) : undefined;
      const now = live.get(security.ticker);
      const problem = now?.problem ?? (!found && !now && benchmark && !regression ? { problem: 'settings' as const, n: 0 } : undefined);
      return { security, held: held.has(security.ticker), outcome: stockCostOfEquity(security, found ?? now?.beta, settings, series), ...(problem ? { betaProblem: problem } : {}) };
    }),
  };
}

// One read per request (core.ts).
export const loadCapmData = cache(loadCapmDataUncached);
