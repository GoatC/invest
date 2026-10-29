/**
 * F7 efficient frontier and capital market line (PRD Module B, Phase 3 step 7 of the roadmap,
 * step 4 of the build). Reference only: it shows where the mix you set sits among the portfolios
 * the same inputs could build, and never writes back to the F6 targets.
 *
 * Method (long-only mean–variance):
 *   minimise  ½ wᵀΣw − λ μᵀw   subject to  Σw = 1,  min ≤ w ≤ max
 * - μ: the capital market assumptions' expected yearly return of each class (F6).
 * - Σ: the sample covariance of the classes' monthly returns in TWD (each class's benchmark ETF,
 *   the N4 proxy) over the last `lookback_years`, × 12 for a year; only months every class has.
 * - Bounds: per class, config frontier. The problem is solved exactly by sequential pair moves
 *   (the maximal-violating-pair rule of SMO): move weight from one class to another by the 1-D
 *   optimum, within the bounds, until no pair improves.
 * - λ = 0 is the minimum-variance portfolio; the frontier is traced by finding the λ that gives
 *   each target return from there up to the highest the bounds allow. Sharpe = (E[Rp] − Rf) ÷ σp;
 *   the tangent portfolio maximises it, and the capital market line runs from (0, Rf) through it.
 *
 * Pure functions; the Frontier page uses them.
 */
import { isMonth } from '../dates';
import type { Point } from './regression';

// ---------------------------------------------------------------------------
// Settings (config frontier)
// ---------------------------------------------------------------------------

export interface FrontierSettings {
  lookbackYears: number;
  /** Fewest common months to run on. */
  minMonths: number;
  /** Points along the frontier. */
  points: number;
  /** The yearly rate the capital market line starts from; 0.017 is 1.7%. */
  riskFree: number;
  /** Weight bounds by asset class id: [min, max] as fractions. */
  bounds: Record<string, [number, number]>;
  lastVerified: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The config value read defensively; undefined when a required part is missing or out of range. */
export function readFrontierSettings(value: unknown, lastVerified: string | null = null): FrontierSettings | undefined {
  const row = record(value);
  const { lookback_years: years, min_months: minMonths, points, risk_free: riskFree } = row;
  if (typeof years !== 'number' || !Number.isInteger(years) || years < 1 || years > 30) return undefined;
  if (typeof minMonths !== 'number' || !Number.isInteger(minMonths) || minMonths < 12 || minMonths > 600) return undefined;
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 5 || points > 200) return undefined;
  if (typeof riskFree !== 'number' || !(riskFree > -0.05 && riskFree < 0.3)) return undefined;
  const bounds: Record<string, [number, number]> = {};
  for (const [id, entry] of Object.entries(record(row['bounds']))) {
    if (!Array.isArray(entry) || entry.length !== 2) return undefined;
    const [min, max] = entry as unknown[];
    if (typeof min !== 'number' || typeof max !== 'number' || !(min >= 0 && max <= 1 && min <= max)) return undefined;
    bounds[id] = [min, max];
  }
  if (Object.keys(bounds).length === 0) return undefined;
  return { lookbackYears: years, minMonths, points, riskFree, bounds, lastVerified };
}

// ---------------------------------------------------------------------------
// Covariance and correlation
// ---------------------------------------------------------------------------

/** The sample covariance of the columns, × `scale` (12 turns monthly into yearly). */
export function covarianceMatrix(columns: ReadonlyArray<readonly number[]>, scale = 12): number[][] {
  const k = columns.length;
  const n = columns[0]?.length ?? 0;
  const means = columns.map((column) => column.reduce((sum, value) => sum + value, 0) / n);
  return Array.from({ length: k }, (_, a) =>
    Array.from({ length: k }, (_, b) => {
      let sum = 0;
      for (let t = 0; t < n; t++) sum += ((columns[a] as readonly number[])[t] as number - (means[a] as number)) * ((columns[b] as readonly number[])[t] as number - (means[b] as number));
      return n > 1 ? (sum / (n - 1)) * scale : 0;
    }),
  );
}

