/**
 * N1 Regression Lab (PRD Module C, Phase 2 step 2): how much a stock or fund moves with the market,
 * by an OLS regression of its excess returns on the market's, against the S&P 500 and TAIEX side by
 * side. Single-factor (CAPM β) in Phase 2; the Fama–French five factors come in Phase 3.
 *
 *   R_i,t − R_f,t = α + β (R_m,t − R_f,t) + ε
 *
 * Method:
 * - Returns come from adjusted closes (dividends reinvested): daily, weekly (the last close on or
 *   before each Friday) or monthly (the last close of each month); a market closed all period keeps
 *   its last close. Each series in its own currency, or all in TWD at the day's rate.
 * - R_f is the currency's yearly rate for the period's month (config regression.risk_free when no
 *   monthly series is loaded), over the periods in a year.
 * - Taiwan closes before New York opens, so daily returns across the two markets are out of step.
 *   A daily regression across markets adds the market's adjacent day: a Taiwan series against a US
 *   index takes the index's day before, a US or London one against TAIEX its day after. β is the
 *   sum of the two slopes (Dimson), with the standard error of that sum.
 * - Outputs: β, its standard error and confidence interval (Student t), α per period and a year
 *   (× periods a year), R², Blume's adjusted β (0.67 β + 0.33), and β over a rolling 52 weeks.
 *
 * Pure functions; the Regression Lab page and the nightly job's monthly β (beta_results) use them.
 */
import { addDays } from '../dates';

export type Frequency = 'daily' | 'weekly' | 'monthly';
export const FREQUENCIES: readonly Frequency[] = ['daily', 'weekly', 'monthly'];
export const PERIODS_PER_YEAR: Record<Frequency, number> = { daily: 252, weekly: 52, monthly: 12 };
export type CurrencyBasis = 'local' | 'TWD';

/** The indices the nightly job loads into index_prices (config regression names them as benchmarks). */
export const INDICES = ['SPX', 'TAIEX'] as const;

/** The monthly series of the US 3-month Treasury bill rate (FRED TB3MS), a fraction a year. */
export const RISK_FREE_SERIES: Record<string, string> = { USD: 'us_tbill_3m' };

export interface Close {
  date: string;
  close: number;
}

