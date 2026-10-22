/**
 * N4 Value at Risk (PRD Module E): how much the whole portfolio could lose in a bad week, as a
 * home-screen gauge rather than a risk-management page. Parametric (variance–covariance) VaR at
 * the confidence in config var:
 *
 *   VaR = z × σ_p × √h × V,   σ_p = √(wᵀ Σ w)
 *
 * - Every holding is measured by its asset class's proxy ETF (asset_classes.benchmark_ticker, the
 *   PRD's N4 table), so a single stock's own risk is left out by design; a theme ETF by its own
 *   prices once it has the whole window of them. A TWD balance does not move in TWD, so it adds
 *   value but no risk.
 * - Σ: the sample covariance of the proxies' weekly returns, Friday close to Friday close, in TWD
 *   at each Friday's rate (FX included), dividends reinvested, over the last three years.
 * - V: everything priced, both pools; h: one week, or the weeks in a month for the toggle.
 *
 * Pure functions: the holdings and risk pages work today's VaR out on request, and the nightly
 * job stores each day's 1-week VaR with its NAV snapshot for the 52-week line.
 */
import { addDays } from '../dates';
import { stateOn, type ManualHistory } from './manual-history';
import { MarketHistory, type PriceRow } from './market';
import type { DayPoint } from './performance';
import type { FxQuote, ProductType, Security } from './types';
import type { Holding } from './valuation';

// ---------------------------------------------------------------------------
// Settings (config var)
// ---------------------------------------------------------------------------

export interface RiskSettings {
  /** One-sided confidence: 0.95. */
  confidence: number;
  /** The card's horizon in weeks: 1. */
  horizonWeeks: number;
  /** Weeks in the 1-month toggle: 4.33. */
  monthWeeks: number;
  /** Years of weekly returns behind the covariance: 3. */
  lookbackYears: number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Weekly returns behind the covariance: 52 a year, 156 for three years. */
export function lookbackWeeks(settings: Pick<RiskSettings, 'lookbackYears'>): number {
  return Math.round(52 * settings.lookbackYears);
}

/** The config value read defensively; undefined when a number is missing or out of range. */
export function readRiskSettings(value: unknown): RiskSettings | undefined {
  const { confidence, horizon_weeks: horizonWeeks, month_weeks: monthWeeks, lookback_years: lookbackYears } = record(value);
  if (typeof confidence !== 'number' || !(confidence > 0.5 && confidence < 1)) return undefined;
  if (!positive(horizonWeeks) || !positive(monthWeeks) || !positive(lookbackYears)) return undefined;
  // A covariance needs two weekly returns at the very least.
  if (lookbackWeeks({ lookbackYears }) < 2) return undefined;
  return { confidence, horizonWeeks, monthWeeks, lookbackYears };
}

// ---------------------------------------------------------------------------
// The formula
// ---------------------------------------------------------------------------

/** Evaluates a polynomial given highest power first. */
function horner(coefficients: readonly number[], x: number): number {
  return coefficients.reduce((sum, coefficient) => sum * x + coefficient, 0);
}

const ACKLAM = {
  a: [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239],
  b: [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1, 1],
  c: [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
  d: [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416, 1],
};

/** The standard normal quantile Φ⁻¹(p), by Acklam's rational approximation (relative error below 1.2 × 10⁻⁹). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return Number.NaN;
  const tail = 0.02425;
  if (p < tail || p > 1 - tail) {
    const q = Math.sqrt(-2 * Math.log(Math.min(p, 1 - p)));
    const x = horner(ACKLAM.c, q) / horner(ACKLAM.d, q);
    return p < tail ? x : -x;
  }
  const q = p - 0.5;
  return (horner(ACKLAM.a, q * q) * q) / horner(ACKLAM.b, q * q);
}

/** z for a one-sided confidence, to three decimals as a z-table quotes it: 1.645 at 95%, 2.326 at 99%. */
export function zScore(confidence: number): number {
  return Math.round(normalQuantile(confidence) * 1000) / 1000;
}

/** VaR = z × σ (weekly, as a share of the value) × √h × V: over h weeks, risk grows with the square root of time. */
export function parametricVar(value: number, weeklySigma: number, horizonWeeks: number, z: number): number {
  return z * weeklySigma * Math.sqrt(horizonWeeks) * value;
}

/** Losses beyond the VaR come about once in this many periods: 20 at 95%. */
export function oneIn(confidence: number): number {
  return Math.round(1 / (1 - confidence));
}

// ---------------------------------------------------------------------------
// Weekly returns, Friday to Friday
// ---------------------------------------------------------------------------

/** The Friday on or before a date. */
export function fridayOnOrBefore(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 2) % 7));
}

