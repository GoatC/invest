import type { Holding } from './valuation';
import type { AssetClass } from './types';

/** Weights a hair over a cap from floating-point sums are not breaches. */
const TOLERANCE = 1e-9;

/** The regular-contribution pool that R1, R2 and the targets measure. Windfall money is left out entirely. */
export interface PoolView {
  totalTwd: number;
  /** Regular-pool holdings with a known TWD value. */
  holdings: Holding[];
  /** Regular-pool holdings still waiting for a price; they are not in totalTwd. */
  unpriced: Holding[];
}

export function regularPool(holdings: readonly Holding[]): PoolView {
  const regular = holdings.filter((holding) => holding.pool === 'regular');
  const priced = regular.filter((holding) => holding.valueTwd !== null);
  return {
    totalTwd: priced.reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0),
    holdings: priced,
    unpriced: regular.filter((holding) => holding.valueTwd === null),
  };
}

/** R1 and R2 thresholds as stored in the rules table; a disabled or malformed rule is absent. */
export interface Caps {
  singleStock?: { maxWeight: number };
  satellite?: { triggerWeight: number; targetWeight: number };
}

export interface RuleRow {
  id: string;
  threshold: unknown;
  enabled: boolean;
}

function fraction(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 && value < 1 ? value : undefined;
}

export function capsFromRules(rows: readonly RuleRow[]): Caps {
  const caps: Caps = {};
  for (const row of rows) {
    if (!row.enabled || typeof row.threshold !== 'object' || row.threshold === null) continue;
    const threshold = row.threshold as Record<string, unknown>;
    if (row.id === 'R1') {
      const maxWeight = fraction(threshold['max_weight']);
      if (maxWeight !== undefined) caps.singleStock = { maxWeight };
    }
    if (row.id === 'R2') {
      const triggerWeight = fraction(threshold['trigger_weight']);
      const targetWeight = fraction(threshold['target_weight']);
      if (triggerWeight !== undefined && targetWeight !== undefined) caps.satellite = { triggerWeight, targetWeight };
    }
  }
  return caps;
}

/** A holding or sleeve above its cap, and how much to sell to fix it. */
export interface CapBreach {
  rule: 'R1' | 'R2';
  /** The stock's ticker for R1; "satellite" for R2. */
  subject: string;
  valueTwd: number;
  weight: number;
  limit: number;
  /**
   * TWD to sell to get back to the cap (R1) or down to the target (R2). The proceeds stay in the
   * regular pool, so its total does not change: trim = value − goal × total.
   */
  trimTwd: number;
}

/** R1: no single stock above max_weight of the regular pool. ETFs are not single stocks. */
export function singleStockBreaches(pool: PoolView, cap: NonNullable<Caps['singleStock']>): CapBreach[] {
  if (pool.totalTwd <= 0) return [];
  return pool.holdings
    .filter((holding) => holding.productType === 'stock')
    .map((holding) => {
      const valueTwd = holding.valueTwd ?? 0;
      return {
        rule: 'R1' as const,
        subject: holding.ticker ?? holding.label,
        valueTwd,
        weight: valueTwd / pool.totalTwd,
        limit: cap.maxWeight,
        trimTwd: valueTwd - cap.maxWeight * pool.totalTwd,
      };
    })
    .filter((breach) => breach.weight - breach.limit > TOLERANCE);
}

/** R2: when the satellite sleeve rises above trigger_weight of the regular pool, trim it back to target_weight. */
export function satelliteBreach(pool: PoolView, cap: NonNullable<Caps['satellite']>): CapBreach | undefined {
  if (pool.totalTwd <= 0) return undefined;
  const valueTwd = pool.holdings.filter((holding) => holding.sleeve === 'satellite').reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const weight = valueTwd / pool.totalTwd;
  if (weight - cap.triggerWeight <= TOLERANCE) return undefined;
  return { rule: 'R2', subject: 'satellite', valueTwd, weight, limit: cap.triggerWeight, trimTwd: valueTwd - cap.targetWeight * pool.totalTwd };
}

/** Every R1 and R2 breach in the regular pool; the check N5 runs before and after a trade is saved. */
export function capBreaches(holdings: readonly Holding[], caps: Caps): CapBreach[] {
  const pool = regularPool(holdings);
  const breaches = caps.singleStock ? singleStockBreaches(pool, caps.singleStock) : [];
  const satellite = caps.satellite ? satelliteBreach(pool, caps.satellite) : undefined;
  return satellite ? [...breaches, satellite] : breaches;
}

export interface ClassWeight {
  assetClass: AssetClass;
  valueTwd: number;
  /** Share of the priced regular pool, 0 to 1. */
  weight: number;
  /** weight − target, in fractions: 0.01 is one percentage point. */
  drift: number;
}

/** Actual against target weight per asset class, in the regular pool (N5 holdings view, F6). */
export function classWeights(pool: PoolView, assetClasses: readonly AssetClass[]): ClassWeight[] {
  return [...assetClasses]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((assetClass) => {
      const valueTwd = pool.holdings.filter((holding) => holding.assetClassId === assetClass.id).reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
      const weight = pool.totalTwd > 0 ? valueTwd / pool.totalTwd : 0;
      return { assetClass, valueTwd, weight, drift: weight - assetClass.targetWeight };
    });
}
