/**
 * F3, the windfall tranche planner (PRD Module A): the windfall goes into the core classes only, in
 * monthly tranches whose number follows market valuation, sooner when the world market falls.
 * Pure functions; the rules engine drafts each tranche's orders, and the Windfall page shows the
 * plan and the backtest.
 *
 * Method:
 * - Valuation gauge: the S&P 500's Shiller CAPE as a percentile of its own history up to the
 *   month: the share of months, since the data begins, with a CAPE at or below it.
 * - Pace (config windfall_pace): below the first cutoff (30) the first count of tranches (6), up
 *   to the second (70) the middle one (12), above it the last (24). A tranche falls due each month
 *   from the plan's start, on the same day of the month (or the month's last day).
 * - Acceleration (rule WINDFALL_ACCELERATION): MSCI ACWI's fall from its 52-week high, measured on
 *   the ACWI ETF's closes. At 15% the next tranche is pulled forward into the current one; at 25%
 *   half the cash left goes in; at 35% all of it. A drawdown is named by the date of its peak, and
 *   each tier fires once per drawdown: a deeper one counts the tiers above it as fired too. A new
 *   52-week high starts a new drawdown.
 * - Backtest: lump sum against this pace and against the pace with its acceleration, on Shiller's
 *   monthly S&P 500 since 1871, from every start month with ten years of CAPE behind it. Each month
 *   the invested money earns the month's price change plus a twelfth of the dividend yield; the cash
 *   waiting earns config windfall.cash_return; the drawdown uses the trailing 12 months' high.
 *   Months are monthly averages, so drawdowns look shallower than day by day.
 */
import { addDays } from '../dates';