/** A return over the period ending on `date`. */
export interface Point {
  date: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Settings (config regression)
// ---------------------------------------------------------------------------

export interface Benchmark {
  id: string;
  nameEn: string;
  nameZh: string;
  market: string;
  currency: string;
}

export interface RegressionSettings {
  benchmarks: Benchmark[];
  defaults: { freq: Frequency; years: number; currency: CurrencyBasis };
  /** The windows offered, in years: [1, 2, 3, 5]. */
  windows: number[];
  confidence: number;
  /** Blume: weight × β + (1 − weight) × prior. */
  blume: { weight: number; prior: number };
  rollingWeeks: number;
  minObservations: number;
  compareMax: number;
  /** Yearly risk-free rate by currency when no monthly series covers the month. */
  riskFree: Record<string, number>;
  riskFreeChecked: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** config regression, read defensively; undefined when a part is missing or out of range. */
export function readRegressionSettings(value: unknown): RegressionSettings | undefined {
  const row = record(value);
  const benchmarks: Benchmark[] = [];
  for (const [id, entry] of Object.entries(record(row['benchmarks']))) {
    const item = record(entry);
    const { name_en: nameEn, name_zh: nameZh, market, currency } = item;
    if (typeof nameEn !== 'string' || typeof nameZh !== 'string' || typeof market !== 'string' || typeof currency !== 'string') return undefined;
    benchmarks.push({ id, nameEn, nameZh, market, currency });
  }
  const defaults = record(row['defaults']);
  const freq = defaults['freq'];
  const years = defaults['window_years'];
  const currency = defaults['currency'];
  const windows = row['windows'];
  const confidence = row['confidence'];
  const blume = record(row['blume']);
  const rollingWeeks = row['rolling_weeks'];
  const minObservations = row['min_observations'];
  const compareMax = row['compare_max'];
  const riskFree = record(row['risk_free']);
  if (benchmarks.length === 0 || !FREQUENCIES.includes(freq as Frequency) || (currency !== 'local' && currency !== 'TWD')) return undefined;
  if (!Array.isArray(windows) || windows.length === 0 || !windows.every((year) => isNumber(year) && Number.isInteger(year) && year > 0)) return undefined;
  if (!isNumber(years) || !windows.includes(years)) return undefined;
  if (!isNumber(confidence) || !(confidence > 0.5 && confidence < 1)) return undefined;
  if (!isNumber(blume['weight']) || !isNumber(blume['prior']) || blume['weight'] < 0 || blume['weight'] > 1) return undefined;
  if (!isNumber(rollingWeeks) || !Number.isInteger(rollingWeeks) || rollingWeeks < 4) return undefined;
  if (!isNumber(minObservations) || !Number.isInteger(minObservations) || minObservations < 4) return undefined;
  if (!isNumber(compareMax) || !Number.isInteger(compareMax) || compareMax < 1) return undefined;
  const rates: Record<string, number> = {};
  for (const [key, rate] of Object.entries(riskFree)) if (/^[A-Z]{3}$/.test(key) && isNumber(rate) && rate > -0.1 && rate < 0.5) rates[key] = rate;
  const checked = riskFree['last_verified'];
  return {
    benchmarks,
    defaults: { freq: freq as Frequency, years, currency },
    windows: [...(windows as number[])].sort((a, b) => a - b),
    confidence,
    blume: { weight: blume['weight'], prior: blume['prior'] },
    rollingWeeks,
    minObservations,
    compareMax,
    riskFree: rates,
    riskFreeChecked: typeof checked === 'string' ? checked : null,
  };
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

/** The Friday on or after a date: the week a close belongs to. */
function fridayOnOrAfter(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, (5 - weekday + 7) % 7);
}

/** The last day of a date's month. */
function monthEnd(date: string): string {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function periodEnd(date: string, freq: Frequency): string {
  return freq === 'weekly' ? fridayOnOrAfter(date) : freq === 'monthly' ? monthEnd(date) : date;
}

function nextPeriod(end: string, freq: Frequency): string {
  return freq === 'weekly' ? addDays(end, 7) : monthEnd(addDays(end, 1));
}

/**
 * Returns over each period, oldest first. Daily: from one close to the next. Weekly and monthly:
 * from the last close on or before one period's end to the next's, every period from the first
 * close on, a period without a close keeping the last one (a return of 0).
 */
export function periodReturns(closes: readonly Close[], freq: Frequency): Point[] {
  const sorted = closes.filter((row) => row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (freq === 'daily') {
    return sorted.slice(1).map((row, i) => ({ date: row.date, value: row.close / (sorted[i] as Close).close - 1 }));
  }
  const last = new Map<string, number>();
  for (const row of sorted) last.set(periodEnd(row.date, freq), row.close);
  const first = sorted[0];
  const final = sorted[sorted.length - 1];
  if (!first || !final) return [];
  const out: Point[] = [];
  let previous = last.get(periodEnd(first.date, freq)) as number;
  for (let end = nextPeriod(periodEnd(first.date, freq), freq), stop = periodEnd(final.date, freq); end <= stop; end = nextPeriod(end, freq)) {
    const close = last.get(end) ?? previous;
    out.push({ date: end, value: close / previous - 1 });
    previous = close;
  }
  return out;
}

/** Each close × the currency's TWD rate on or before its date; closes before the first rate are left out. */
export function inTwd(closes: readonly Close[], rates: readonly Close[]): Close[] {
  const sorted = [...rates].sort((a, b) => a.date.localeCompare(b.date));
  const out: Close[] = [];
  let at = -1;
  for (const row of [...closes].sort((a, b) => a.date.localeCompare(b.date))) {
    while (at + 1 < sorted.length && (sorted[at + 1] as Close).date <= row.date) at += 1;
    const rate = sorted[at];
    if (rate) out.push({ date: row.date, close: row.close * rate.close });
  }
  return out;
}

/** A yearly rate per month (YYYY-MM): the month's, else the newest before it, else the fallback. */
export function rateOn(monthly: ReadonlyMap<string, number>, month: string, fallback: number): number {
  const exact = monthly.get(month);
  if (exact !== undefined) return exact;
  let best: string | undefined;
  for (const key of monthly.keys()) if (key < month && (best === undefined || key > best)) best = key;
  return best === undefined ? fallback : (monthly.get(best) as number);
}

/** Returns less the period's share of the yearly risk-free rate. */
export function excessReturns(returns: readonly Point[], freq: Frequency, rate: (month: string) => number): Point[] {
  return returns.map((point) => ({ date: point.date, value: point.value - rate(point.date.slice(0, 7)) / PERIODS_PER_YEAR[freq] }));
}

// ---------------------------------------------------------------------------
// Aligning a series with the market
// ---------------------------------------------------------------------------

/** The market's adjacent day a daily regression adds (Dimson): none, the day before, or the day after. */
export type Adjacent = 'none' | 'previous' | 'next';

/** Each market's close in hours UTC: Taipei 13:30, London 16:30, New York 16:00 (21:00 UTC). */
const CLOSE_UTC: Record<string, number> = { TW: 5.5, UK: 16.5, US: 21 };

/**
 * The adjacent day for a series and an index: on daily returns, a series that closes more than
 * eight hours before the index (a Taiwan stock against the S&P 500) reacts to the index's day
 * before; one that closes more than eight hours after it (a US stock against TAIEX) moves TAIEX's
 * day after. Weekly and monthly returns overlap almost entirely, so they need neither.
 */
export function adjacentDay(seriesMarket: string, indexMarket: string, freq: Frequency): Adjacent {
  const [series, index] = [CLOSE_UTC[seriesMarket], CLOSE_UTC[indexMarket]];
  if (freq !== 'daily' || series === undefined || index === undefined) return 'none';
  if (index - series > 8) return 'previous';
  if (series - index > 8) return 'next';
  return 'none';
}

export interface Observation {
  date: string;
  /** The series' excess return. */
  y: number;
  /** The market's excess return that period, then the adjacent day's when there is one. */
  x: number[];
}

/** Periods both have; with an adjacent day, only those where the market has that day too. */
export function align(series: readonly Point[], market: readonly Point[], adjacent: Adjacent): Observation[] {
  const at = new Map(market.map((point, index) => [point.date, index]));
  const out: Observation[] = [];
  for (const point of series) {
    const index = at.get(point.date);
    if (index === undefined) continue;
    const same = (market[index] as Point).value;
    if (adjacent === 'none') {
      out.push({ date: point.date, y: point.value, x: [same] });
      continue;
    }
    const other = market[adjacent === 'previous' ? index - 1 : index + 1];
    if (other) out.push({ date: point.date, y: point.value, x: [same, other.value] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// OLS and the t distribution
// ---------------------------------------------------------------------------

export interface Fit {
  /** Intercept first, then one slope per regressor. */
  coefficients: number[];
  /** σ² (XᵀX)⁻¹. */
  covariance: number[][];
  n: number;
  /** n − the coefficients. */
  dof: number;
  r2: number;
}

/** The inverse of a small symmetric matrix by Gauss–Jordan elimination; undefined when singular. */
function invert(matrix: readonly number[][]): number[][] | undefined {
  const size = matrix.length;
  const a = matrix.map((row, i) => [...row, ...Array.from({ length: size }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) if (Math.abs((a[row] as number[])[col] as number) > Math.abs((a[pivot] as number[])[col] as number)) pivot = row;
    const top = a[pivot] as number[];
    if (Math.abs(top[col] as number) < 1e-14) return undefined;
    [a[col], a[pivot]] = [top, a[col] as number[]];
    const lead = a[col] as number[];
    const scale = lead[col] as number;
    for (let k = 0; k < 2 * size; k++) lead[k] = (lead[k] as number) / scale;
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const current = a[row] as number[];
      const factor = current[col] as number;
      for (let k = 0; k < 2 * size; k++) current[k] = (current[k] as number) - factor * (lead[k] as number);
    }
  }
  return a.map((row) => row.slice(size));
}

/** Ordinary least squares of y on an intercept and the x terms; undefined with too few observations or collinear terms. */
export function ols(observations: readonly Observation[]): Fit | undefined {
  const n = observations.length;
  const terms = (observations[0]?.x.length ?? 0) + 1;
  if (n <= terms) return undefined;
  const xtx = Array.from({ length: terms }, () => Array<number>(terms).fill(0));
  const xty = Array<number>(terms).fill(0);
  for (const { x, y } of observations) {
    const row = [1, ...x];
    for (let i = 0; i < terms; i++) {
      xty[i] = (xty[i] as number) + (row[i] as number) * y;
      for (let j = 0; j < terms; j++) (xtx[i] as number[])[j] = ((xtx[i] as number[])[j] as number) + (row[i] as number) * (row[j] as number);
    }
  }
  const inverse = invert(xtx);
  if (!inverse) return undefined;
  const coefficients = inverse.map((row) => row.reduce((sum, value, j) => sum + value * (xty[j] as number), 0));
  const mean = observations.reduce((sum, { y }) => sum + y, 0) / n;
  let sse = 0;
  let sst = 0;
  for (const { x, y } of observations) {
    const fitted = [1, ...x].reduce((sum, value, i) => sum + value * (coefficients[i] as number), 0);
    sse += (y - fitted) ** 2;
    sst += (y - mean) ** 2;
  }
  const dof = n - terms;
  const variance = sse / dof;
  return {
    coefficients,
    covariance: inverse.map((row) => row.map((value) => value * variance)),
    n,
    dof,
    r2: sst > 0 ? Math.max(0, 1 - sse / sst) : 0,
  };
}

/** ln Γ(x), Lanczos (g = 7, nine coefficients). */
function lnGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const z = x - 1;
  let sum = c[0] as number;
  for (let i = 1; i < 9; i++) sum += (c[i] as number) / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** The continued fraction of the regularized incomplete beta function (modified Lentz). */
function betaFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h;
}

/** The regularized incomplete beta function I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(a, b, x)) / a : 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

/** P(T ≤ t) for Student's t with `dof` degrees of freedom. */
export function studentCdf(t: number, dof: number): number {
  const tail = 0.5 * incompleteBeta(dof / (dof + t * t), dof / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** The t value with P(T ≤ t) = p, by bisection: 3.182 for p = 0.975 and 3 degrees of freedom. */
export function studentQuantile(p: number, dof: number): number {
  if (p === 0.5) return 0;
  if (p < 0.5) return -studentQuantile(1 - p, dof);
  let [low, high] = [0, 1];
  while (studentCdf(high, dof) < p) high *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (studentCdf(mid, dof) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// ---------------------------------------------------------------------------
// β and what comes with it
// ---------------------------------------------------------------------------

export interface BetaFigures {
  /** The slope, or with an adjacent day the sum of both slopes (Dimson). */
  beta: number;
  /** Each slope: the period's, then the adjacent day's. */
  slopes: number[];
  stdErr: number;
  ci: [number, number];
  /** α per period, and × periods a year. */
  alpha: number;
  alphaAnnual: number;
  r2: number;
  /** Blume: weight × β + (1 − weight) × prior. */
  adjusted: number;
  n: number;
}

/** β from a fit: the slopes summed, the standard error of that sum, the interval at `confidence`. */
export function betaFigures(fit: Fit, freq: Frequency, settings: Pick<RegressionSettings, 'confidence' | 'blume'>): BetaFigures {
  const slopes = fit.coefficients.slice(1);
  const beta = slopes.reduce((sum, value) => sum + value, 0);
  let variance = 0;
  for (let i = 1; i < fit.coefficients.length; i++) for (let j = 1; j < fit.coefficients.length; j++) variance += (fit.covariance[i] as number[])[j] as number;
  const stdErr = Math.sqrt(Math.max(0, variance));
  const t = studentQuantile(1 - (1 - settings.confidence) / 2, fit.dof);
  const alpha = fit.coefficients[0] as number;
  return {
    beta,
    slopes,
    stdErr,
    ci: [beta - t * stdErr, beta + t * stdErr],
    alpha,
    alphaAnnual: alpha * PERIODS_PER_YEAR[freq],
    r2: fit.r2,
    adjusted: settings.blume.weight * beta + (1 - settings.blume.weight) * settings.blume.prior,
    n: fit.n,
  };
}

/** The observations of the last `years` up to the newest one. */
export function lastYears(observations: readonly Observation[], years: number): Observation[] {
  const end = observations[observations.length - 1]?.date;
  if (!end) return [];
  const [year, month, day] = end.split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(year - years, month - 1, day)).toISOString().slice(0, 10);
  return observations.filter((observation) => observation.date > start);
}

/**
 * β over a trailing window of `weeks` at each observation once a whole window lies behind it, the
 * observations in it counted from the window's own (52 weeks of weekly returns are 52).
 */
export function rollingBeta(observations: readonly Observation[], weeks: number, minObservations: number): Point[] {
  const first = observations[0]?.date;
  if (!first) return [];
  const out: Point[] = [];
  let start = 0;
  for (let end = 0; end < observations.length; end++) {
    const date = (observations[end] as Observation).date;
    const from = addDays(date, -7 * weeks);
    if (from < first) continue;
    while ((observations[start] as Observation).date <= from) start += 1;
    const window = observations.slice(start, end + 1);
    if (window.length < minObservations) continue;
    const fit = ols(window);
    if (fit) out.push({ date, value: fit.coefficients.slice(1).reduce((sum, value) => sum + value, 0) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The whole regression of one series on one index
// ---------------------------------------------------------------------------

export interface SeriesInput {
  closes: readonly Close[];
  market: string;
  currency: string;
}

export interface RegressionInput {
  series: SeriesInput;
  index: SeriesInput;
  freq: Frequency;
  years: number;
  basis: CurrencyBasis;
  /** TWD per unit of each foreign currency, by day, for the TWD basis. */
  fx: ReadonlyMap<string, readonly Close[]>;
  /** Monthly yearly rates by currency (YYYY-MM → fraction). */
  riskFree: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export interface Regression extends BetaFigures {
  adjacent: Adjacent;
  from: string;
  to: string;
  /** The observations: the series' excess return against the market's (summed over the adjacent day). */
  points: Array<{ date: string; x: number; y: number }>;
  rolling: Point[];
}

export type RegressionOutcome = { ok: true; result: Regression } | { ok: false; problem: 'fx' | 'observations' | 'collinear'; n: number };

function toBasis(closes: readonly Close[], currency: string, basis: CurrencyBasis, fx: RegressionInput['fx']): Close[] | undefined {
  if (basis === 'local' || currency === 'TWD') return [...closes];
  const rates = fx.get(currency);
  return rates && rates.length > 0 ? inTwd(closes, rates) : undefined;
}

/** One series against one index over the window, with its rolling β; or why there is none. */
export function regress(input: RegressionInput, settings: RegressionSettings): RegressionOutcome {
  const { freq, basis } = input;
  const seriesCloses = toBasis(input.series.closes, input.series.currency, basis, input.fx);
  const indexCloses = toBasis(input.index.closes, input.index.currency, basis, input.fx);
  if (!seriesCloses || !indexCloses) return { ok: false, problem: 'fx', n: 0 };
  const rate = (currency: string) => (month: string) => rateOn(input.riskFree.get(currency) ?? new Map(), month, settings.riskFree[currency] ?? 0);
  const seriesCurrency = basis === 'TWD' ? 'TWD' : input.series.currency;
  const indexCurrency = basis === 'TWD' ? 'TWD' : input.index.currency;
  const y = excessReturns(periodReturns(seriesCloses, freq), freq, rate(seriesCurrency));
  const x = excessReturns(periodReturns(indexCloses, freq), freq, rate(indexCurrency));
  const adjacent = adjacentDay(input.series.market, input.index.market, freq);
  const all = align(y, x, adjacent);
  const observations = lastYears(all, input.years);
  if (observations.length < settings.minObservations) return { ok: false, problem: 'observations', n: observations.length };
  const fit = ols(observations);
  if (!fit) return { ok: false, problem: 'collinear', n: observations.length };
  const figures = betaFigures(fit, freq, settings);
  const from = (observations[0] as Observation).date;
  return {
    ok: true,
    result: {
      ...figures,
      adjacent,
      from,
      to: (observations[observations.length - 1] as Observation).date,
      points: observations.map((observation) => ({ date: observation.date, x: observation.x.reduce((sum, value) => sum + value, 0), y: observation.y })),
      // Each point looks back its own 52 weeks, which may reach before the window.
      rolling: rollingBeta(all, settings.rollingWeeks, settings.minObservations).filter((point) => point.date >= from),
    },
  };
}

// ---------------------------------------------------------------------------
// From loaded data to one regression
// ---------------------------------------------------------------------------

export interface LoadedSeries {
  /** Each ticker's adjusted closes. */
  closes: ReadonlyMap<string, readonly Close[]>;
  /** Each index's closes. */
  indices: ReadonlyMap<string, readonly Close[]>;
  /** TWD per unit of each foreign currency. */
  fx: ReadonlyMap<string, readonly Close[]>;
  /** Monthly yearly rates by currency. */
  riskFree: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export interface Choice {
  freq: Frequency;
  years: number;
  basis: CurrencyBasis;
}

/** One ticker against one benchmark at the chosen frequency, window and currency. */
export function regressTicker(
  loaded: LoadedSeries,
  security: { ticker: string; market: string; currency: string },
  benchmark: Benchmark,
  choice: Choice,
  settings: RegressionSettings,
): RegressionOutcome {
  return regress(
    {
      series: { closes: loaded.closes.get(security.ticker) ?? [], market: security.market, currency: security.currency },
      index: { closes: loaded.indices.get(benchmark.id) ?? [], market: benchmark.market, currency: benchmark.currency },
      freq: choice.freq,
      years: choice.years,
      basis: choice.basis,
      fx: loaded.fx,
      riskFree: loaded.riskFree,
    },
    settings,
  );
}

/** The first day to load for a window: its years before today, with a month to spare for the first return and a rolling 52 weeks. */
export function loadFrom(today: string, years: number, rollingWeeks: number): string {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  return addDays(new Date(Date.UTC(year - years, month - 1, day)).toISOString().slice(0, 10), -7 * rollingWeeks - 31);
}
