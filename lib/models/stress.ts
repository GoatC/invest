/**
 * F10 stress test and scenario replay (PRD Module B, Phase 3 step 3): what a bad stretch from
 * history, or one you make up, would have done to what you hold today.
 *
 * Method:
 * - A scenario is a run of months with a return in TWD for each of five series: US stocks, Taiwan
 *   stocks, bonds, gold and cash (config stress; each series is a long-history ETF or index of the
 *   asset class, since the class's own ETF may not have existed). Each asset class is mapped to
 *   one series.
 * - The replay applies the months to today's holdings by asset class, buy-and-hold: each class's
 *   value grows by its series' return, no trades, so the mix drifts as it did. A class with no
 *   series stays flat.
 * - Maximum drawdown: the deepest fall of the portfolio from its running peak (the start counts),
 *   in % and in NT$ of today's value. Months to recover: from the trough until the portfolio is
 *   back at the peak it fell from; null when the scenario ends first.
 * - F3's tiers: the gauge series (the US stock series stands for ACWI, whose history starts in
 *   2008) is read as month-end closes; the fall from its high of the rule's window fires the
 *   tiers, each once per drawdown, as F3 does (windfall.ts). They reset at a new high.
 * - A custom scenario is one shock month, then every class earns its expected return from the
 *   capital market assumptions until the portfolio is back at its start (at most `maxMonths`).
 *
 * Pure functions; the Stress test page uses them.
 */
import { addMonths, isMonth, lastDayOf } from '../dates';
import { drawdownOf, tierToFire, type Tier } from './windfall';

// ---------------------------------------------------------------------------
// Settings (config stress)
// ---------------------------------------------------------------------------

export interface SeriesInfo {
  id: string;
  nameEn: string;
  nameZh: string;
}

export interface Scenario {
  id: string;
  nameEn: string;
  nameZh: string;
  /** YYYY-MM of the first month. */
  from: string;
  /** Monthly return by series id, as fractions; every series has one for each month. */
  returns: Record<string, number[]>;
}

