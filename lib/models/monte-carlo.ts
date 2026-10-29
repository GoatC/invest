/**
 * F5 Monte Carlo simulation (PRD Module A, Phase 3 step 1): the projection engine's stochastic
 * mode. F2 earns the expected return every month; here each path draws its own months, and the
 * page reads the spread of where the regular pool (and the windfall, F3) could end up.
 *
 * Method:
 * - History: each class's benchmark ETF (the N4 proxy) as monthly returns in TWD, over the last
 *   `lookback_years`. Only months every simulated class has are used, so one row is one month of
 *   the whole market and the classes keep their correlation.
 * - Calibration: a class with an assumption (F6's CMA) is re-centred on its expected return ÷ 12
 *   (F2's monthly return, so the two modes agree on the mean) and, when `scale_to_cma` is on, its
 *   deviations are scaled to its volatility ÷ √12. The deviations themselves are the historical
 *   ones, so the fat tails and the crashes stay. A class without an assumption is left out and
 *   the rest re-weighted to 100%, as F2's expected return does.
 * - The portfolio holds the target weights every month (rebalanced monthly): a row's portfolio
 *   return is the weighted sum of its classes'. The regular pool earns the mix of every simulated
 *   class; the windfall's deployed money the core classes only (F3 never buys the satellite).
 * - Paths: a moving-block bootstrap, `block_months` consecutive historical rows at a time (1 is
 *   the plain bootstrap), 10,000 paths. A seeded generator, so a page shows the same figures until
 *   the month or an input changes.
 * - Money: the regular pool runs F2's own loop (`simulate`, in projection.ts): the month's return,
 *   then the month's contribution at the month end. The windfall waits in cash (config windfall
 *   cash_return) and moves to the core mix as its tranches come due; the tranches are the saved
 *   F3 plan's, else an expected windfall's (config monte_carlo.windfall) paid in equal tranches.
 *   Acceleration is not simulated: the schedule stays the plan's. F10 replays the tiers.
 * - Output: the band (low / median / high percentile) at each year end, in nominal TWD and in
 *   today's money, the figures at the marks (years 10, 20, 30), the share of paths reaching a
 *   target (in today's money) and the spread of the final year, with the mean path (every month
 *   at its expected return, the same engine) for comparison.
 *
 * Pure functions; the Monte Carlo page and the nightly job's monthly re-run use them.
 */
import { isMonth, monthsBetween } from '../dates';
import { monthlyReturn, monthlyStepUp, simulate, type Path, type Plan, type SavedPlan } from './projection';
import type { Point } from './regression';

// ---------------------------------------------------------------------------
// Settings (config monte_carlo)
// ---------------------------------------------------------------------------

export interface ExpectedWindfall {
  amountTwd: number | null;
  /** YYYY-MM the money arrives (at its end); null until set. */
  month: string | null;
  tranches: number;
}

