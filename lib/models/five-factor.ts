/**
 * N1 Regression Lab, Fama–French five-factor mode (PRD Module C, Phase 3 step 6): what drives a
 * stock's or the whole portfolio's return beyond the market, on Kenneth French's free factors.
 *
 *   R_i,t − R_f,t = α + β_mkt (R_m − R_f) + s SMB + h HML + r RMW + c CMA + ε
 *
 * Market, size (small minus big), value (high minus low book-to-market), profitability (robust
 * minus weak) and investment (conservative minus aggressive). Monthly, since the factors are.
 * - Returns are in US dollars, as the factors are: a Taiwan return is converted with the month's
 *   USD/TWD move. A holding's factors come from its market (config factors.regions): US-listed on
 *   the US factors, Taiwan on the emerging markets', London on the developed markets'; the whole
 *   portfolio, today's holdings held through the window at today's weights, on the global factors.
 * - Months where a factor is missing (-99.99 in the library) are left out.
 * - Each loading comes with its standard error, t-statistic (t = coefficient ÷ standard error) and
 *   a confidence interval, and the fit with R² and its adjusted R²; α is monthly and × 12.
 *
 * Pure functions on the OLS of regression.ts; the Factors page and the nightly job's factor feed use them.
 */
import { isMonth } from '../dates';
import { ols, studentQuantile, type Observation, type Point } from './regression';

export const FACTORS = ['mkt', 'smb', 'hml', 'rmw', 'cma'] as const;
export type Factor = (typeof FACTORS)[number];

export const FACTOR_NAMES: Record<Factor, { en: string; zh: string }> = {
  mkt: { en: 'Market (Mkt − Rf)', zh: '市場（Mkt − Rf）' },
  smb: { en: 'Size (SMB)', zh: '規模（SMB）' },
  hml: { en: 'Value (HML)', zh: '價值（HML）' },
  rmw: { en: 'Profitability (RMW)', zh: '獲利能力（RMW）' },
  cma: { en: 'Investment (CMA)', zh: '投資（CMA）' },
};

/** The regions the nightly job loads and the series each is saved under: ff5_<region>_<factor>. */
export const REGIONS = ['us', 'developed', 'emerging', 'global'] as const;
export type Region = (typeof REGIONS)[number];

export function seriesName(region: Region, factor: Factor | 'rf'): string {
  return `ff5_${region}_${factor}`;
}

/** One month of a region's factors, as fractions (1.5% is 0.015). */
export interface FactorMonth {
  /** YYYY-MM. */
  month: string;
  mkt: number;
  smb: number;
  hml: number;
  rmw: number;
  cma: number;
  rf: number;
}

// ---------------------------------------------------------------------------
// Settings (config factors)
// ---------------------------------------------------------------------------

