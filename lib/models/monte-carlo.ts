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
 *   then the month's contribution at the month end. The windfall (F3) waits in cash (config
 *   windfall cash_return) and moves to the core mix as its tranches come due; the tranches are the
 *   saved F3 plan's, else an expected windfall's (config monte_carlo.windfall) in equal tranches,
 *   as many as F3's pace gives today's CAPE percentile unless a count is set. The last tranche
 *   takes whatever cash is left, so the cash return's interest is invested too.
 * - Acceleration (rule WINDFALL_ACCELERATION), on every path: the gauge class (config
 *   monte_carlo.gauge_class, the global equity class standing for ACWI as in F10) is the path's own
 *   market; its fall from the highest month end of the window (52 weeks as 12 month ends) fires
 *   F3's tiers on the cash still waiting: 15% pulls the next tranche forward, 25% invests half,
 *   35% all of it, each tier once per drawdown, as the rules engine does. Month ends are smoother
 *   than days, so the tiers fire a little less often than they would live.
 * - Output: the band (low / median / high percentile) at each year end, in nominal TWD and in
 *   today's money, the figures at the marks (years 10, 20, 30), the share of paths reaching a
 *   target (in today's money) and the spread of the final year, with the mean path (every month
 *   at its expected return, the same engine) for comparison. With a windfall, each year also
 *   splits into the regular pool's and the windfall's median and gives the target's chance
 *   without the windfall, and the run counts the paths on which each tier fired.
 *
 * Pure functions; the Monte Carlo page and the nightly job's monthly re-run use them.
 */
import { isMonth, monthsBetween } from '../dates';
import { monthlyReturn, monthlyStepUp, simulate, type Path, type Plan, type SavedPlan } from './projection';
import type { Point } from './regression';
import { tierToFire, trancheCount, type Acceleration, type Gauge, type Pace, type Tier } from './windfall';

// ---------------------------------------------------------------------------
// Settings (config monte_carlo)
// ---------------------------------------------------------------------------