/** The first Friday of `weeks` weekly returns ending at the Friday on or before `end`: how far back the closes must reach. */
export function gridStart(end: string, weeks: number): string {
  return addDays(fridayOnOrBefore(end), -7 * weeks);
}

/** Every Friday from the one on or before `from` to the one on or before `to`, oldest first. */
export function fridays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = fridayOnOrBefore(from), last = fridayOnOrBefore(to); day <= last; day = addDays(day, 7)) out.push(day);
  return out;
}

/**
 * Each proxy's TWD return over every week of the grid (the entry at k is the week to grid[k + 1]):
 * its adjusted close's growth times its currency's against TWD, or undefined before it has a
 * close and a rate on or before the week's first Friday. A closed market keeps its last close.
 */
export function weeklyReturns(market: MarketHistory, proxies: ReadonlyMap<string, string>, grid: readonly string[]): Map<string, Array<number | undefined>> {
  const out = new Map<string, Array<number | undefined>>();
  for (const [ticker, currency] of proxies) {
    const returns: Array<number | undefined> = [];
    for (let k = 1; k < grid.length; k++) {
      const growth = market.twdGrowth(ticker, currency, grid[k - 1] ?? '', grid[k] ?? '');
      returns.push(growth === undefined ? undefined : growth - 1);
    }
    out.set(ticker, returns);
  }
  return out;
}

/** The weekly returns behind one VaR: `weeks` of them, to a Friday. */
export interface ReturnWindow {
  /** The Friday the first return starts from, and the one the last ends on. */
  from: string;
  to: string;
  weeks: number;
  /** Each proxy with a return for every week, oldest first; a proxy whose history is shorter is left out. */
  returns: ReadonlyMap<string, readonly number[]>;
}

/** The window of `weeks` returns ending at grid[end]. */
export function returnWindow(all: ReadonlyMap<string, ReadonlyArray<number | undefined>>, grid: readonly string[], end: number, weeks: number): ReturnWindow {
  const returns = new Map<string, number[]>();
  if (end - weeks >= 0) {
    for (const [ticker, series] of all) {
      const slice = series.slice(end - weeks, end);
      if (slice.length === weeks && slice.every((value) => value !== undefined)) returns.set(ticker, slice as number[]);
    }
  }
  return { from: grid[Math.max(0, end - weeks)] ?? '', to: grid[end] ?? '', weeks, returns };
}

/** The window for a VaR on `date`: the weeks to the Friday on or before it. */
export function windowOn(market: MarketHistory, proxies: ReadonlyMap<string, string>, date: string, weeks: number): ReturnWindow {
  const grid = fridays(gridStart(date, weeks), date);
  return returnWindow(weeklyReturns(market, proxies, grid), grid, grid.length - 1, weeks);
}

/** The sample covariance (divided by n − 1) of equally long series. */
export function covariance(series: ReadonlyArray<readonly number[]>): number[][] {
  const n = series[0]?.length ?? 0;
  const means = series.map((values) => values.reduce((sum, value) => sum + value, 0) / n);
  const matrix = series.map(() => series.map(() => 0));
  for (let i = 0; i < series.length; i++) {
    for (let j = i; j < series.length; j++) {
      let sum = 0;
      for (let t = 0; t < n; t++) sum += ((series[i]?.[t] ?? 0) - (means[i] ?? 0)) * ((series[j]?.[t] ?? 0) - (means[j] ?? 0));
      const value = n > 1 ? sum / (n - 1) : 0;
      const row = matrix[i];
      const column = matrix[j];
      if (row) row[j] = value;
      if (column) column[i] = value;
    }
  }
  return matrix;
}