/** Correlations from a covariance matrix; a class with no variance has 0 with the others and 1 with itself. */
export function correlationMatrix(covariance: ReadonlyArray<readonly number[]>): number[][] {
  return covariance.map((row, a) =>
    row.map((value, b) => {
      if (a === b) return 1;
      const scale = Math.sqrt((covariance[a]?.[a] ?? 0) * (covariance[b]?.[b] ?? 0));
      return scale > 0 ? value / scale : 0;
    }),
  );
}

// ---------------------------------------------------------------------------
// The optimiser
// ---------------------------------------------------------------------------

export interface Problem {
  /** Expected yearly returns. */
  mu: readonly number[];
  /** Covariance of yearly returns. */
  sigma: ReadonlyArray<readonly number[]>;
  lo: readonly number[];
  hi: readonly number[];
}

/** The bounds can hold weights summing to 1. */
export function feasible(problem: Pick<Problem, 'lo' | 'hi'>): boolean {
  const low = problem.lo.reduce((sum, value) => sum + value, 0);
  const high = problem.hi.reduce((sum, value) => sum + value, 0);
  return low <= 1 + 1e-12 && high >= 1 - 1e-12;
}

/** Start at the minimums and fill each class up to its maximum, in order, until the weights sum to 1. */
function start(problem: Pick<Problem, 'lo' | 'hi'>): number[] {
  const w = [...problem.lo];
  let left = 1 - w.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < w.length && left > 1e-15; i++) {
    const add = Math.min(left, (problem.hi[i] as number) - (w[i] as number));
    w[i] = (w[i] as number) + add;
    left -= add;
  }
  return w;
}

/** Minimises ½ wᵀΣw − λ μᵀw over the bounded simplex. Throws when the bounds cannot hold weights summing to 1. */
export function solve(problem: Problem, lambda: number, tolerance = 1e-13): number[] {
  if (!feasible(problem)) throw new Error('bounds cannot sum to 1');
  const { mu, sigma, lo, hi } = problem;
  const k = mu.length;
  const w = start(problem);
  const gradient = (i: number) => {
    let g = -lambda * (mu[i] as number);
    for (let j = 0; j < k; j++) g += ((sigma[i] as readonly number[])[j] as number) * (w[j] as number);
    return g;
  };
  for (let iteration = 0; iteration < 20000; iteration++) {
    // The class whose weight is most worth raising, and the one most worth lowering.
    let up = -1;
    let down = -1;
    let gUp = Infinity;
    let gDown = -Infinity;
    for (let i = 0; i < k; i++) {
      const g = gradient(i);
      if ((w[i] as number) < (hi[i] as number) - 1e-15 && g < gUp) {
        gUp = g;
        up = i;
      }
      if ((w[i] as number) > (lo[i] as number) + 1e-15 && g > gDown) {
        gDown = g;
        down = i;
      }
    }
    if (up < 0 || down < 0 || up === down || gDown - gUp < tolerance) break;
    const curvature = ((sigma[up] as readonly number[])[up] as number) + ((sigma[down] as readonly number[])[down] as number) - 2 * ((sigma[up] as readonly number[])[down] as number);
    const room = Math.min((hi[up] as number) - (w[up] as number), (w[down] as number) - (lo[down] as number));
    const step = curvature > 1e-14 ? Math.min((gDown - gUp) / curvature, room) : room;
    w[up] = (w[up] as number) + step;
    w[down] = (w[down] as number) - step;
  }
  return w;
}

export function expectedReturn(w: readonly number[], mu: readonly number[]): number {
  return w.reduce((sum, weight, i) => sum + weight * (mu[i] as number), 0);
}

export function volatility(w: readonly number[], sigma: ReadonlyArray<readonly number[]>): number {
  let variance = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) variance += (w[i] as number) * (w[j] as number) * ((sigma[i] as readonly number[])[j] as number);
  return Math.sqrt(Math.max(variance, 0));
}