export interface McSettings {
  paths: number;
  lookbackYears: number;
  blockMonths: number;
  /** Fewest months of history to simulate from. */
  minMonths: number;
  scaleToCma: boolean;
  /** The band's edges, fractions: 0.1 and 0.9. */
  band: [number, number];
  /** Years the figures are read at. */
  markYears: number[];
  /** The goal in today's money; null until set. */
  targetTwd: number | null;
  windfall: ExpectedWindfall;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function whole(value: unknown, least: number, most: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= least && value <= most ? value : undefined;
}

/** The config value read defensively; undefined when a required part is missing or out of range. */
export function readMcSettings(value: unknown): McSettings | undefined {
  const row = record(value);
  const paths = whole(row['paths'], 100, 100000);
  const lookbackYears = whole(row['lookback_years'], 1, 30);
  const blockMonths = whole(row['block_months'], 1, 12);
  const minMonths = whole(row['min_months'], 12, 600);
  const band = row['band'];
  const marks = row['mark_years'];
  if (paths === undefined || lookbackYears === undefined || blockMonths === undefined || minMonths === undefined) return undefined;
  if (typeof row['scale_to_cma'] !== 'boolean') return undefined;
  if (!Array.isArray(band) || band.length !== 2) return undefined;
  const [low, high] = band as unknown[];
  if (typeof low !== 'number' || typeof high !== 'number' || !(low > 0 && low < 0.5 && high > 0.5 && high < 1)) return undefined;
  if (!Array.isArray(marks) || marks.length === 0 || !marks.every((year) => typeof year === 'number' && Number.isInteger(year) && year >= 1 && year <= 100)) return undefined;
  const target = row['target_twd'];
  const windfall = record(row['windfall']);
  const amount = windfall['amount_twd'];
  const month = windfall['month'];
  const tranches = whole(windfall['tranches'], 1, 120);
  if (tranches === undefined) return undefined;
  return {
    paths,
    lookbackYears,
    blockMonths,
    minMonths,
    scaleToCma: row['scale_to_cma'],
    band: [low, high],
    markYears: [...(marks as number[])].sort((a, b) => a - b),
    targetTwd: typeof target === 'number' && Number.isFinite(target) && target > 0 ? target : null,
    windfall: {
      amountTwd: typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : null,
      month: typeof month === 'string' && isMonth(month) ? month : null,
      tranches,
    },
  };
}

/** The shape the config row stores. */
export function mcSettingsValue(settings: McSettings): Record<string, unknown> {
  return {
    paths: settings.paths,
    lookback_years: settings.lookbackYears,
    block_months: settings.blockMonths,
    min_months: settings.minMonths,
    scale_to_cma: settings.scaleToCma,
    band: settings.band,
    mark_years: settings.markYears,
    target_twd: settings.targetTwd,
    windfall: { amount_twd: settings.windfall.amountTwd, month: settings.windfall.month, tranches: settings.windfall.tranches },
  };
}

// ---------------------------------------------------------------------------
// Random numbers and percentiles
// ---------------------------------------------------------------------------

/** mulberry32: a small seeded generator returning numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed for a month's run: its year and month as a number, so the figures hold for the month. */
export function monthSeed(month: string): number {
  return Number(month.slice(0, 4)) * 100 + Number(month.slice(5, 7));
}

/** The p-quantile of an ascending list, interpolating between neighbours (type 7). */
export function quantile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const at = (n - 1) * p;
  const lower = Math.floor(at);
  const upper = Math.ceil(at);
  const a = sorted[lower] as number;
  const b = sorted[upper] as number;
  return a + (b - a) * (at - lower);
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/** One simulated class: its target weight and its monthly TWD returns, oldest first. */
export interface ClassHistory {
  id: string;
  /** Share of the regular pool, 0 to 1. */
  weight: number;
  core: boolean;
  /** The monthly return of its benchmark ETF in TWD; `date` is the month's last day. */
  returns: readonly Point[];
}

export interface Assumption {
  expectedReturn: number;
  volatility: number;
}

export interface CalibratedClass {
  id: string;
  /** Share of the simulated mix, re-weighted to 100%. */
  weight: number;
  core: boolean;
  /** Mean and standard deviation of the monthly history, before calibration. */
  historyMean: number;
  historyVol: number;
  /** After: the expected return ÷ 12, and the deviations' standard deviation. */
  mean: number;
  vol: number;
}

export interface Calibration {
  /** The first and last month of the history used, YYYY-MM. */
  from: string;
  to: string;
  months: number;
  classes: CalibratedClass[];
  /** The regular pool's return in each historical month, calibrated. */
  regular: Float64Array;
  /** The core mix's, for the deployed windfall. */
  core: Float64Array;
  /** The mix's expected monthly return: the weighted means. */
  regularMean: number;
  coreMean: number;
  /** Classes with a target but no assumption or no history, and the share of the targets they hold. */
  left: Array<{ id: string; reason: 'assumption' | 'history' }>;
  leftShare: number;
}

export type CalibrationProblem = { problem: 'classes' } | { problem: 'history'; months: number; need: number };

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The sample standard deviation. */
function deviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

/**
 * Joins the classes' histories on their common months, re-centres and scales each (see the header)
 * and works out the regular and core mixes' return in every historical month.
 */
export function calibrate(histories: readonly ClassHistory[], assumptions: Readonly<Record<string, Assumption>>, settings: Pick<McSettings, 'scaleToCma' | 'minMonths'>, months?: number): Calibration | CalibrationProblem {
  const left: Calibration['left'] = [];
  const used: ClassHistory[] = [];
  for (const history of histories) {
    if (history.weight <= 0) continue;
    if (!assumptions[history.id]) left.push({ id: history.id, reason: 'assumption' });
    else if (history.returns.length === 0) left.push({ id: history.id, reason: 'history' });
    else used.push(history);
  }
  if (used.length === 0) return { problem: 'classes' };

  // The months every used class has, newest `months` of them.
  let common = new Set(used[0]?.returns.map((point) => point.date.slice(0, 7)));
  for (const history of used.slice(1)) {
    const have = new Set(history.returns.map((point) => point.date.slice(0, 7)));
    common = new Set([...common].filter((month) => have.has(month)));
  }
  let keep = [...common].sort();
  if (months !== undefined) keep = keep.slice(-months);
  if (keep.length < settings.minMonths) return { problem: 'history', months: keep.length, need: settings.minMonths };

  const total = histories.reduce((sum, history) => sum + Math.max(history.weight, 0), 0);
  const usedWeight = used.reduce((sum, history) => sum + history.weight, 0);
  const classes: CalibratedClass[] = [];
  const columns: number[][] = [];
  for (const history of used) {
    const byMonth = new Map(history.returns.map((point) => [point.date.slice(0, 7), point.value]));
    const values = keep.map((month) => byMonth.get(month) as number);
    const assumption = assumptions[history.id] as Assumption;
    const historyMean = mean(values);
    const historyVol = deviation(values);
    const target = assumption.volatility / Math.sqrt(12);
    const scale = settings.scaleToCma && historyVol > 1e-12 ? target / historyVol : 1;
    const centre = monthlyReturn(assumption.expectedReturn);
    columns.push(values.map((value) => centre + (value - historyMean) * scale));
    classes.push({ id: history.id, weight: history.weight / usedWeight, core: history.core, historyMean, historyVol, mean: centre, vol: historyVol * scale });
  }

  const coreWeight = classes.filter((entry) => entry.core).reduce((sum, entry) => sum + entry.weight, 0);
  const regular = new Float64Array(keep.length);
  const core = new Float64Array(keep.length);
  for (let t = 0; t < keep.length; t++) {
    classes.forEach((entry, i) => {
      const value = (columns[i] as number[])[t] as number;
      regular[t] = (regular[t] as number) + entry.weight * value;
      if (entry.core && coreWeight > 0) core[t] = (core[t] as number) + (entry.weight / coreWeight) * value;
    });
  }
  const regularMean = classes.reduce((sum, entry) => sum + entry.weight * entry.mean, 0);
  const coreMean = coreWeight > 0 ? classes.filter((entry) => entry.core).reduce((sum, entry) => sum + (entry.weight / coreWeight) * entry.mean, 0) : regularMean;
  // With no core class simulated the windfall has nowhere to go but the whole mix.
  if (coreWeight === 0) core.set(regular);
  return {
    from: keep[0] as string,
    to: keep[keep.length - 1] as string,
    months: keep.length,
    classes,
    regular,
    core,
    regularMean,
    coreMean,
    left,
    leftShare: total > 0 ? (total - usedWeight) / total : 0,
  };
}

// ---------------------------------------------------------------------------
// The windfall in the simulation
// ---------------------------------------------------------------------------

export interface WindfallMoney {
  /** Cash waiting at the start for tranches still to come, TWD. */
  waiting: number;
  /** Already in the core mix at the start, TWD. */
  deployed: number;
  /** Money arriving at a month's end: month 1 is the plan's first month. */
  arrivals: Array<{ month: number; amount: number }>;
  /** Tranches moving from waiting cash to the core mix at a month's end. */
  deployments: Array<{ month: number; amount: number }>;
  /** Yearly return of the waiting cash. */
  cashReturn: number;
}

/** A date or month as a month number of the simulation; 1 is the plan's first month, earlier ones count as 1. */
function monthNumber(start: string, when: string): number {
  return Math.max(1, monthsBetween(start, when.slice(0, 7)) + 1);
}

/**
 * The saved F3 plan's remaining tranches: the money waiting is what they still have to deploy, the
 * rest of the windfall pool is deployed already. `poolValue` is the windfall pool's value now.
 */
export function windfallFromPlan(
  plan: { tranches: ReadonlyArray<{ dueDate: string; amountTwd: number; status: string }> },
  poolValue: number,
  start: string,
  cashReturn: number,
): WindfallMoney {
  const open = plan.tranches.filter((tranche) => tranche.status !== 'done');
  const waiting = open.reduce((sum, tranche) => sum + tranche.amountTwd, 0);
  return {
    waiting,
    deployed: Math.max(0, poolValue - waiting),
    arrivals: [],
    deployments: open.map((tranche) => ({ month: monthNumber(start, tranche.dueDate), amount: tranche.amountTwd })),
    cashReturn,
  };
}

/** A windfall still to come: it arrives at the end of `month` and is deployed in equal tranches from then. */
export function expectedWindfall(expected: ExpectedWindfall, start: string, poolValue: number, cashReturn: number): WindfallMoney | null {
  if (expected.amountTwd === null || expected.month === null) return null;
  const first = monthNumber(start, expected.month);
  const each = expected.amountTwd / expected.tranches;
  return {
    waiting: 0,
    deployed: poolValue,
    arrivals: [{ month: first, amount: expected.amountTwd }],
    deployments: Array.from({ length: expected.tranches }, (_, i) => ({ month: first + i, amount: each })),
    cashReturn,
  };
}

/** What the windfall is worth at each month end given the core mix's returns; index 0 is the start. */
function windfallPath(money: WindfallMoney, months: number, core: (month: number) => number): Float64Array {
  const out = new Float64Array(months + 1);
  let waiting = money.waiting;
  let deployed = money.deployed;
  out[0] = waiting + deployed;
  const cash = monthlyReturn(money.cashReturn);
  const arrive = new Map<number, number>();
  const deploy = new Map<number, number>();
  for (const { month, amount } of money.arrivals) arrive.set(month, (arrive.get(month) ?? 0) + amount);
  for (const { month, amount } of money.deployments) deploy.set(month, (deploy.get(month) ?? 0) + amount);
  for (let month = 1; month <= months; month++) {
    waiting *= 1 + cash;
    deployed *= 1 + core(month);
    waiting += arrive.get(month) ?? 0;
    const moved = Math.min(deploy.get(month) ?? 0, waiting);
    waiting -= moved;
    deployed += moved;
    out[month] = waiting + deployed;
  }
  return out;
}

/** Money put in by month `month`: the windfall's arrivals count when they arrive. */
function windfallPutIn(money: WindfallMoney, month: number): number {
  return money.waiting + money.deployed + money.arrivals.filter((arrival) => arrival.month <= month).reduce((sum, arrival) => sum + arrival.amount, 0);
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

export interface McInput {
  plan: Plan;
  /** YYYY-MM of the plan's first month; month 1 of the simulation. */
  start: string;
  calibration: Calibration;
  windfall: WindfallMoney | null;
  settings: Pick<McSettings, 'paths' | 'blockMonths' | 'band' | 'markYears' | 'targetTwd'>;
  seed: number;
}

export interface YearFigures {
  year: number;
  /** Nominal TWD: the band's low and high edges and the median. */
  low: number;
  median: number;
  high: number;
  /** The same in today's money. */
  realLow: number;
  realMedian: number;
  realHigh: number;
  /** The mean path (every month at its expected return) at the year end, nominal. */
  expected: number;
  /** Money put in by the year end, TWD. */
  putIn: number;
  /** Share of paths whose value in today's money is at or above the target; null without one. */
  reaching: number | null;
}

export interface McResult {
  paths: number;
  years: number;
  /** One entry per year end, 0 to `years`. */
  fan: YearFigures[];
  /** The fan's entries at the mark years that fall within the plan. */
  marks: YearFigures[];
  /** The last year end's values of every path, ascending, nominal TWD. */
  finals: ArrayLike<number>;
  /** Where the final value falls: the share of paths below the putIn. */
  belowPutIn: number;
}

/** Share of the ascending list that is at or above a value. */
function shareAtLeast(sorted: ArrayLike<number>, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] as number) < value) low = mid + 1;
    else high = mid;
  }
  return (sorted.length - low) / sorted.length;
}