export interface StressSettings {
  series: SeriesInfo[];
  scenarios: Scenario[];
  /** Asset class id → series id. */
  map: Record<string, string>;
  /** The series whose month-end closes F3's tiers are read on. */
  gauge: string;
  /** The custom scenario: longest recovery to wait for, and the shocks it starts with, by class id. */
  customMaxMonths: number;
  customShocks: Record<string, number>;
  source: string;
  lastVerified: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** The config value read defensively; undefined when it is missing or its parts do not fit together. */
export function readStressSettings(value: unknown, lastVerified: string | null = null): StressSettings | undefined {
  const row = record(value);
  const seriesRow = record(row['series']);
  const series: SeriesInfo[] = [];
  for (const [id, entry] of Object.entries(seriesRow)) {
    const info = record(entry);
    const nameEn = text(info['name_en']);
    const nameZh = text(info['name_zh']);
    if (!nameEn || !nameZh) return undefined;
    series.push({ id, nameEn, nameZh });
  }
  if (series.length === 0) return undefined;
  const ids = new Set(series.map((entry) => entry.id));

  const scenarios: Scenario[] = [];
  if (!Array.isArray(row['scenarios'])) return undefined;
  for (const entry of row['scenarios']) {
    const scenario = record(entry);
    const id = text(scenario['id']);
    const nameEn = text(scenario['name_en']);
    const nameZh = text(scenario['name_zh']);
    const from = scenario['from'];
    const returnsRow = record(scenario['returns']);
    if (!id || !nameEn || !nameZh || typeof from !== 'string' || !isMonth(from)) return undefined;
    const returns: Record<string, number[]> = {};
    let months = -1;
    for (const key of ids) {
      const list = returnsRow[key];
      if (!Array.isArray(list) || list.length === 0 || !list.every((x) => typeof x === 'number' && Number.isFinite(x) && x > -1)) return undefined;
      if (months >= 0 && list.length !== months) return undefined;
      months = list.length;
      returns[key] = list as number[];
    }
    scenarios.push({ id, nameEn, nameZh, from, returns });
  }
  if (scenarios.length === 0) return undefined;

  const map: Record<string, string> = {};
  for (const [classId, seriesId] of Object.entries(record(row['map']))) {
    if (typeof seriesId === 'string' && ids.has(seriesId)) map[classId] = seriesId;
  }
  const gauge = text(row['gauge']);
  if (!gauge || !ids.has(gauge)) return undefined;
  const custom = record(row['custom']);
  const maxMonths = custom['max_months'];
  if (typeof maxMonths !== 'number' || !Number.isInteger(maxMonths) || maxMonths < 12 || maxMonths > 600) return undefined;
  const customShocks: Record<string, number> = {};
  for (const [classId, shock] of Object.entries(record(custom['shocks']))) {
    if (typeof shock === 'number' && shock > -1 && shock < 10) customShocks[classId] = shock;
  }
  return { series, scenarios, map, gauge, customMaxMonths: maxMonths, customShocks, source: text(row['source']) ?? '', lastVerified };
}

// ---------------------------------------------------------------------------
// The replay
// ---------------------------------------------------------------------------

/** One month of a replay: the portfolio's value at its end and how far it is below its peak. */
export interface ReplayMonth {
  /** YYYY-MM. */
  month: string;
  value: number;
  /** 1 − value ÷ running peak. */
  drawdown: number;
  /** The gauge's fall from its high of the window, for F3's tiers. */
  gaugeDrawdown: number | null;
}

export interface FiredTier {
  /** The tier's drawdown, 0.15 is 15%. */
  tier: number;
  month: string;
  /** The gauge's fall when it fired. */
  reached: number;
}

export interface Replay {
  /** The start, then each month. */
  months: ReplayMonth[];
  startValue: number;
  /** The deepest fall, as a fraction, and in TWD of the start value. */
  maxDrawdown: number;
  maxDrawdownTwd: number;
  /** YYYY-MM of the deepest fall; null when the value never fell. */
  troughMonth: string | null;
  /** Months from the trough back to the peak it fell from; null while still below at the end, 0 when it never fell. */
  recoveryMonths: number | null;
  endValue: number;
  tiers: FiredTier[];
  /** Asset classes with value and no series to move them: held flat. */
  unmapped: string[];
  /** Each class's value at the start and the end. */
  byClass: Array<{ id: string; start: number; end: number }>;
}

export interface ClassValue {
  id: string;
  /** Own money at the start: what the portfolio's value adds up. */
  valueTwd: number;
  /**
   * What moves with the series, negative for a short; the value when absent. A month's return r
   * changes the value by exposure × r, and the exposure itself by (1 + r).
   */
  exposureTwd?: number;
  /** The asset class whose series it follows, when `id` is not one (a what-if position); `id` when absent. */
  classId?: string;
}

/**
 * Today's holdings through a run of months. `returnsOf(classId, index)` is a class's return in the
 * month `index` (0 is the first); `gauge` the month-end closes' returns the tiers are read on.
 */
function run(start: string, classes: readonly ClassValue[], months: number, returnsOf: (classId: string, index: number) => number | undefined, gauge: ((index: number) => number) | null, tiers: readonly Tier[], windowWeeks: number): Replay {
  const values = new Map(classes.map((entry) => [entry.id, entry.valueTwd]));
  const exposures = new Map(classes.map((entry) => [entry.id, entry.exposureTwd ?? entry.valueTwd]));
  const seriesOf = new Map(classes.map((entry) => [entry.id, entry.classId ?? entry.id]));
  const startClass = new Map(values);
  const unmapped = classes.filter((entry) => Math.abs(entry.exposureTwd ?? entry.valueTwd) > 0 && returnsOf(entry.classId ?? entry.id, 0) === undefined).map((entry) => entry.id);
  const startValue = classes.reduce((sum, entry) => sum + entry.valueTwd, 0);

  const out: ReplayMonth[] = [{ month: addMonths(start, -1), value: startValue, drawdown: 0, gaugeDrawdown: gauge ? 0 : null }];
  const closes = [{ date: lastDayOf(addMonths(start, -1)), close: 1 }];
  let level = 1;
  let peak = startValue;
  let worst = 0;
  let troughAt: number | null = null;
  let troughPeak = startValue;
  const fired: FiredTier[] = [];
  let firedDrawdowns: number[] = [];

  for (let index = 0; index < months; index++) {
    let total = 0;
    for (const [id, value] of values) {
      const r = returnsOf(seriesOf.get(id) ?? id, index) ?? 0;
      const exposure = exposures.get(id) ?? value;
      const next = value + exposure * r;
      values.set(id, next);
      exposures.set(id, exposure * (1 + r));
      total += next;
    }
    if (total > peak) {
      peak = total;
    }
    const drawdown = peak > 0 ? 1 - total / peak : 0;
    if (drawdown > worst + 1e-12) {
      worst = drawdown;
      troughAt = index + 1;
      troughPeak = peak;
    }
    const month = addMonths(start, index);
    let gaugeDrawdown: number | null = null;
    if (gauge) {
      level *= 1 + gauge(index);
      closes.push({ date: lastDayOf(month), close: level });
      gaugeDrawdown = drawdownOf(closes, lastDayOf(month), windowWeeks)?.drawdown ?? 0;
      if (gaugeDrawdown <= 1e-9) firedDrawdowns = [];
      const tier = tierToFire(tiers, gaugeDrawdown, firedDrawdowns);
      if (tier) {
        // A deeper tier counts as firing those above it, as in F3; each is recorded once.
        for (const above of tiers.filter((one) => one.drawdown <= tier.drawdown + 1e-12 && !firedDrawdowns.includes(one.drawdown))) {
          fired.push({ tier: above.drawdown, month, reached: gaugeDrawdown });
          firedDrawdowns.push(above.drawdown);
        }
      }
    }
    out.push({ month, value: total, drawdown, gaugeDrawdown });
  }

  let recoveryMonths: number | null = worst > 0 ? null : 0;
  if (troughAt !== null) {
    for (let at = troughAt + 1; at < out.length; at++) {
      if ((out[at] as ReplayMonth).value >= troughPeak - 1e-9) {
        recoveryMonths = at - troughAt;
        break;
      }
    }
  }
  return {
    months: out,
    startValue,
    maxDrawdown: worst,
    maxDrawdownTwd: worst * startValue,
    troughMonth: troughAt === null ? null : (out[troughAt] as ReplayMonth).month,
    recoveryMonths,
    endValue: (out[out.length - 1] as ReplayMonth).value,
    tiers: fired,
    unmapped,
    byClass: classes.map((entry) => ({ id: entry.id, start: startClass.get(entry.id) ?? 0, end: values.get(entry.id) ?? 0 })),
  };
}

/** A scenario from history applied to today's holdings by asset class. */
export function replay(scenario: Scenario, classes: readonly ClassValue[], settings: Pick<StressSettings, 'map' | 'gauge'>, tiers: readonly Tier[], windowWeeks: number): Replay {
  const months = scenario.returns[settings.gauge]?.length ?? 0;
  const returnsOf = (classId: string, index: number) => {
    const series = settings.map[classId];
    return series ? scenario.returns[series]?.[index] : undefined;
  };
  const gauge = scenario.returns[settings.gauge];
  return run(scenario.from, classes, months, returnsOf, gauge ? (index) => gauge[index] as number : null, tiers, windowWeeks);
}

/**
 * The custom scenario: `shocks` (a return by class id) in the first month, then every class earns
 * its expected yearly return ÷ 12 until the portfolio is back at its start or `maxMonths` pass.
 */
export function customReplay(start: string, classes: readonly ClassValue[], shocks: Readonly<Record<string, number>>, expected: Readonly<Record<string, number>>, maxMonths: number): Replay {
  const returnsOf = (classId: string, index: number) => (index === 0 ? (shocks[classId] ?? 0) : (expected[classId] ?? 0) / 12);
  const full = run(start, classes, maxMonths, returnsOf, null, [], 52);
  if (full.recoveryMonths === null || full.troughMonth === null) return full;
  // Stop at the month the start value is regained.
  const troughAt = full.months.findIndex((month) => month.month === full.troughMonth);
  return run(start, classes, troughAt + full.recoveryMonths, returnsOf, null, [], 52);
}

// ---------------------------------------------------------------------------
// What-if position: a long or short, leveraged, added to the replay (analysis only, nothing saved)
// ---------------------------------------------------------------------------

export interface WhatIf {
  /** The asset class whose series the position follows. */
  classId: string;
  direction: 'long' | 'short';
  /** 1 to 10 in steps of 0.1. */
  leverage: number;
  /** Own money put in, TWD. */
  marginTwd: number;
}

export interface PositionPath {
  /** Own money left at each month-end, TWD, the start first: margin ± exposure × the month's return, frozen once used up. */
  values: number[];
  /** The lowest own money as a share of the margin (it can be below 0: a gap that costs more than was put in). */
  worstShare: number;
  /** First month own money fell to `callShare` of the margin or below; null when it never did. */
  callMonth: string | null;
  /** First month own money was used up (0 or below), when the broker would have closed it; null when it never was. */
  wipedMonth: string | null;
  /** Own money at the end as a share of the margin. */
  endShare: number;
}

/**
 * The position month by month. Exposure starts at ±leverage × margin and moves with the series:
 * each month the own money changes by exposure × r and the exposure by (1 + r), so a short's
 * exposure shrinks as prices fall and a leveraged long's grows as they rise. Once the own money
 * reaches 0 the position is treated as closed by the broker at that month-end, its loss frozen.
 */
export function positionPath(whatIf: WhatIf, start: string, months: number, returnAt: (index: number) => number | undefined, callShare: number | null): PositionPath {
  const margin = whatIf.marginTwd;
  let equity = margin;
  let exposure = (whatIf.direction === 'short' ? -1 : 1) * whatIf.leverage * margin;
  const values = [margin];
  let worst = margin;
  let callMonth: string | null = null;
  let wipedMonth: string | null = null;
  for (let index = 0; index < months; index++) {
    if (wipedMonth === null) {
      const r = returnAt(index) ?? 0;
      equity += exposure * r;
      exposure *= 1 + r;
      const month = addMonths(start, index);
      if (callMonth === null && callShare !== null && equity <= callShare * margin + 1e-9) callMonth = month;
      if (equity <= 1e-9) wipedMonth = month;
    }
    worst = Math.min(worst, equity);
    values.push(equity);
  }
  return { values, worstShare: margin > 0 ? worst / margin : 0, callMonth, wipedMonth, endShare: margin > 0 ? equity / margin : 0 };
}

/** The portfolio's deepest fall from its running peak with the position's own money added month by month. */
export function combinedDrawdown(base: Pick<Replay, 'months'>, path: Pick<PositionPath, 'values'>): { maxDrawdown: number; maxDrawdownTwd: number; endValue: number } {
  let peak = -Infinity;
  let worst = 0;
  let worstTwd = 0;
  let total = 0;
  base.months.forEach((month, at) => {
    total = month.value + (path.values[at] ?? path.values[path.values.length - 1] ?? 0);
    if (total > peak) peak = total;
    if (peak > 0 && 1 - total / peak > worst) {
      worst = 1 - total / peak;
      worstTwd = peak - total;
    }
  });
  return { maxDrawdown: worst, maxDrawdownTwd: worstTwd, endValue: total };
}

/** A scenario's monthly returns for one asset class, through the class → series map. */
export function classReturns(scenario: Scenario, map: Readonly<Record<string, string>>, classId: string): number[] | undefined {
  const series = map[classId];
  return series ? scenario.returns[series] : undefined;
}