// ---------------------------------------------------------------------------
// Holdings to proxies
// ---------------------------------------------------------------------------

/** A holding as the VaR sees it. */
export interface RiskLine {
  key: string;
  /** Null for a non-listed asset. */
  ticker: string | null;
  label: string;
  productType: ProductType;
  assetClassId: string;
  valueTwd: number;
}

/** The priced holdings, both pools; the rest wait for a price, as on the holdings page. */
export function holdingLines(holdings: readonly Holding[]): { lines: RiskLine[]; unpriced: Holding[] } {
  const lines: RiskLine[] = [];
  for (const holding of holdings) {
    if (holding.valueTwd === null || holding.valueTwd <= 0) continue;
    lines.push({ key: holding.key, ticker: holding.ticker, label: holding.label, productType: holding.productType, assetClassId: holding.assetClassId, valueTwd: holding.valueTwd });
  }
  return { lines, unpriced: holdings.filter((holding) => holding.valueTwd === null) };
}

/** A TWD savings or money-market balance: entered as TWD, it has no price to move. */
export function isTwdBalance(line: Pick<RiskLine, 'ticker' | 'productType'>): boolean {
  return line.ticker === null && line.productType === 'cash_mmf';
}

/**
 * Where to look for a holding's risk, in order: a theme ETF's own prices, then its class's
 * benchmark (VT for tactical themes); anything else, its class's benchmark.
 */
export function proxyCandidates(line: Pick<RiskLine, 'ticker' | 'productType' | 'assetClassId'>, benchmarks: ReadonlyMap<string, string | null>): string[] {
  const benchmark = benchmarks.get(line.assetClassId) ?? null;
  const own = line.productType === 'theme_etf' && line.ticker !== null ? [line.ticker] : [];
  return [...new Set([...own, ...(benchmark ? [benchmark] : [])])];
}

/** Every ticker that can stand as a proxy, with its trade currency: the class benchmarks and the theme ETFs among the securities. */
export function candidateProxies(benchmarks: ReadonlyMap<string, string | null>, securities: readonly Pick<Security, 'ticker' | 'productType' | 'currency'>[]): Map<string, string> {
  const wanted = new Set([...benchmarks.values()]);
  return new Map(securities.filter((security) => wanted.has(security.ticker) || security.productType === 'theme_etf').map((security) => [security.ticker, security.currency]));
}

export interface MeasuredHolding {
  key: string;
  ticker: string | null;
  label: string;
  valueTwd: number;
  /** The class benchmark stands in for a theme ETF that lacks a full window of its own weekly prices. */
  standIn: boolean;
}

export interface Measured {
  /** Everything priced, both pools, TWD: V. */
  valueTwd: number;
  /** By proxy, largest first: the TWD value it measures and the holdings behind it. */
  exposures: Array<{ proxy: string; valueTwd: number; holdings: MeasuredHolding[] }>;
  /** TWD balances: value without price risk. */
  cash: { valueTwd: number; holdings: MeasuredHolding[] };
  /** Holdings with no proxy that has the whole window of weekly prices; `proxy` is the one missing them, null when the class has none. */
  unmeasured: Array<MeasuredHolding & { proxy: string | null }>;
}

const byValue = <T extends { valueTwd: number }>(a: T, b: T) => b.valueTwd - a.valueTwd;