function pathOf(plan: Plan): Path {
  return { pv: plan.pv, pmt: plan.pmt, g: monthlyStepUp(plan.stepUp), months: Math.round(plan.years * 12) };
}

/** One path's total at each year end: the regular pool on F2's loop plus the windfall. */
function yearEnds(path: Path, regular: (month: number) => number, windfall: WindfallMoney | null, core: (month: number) => number, out: Float64Array): void {
  const points = simulate(path, regular);
  const extra = windfall ? windfallPath(windfall, path.months, core) : null;
  for (let year = 0; year * 12 <= path.months; year++) {
    out[year] = (points[year * 12] as { value: number }).value + (extra ? (extra[year * 12] as number) : 0);
  }
}

export function monteCarlo(input: McInput): McResult {
  const { plan, calibration, windfall, settings } = input;
  const path = pathOf(plan);
  const years = Math.floor(path.months / 12);
  const rows = calibration.months;
  const block = Math.min(settings.blockMonths, rows);
  const random = seededRandom(input.seed);

  // columns[y] holds every path's value at year end y.
  const columns = Array.from({ length: years + 1 }, () => new Float64Array(settings.paths));
  const drawn = new Int32Array(path.months);
  const one = new Float64Array(years + 1);
  for (let p = 0; p < settings.paths; p++) {
    for (let month = 0; month < path.months; ) {
      const first = Math.floor(random() * (rows - block + 1));
      for (let j = 0; j < block && month < path.months; j++) drawn[month++] = first + j;
    }
    yearEnds(path, (month) => calibration.regular[drawn[month - 1] as number] as number, windfall, (month) => calibration.core[drawn[month - 1] as number] as number, one);
    for (let y = 0; y <= years; y++) (columns[y] as Float64Array)[p] = one[y] as number;
  }

  // The mean path: the same engine with every month at the mix's expected return.
  const mean = new Float64Array(years + 1);
  yearEnds(path, () => calibration.regularMean, windfall, () => calibration.coreMean, mean);

  const inflation = plan.inflation;
  const putInAt = (year: number) => {
    const months = year * 12;
    let contributed = plan.pv;
    let payment = plan.pmt;
    for (let m = 1; m <= months; m++) {
      contributed += payment;
      payment *= 1 + path.g;
    }
    return contributed + (windfall ? windfallPutIn(windfall, months) : 0);
  };

  const fan: YearFigures[] = [];
  let finals: ArrayLike<number> = new Float64Array(0);
  for (let year = 0; year <= years; year++) {
    const column = columns[year] as Float64Array;
    column.sort();
    const factor = (1 + inflation) ** year;
    const low = quantile(column, settings.band[0]);
    const median = quantile(column, 0.5);
    const high = quantile(column, settings.band[1]);
    fan.push({
      year,
      low,
      median,
      high,
      realLow: low / factor,
      realMedian: median / factor,
      realHigh: high / factor,
      expected: mean[year] as number,
      putIn: putInAt(year),
      // Real value ≥ target ⇔ nominal ≥ target × factor.
      reaching: settings.targetTwd === null ? null : shareAtLeast(column, settings.targetTwd * factor),
    });
    if (year === years) finals = column;
  }
  const last = fan[fan.length - 1] as YearFigures;
  return {
    paths: settings.paths,
    years,
    fan,
    marks: settings.markYears.filter((year) => year <= years).map((year) => fan[year] as YearFigures),
    finals,
    belowPutIn: 1 - shareAtLeast(finals, last.putIn),
  };
}