/** PRD F7: Sharpe = (E[Rp] − Rf) ÷ σp; null for a portfolio with no volatility. */
export function sharpe(ret: number, vol: number, riskFree: number): number | null {
  return vol > 1e-12 ? (ret - riskFree) / vol : null;
}

export interface FrontierPoint {
  ret: number;
  vol: number;
  weights: number[];
}

function pointOf(w: number[], problem: Problem): FrontierPoint {
  return { ret: expectedReturn(w, problem.mu), vol: volatility(w, problem.sigma), weights: w };
}

/** The highest expected return the bounds allow: fill the best-returning classes first. */
export function highestReturn(problem: Pick<Problem, 'mu' | 'lo' | 'hi'>): FrontierPoint | null {
  if (!feasible(problem)) return null;
  const w = [...problem.lo];
  let left = 1 - w.reduce((sum, value) => sum + value, 0);
  const order = problem.mu.map((value, i) => ({ value, i })).sort((a, b) => b.value - a.value);
  for (const { i } of order) {
    const add = Math.min(left, (problem.hi[i] as number) - (w[i] as number));
    w[i] = (w[i] as number) + add;
    left -= add;
  }
  return { ret: expectedReturn(w, problem.mu), vol: NaN, weights: w };
}

/** The portfolio at a given λ; `ret` rises with λ. */
function atLambda(problem: Problem, lambda: number): FrontierPoint {
  return pointOf(solve(problem, lambda), problem);
}

/** The λ whose portfolio earns `target`, between the minimum-variance return and the highest. */
function lambdaFor(problem: Problem, target: number): number {
  let low = 0;
  let high = 1;
  while (atLambda(problem, high).ret < target - 1e-12 && high < 1e9) high *= 4;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (atLambda(problem, mid).ret < target) low = mid;
    else high = mid;
  }
  return high;
}

/**
 * The frontier from the minimum-variance portfolio to the highest return the bounds allow, at
 * `points` evenly spaced returns. A single point when every class earns the same.
 */
export function frontier(problem: Problem, points: number): FrontierPoint[] {
  if (!feasible(problem)) return [];
  const first = atLambda(problem, 0);
  const top = highestReturn(problem);
  if (!top || top.ret - first.ret < 1e-9) return [first];
  const out: FrontierPoint[] = [first];
  for (let n = 1; n < points - 1; n++) {
    const target = first.ret + ((top.ret - first.ret) * n) / (points - 1);
    out.push(atLambda(problem, lambdaFor(problem, target)));
  }
  out.push(atLambda(problem, lambdaFor(problem, top.ret - 1e-10)));
  return out;
}

/**
 * The portfolio on the frontier with the highest Sharpe ratio: the best of the frontier's points,
 * then refined between its neighbours; null when nothing on it beats the risk-free rate.
 */