export interface ExpectedWindfall {
  amountTwd: number | null;
  /** YYYY-MM the money arrives (at its end); null until set. */
  month: string | null;
  /** Monthly tranches; null follows F3's pace at today's CAPE percentile. */
  tranches: number | null;
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
  /** The asset class whose simulated returns stand for ACWI, F3's acceleration gauge; null turns acceleration off. */
  gaugeClass: string | null;
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
  const tranches = windfall['tranches'] === null ? null : whole(windfall['tranches'], 1, 120);
  if (tranches === undefined) return undefined;
  const gauge = row['gauge_class'];
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
    gaugeClass: typeof gauge === 'string' && gauge.trim() !== '' ? gauge : null,
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
    gauge_class: settings.gaugeClass,
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
  /** Each simulated class's own calibrated return in each historical month, by class id. */
  byClass: Record<string, Float64Array>;
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
  const byClass: Record<string, Float64Array> = {};
  classes.forEach((entry, i) => {
    byClass[entry.id] = Float64Array.from(columns[i] as number[]);
  });
  return {
    from: keep[0] as string,
    to: keep[keep.length - 1] as string,
    months: keep.length,
    classes,
    regular,
    core,
    byClass,
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

/** A windfall still to come: it arrives at the end of `month` and is deployed in `tranches` equal tranches from then. */
export function expectedWindfall(expected: ExpectedWindfall, start: string, poolValue: number, cashReturn: number, tranches: number): WindfallMoney | null {
  if (expected.amountTwd === null || expected.month === null) return null;
  const first = monthNumber(start, expected.month);
  const each = expected.amountTwd / tranches;
  return {
    waiting: 0,
    deployed: poolValue,
    arrivals: [{ month: first, amount: expected.amountTwd }],
    deployments: Array.from({ length: tranches }, (_, i) => ({ month: first + i, amount: each })),
    cashReturn,
  };
}

/** F3's acceleration as one path meets it: its gauge's monthly return, the tiers, and the months the high is looked for over. */
export interface PathAcceleration {
  gauge: (month: number) => number;
  tiers: readonly Tier[];
  windowMonths: number;
}

/** 52 weeks as month ends: 12. */
export function windowMonths(weeks: number): number {
  return Math.max(1, Math.round((weeks * 12) / 52));
}

/** One path's windfall: its value at each month end (index 0 is the start) and the tiers that fired on it. */
export interface WindfallTrace {
  values: Float64Array;
  /** Each tier's drawdown, once for every time it fired. */
  fired: number[];
}

/**
 * What the windfall is worth at each month end given the core mix's returns. Each month the cash
 * earns the cash return and the deployed money the core mix's; then arrivals land, the tranches
 * due move over (the last takes all the cash left), and, with `acceleration`, a fall of the gauge
 * from its high of the window fires the deepest tier not yet fired in that drawdown.
 */
export function windfallPath(money: WindfallMoney, months: number, core: (month: number) => number, acceleration: PathAcceleration | null = null): WindfallTrace {
  const values = new Float64Array(months + 1);
  let waiting = money.waiting;
  let deployed = money.deployed;
  values[0] = waiting + deployed;
  const cash = monthlyReturn(money.cashReturn);
  const arrive = new Map<number, number>();
  for (const { month, amount } of money.arrivals) arrive.set(month, (arrive.get(month) ?? 0) + amount);
  const pending = [...money.deployments].sort((a, b) => a.month - b.month).map((tranche) => ({ ...tranche }));
  const level = new Float64Array(months + 1);
  level[0] = 1;
  const firedByPeak = new Map<number, number[]>();
  const fired: number[] = [];
  const invest = (amount: number) => {
    const moved = Math.min(Math.max(amount, 0), waiting);
    waiting -= moved;
    deployed += moved;
  };
  for (let month = 1; month <= months; month++) {
    waiting *= 1 + cash;
    deployed *= 1 + core(month);
    waiting += arrive.get(month) ?? 0;
    while (pending.length > 0 && (pending[0] as { month: number }).month <= month) {
      const tranche = pending.shift() as { amount: number };
      invest(pending.length === 0 ? waiting : tranche.amount);
    }
    if (acceleration) {
      level[month] = (level[month - 1] as number) * (1 + acceleration.gauge(month));
      // The earliest of equal highs names the drawdown, as the live gauge does.
      let peakAt = Math.max(0, month - acceleration.windowMonths + 1);
      for (let k = peakAt + 1; k <= month; k++) if ((level[k] as number) > (level[peakAt] as number)) peakAt = k;
      const drawdown = 1 - (level[month] as number) / (level[peakAt] as number);
      if (waiting > 1e-6 && pending.length > 0) {
        const tier = tierToFire(acceleration.tiers, drawdown, firedByPeak.get(peakAt) ?? []);
        if (tier) {
          firedByPeak.set(peakAt, [...(firedByPeak.get(peakAt) ?? []), tier.drawdown]);
          fired.push(tier.drawdown);
          if (tier.deploy.kind === 'next_tranche') {
            const next = pending.shift() as { amount: number };
            invest(pending.length === 0 ? waiting : next.amount);
          } else {
            invest(waiting * tier.deploy.share);
          }
          // The tranches left share what cash is left, as the live plan re-spreads it.
          const left = pending.reduce((sum, tranche) => sum + tranche.amount, 0);
          if (waiting <= 1e-6) pending.length = 0;
          else if (left > 0) for (const tranche of pending) tranche.amount *= waiting / left;
        }
      }
    }
    values[month] = waiting + deployed;
  }
  return { values, fired };
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
  /** F3's tiers and the class whose returns stand for ACWI; null leaves the windfall to its schedule. */
  acceleration?: { classId: string; tiers: readonly Tier[]; windowMonths: number } | null;
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
  /** With a windfall: the regular pool's and the windfall's own medians (nominal), and the target's chance without the windfall. */
  split: { regularMedian: number; windfallMedian: number; reachingWithout: number | null } | null;
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
  /** Every year end's values of every path, each ascending, nominal TWD; index 0 is the start. */
  columns: ArrayLike<number>[];
  /** Where the final value falls: the share of paths below the putIn. */
  belowPutIn: number;
  /** With acceleration: each tier's share of paths on which it fired at least once, shallowest first. */
  tiers: Array<{ drawdown: number; share: number }> | null;
}

/** Share of the ascending list that is at or above a value. */
export function shareAtLeast(sorted: ArrayLike<number>, value: number): number {
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

export function monteCarlo(input: McInput): McResult {
  const { plan, calibration, windfall, settings } = input;
  const path = pathOf(plan);
  const years = Math.floor(path.months / 12);
  const rows = calibration.months;
  const block = Math.min(settings.blockMonths, rows);
  const random = seededRandom(input.seed);
  const gaugeRows = input.acceleration ? calibration.byClass[input.acceleration.classId] : undefined;
  const accelerate = input.acceleration && gaugeRows ? input.acceleration : null;

  // columns[y] holds every path's value at year end y; with a windfall, its two parts too.
  const column = () => Array.from({ length: years + 1 }, () => new Float64Array(settings.paths));
  const columns = column();
  const regularColumns = windfall ? column() : null;
  const windfallColumns = windfall ? column() : null;
  const firedPaths = new Map<number, number>();
  const drawn = new Int32Array(path.months);
  for (let p = 0; p < settings.paths; p++) {
    for (let month = 0; month < path.months; ) {
      const first = Math.floor(random() * (rows - block + 1));
      for (let j = 0; j < block && month < path.months; j++) drawn[month++] = first + j;
    }
    const row = (month: number) => drawn[month - 1] as number;
    const points = simulate(path, (month) => calibration.regular[row(month)] as number);
    const trace = windfall
      ? windfallPath(
          windfall,
          path.months,
          (month) => calibration.core[row(month)] as number,
          accelerate && gaugeRows ? { gauge: (month) => gaugeRows[row(month)] as number, tiers: accelerate.tiers, windowMonths: accelerate.windowMonths } : null,
        )
      : null;
    for (let y = 0; y <= years; y++) {
      const regular = (points[y * 12] as { value: number }).value;
      const extra = trace ? (trace.values[y * 12] as number) : 0;
      (columns[y] as Float64Array)[p] = regular + extra;
      if (regularColumns && windfallColumns) {
        (regularColumns[y] as Float64Array)[p] = regular;
        (windfallColumns[y] as Float64Array)[p] = extra;
      }
    }
    if (trace) for (const tier of new Set(trace.fired)) firedPaths.set(tier, (firedPaths.get(tier) ?? 0) + 1);
  }

  // The mean path: the same engine with every month at the mix's expected return.
  const meanPoints = simulate(path, () => calibration.regularMean);
  const meanWindfall = windfall
    ? windfallPath(windfall, path.months, () => calibration.coreMean, accelerate && gaugeRows ? { gauge: () => calibration.classes.find((entry) => entry.id === accelerate.classId)?.mean ?? 0, tiers: accelerate.tiers, windowMonths: accelerate.windowMonths } : null)
    : null;

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
    const values = columns[year] as Float64Array;
    values.sort();
    const factor = (1 + inflation) ** year;
    const low = quantile(values, settings.band[0]);
    const median = quantile(values, 0.5);
    const high = quantile(values, settings.band[1]);
    let split: YearFigures['split'] = null;
    if (regularColumns && windfallColumns) {
      const regular = (regularColumns[year] as Float64Array).sort();
      const extra = (windfallColumns[year] as Float64Array).sort();
      split = {
        regularMedian: quantile(regular, 0.5),
        windfallMedian: quantile(extra, 0.5),
        reachingWithout: settings.targetTwd === null ? null : shareAtLeast(regular, settings.targetTwd * factor),
      };
    }
    fan.push({
      year,
      low,
      median,
      high,
      realLow: low / factor,
      realMedian: median / factor,
      realHigh: high / factor,
      expected: (meanPoints[year * 12] as { value: number }).value + (meanWindfall ? (meanWindfall.values[year * 12] as number) : 0),
      putIn: putInAt(year),
      // Real value ≥ target ⇔ nominal ≥ target × factor.
      reaching: settings.targetTwd === null ? null : shareAtLeast(values, settings.targetTwd * factor),
      split,
    });
    if (year === years) finals = values;
  }
  const last = fan[fan.length - 1] as YearFigures;
  return {
    paths: settings.paths,
    years,
    fan,
    marks: settings.markYears.filter((year) => year <= years).map((year) => fan[year] as YearFigures),
    finals,
    columns,
    belowPutIn: 1 - shareAtLeast(finals, last.putIn),
    tiers: windfall && accelerate ? accelerate.tiers.map((tier) => ({ drawdown: tier.drawdown, share: (firedPaths.get(tier.drawdown) ?? 0) / settings.paths })) : null,
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
  /** config windfall_pace and CAPE's percentile now (F3), for an expected windfall's tranches; null when missing. */
  pace: Pace | null;
  cape: Gauge | null;
  /** Rule WINDFALL_ACCELERATION's tiers when the rule is on; null when it is off or malformed. */
  acceleration: Acceleration | null;
}

/** How the run treats the windfall, for the page to say. */
export interface WindfallSetup {
  source: 'plan' | 'expected' | null;
  money: WindfallMoney | null;
  /** An expected windfall's tranches, and where the count came from: the setting, F3's pace at today's CAPE percentile, or the pace's middle count without CAPE. */
  tranches: { count: number; from: 'setting' | 'cape' | 'pace' } | null;
  /** Why acceleration is off: the rule is off, no gauge class is set, or the gauge class is not simulated (no assumption or history). Null when it is on. */
  accelerationOff: 'rule' | 'gauge' | 'gauge_class' | null;
  /** The gauge class when acceleration is on. */
  gaugeClass: string | null;
}

export type McRun =
  | {
      ok: true;
      result: McResult;
      calibration: Calibration;
      settings: McSettings;
      plan: SavedPlan;
      /** Where the windfall in the run came from (the saved F3 plan, the expected one, or none) and how it is paced. */
      windfall: WindfallSetup;
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
  // An expected windfall is paced as F3 would pace it today: CAPE's percentile sets the count.
  const tranches: WindfallSetup['tranches'] =
    settings.windfall.tranches !== null
      ? { count: settings.windfall.tranches, from: 'setting' }
      : data.pace && data.cape
        ? { count: trancheCount(data.cape.percentile, data.pace), from: 'cape' }
        : { count: data.pace?.tranches[1] ?? 12, from: 'pace' };
  const expected = planned ? null : expectedWindfall(settings.windfall, plan.start, data.windfallValue, data.cashReturn, tranches.count);
  const money = planned ?? expected;
  const accelerationOff: WindfallSetup['accelerationOff'] = !data.acceleration ? 'rule' : !settings.gaugeClass ? 'gauge' : !calibration.byClass[settings.gaugeClass] ? 'gauge_class' : null;
  const acceleration =
    accelerationOff === null && data.acceleration && settings.gaugeClass
      ? { classId: settings.gaugeClass, tiers: data.acceleration.tiers, windowMonths: windowMonths(data.acceleration.windowWeeks) }
      : null;
  const result = monteCarlo({ plan, start: plan.start, calibration, windfall: money, acceleration, settings, seed: monthSeed(today.slice(0, 7)) });
  return {
    ok: true,
    result,
    calibration,
    settings,
    plan,
    windfall: { source: planned ? 'plan' : expected ? 'expected' : null, money, tranches: expected ? tranches : null, accelerationOff, gaugeClass: acceleration?.classId ?? null },
  };
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
    windfall_tranches: run.windfall.tranches?.count ?? null,
    accelerated: result.tiers?.map((tier) => ({ drawdown: tier.drawdown, share: tier.share })) ?? null,
    target_twd: settings.targetTwd,
    marks: result.marks.map((mark) => ({
      year: mark.year,
      low: Math.round(mark.low),
      median: Math.round(mark.median),
      high: Math.round(mark.high),
      real_median: Math.round(mark.realMedian),
      reaching: mark.reaching,
      windfall_median: mark.split ? Math.round(mark.split.windfallMedian) : null,
      reaching_without_windfall: mark.split?.reachingWithout ?? null,
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