// ---------------------------------------------------------------------------
// From the database's rows to a run
// ---------------------------------------------------------------------------

/** What a run reads, as the page and the nightly job load it. */
export interface McData {
  settings: McSettings | undefined;
  /** The saved F2 plan; null until one is saved. */
  plan: SavedPlan | null;
  classes: ReadonlyArray<{ id: string; targetWeight: number; sleeve: 'core' | 'satellite'; benchmarkTicker: string | null }>;
  assumptions: Readonly<Record<string, Assumption>>;
  /** Each benchmark ticker's monthly return in TWD, oldest first; the month still running is left out. */
  history: ReadonlyMap<string, readonly Point[]>;
  /** The newest F3 plan, if one was started. */
  windfallPlan: { tranches: ReadonlyArray<{ dueDate: string; amountTwd: number; status: string }> } | null;
  /** The windfall pool's value now, TWD. */
  windfallValue: number;
  /** config windfall cash_return. */
  cashReturn: number;
}

export type McRun =
  | {
      ok: true;
      result: McResult;
      calibration: Calibration;
      settings: McSettings;
      plan: SavedPlan;
      /** Where the windfall in the run came from: the saved F3 plan, the expected one, or none. */
      windfall: { source: 'plan' | 'expected' | null; money: WindfallMoney | null };
    }
  | { ok: false; problem: 'settings' | 'plan' | 'assumptions' | 'classes' | { history: number; need: number } };