/** Sorts each holding to its proxy, the TWD balances, or the unmeasured. */
export function measure(lines: readonly RiskLine[], benchmarks: ReadonlyMap<string, string | null>, window: Pick<ReturnWindow, 'returns'>): Measured {
  const exposures = new Map<string, { proxy: string; valueTwd: number; holdings: MeasuredHolding[] }>();
  const cash: Measured['cash'] = { valueTwd: 0, holdings: [] };
  const unmeasured: Measured['unmeasured'] = [];
  let valueTwd = 0;
  for (const line of lines) {
    valueTwd += line.valueTwd;
    const holding = { key: line.key, ticker: line.ticker, label: line.label, valueTwd: line.valueTwd, standIn: false };
    if (isTwdBalance(line)) {
      cash.valueTwd += line.valueTwd;
      cash.holdings.push(holding);
      continue;
    }
    const candidates = proxyCandidates(line, benchmarks);
    const found = candidates.findIndex((ticker) => window.returns.has(ticker));
    const proxy = candidates[found];
    if (proxy === undefined) {
      unmeasured.push({ ...holding, proxy: candidates[candidates.length - 1] ?? null });
      continue;
    }
    const exposure = exposures.get(proxy) ?? { proxy, valueTwd: 0, holdings: [] };
    exposure.valueTwd += line.valueTwd;
    exposure.holdings.push({ ...holding, standIn: line.productType === 'theme_etf' && found > 0 });
    exposures.set(proxy, exposure);
  }
  for (const exposure of exposures.values()) exposure.holdings.sort(byValue);
  cash.holdings.sort(byValue);
  return { valueTwd, exposures: [...exposures.values()].sort((a, b) => b.valueTwd - a.valueTwd || a.proxy.localeCompare(b.proxy)), cash, unmeasured: unmeasured.sort(byValue) };
}

// ---------------------------------------------------------------------------
// The VaR and what it is made of
// ---------------------------------------------------------------------------

export interface ProxyFigures {
  proxy: string;
  /** Share of V. */
  weight: number;
  /** Standard deviation of its weekly TWD returns. */
  weeklySigma: number;
  /** Its part of the VaR, w_i (Σw)_i ÷ wᵀΣw: the parts add up to 1. Null without a VaR. */
  share: number | null;
}

export interface RiskFigures {
  /** Weekly standard deviation of the whole portfolio as a share of V: σ_p. Null without a VaR. */
  sigma: number | null;
  /** The 1-week VaR in TWD at the confidence; null when nothing is held or a holding cannot be measured. */
  weekVar: number | null;
  /** In the order of Measured.exposures. */
  proxies: ProxyFigures[];
  /** Correlations of the proxies' weekly returns, same order; null where one never moved. */
  correlations: Array<Array<number | null>>;
  /** The current mix's return in each week of the window, oldest first (TWD balances at 0%); empty without a VaR. */
  mixReturns: number[];
}

export function riskFigures(measured: Measured, window: Pick<ReturnWindow, 'returns'>, z: number): RiskFigures {
  const value = measured.valueTwd;
  const series = measured.exposures.map((exposure) => window.returns.get(exposure.proxy) ?? []);
  const matrix = covariance(series);
  const exposure = measured.exposures.map((row) => row.valueTwd);
  // Σe in TWD, and eᵀΣe: the portfolio's weekly variance in TWD².
  const marginal = matrix.map((row) => row.reduce((sum, cell, j) => sum + cell * (exposure[j] ?? 0), 0));
  const variance = marginal.reduce((sum, cell, i) => sum + cell * (exposure[i] ?? 0), 0);
  const complete = value > 0 && measured.unmeasured.length === 0;
  const sd = (i: number) => Math.sqrt(Math.max(0, matrix[i]?.[i] ?? 0));
  return {
    sigma: complete ? Math.sqrt(Math.max(0, variance)) / value : null,
    weekVar: complete ? z * Math.sqrt(Math.max(0, variance)) : null,
    proxies: measured.exposures.map((row, i) => ({
      proxy: row.proxy,
      weight: value > 0 ? row.valueTwd / value : 0,
      weeklySigma: sd(i),
      share: complete ? (variance > 0 ? ((exposure[i] ?? 0) * (marginal[i] ?? 0)) / variance : 0) : null,
    })),
    correlations: matrix.map((row, i) => row.map((cell, j) => (sd(i) > 0 && sd(j) > 0 ? cell / (sd(i) * sd(j)) : null))),
    mixReturns: complete ? (series[0] ?? []).map((_, t) => series.reduce((sum, returns, i) => sum + ((exposure[i] ?? 0) / value) * (returns[t] ?? 0), 0)) : [],
  };
}

/** A VaR over another horizon: the 1-week figure times √weeks. */
export function overWeeks(weekVar: number, weeks: number): number {
  return weekVar * Math.sqrt(weeks);
}