export interface MonthValue {
  /** YYYY-MM. */
  month: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Valuation and pace
// ---------------------------------------------------------------------------

export interface Gauge {
  month: string;
  cape: number;
  /** 0 to 100. */
  percentile: number;
  /** Months of history it is measured against, itself included. */
  months: number;
}

/** CAPE's percentile at `month` (the newest month on or before it), over every month up to it. */
export function capePercentile(series: readonly MonthValue[], month?: string): Gauge | null {
  const history = series.filter((point) => month === undefined || point.month <= month).sort((a, b) => a.month.localeCompare(b.month));
  const current = history[history.length - 1];
  if (!current) return null;
  const atOrBelow = history.filter((point) => point.value <= current.value).length;
  return { month: current.month, cape: current.value, percentile: (100 * atOrBelow) / history.length, months: history.length };
}

export interface Pace {
  /** Percentile cutoffs, ascending: [30, 70]. */
  cutoffs: [number, number];
  /** Tranches below the first, up to the second, above it: [6, 12, 24]. */
  tranches: [number, number, number];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** config windfall_pace; null when malformed. */
export function readPace(value: unknown): Pace | null {
  const { cutoffs, tranches } = record(value);
  if (!Array.isArray(cutoffs) || !Array.isArray(tranches) || cutoffs.length !== 2 || tranches.length !== 3) return null;
  const [low, high] = cutoffs;
  if (typeof low !== 'number' || typeof high !== 'number' || !(low >= 0 && low <= high && high <= 100)) return null;
  if (!tranches.every((count) => typeof count === 'number' && Number.isInteger(count) && count >= 1)) return null;
  return { cutoffs: [low, high], tranches: tranches as [number, number, number] };
}

/** PRD F3: below 30 → 6 monthly tranches, 30–70 → 12, above 70 → 24. */
export function trancheCount(percentile: number, pace: Pace): number {
  if (percentile < pace.cutoffs[0]) return pace.tranches[0];
  if (percentile <= pace.cutoffs[1]) return pace.tranches[1];
  return pace.tranches[2];
}

export interface PlannedTranche {
  dueDate: string;
  amountTwd: number;
}

/** The month `index` months after a date's, on its day or the month's last day. */
function monthlyDate(start: string, index: number): string {
  const [year, month, day] = start.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + index, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** `count` monthly tranches from `start`, the total split evenly to the dollar, the last taking what rounding leaves. */
export function schedule(totalTwd: number, start: string, count: number): PlannedTranche[] {
  const each = Math.round(totalTwd / count);
  return Array.from({ length: count }, (_, index) => ({
    dueDate: monthlyDate(start, index),
    amountTwd: index === count - 1 ? totalTwd - each * (count - 1) : each,
  }));
}

// ---------------------------------------------------------------------------
// Acceleration
// ---------------------------------------------------------------------------

export type Deploy = { kind: 'next_tranche' } | { kind: 'share'; share: number };

export interface Tier {
  /** 0.15 is a 15% fall from the 52-week high. */
  drawdown: number;
  deploy: Deploy;
}

export interface Acceleration {
  windowWeeks: number;
  tiers: Tier[];
}

/** The rule WINDFALL_ACCELERATION's threshold, tiers shallowest first; null when malformed. */
export function readAcceleration(threshold: unknown): Acceleration | null {
  const row = record(threshold);
  const weeks = row['window_weeks'];
  if (typeof weeks !== 'number' || !Number.isInteger(weeks) || weeks < 1 || !Array.isArray(row['tiers'])) return null;
  const tiers: Tier[] = [];
  for (const entry of row['tiers']) {
    const tier = record(entry);
    const drawdown = tier['drawdown'];
    if (typeof drawdown !== 'number' || !(drawdown > 0 && drawdown < 1)) return null;
    const share = tier['deploy_share_of_remaining'];
    if (tier['deploy'] === 'next_tranche') tiers.push({ drawdown, deploy: { kind: 'next_tranche' } });
    else if (typeof share === 'number' && share > 0 && share <= 1) tiers.push({ drawdown, deploy: { kind: 'share', share } });
    else return null;
  }
  return tiers.length > 0 ? { windowWeeks: weeks, tiers: tiers.sort((a, b) => a.drawdown - b.drawdown) } : null;
}

export interface Close {
  date: string;
  close: number;
}

export interface Drawdown {
  peak: Close;
  latest: Close;
  /** 1 − latest ÷ peak. */
  drawdown: number;
}

/** The fall of the newest close from the highest close of the `weeks` before it. */
export function drawdownOf(closes: readonly Close[], today: string, weeks: number): Drawdown | null {
  const from = addDays(today, -7 * weeks);
  const window = closes.filter((row) => row.date > from && row.date <= today && row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const latest = window[window.length - 1];
  if (!latest) return null;
  // The earliest of equal highs names the drawdown, so it keeps its name while the price stays below.
  const peak = window.reduce((best, row) => (row.close > best.close ? row : best));
  return { peak, latest, drawdown: 1 - latest.close / peak.close };
}

/**
 * The deepest tier the drawdown has reached that it has not fired. `fired` are the drawdowns of the
 * tiers this drawdown fired; a deeper one counts as firing those above it.
 */
export function tierToFire(tiers: readonly Tier[], drawdown: number, fired: readonly number[]): Tier | undefined {
  const deepestFired = fired.reduce((max, value) => Math.max(max, value), 0);
  const reached = tiers.filter((tier) => tier.drawdown <= drawdown + 1e-12 && tier.drawdown > deepestFired + 1e-12);
  return reached[reached.length - 1];
}

/** What a tier deploys of the cash waiting, with `left` tranches still scheduled: one tranche's worth, or its share. */
export function tierAmount(tier: Tier, waitingTwd: number, left: number): number {
  if (tier.deploy.kind === 'share') return waitingTwd * tier.deploy.share;
  return left > 0 ? waitingTwd / left : 0;
}

// ---------------------------------------------------------------------------
// Backtest: lump sum against the pace, and the pace with its acceleration
// ---------------------------------------------------------------------------

export interface MarketMonth {
  month: string;
  price: number;
  /** The year's dividends over the price. */
  yield: number;
  cape: number | null;
}

export interface BacktestSettings {
  pace: Pace;
  acceleration: Acceleration | null;
  /** Yearly return of the cash waiting. */
  cashReturn: number;
  horizonMonths: number;
  fromYear: number;
}

export interface BacktestRow {
  start: string;
  percentile: number;
  tranches: number;
  /** Ending value of 1 invested at once, at the pace, and at the pace with acceleration. */
  lump: number;
  pace: number;
  rule: number;
}

export interface Spread {
  /** Share of start months where the first beat the second. */
  wins: number;
  median: number;
  p10: number;
  p90: number;
  worst: number;
  best: number;
}

export interface Backtest {
  rows: BacktestRow[];
  /** Each as a return over the other: rule ÷ lump − 1, pace ÷ lump − 1, rule ÷ pace − 1. */
  ruleVsLump: Spread;
  paceVsLump: Spread;
  ruleVsPace: Spread;
  first: string;
  last: string;
}

/** History the gauge needs before a start month counts: ten years of CAPE. */
const MIN_HISTORY = 120;
/** Months the backtest's drawdown looks back over: twelve, the monthly 52 weeks. */
const PEAK_MONTHS = 12;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return (sorted[low] as number) + ((sorted[high] as number) - (sorted[low] as number)) * (at - low);
}

function spread(values: readonly number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    wins: values.length > 0 ? values.filter((value) => value > 0).length / values.length : 0,
    median: quantile(sorted, 0.5),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
    worst: sorted[0] ?? 0,
    best: sorted[sorted.length - 1] ?? 0,
  };
}

/** One strategy from month `s` for the horizon: tranches over `count` months, accelerated when `acceleration` is given. */
function simulate(months: readonly MarketMonth[], s: number, count: number, settings: BacktestSettings, accelerate: boolean): number {
  const cashRate = settings.cashReturn / 12;
  let invested = 0;
  let cash = 1;
  let left = count;
  const fired = new Map<number, number[]>();
  for (let t = s; t <= s + settings.horizonMonths; t++) {
    const month = months[t] as MarketMonth;
    if (left > 0) {
      const deploy = cash / left;
      invested += deploy;
      cash -= deploy;
      left -= 1;
    }
    if (accelerate && settings.acceleration && left > 0 && cash > 1e-12) {
      let peakAt = Math.max(0, t - PEAK_MONTHS + 1);
      for (let k = peakAt; k <= t; k++) if ((months[k] as MarketMonth).price > (months[peakAt] as MarketMonth).price) peakAt = k;
      const drawdown = 1 - month.price / (months[peakAt] as MarketMonth).price;
      const tier = tierToFire(settings.acceleration.tiers, drawdown, fired.get(peakAt) ?? []);
      if (tier) {
        fired.set(peakAt, [...(fired.get(peakAt) ?? []), tier.drawdown]);
        const amount = Math.min(cash, tierAmount(tier, cash, left));
        invested += amount;
        cash -= amount;
        if (tier.deploy.kind === 'next_tranche') left -= 1;
        if (cash <= 1e-12) left = 0;
      }
    }
    if (t === s + settings.horizonMonths) break;
    const next = months[t + 1] as MarketMonth;
    invested *= next.price / month.price + month.yield / 12;
    cash *= 1 + cashRate;
  }
  return invested + cash;
}

/**
 * Every start month from `fromYear` with ten years of CAPE behind it and the whole horizon after
 * it: what 1 grows to invested at once, at the pace its CAPE percentile sets, and at that pace
 * with acceleration.
 */
export function backtest(months: readonly MarketMonth[], settings: BacktestSettings): Backtest | null {
  const data = [...months].filter((row) => row.price > 0 && row.yield >= 0).sort((a, b) => a.month.localeCompare(b.month));
  const capes: MonthValue[] = [];
  const rows: BacktestRow[] = [];
  for (let s = 0; s < data.length; s++) {
    const month = data[s] as MarketMonth;
    if (month.cape !== null) capes.push({ month: month.month, value: month.cape });
    if (Number(month.month.slice(0, 4)) < settings.fromYear || month.cape === null || capes.length < MIN_HISTORY || s + settings.horizonMonths >= data.length) continue;
    const gauge = capePercentile(capes);
    if (!gauge) continue;
    const count = trancheCount(gauge.percentile, settings.pace);
    rows.push({
      start: month.month,
      percentile: gauge.percentile,
      tranches: count,
      lump: simulate(data, s, 1, settings, false),
      pace: simulate(data, s, count, settings, false),
      rule: simulate(data, s, count, settings, true),
    });
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return null;
  return {
    rows,
    ruleVsLump: spread(rows.map((row) => row.rule / row.lump - 1)),
    paceVsLump: spread(rows.map((row) => row.pace / row.lump - 1)),
    ruleVsPace: spread(rows.map((row) => row.rule / row.pace - 1)),
    first: first.start,
    last: last.start,
  };
}