/** The month's run: the same on every page load until the month, the plan or an input changes. */
export function runMonteCarlo(data: McData, today: string): McRun {
  const { settings, plan } = data;
  if (!settings) return { ok: false, problem: 'settings' };
  if (!plan) return { ok: false, problem: 'plan' };
  if (Object.keys(data.assumptions).length === 0) return { ok: false, problem: 'assumptions' };
  const histories: ClassHistory[] = data.classes
    .filter((entry) => entry.targetWeight > 0)
    .map((entry) => ({ id: entry.id, weight: entry.targetWeight, core: entry.sleeve === 'core', returns: (entry.benchmarkTicker ? data.history.get(entry.benchmarkTicker) : undefined) ?? [] }));
  const calibration = calibrate(histories, data.assumptions, settings, settings.lookbackYears * 12);
  if ('problem' in calibration) return { ok: false, problem: calibration.problem === 'classes' ? 'classes' : { history: calibration.months, need: calibration.need } };
  const planned = data.windfallPlan ? windfallFromPlan(data.windfallPlan, data.windfallValue, plan.start, data.cashReturn) : null;
  const expected = planned ? null : expectedWindfall(settings.windfall, plan.start, data.windfallValue, data.cashReturn);
  const money = planned ?? expected;
  const result = monteCarlo({ plan, start: plan.start, calibration, windfall: money, settings, seed: monthSeed(today.slice(0, 7)) });
  return { ok: true, result, calibration, settings, plan, windfall: { source: planned ? 'plan' : expected ? 'expected' : null, money } };
}

