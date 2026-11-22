/**
 * F6 auto-scored assumptions: satellite classes left blank, scored from their holdings by CAPM.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { estimateClass, estimateRow, marketLines, readAutoCmaSettings, unscoredRow, type IndexFit } from '../models/auto-cma';
import { readCapmSettings, type CapmSettings } from '../models/capm';
import { readAssumptions } from '../models/cma';
import { buildPortfolio } from '../models/portfolio';
import { loadFrom, regressTicker, type Point as ReturnPoint } from '../models/regression';
import { exposureOf } from '../models/valuation';
import { loadAssetClassSettingsUncached } from './allocation';
import { loadCapmSeries, savedBetaInputs } from './capm';
import { DataError, rows } from './core';
import { loadHoldingsDataUncached } from './holdings';
import { loadMonthlyReturns } from './market';
import { loadRegressionData, loadRegressionSetup } from './regression';

/**
 * Each ticker's fit against every N1 index, its β as config capm.beta reads it: the newest the
 * monthly refresh saved, else worked out now at N1's defaults, as F11 does for a stock with none.
 */
async function loadIndexFits(supabase: SupabaseClient, today: string, tickers: readonly string[], capm: CapmSettings): Promise<Map<string, IndexFit[]>> {
  const [setup, saved] = await Promise.all([loadRegressionSetup(supabase), savedBetaInputs(supabase)]);
  const regression = setup.settings;
  const benchmarks = regression?.benchmarks ?? [];
  const used = (beta: { raw: number; adjusted: number }) => (capm.beta === 'adjusted' ? beta.adjusted : beta.raw);
  const out = new Map<string, IndexFit[]>();
  const missing: string[] = [];
  for (const ticker of tickers) {
    const fits: IndexFit[] = [];
    for (const benchmark of benchmarks) {
      const found = saved.get(`${ticker}|${benchmark.id}`);
      if (found) fits.push({ benchmark: benchmark.id, beta: used(found), r2: found.r2 });
    }
    out.set(ticker, fits);
    if (fits.length < benchmarks.length && setup.priced.has(ticker)) missing.push(ticker);
  }
  if (missing.length > 0 && regression) {
    const { defaults } = regression;
    const data = await loadRegressionData(supabase, missing, loadFrom(today, defaults.years, regression.rollingWeeks), setup);
    const securities = new Map(setup.securities.map((security) => [security.ticker, security]));
    for (const ticker of missing) {
      const security = securities.get(ticker);
      const fits = out.get(ticker) ?? [];
      if (!security) continue;
      for (const benchmark of benchmarks) {
        if (fits.some((fit) => fit.benchmark === benchmark.id)) continue;
        const outcome = regressTicker(data, security, benchmark, { freq: defaults.freq, years: defaults.years, basis: defaults.currency }, regression);
        if (outcome.ok) fits.push({ benchmark: benchmark.id, beta: used({ raw: outcome.result.beta, adjusted: outcome.result.adjusted }), r2: outcome.result.r2 });
      }
    }
  }
  return out;
}

export interface CmaRefresh {
  /** The satellite classes scored and saved. */
  saved: string[];
  /** The classes held with nothing that can be scored yet: saved with no figures, naming the lines left out. */
  unscored: string[];
}

/**
 * Scores each satellite class from its long lines of both pools (lib/models/auto-cma.ts) and saves
 * the estimates in cma_estimates, today's date as of; a class holding nothing that can be scored
 * loses its row. Undefined before the migration, without config capm or while scoring is off. The
 * nightly job runs it, and so does the owner's save of a trade in a satellite class or of the
 * assumptions, so a new holding is scored at once when its closes are in.
 */
export async function refreshCmaEstimates(supabase: SupabaseClient, today: string): Promise<CmaRefresh | undefined> {
  const config = await rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').in('key', ['cma', 'cma_auto', 'capm']));
  const value = (key: string) => config.find((row) => row.key === key)?.value;
  const settings = readAutoCmaSettings(value('cma_auto'));
  const capm = readCapmSettings(value('capm'));
  if (!settings?.enabled || !capm || value('cma') === undefined) return undefined;
  // Uncached: a server action calls this right after saving a trade.
  const [classes, holdings, series] = await Promise.all([loadAssetClassSettingsUncached(supabase), loadHoldingsDataUncached(supabase), loadCapmSeries(supabase, today)]);
  const satellite = classes.filter((assetClass) => assetClass.sleeve === 'satellite');
  const ids = new Set(satellite.map((assetClass) => assetClass.id));
  // Each satellite class's long lines by ticker, both pools: what the class holds.
  const byClass = new Map<string, Map<string, { market: string; exposure: number }>>();
  for (const holding of buildPortfolio(holdings).holdings) {
    if (!holding.ticker || !holding.market || holding.qty <= 0 || holding.direction !== 'long' || !ids.has(holding.assetClassId)) continue;
    const exposure = exposureOf(holding);
    if (!(exposure > 0)) continue;
    const lines = byClass.get(holding.assetClassId) ?? new Map<string, { market: string; exposure: number }>();
    const line = lines.get(holding.ticker) ?? { market: holding.market, exposure: 0 };
    line.exposure += exposure;
    lines.set(holding.ticker, line);
    byClass.set(holding.assetClassId, lines);
  }
  const tickers = [...new Set([...byClass.values()].flatMap((lines) => [...lines.keys()]))].sort();
  const [fits, returns] =
    tickers.length > 0
      ? await Promise.all([loadIndexFits(supabase, today, tickers, capm), loadMonthlyReturns(supabase, tickers, settings.lookbackYears, today)])
      : [new Map<string, IndexFit[]>(), new Map<string, ReturnPoint[]>()];
  const lines = marketLines(settings, capm, series, readAssumptions(value('cma')));
  const out: Array<Record<string, unknown>> = [];
  const saved: string[] = [];
  const unscored: string[] = [];
  for (const assetClass of satellite) {
    const held = byClass.get(assetClass.id);
    if (!held) continue;
    const outcome = estimateClass(
      assetClass.id,
      [...held].map(([ticker, line]) => ({ ticker, market: line.market, exposure: line.exposure, fits: fits.get(ticker) ?? [], returns: returns.get(ticker) ?? [] })),
      lines,
      settings,
    );
    if (outcome.ok) {
      out.push(estimateRow(outcome.estimate, lines, today));
      saved.push(assetClass.id);
    } else {
      out.push(unscoredRow(assetClass.id, outcome.left, today));
      unscored.push(assetClass.id);
    }
  }
  if (out.length > 0) {
    const { error } = await supabase.from('cma_estimates').upsert(out, { onConflict: 'class_id' });
    if (error) throw new DataError('cma_estimates', error.message);
  }
  // A class that holds nothing any more has nothing to say.
  const empty = satellite.map((assetClass) => assetClass.id).filter((id) => !byClass.has(id));
  if (empty.length > 0) {
    const { error } = await supabase.from('cma_estimates').delete().in('class_id', empty);
    if (error) throw new DataError('cma_estimates', error.message);
  }
  return { saved, unscored };
}

/**
 * The same after an owner's save, as a courtesy: the save already succeeded, so a failure here is
 * left for the nightly job to retry rather than shown as the save's.
 */
export async function rescoreQuietly(supabase: SupabaseClient, today: string): Promise<void> {
  try {
    await refreshCmaEstimates(supabase, today);
  } catch {
    // The nightly job scores again tonight.
  }
}
