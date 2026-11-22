/**
 * F6 targets, benchmarks and capital market assumptions, R1 / R2 caps, and N6's allocation view.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { driftBands, type DriftBands } from '../models/allocation';
import { mergeAssumptions, readAutoCmaSettings, readEstimateRow, readUnscoredRow, type AutoCmaSettings, type SavedEstimate, type Unscored } from '../models/auto-cma';
import { readAssumptions, type Assumptions } from '../models/cma';
import { capsFromRules, type Caps, type RuleRow } from '../models/rules';
import type { AssetClass } from '../models/types';
import { rows } from './core';
import { loadAssetClasses, loadHoldingsData, toAssetClass, type AssetClassRow, type HoldingsData } from './holdings';

/** An asset class with the benchmark ETF its returns are measured against (F6, F18, N4). */
export interface AssetClassSettings extends AssetClass {
  benchmarkTicker: string | null;
}

export async function loadAssetClassSettingsUncached(supabase: SupabaseClient): Promise<AssetClassSettings[]> {
  const found = await rows<AssetClassRow & { benchmark_ticker: string | null }>(
    'asset_classes',
    supabase.from('asset_classes').select('id, name_en, name_zh, target_weight, sleeve, sort_order, benchmark_ticker').order('sort_order'),
  );
  return found.map((row) => ({ ...toAssetClass(row), benchmarkTicker: row.benchmark_ticker }));
}

/** The capital market assumptions as the models read them, with yours and the auto-scored ones apart. */
export interface SavedAssumptions {
  /** Yours, plus the estimate of each satellite class you left blank (F6 auto): what F2, F5, F7 and F10 read. */
  assumptions: Assumptions;
  /** Yours alone, as config cma holds them. */
  manual: Assumptions;
  /** Every saved estimate, a class you set included (shown beside yours); empty while scoring is off. */
  estimates: SavedEstimate[];
  /** The classes held with nothing that can be scored yet, and why each line was left out. */
  unscored: Unscored[];
  /** config cma_auto; undefined before its migration. */
  auto: AutoCmaSettings | undefined;
  verifiedOn: string | null;
}

/** The saved estimates (cma_estimates), each read defensively, and the classes held but not scored yet. */
async function loadCmaEstimates(supabase: SupabaseClient): Promise<{ estimates: SavedEstimate[]; unscored: Unscored[] }> {
  const found = await rows<{ class_id: string; as_of: string; expected_return: unknown; volatility: unknown; months: unknown; detail: unknown }>(
    'cma_estimates',
    supabase.from('cma_estimates').select('class_id, as_of, expected_return, volatility, months, detail'),
  );
  return {
    estimates: found.flatMap((row) => {
      const read = readEstimateRow(row);
      return read ? [read] : [];
    }),
    unscored: found.flatMap((row) => {
      const read = readUnscoredRow(row);
      return read ? [read] : [];
    }),
  };
}

/**
 * The capital market assumptions (config cma) and when they were last reviewed, merged with the
 * auto-scored estimate of each satellite class left blank while config cma_auto is on; missing is undefined.
 */
async function loadAssumptionsUncached(supabase: SupabaseClient): Promise<SavedAssumptions | undefined> {
  const [config, classes] = await Promise.all([
    rows<{ key: string; value: unknown; last_verified: string | null }>('config', supabase.from('config').select('key, value, last_verified').in('key', ['cma', 'cma_auto'])),
    loadAssetClasses(supabase),
  ]);
  const row = config.find((entry) => entry.key === 'cma');
  if (!row) return undefined;
  const manual = readAssumptions(row.value);
  const auto = readAutoCmaSettings(config.find((entry) => entry.key === 'cma_auto')?.value);
  const { estimates, unscored } = auto?.enabled ? await loadCmaEstimates(supabase) : { estimates: [], unscored: [] };
  const satellite = new Set(classes.filter((assetClass) => assetClass.sleeve === 'satellite').map((assetClass) => assetClass.id));
  return { assumptions: mergeAssumptions(manual, estimates, satellite), manual, estimates, unscored, auto, verifiedOn: row.last_verified };
}

/** R1 and R2 as the rules table holds them. */
async function loadCapsUncached(supabase: SupabaseClient): Promise<Caps> {
  return capsFromRules(await rows<RuleRow>('rules', supabase.from('rules').select('id, threshold, enabled').in('id', ['R1', 'R2'])));
}

/** The holdings, plus the targets' benchmarks, F8's drift band and the assumptions. */
export interface AllocationData extends HoldingsData {
  classSettings: AssetClassSettings[];
  /** Undefined while the F8_DRIFT rule is off. */
  bands: DriftBands | undefined;
  /** Undefined until the step 6 migration is applied. */
  assumptions: SavedAssumptions | undefined;
}

async function loadAllocationDataUncached(supabase: SupabaseClient): Promise<AllocationData> {
  const [holdings, classSettings, drift, display, assumptions] = await Promise.all([
    loadHoldingsData(supabase),
    loadAssetClassSettings(supabase),
    rows<RuleRow>('rules', supabase.from('rules').select('id, threshold, enabled').eq('id', 'F8_DRIFT')),
    rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'drift_display')),
    loadAssumptions(supabase),
  ]);
  return { ...holdings, classSettings, bands: driftBands(drift[0], display[0]?.value), assumptions };
}

// One read per request (core.ts).
export const loadAllocationData = cache(loadAllocationDataUncached);
export const loadAssetClassSettings = cache(loadAssetClassSettingsUncached);
export const loadAssumptions = cache(loadAssumptionsUncached);
export const loadCaps = cache(loadCapsUncached);
