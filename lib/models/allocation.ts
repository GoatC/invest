/**
 * F6 drift and the N6 allocation lenses (PRD Modules B and E).
 *
 * Drift compares each asset class with its SAA target in the regular pool, the base the targets
 * are set on. A core class is coloured by F8's 5/25 rule (rules table, F8_DRIFT): red once F8
 * would draft a rebalance, amber once it has used a share of that band (config drift_display).
 * Satellite classes are left to R2, which watches the sleeve as a whole.
 *
 * The donuts split a pool three ways: by product type, by listing country (where a fund trades,
 * not what it owns) and by sleeve (passive core against active satellite), with the SAA's split
 * as the target ring where one exists.
 */
import type { Scope } from './performance';
import { satelliteValue, type Caps, type ClassWeight, type PoolView, type RuleRow } from './rules';
import type { AssetClass, Sleeve } from './types';
import type { Holding } from './valuation';

/** Floating-point sums a hair over a band are not over it. */
const TOLERANCE = 1e-9;

// ---------------------------------------------------------------------------
// F6: drift from the targets
// ---------------------------------------------------------------------------

export interface DriftBands {
  /** F8 drafts a rebalance beyond this absolute drift: 0.05 is 5 percentage points. */
  absDrift: number;
  /** …or beyond this share of the target itself: 0.25 is a quarter of it. */
  relDrift: number;
  /** Share of that band at which a class turns amber; 1 when no amber is set. */
  warnShare: number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The F8_DRIFT rule's band and the amber share from config; undefined while the rule is off or malformed. */
export function driftBands(rule: RuleRow | undefined, display: unknown): DriftBands | undefined {
  if (!rule?.enabled) return undefined;
  const { abs_drift: absDrift, rel_drift: relDrift } = record(rule.threshold);
  if (typeof absDrift !== 'number' || absDrift <= 0 || typeof relDrift !== 'number' || relDrift <= 0) return undefined;
  const warnShare = record(display)['warn_share'];
  return { absDrift, relDrift, warnShare: typeof warnShare === 'number' && warnShare > 0 && warnShare < 1 ? warnShare : 1 };
}

/** ok: within the amber share; watch: past it; rebalance: F8 would draft a rebalance; unchecked: no band applies. */
export type DriftStatus = 'ok' | 'watch' | 'rebalance' | 'unchecked';

export interface ClassDrift extends ClassWeight {
  /**
   * The drift beyond which F8 drafts a rebalance: the smaller of the absolute band and the share
   * of the target. Null for a satellite class, or with the rule off.
   */
  band: number | null;
  status: DriftStatus;
}

function statusFor(size: number, band: number, warnShare: number): DriftStatus {
  if (size - band > TOLERANCE) return 'rebalance';
  return size - warnShare * band > TOLERANCE ? 'watch' : 'ok';
}

/** Each class's band and status; nothing is checked while the regular pool holds nothing priced. */
export function classDrifts(classes: readonly ClassWeight[], bands: DriftBands | undefined, poolTotal: number): ClassDrift[] {
  return classes.map((row) => {
    if (row.assetClass.sleeve === 'satellite' || !bands) return { ...row, band: null, status: 'unchecked' };
    const band = Math.min(bands.absDrift, bands.relDrift * row.assetClass.targetWeight);
    return { ...row, band, status: poolTotal > 0 ? statusFor(Math.abs(row.drift), band, bands.warnShare) : 'unchecked' };
  });
}

export interface SatelliteCheck {
  weight: number;
  /** R2's target and trigger, from the rules table. */
  target: number;
  trigger: number;
  /** ok: at or below the target; watch: between the target and the trigger; rebalance: R2 trims. */
  status: DriftStatus;
}

/** The satellite sleeve against R2; undefined while R2 is off. */
export function satelliteCheck(pool: PoolView, caps: Caps): SatelliteCheck | undefined {
  if (!caps.satellite) return undefined;
  const { targetWeight: target, triggerWeight: trigger } = caps.satellite;
  if (pool.totalTwd <= 0) return { weight: 0, target, trigger, status: 'unchecked' };
  const weight = satelliteValue(pool) / pool.totalTwd;
  const status = weight - trigger > TOLERANCE ? 'rebalance' : weight - target > TOLERANCE ? 'watch' : 'ok';
  return { weight, target, trigger, status };
}

// ---------------------------------------------------------------------------
// N6: allocation lenses
// ---------------------------------------------------------------------------

export type Lens = 'product' | 'country' | 'sleeve';
export const LENSES: readonly Lens[] = ['product', 'country', 'sleeve'];

/** Each lens's slices in a fixed order, so a slice keeps its place and colour whatever else is held. */
export const SLICES: Record<Lens, readonly string[]> = {
  product: ['equity_etf', 'bond_etf', 'gold', 'cash_mmf', 'stock', 'theme_etf'],
  country: ['US', 'UK', 'TW', 'unlisted'],
  sleeve: ['core', 'satellite'],
};

/** The slice a holding falls in: physical gold joins gold ETFs, a non-listed asset is "unlisted". */
export function sliceOf(holding: Holding, lens: Lens): string {
  if (lens === 'product') return holding.productType;
  if (lens === 'country') return holding.market ?? 'unlisted';
  return holding.sleeve;
}

export interface SliceHolding {
  key: string;
  ticker: string | null;
  label: string;
  valueTwd: number;
  /** Share of the whole scope, not of the slice. */
  weight: number;
}

export interface Slice {
  key: string;
  valueTwd: number;
  weight: number;
  /** The target share, where the lens has one; null otherwise. */
  target: number | null;
  /** Largest first. */
  holdings: SliceHolding[];
}

export interface Allocation {
  /** Priced holdings in the scope, TWD. */
  totalTwd: number;
  slices: Record<Lens, Slice[]>;
  /** Holdings in the scope still waiting for a price, left out of the slices. */
  unpriced: Holding[];
}

/** The SAA's split between the core and the satellite: each sleeve's class targets added up. */
export function sleeveTargets(assetClasses: readonly AssetClass[]): Record<Sleeve, number> {
  const targets: Record<Sleeve, number> = { core: 0, satellite: 0 };
  for (const assetClass of assetClasses) targets[assetClass.sleeve] += assetClass.targetWeight;
  return targets;
}

/**
 * A scope's holdings split by every lens. `targets` (sleeve targets) draw the target ring of the
 * sleeve lens; pass them only for the regular pool, the one the SAA is set on.
 */
export function allocation(holdings: readonly Holding[], scope: Scope, targets?: Record<Sleeve, number>): Allocation {
  const inScope = holdings.filter((holding) => scope === 'all' || holding.pool === scope);
  const priced = inScope.filter((holding) => holding.valueTwd !== null && holding.valueTwd > 0);
  const totalTwd = priced.reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const share = (value: number) => (totalTwd > 0 ? value / totalTwd : 0);
  const slices = {} as Record<Lens, Slice[]>;
  for (const lens of LENSES) {
    slices[lens] = SLICES[lens]
      .map((key): Slice => {
        const members = priced
          .filter((holding) => sliceOf(holding, lens) === key)
          .map((holding) => ({ key: holding.key, ticker: holding.ticker, label: holding.label, valueTwd: holding.valueTwd ?? 0, weight: share(holding.valueTwd ?? 0) }))
          .sort((a, b) => b.valueTwd - a.valueTwd);
        const valueTwd = members.reduce((sum, member) => sum + member.valueTwd, 0);
        const target = lens === 'sleeve' && targets ? (targets[key as Sleeve] ?? null) : null;
        return { key, valueTwd, weight: share(valueTwd), target, holdings: members };
      })
      .filter((slice) => slice.valueTwd > 0 || (slice.target ?? 0) > 0);
  }
  return { totalTwd, slices, unpriced: inScope.filter((holding) => holding.valueTwd === null) };
}