// ---------------------------------------------------------------------------
// The weekly-return histogram (PRD visual catalogue: where the VaR sits in the distribution)
// ---------------------------------------------------------------------------

export interface Bin {
  /** From this return (included) to the next bin's. */
  from: number;
  to: number;
  count: number;
}

/** Bin widths a reader takes in at a glance: 0.1%, 0.25%, 0.5%, 1%, 2%, 5%. */
const WIDTHS = [0.001, 0.0025, 0.005, 0.01, 0.02, 0.05];

/**
 * The values in bins of the narrowest round width that needs at most `most` bins. With an
 * `anchor`, one edge falls on it (the VaR's cutoff), so the bins left of it hold exactly the
 * weeks beyond it.
 */
export function histogram(values: readonly number[], most = 24, anchor = 0): { width: number; bins: Bin[] } {
  if (values.length === 0) return { width: 0, bins: [] };
  const low = Math.min(...values) - anchor;
  const high = Math.max(...values) - anchor;
  const width = WIDTHS.find((candidate) => Math.floor(high / candidate) - Math.floor(low / candidate) + 1 <= most) ?? 0.1;
  const first = Math.floor(low / width);
  const counts = new Array<number>(Math.floor(high / width) - first + 1).fill(0);
  for (const value of values) {
    const at = Math.floor((value - anchor) / width) - first;
    counts[at] = (counts[at] ?? 0) + 1;
  }
  // Rounded edges, so a bin reads 1.5% rather than 1.4999999%.
  const edge = (k: number) => Math.round((anchor + k * width) * 1e9) / 1e9;
  return { width, bins: counts.map((count, k) => ({ from: edge(first + k), to: edge(first + k + 1), count })) };
}

/** How many weeks lost more than `loss` (a share of the value): a check of the "1 in 20". */
export function weeksBeyond(returns: readonly number[], loss: number): number {
  return returns.filter((value) => value < -loss).length;
}

// ---------------------------------------------------------------------------
// The 52-week line
// ---------------------------------------------------------------------------

/** One day's 1-week VaR and the portfolio value it is a share of, TWD. */
export interface VarPoint {
  date: string;
  valueAtRisk: number;
  totalTwd: number;
}

/** The saved daily VaR of the last `weeks` weeks, with today's worked-out figure in place of today's saved one. */
export function varLine(saved: readonly VarPoint[], today: string, live: VarPoint | undefined, weeks = 52): VarPoint[] {
  const since = addDays(today, -7 * weeks);
  const points = saved.filter((point) => point.date > since && point.date <= today && !(live && point.date === live.date));
  return [...points, ...(live ? [live] : [])].sort((a, b) => a.date.localeCompare(b.date));
}

/** The card's 52-week line: the saved 1-week VaR, one point a week, ending with today's worked-out figure. */
export function sparkline(saved: readonly VarPoint[], today: string, report: Pick<RiskReport, 'weekVar' | 'measured'> | undefined): VarPoint[] {
  const live = report && report.weekVar !== null ? { date: today, valueAtRisk: report.weekVar, totalTwd: report.measured.valueTwd } : undefined;
  return lastOfEachWeek(varLine(saved, today, live));
}

/** A line's last point in each week to Friday, and its very last point: one point a week for the sparkline. */
export function lastOfEachWeek(points: readonly VarPoint[]): VarPoint[] {
  const weekOf = (date: string) => fridayOnOrBefore(addDays(date, 6));
  return points.filter((point, at) => {
    const next = points[at + 1];
    return !next || weekOf(next.date) !== weekOf(point.date);
  });
}

// ---------------------------------------------------------------------------
// Today's report and each day's figure
// ---------------------------------------------------------------------------

/** What the VaR reads besides the holdings: config var, the class benchmarks and the proxies' weekly history. */
export interface RiskInput {
  /** Undefined when config var is missing or malformed. */
  settings: RiskSettings | undefined;
  /** Asset class id to its benchmark ETF. */
  benchmarks: ReadonlyMap<string, string | null>;
  /** Every candidate proxy with its trade currency. */
  proxies: ReadonlyMap<string, string>;
  /** The proxies' weekly closes and the daily "<CUR>/TWD" rates, reaching back a window before the first day needed. */
  prices: readonly PriceRow[];
  rates: readonly FxQuote[];
}