export interface FactorSettings {
  /** Market → region of factors for a holding. */
  regions: Record<string, Region>;
  /** The region for the whole portfolio. */
  portfolio: Region;
  /** Windows the page offers, in years. */
  windows: number[];
  defaultWindow: number;
  confidence: number;
  /** Fewest months a fit needs. */
  minMonths: number;
  /** Years of factors the nightly job keeps. */
  keepYears: number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const isRegion = (value: unknown): value is Region => typeof value === 'string' && (REGIONS as readonly string[]).includes(value);

/** The config value read defensively; undefined when a part is missing or out of range. */
export function readFactorSettings(value: unknown): FactorSettings | undefined {
  const row = record(value);
  const regions: Record<string, Region> = {};
  for (const [market, region] of Object.entries(record(row['regions']))) if (isRegion(region)) regions[market] = region;
  const windows = row['windows'];
  const confidence = row['confidence'];
  const minMonths = row['min_months'];
  const keepYears = row['keep_years'];
  const defaultWindow = row['default_window'];
  if (Object.keys(regions).length === 0 || !isRegion(row['portfolio'])) return undefined;
  if (!Array.isArray(windows) || windows.length === 0 || !windows.every((w) => typeof w === 'number' && Number.isInteger(w) && w >= 1 && w <= 30)) return undefined;
  if (typeof defaultWindow !== 'number' || !windows.includes(defaultWindow)) return undefined;
  if (typeof confidence !== 'number' || !(confidence > 0.5 && confidence < 1)) return undefined;
  if (typeof minMonths !== 'number' || !Number.isInteger(minMonths) || minMonths < 12 || minMonths > 240) return undefined;
  if (typeof keepYears !== 'number' || !Number.isInteger(keepYears) || keepYears < 1 || keepYears > 60) return undefined;
  return { regions, portfolio: row['portfolio'], windows: [...(windows as number[])].sort((a, b) => a - b), defaultWindow, confidence, minMonths, keepYears };
}

// ---------------------------------------------------------------------------
// The regression
// ---------------------------------------------------------------------------

export interface Loading {
  factor: Factor;
  beta: number;
  stdErr: number;
  t: number;
  ci: [number, number];
}

export interface FactorFit {
  n: number;
  /** The first and last month fitted, YYYY-MM. */
  from: string;
  to: string;
  /** α per month, × 12, and its t-statistic. */
  alpha: number;
  alphaAnnual: number;
  alphaT: number;
  loadings: Loading[];
  r2: number;
  adjR2: number;
}

/**
 * The five-factor regression of monthly returns (simple, in the factors' currency, dated by month)
 * on the region's factors, over the months both have, newest `months` of them when given. Undefined
 * with fewer than `minMonths` months or collinear factors.
 */
export function fiveFactor(returns: readonly Point[], factors: readonly FactorMonth[], settings: Pick<FactorSettings, 'confidence' | 'minMonths'>, months?: number): FactorFit | undefined {
  const byMonth = new Map(factors.map((factor) => [factor.month, factor]));
  let observations: Observation[] = returns.flatMap((point): Observation[] => {
    const month = point.date.slice(0, 7);
    const factor = byMonth.get(month);
    return factor && isMonth(month) ? [{ date: month, y: point.value - factor.rf, x: FACTORS.map((key) => factor[key]) }] : [];
  });
  observations.sort((a, b) => a.date.localeCompare(b.date));
  if (months !== undefined) observations = observations.slice(-months);
  if (observations.length < settings.minMonths) return undefined;
  const fit = ols(observations);
  if (!fit) return undefined;
  const t = studentQuantile(1 - (1 - settings.confidence) / 2, fit.dof);
  const se = (index: number) => Math.sqrt(Math.max(0, (fit.covariance[index] as number[])[index] as number));
  const alpha = fit.coefficients[0] as number;
  return {
    n: fit.n,
    from: (observations[0] as Observation).date,
    to: (observations[observations.length - 1] as Observation).date,
    alpha,
    alphaAnnual: alpha * 12,
    alphaT: se(0) > 0 ? alpha / se(0) : 0,
    loadings: FACTORS.map((factor, i) => {
      const beta = fit.coefficients[i + 1] as number;
      const stdErr = se(i + 1);
      return { factor, beta, stdErr, t: stdErr > 0 ? beta / stdErr : 0, ci: [beta - t * stdErr, beta + t * stdErr] as [number, number] };
    }),
    r2: fit.r2,
    adjR2: 1 - ((1 - fit.r2) * (fit.n - 1)) / fit.dof,
  };
}

/** A US-dollar return from a series in another currency: the local return less the dollar's move against it. */
export function inDollars(local: readonly Point[], usdPerLocalGrowth: (month: string) => number | undefined): Point[] {
  return local.flatMap((point) => {
    const growth = usdPerLocalGrowth(point.date.slice(0, 7));
    return growth === undefined ? [] : [{ date: point.date, value: (1 + point.value) / growth - 1 }];
  });
}

/** The portfolio's monthly return: today's weights over the holdings that have a return that month, re-weighted. */
export function portfolioReturns(holdings: ReadonlyArray<{ weight: number; returns: readonly Point[] }>): Point[] {
  const months = new Map<string, Array<{ weight: number; value: number }>>();
  for (const holding of holdings) for (const point of holding.returns) months.set(point.date.slice(0, 7), [...(months.get(point.date.slice(0, 7)) ?? []), { weight: holding.weight, value: point.value }]);
  return [...months]
    .filter(([, list]) => list.length === holdings.length)
    .map(([month, list]) => {
      const total = list.reduce((sum, one) => sum + one.weight, 0);
      return { date: `${month}-01`, value: list.reduce((sum, one) => sum + one.weight * one.value, 0) / total };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