/** What the monthly re-run saves (simulation_runs.summary): the inputs and the marks' figures. */
export function runSummary(run: Extract<McRun, { ok: true }>, today: string): Record<string, unknown> {
  const { result, calibration, plan, settings } = run;
  return {
    run_date: today,
    paths: result.paths,
    plan: { start: plan.start, years: plan.years, pv: plan.pv, pmt: plan.pmt, step_up: plan.stepUp, inflation: plan.inflation },
    history: { from: calibration.from, to: calibration.to, months: calibration.months, block_months: settings.blockMonths, scale_to_cma: settings.scaleToCma },
    windfall: run.windfall.source,
    target_twd: settings.targetTwd,
    marks: result.marks.map((mark) => ({
      year: mark.year,
      low: Math.round(mark.low),
      median: Math.round(mark.median),
      high: Math.round(mark.high),
      real_median: Math.round(mark.realMedian),
      reaching: mark.reaching,
    })),
  };
}

/** The monthly figures of a saved summary, read defensively; null when it is not one. */
export function readRunSummary(value: unknown): { runDate: string; months: number; marks: Array<{ year: number; median: number; realMedian: number; reaching: number | null }> } | null {
  const row = record(value);
  const history = record(row['history']);
  const marks = row['marks'];
  if (typeof row['run_date'] !== 'string' || typeof history['months'] !== 'number' || !Array.isArray(marks)) return null;
  const parsed = marks.flatMap((entry) => {
    const mark = record(entry);
    return typeof mark['year'] === 'number' && typeof mark['median'] === 'number' && typeof mark['real_median'] === 'number'
      ? [{ year: mark['year'], median: mark['median'], realMedian: mark['real_median'], reaching: typeof mark['reaching'] === 'number' ? mark['reaching'] : null }]
      : [];
  });
  return { runDate: row['run_date'], months: history['months'], marks: parsed };
}

// ---------------------------------------------------------------------------
// The spread of the final year
// ---------------------------------------------------------------------------

export interface ValueBin {
  from: number;
  to: number;
  count: number;
}

/** 1, 2 or 5 times a power of ten: the narrowest such width that gives at most `most` bins over `range`. */
function niceWidth(range: number, most: number): number {
  if (!(range > 0)) return 1;
  const raw = range / most;
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((step) => step * power >= raw) as number) * power;
}

/** The values (÷ `divisor`, e.g. the inflation factor for today's money) in bins of a round width. */
export function valueBins(values: ArrayLike<number>, divisor = 1, most = 30): { width: number; bins: ValueBin[] } {
  const n = values.length;
  if (n === 0) return { width: 0, bins: [] };
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < n; i++) {
    const value = (values[i] as number) / divisor;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const width = niceWidth(high - low, most);
  const first = Math.floor(low / width);
  const counts = new Array<number>(Math.floor(high / width) - first + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const at = Math.floor((values[i] as number) / divisor / width) - first;
    counts[at] = (counts[at] ?? 0) + 1;
  }
  return { width, bins: counts.map((count, k) => ({ from: (first + k) * width, to: (first + k + 1) * width, count })) };
}