export interface RiskReport extends RiskFigures {
  settings: RiskSettings;
  z: number;
  window: Pick<ReturnWindow, 'from' | 'to' | 'weeks'>;
  measured: Measured;
  /** Holdings left out until priced. */
  unpriced: Holding[];
  /** Proxies whose weekly prices do not reach back the whole window. */
  missing: string[];
}

/** Today's VaR for the holdings, as valued on the holdings page; undefined without settings. */
export function riskReport(holdings: readonly Holding[], input: RiskInput, today: string): RiskReport | undefined {
  const settings = input.settings;
  if (!settings) return undefined;
  const weeks = lookbackWeeks(settings);
  const window = windowOn(new MarketHistory(input.prices, input.rates), input.proxies, today, weeks);
  const { lines, unpriced } = holdingLines(holdings);
  const measured = measure(lines, input.benchmarks, window);
  const z = zScore(settings.confidence);
  const missing = [...new Set(measured.unmeasured.flatMap((holding) => (holding.proxy ? [holding.proxy] : [])))].sort();
  return { ...riskFigures(measured, window, z), settings, z, window: { from: window.from, to: window.to, weeks }, measured, unpriced, missing };
}

/** A day of buildSeries as risk lines: each holding's value at that day's close, both pools. */
export function dayLines(day: Pick<DayPoint, 'date' | 'held'>, securities: ReadonlyMap<string, Pick<Security, 'productType' | 'assetClassId' | 'name'>>, manual: ReadonlyMap<number, ManualHistory>): RiskLine[] {
  const lines: RiskLine[] = [];
  for (const [key, valueTwd] of Object.entries(day.held)) {
    if (!(valueTwd > 0)) continue;
    const at = key.indexOf(':');
    const [kind, rest] = [key.slice(0, at), key.slice(at + 1)];
    if (kind === 'manual') {
      const history = manual.get(Number(rest));
      const state = history ? stateOn(history, day.date) : undefined;
      if (state) lines.push({ key, ticker: null, label: state.name, productType: state.productType, assetClassId: state.assetClassId, valueTwd });
      continue;
    }
    const security = securities.get(rest);
    if (security) lines.push({ key, ticker: rest, label: security.name, productType: security.productType, assetClassId: security.assetClassId, valueTwd });
  }
  return lines;
}

/**
 * Each day's 1-week VaR in TWD at the confidence, from the days buildSeries values: the holdings
 * at that day's close against the weekly returns to the Friday on or before it. Null for a day a
 * holding has no proxy with the whole window of weekly prices; nothing at all without settings.
 */
export function dailyValueAtRisk(
  days: readonly Pick<DayPoint, 'date' | 'held'>[],
  context: { securities: readonly Security[]; manualAssets: readonly ManualHistory[] },
  input: RiskInput,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const settings = input.settings;
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  if (!settings || !first || !last) return out;
  const weeks = lookbackWeeks(settings);
  const z = zScore(settings.confidence);
  // One grid over every day, its weekly returns worked out once; each Friday's window is a slice.
  const grid = fridays(gridStart(first, weeks), last);
  const index = new Map(grid.map((friday, at) => [friday, at]));
  const all = weeklyReturns(new MarketHistory(input.prices, input.rates), input.proxies, grid);
  const windows = new Map<number, ReturnWindow>();
  const securities = new Map(context.securities.map((security) => [security.ticker, security]));
  const manual = new Map(context.manualAssets.map((asset) => [asset.id, asset]));
  for (const day of days) {
    const end = index.get(fridayOnOrBefore(day.date));
    if (end === undefined) continue;
    let window = windows.get(end);
    if (!window) {
      window = returnWindow(all, grid, end, weeks);
      windows.set(end, window);
    }
    const lines = dayLines(day, securities, manual);
    if (lines.length === 0) {
      out.set(day.date, null);
      continue;
    }
    const weekVar = riskFigures(measure(lines, input.benchmarks, window), window, z).weekVar;
    out.set(day.date, weekVar === null ? null : Math.round(weekVar * 100) / 100);
  }
  return out;
}
