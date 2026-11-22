/**
 * F7 efficient frontier: the classes' assumptions and monthly returns (reference only).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { basketReturns } from '../models/auto-cma';
import { readFrontierSettings, type FrontierSettings } from '../models/frontier';
import { buildPortfolio } from '../models/portfolio';
import type { Point as ReturnPoint } from '../models/regression';
import { loadAssetClassSettings, loadAssumptions, type AssetClassSettings } from './allocation';
import { rows } from './core';
import { loadHoldingsData } from './holdings';
import { loadMonthlyReturns } from './market';

export interface FrontierData {
  /** config frontier; undefined before its migration. */
  settings: FrontierSettings | undefined;
  classes: AssetClassSettings[];
  /** Expected yearly return by class id (the CMA). */
  expected: Record<string, number>;
  /** Each class benchmark's monthly returns in TWD, and those of the lines an auto-scored class holds. */
  history: Map<string, ReturnPoint[]>;
  /**
   * The monthly TWD returns of each auto-scored class's basket (F6 auto), read in place of its
   * benchmark's, so its expected return and its covariance describe the same holdings.
   */
  baskets: Map<string, ReturnPoint[]>;
  /** The regular pool's actual share of each class, 0 to 1. */
  current: Record<string, number>;
}

export async function loadFrontierData(supabase: SupabaseClient, today: string): Promise<FrontierData> {
  const [config, classes, assumptions, holdings] = await Promise.all([
    rows<{ value: unknown; last_verified: string | null }>('config', supabase.from('config').select('value, last_verified').eq('key', 'frontier')),
    loadAssetClassSettings(supabase),
    loadAssumptions(supabase),
    loadHoldingsData(supabase),
  ]);
  const settings = readFrontierSettings(config[0]?.value, config[0]?.last_verified ?? null);
  const estimates = new Map((assumptions?.estimates ?? []).map((estimate) => [estimate.classId, estimate]));
  const scored = classes.flatMap((entry) => {
    const estimate = assumptions?.assumptions[entry.id]?.auto ? estimates.get(entry.id) : undefined;
    return estimate && estimate.lines.length > 0 ? [estimate] : [];
  });
  const tickers = [...new Set([...classes.flatMap((entry) => (entry.benchmarkTicker ? [entry.benchmarkTicker] : [])), ...scored.flatMap((estimate) => estimate.lines.map((line) => line.ticker))])];
  const history = settings ? await loadMonthlyReturns(supabase, tickers, settings.lookbackYears, today) : new Map<string, ReturnPoint[]>();
  const baskets = new Map(scored.flatMap((estimate) => {
    const basket = basketReturns(estimate.lines, history);
    return basket.length > 0 ? [[estimate.classId, basket] as const] : [];
  }));
  const portfolio = buildPortfolio(holdings);
  return {
    settings,
    classes,
    expected: Object.fromEntries(Object.entries(assumptions?.assumptions ?? {}).map(([id, assumption]) => [id, assumption.expectedReturn])),
    history,
    baskets,
    current: Object.fromEntries(portfolio.classes.map((entry) => [entry.assetClass.id, entry.weight])),
  };
}
