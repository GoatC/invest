/**
 * F10 stress test: today's holdings, the assumptions and the leverage settings.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildPortfolio } from '../models/portfolio';
import { readStressSettings, type ClassValue, type StressSettings } from '../models/stress';
import type { AssetClass } from '../models/types';
import { exposureOf } from '../models/valuation';
import { readAcceleration, type Acceleration } from '../models/windfall';
import { loadAssumptions } from './allocation';
import { rows } from './core';
import { leverageSettings, loadAssetClasses, loadHoldingsData, type LeverageSettings } from './holdings';
import { loadRules } from './rules';

export interface StressData {
  /** config stress; undefined before its migration. */
  settings: StressSettings | undefined;
  /** Today's holdings by asset class, both pools, TWD. */
  classes: ClassValue[];
  classNames: AssetClass[];
  /** The capital market assumptions' expected return by class id. */
  expected: Record<string, number>;
  /** F3's tiers and window from the rule; null when missing or malformed. */
  acceleration: Acceleration | null;
  /** config leverage: when the what-if position is close to a margin call. */
  leverage: LeverageSettings;
}

export async function loadStressData(supabase: SupabaseClient): Promise<StressData> {
  const [config, holdings, assumptions, rules, classNames] = await Promise.all([
    rows<{ key: string; value: unknown; last_verified: string | null }>('config', supabase.from('config').select('key, value, last_verified').in('key', ['stress', 'leverage'])),
    loadHoldingsData(supabase),
    loadAssumptions(supabase),
    loadRules(supabase),
    loadAssetClasses(supabase),
  ]);
  // Own money and exposure by class: a short or leveraged line moves its class by its exposure.
  const totals = new Map<string, { valueTwd: number; exposureTwd: number }>();
  for (const holding of buildPortfolio(holdings).holdings) {
    if (!holding.assetClassId) continue;
    const total = totals.get(holding.assetClassId) ?? { valueTwd: 0, exposureTwd: 0 };
    total.valueTwd += holding.valueTwd ?? 0;
    total.exposureTwd += holding.valueTwd === null ? 0 : exposureOf(holding);
    totals.set(holding.assetClassId, total);
  }
  const rule = rules.find((entry) => entry.id === 'WINDFALL_ACCELERATION');
  return {
    settings: (() => {
      const row = config.find((entry) => entry.key === 'stress');
      return readStressSettings(row?.value, row?.last_verified ?? null);
    })(),
    leverage: leverageSettings(config.find((entry) => entry.key === 'leverage')?.value),
    classes: [...totals].map(([id, total]) => ({ id, valueTwd: total.valueTwd, ...(Math.abs(total.exposureTwd - total.valueTwd) > 1e-6 ? { exposureTwd: total.exposureTwd } : {}) })),
    classNames,
    expected: Object.fromEntries(Object.entries(assumptions?.assumptions ?? {}).map(([id, assumption]) => [id, assumption.expectedReturn])),
    acceleration: rule ? readAcceleration(rule.threshold) : null,
  };
}