export function tangent(problem: Problem, curve: readonly FrontierPoint[], riskFree: number): (FrontierPoint & { sharpe: number }) | null {
  let best = -1;
  let bestSharpe = -Infinity;
  curve.forEach((point, i) => {
    const value = sharpe(point.ret, point.vol, riskFree);
    if (value !== null && value > bestSharpe) {
      bestSharpe = value;
      best = i;
    }
  });
  const around = curve[best];
  if (!around || bestSharpe <= 0) return null;
  // Golden-section between the neighbours' returns, by the λ that gives each return.
  const low = (curve[Math.max(best - 1, 0)] as FrontierPoint).ret;
  const high = (curve[Math.min(best + 1, curve.length - 1)] as FrontierPoint).ret;
  const at = (target: number) => {
    const point = atLambda(problem, lambdaFor(problem, target));
    return { point, value: sharpe(point.ret, point.vol, riskFree) ?? -Infinity };
  };
  let a = low;
  let b = high;
  const ratio = (Math.sqrt(5) - 1) / 2;
  let c = b - ratio * (b - a);
  let d = a + ratio * (b - a);
  let fc = at(c);
  let fd = at(d);
  for (let i = 0; i < 40 && b - a > 1e-9; i++) {
    if (fc.value > fd.value) {
      b = d;
      d = c;
      fd = fc;
      c = b - ratio * (b - a);
      fc = at(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + ratio * (b - a);
      fd = at(d);
    }
  }
  const refined = fc.value > fd.value ? fc : fd;
  const winner = refined.value > bestSharpe ? refined : { point: around, value: bestSharpe };
  return { ...winner.point, sharpe: winner.value };
}

/** The capital market line at a volatility: Rf + Sharpe(tangent) × σ. */
export function marketLine(tangentPoint: Pick<FrontierPoint, 'ret' | 'vol'>, riskFree: number, vol: number): number {
  return riskFree + ((tangentPoint.ret - riskFree) / tangentPoint.vol) * vol;
}

// ---------------------------------------------------------------------------
// From classes' monthly returns to a problem
// ---------------------------------------------------------------------------

export interface ClassInput {
  id: string;
  /** Expected yearly return from the CMA; null when the class has none. */
  expected: number | null;
  /** The class's monthly TWD returns, oldest first. */
  returns: readonly Point[];
}

export interface Built {
  /** What to optimise. */
  model: Problem;
  /** The classes in the problem's order. */
  ids: string[];
  correlation: number[][];
  from: string;
  to: string;
  months: number;
  left: Array<{ id: string; reason: 'assumption' | 'history' | 'bounds' }>;
}

export type BuildProblem = { problem: 'classes' } | { problem: 'history'; months: number; need: number } | { problem: 'bounds' };

/**
 * Joins the classes on their common months (the newest `months` of them) and builds the problem;
 * a class without an assumption, history or bounds is left out and named.
 */
export function build(classes: readonly ClassInput[], bounds: Readonly<Record<string, [number, number]>>, settings: Pick<FrontierSettings, 'minMonths'>, months?: number): Built | BuildProblem {
  const left: Built['left'] = [];
  const used: ClassInput[] = [];
  for (const entry of classes) {
    if (entry.expected === null) left.push({ id: entry.id, reason: 'assumption' });
    else if (entry.returns.length === 0) left.push({ id: entry.id, reason: 'history' });
    else if (!bounds[entry.id]) left.push({ id: entry.id, reason: 'bounds' });
    else used.push(entry);
  }
  const first = used[0];
  if (!first) return { problem: 'classes' };
  let common = new Set(first.returns.map((point) => point.date.slice(0, 7)));
  for (const entry of used.slice(1)) {
    const have = new Set(entry.returns.map((point) => point.date.slice(0, 7)));
    common = new Set([...common].filter((month) => have.has(month)));
  }
  let keep = [...common].filter(isMonth).sort();
  if (months !== undefined) keep = keep.slice(-months);
  if (keep.length < settings.minMonths) return { problem: 'history', months: keep.length, need: settings.minMonths };
  const columns = used.map((entry) => {
    const byMonth = new Map(entry.returns.map((point) => [point.date.slice(0, 7), point.value]));
    return keep.map((month) => byMonth.get(month) as number);
  });
  const sigma = covarianceMatrix(columns);
  const problem: Problem = {
    mu: used.map((entry) => entry.expected as number),
    sigma,
    lo: used.map((entry) => (bounds[entry.id] as [number, number])[0]),
    hi: used.map((entry) => (bounds[entry.id] as [number, number])[1]),
  };
  if (!feasible(problem)) return { problem: 'bounds' };
  return { model: problem, ids: used.map((entry) => entry.id), correlation: correlationMatrix(sigma), from: keep[0] as string, to: keep[keep.length - 1] as string, months: keep.length, left };
}

/** Weights by class id as a vector in the problem's order, re-weighted to 100% of the classes used. */
export function weightsFor(ids: readonly string[], byClass: Readonly<Record<string, number>>): number[] | null {
  const raw = ids.map((id) => Math.max(byClass[id] ?? 0, 0));
  const total = raw.reduce((sum, value) => sum + value, 0);
  return total > 0 ? raw.map((value) => value / total) : null;
}
