/**
 * Capital market assumptions (F6, PRD Module B): for each asset class, the expected yearly return
 * and volatility the owner sets, with where they come from. They are the config row `cma`
 * (PRD Section 7); F2, F5 and F7 read them.
 */
import type { AssetClass } from './types';

export interface Assumption {
  /** Expected yearly return: 0.06 is 6%. */
  expectedReturn: number;
  /** Yearly volatility (standard deviation): 0.15 is 15%. */
  volatility: number;
  source: string;
}

/** By asset class id. */
export type Assumptions = Record<string, Assumption>;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The config value read defensively: an entry that is not a complete assumption is left out. */
export function readAssumptions(value: unknown): Assumptions {
  const out: Assumptions = {};
  for (const [id, entry] of Object.entries(record(value))) {
    const { expected_return: expectedReturn, volatility, source } = record(entry);
    if (typeof expectedReturn !== 'number' || !Number.isFinite(expectedReturn)) continue;
    if (typeof volatility !== 'number' || !Number.isFinite(volatility) || volatility < 0) continue;
    if (typeof source !== 'string' || source.trim() === '') continue;
    out[id] = { expectedReturn, volatility, source };
  }
  return out;
}

/** The shape the config row stores. */
export function assumptionsValue(assumptions: Assumptions): Record<string, { expected_return: number; volatility: number; source: string }> {
  return Object.fromEntries(
    Object.entries(assumptions).map(([id, assumption]) => [id, { expected_return: assumption.expectedReturn, volatility: assumption.volatility, source: assumption.source }]),
  );
}

/**
 * The target mix's expected yearly return: each class's target weight times its expected return.
 * Null until every class with a target has an assumption.
 */
export function targetReturn(assetClasses: readonly AssetClass[], assumptions: Assumptions): number | null {
  let total = 0;
  for (const assetClass of assetClasses) {
    if (assetClass.targetWeight <= 0) continue;
    const assumption = assumptions[assetClass.id];
    if (!assumption) return null;
    total += assetClass.targetWeight * assumption.expectedReturn;
  }
  return total;
}
