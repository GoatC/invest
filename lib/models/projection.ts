/**
 * The shared projection engine (PRD Module A). F2, the compounding calculator, is its
 * deterministic mode: the same expected return every month. F5's Monte Carlo (Phase 3) is its
 * stochastic mode: the same month-by-month loop, `simulate`, with a return drawn for each month.
 * Pure functions: the calculator runs them in the browser as the inputs change.
 *
 * Method (PRD F2):
 * - Monthly compounding: r = the expected yearly return ÷ 12.
 * - The contribution grows by g a month, g = (1 + yearly step-up)^(1/12) − 1, so after twelve
 *   months it is the step-up higher. It is paid at the end of each month, after that month's
 *   return, as the closed form assumes: FV = PV(1+r)^n + PMT·((1+r)^n − (1+g)^n) / (r − g).
 * - Real value: the nominal value in today's money, ÷ (1 + inflation)^(months ÷ 12); real return
 *   = (1 + nominal) ÷ (1 + inflation) − 1.
 * - Actual vs plan: the regular pool at each month end, the pool the monthly contributions go to
 *   (the windfall follows F3's own plan). Money put in is the trades', as for XIRR (step 5): buys
 *   in, sales and recorded dividends out, each change to a non-listed asset in or out; so money
 *   counts once it is invested, as the value does.
 */
import { addMonths, isMonth, lastDayOf } from '../dates';
import type { DayPoint, Scope } from './performance';

export interface MonthPoint {
  /** Months since the start; 0 is the start itself. */
  month: number;
  /** TWD at the month end, after its return and its contribution. */
  value: number;
  /** The start value plus every contribution so far, TWD. */
  contributed: number;
}

export interface Path {
  /** The value at the start, TWD. */
  pv: number;
  /** The first month's contribution, TWD. */
  pmt: number;
  /** The contribution's growth a month: 0.002 is 0.2%. */
  g: number;
  months: number;
}

/**
 * Month by month: each month the value earns `returnAt(month)`, then the month's contribution is
 * added. The first point is the start (month 0).
 */
export function simulate(path: Path, returnAt: (month: number) => number): MonthPoint[] {
  const out: MonthPoint[] = [{ month: 0, value: path.pv, contributed: path.pv }];
  let value = path.pv;
  let contributed = path.pv;
  let payment = path.pmt;
  for (let month = 1; month <= path.months; month++) {
    value = value * (1 + returnAt(month)) + payment;
    contributed += payment;
    out.push({ month, value, contributed });
    payment *= 1 + path.g;
  }
  return out;
}

/** The closed form for a constant monthly return r; where r equals g, its limit PMT·n·(1+r)^(n−1). */
export function futureValue({ pv, pmt, g, months, r }: Path & { r: number }): number {
  const growth = (1 + r) ** months;
  const annuity = Math.abs(r - g) < 1e-12 ? months * (1 + r) ** (months - 1) : (growth - (1 + g) ** months) / (r - g);
  return pv * growth + pmt * annuity;
}

/** PRD F2: r = annual return ÷ 12. */
export function monthlyReturn(yearly: number): number {
  return yearly / 12;
}

/** The monthly growth that adds up to `yearly` over twelve months. */
export function monthlyStepUp(yearly: number): number {
  return (1 + yearly) ** (1 / 12) - 1;
}

/** PRD F2: real return = (1 + nominal) ÷ (1 + inflation) − 1. */
export function realReturn(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1;
}

/** A value `months` from now in today's money. */
export function inTodaysMoney(value: number, inflation: number, months: number): number {
  return value / (1 + inflation) ** (months / 12);
}

/** F2's inputs; rates are yearly fractions: 0.06 is 6%. */
export interface Plan {
  pv: number;
  pmt: number;
  stepUp: number;
  expectedReturn: number;
  inflation: number;
  years: number;
}

export interface YearPoint {
  /** Years since the start; 0 is the start. */
  year: number;
  value: number;
  contributed: number;
  /** Value − contributed. */
  growth: number;
  /** The value in today's money. */
  real: number;
}

export interface Projection {
  months: MonthPoint[];
  /** The start and each year end. */
  years: YearPoint[];
  /** The last year end. */
  final: YearPoint;
  /** The last month's contribution, after every step-up. */
  lastPayment: number;
  realReturn: number;
}

function planPath(plan: Plan): Path {
  return { pv: plan.pv, pmt: plan.pmt, g: monthlyStepUp(plan.stepUp), months: Math.round(plan.years * 12) };
}

/** F2's deterministic path: the plan's expected return every month. */
export function project(plan: Plan): Projection {
  const path = planPath(plan);
  const r = monthlyReturn(plan.expectedReturn);
  const months = simulate(path, () => r);
  const years: YearPoint[] = months
    .filter((point) => point.month % 12 === 0)
    .map((point) => ({
      year: point.month / 12,
      value: point.value,
      contributed: point.contributed,
      growth: point.value - point.contributed,
      real: inTodaysMoney(point.value, plan.inflation, point.month),
    }));
  const final = years[years.length - 1] as YearPoint;
  return {
    months,
    years,
    final,
    lastPayment: path.months > 0 ? path.pmt * (1 + path.g) ** (path.months - 1) : 0,
    realReturn: realReturn(plan.expectedReturn, plan.inflation),
  };
}

// ---------------------------------------------------------------------------
// The saved plan (config projection)
// ---------------------------------------------------------------------------

/** The config row projection as read: anything missing or malformed is null. */
export interface PlanSettings {
  /** YYYY-MM; null until a plan is saved. */
  start: string | null;
  pv: number | null;
  pmt: number | null;
  stepUp: number | null;
  expectedReturn: number | null;
  inflation: number | null;
  years: number | null;
}

/** A plan with the month it starts: the one the actual regular pool is compared with. */
export interface SavedPlan extends Plan {
  start: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finite(value: unknown, ok: (number: number) => boolean = () => true): number | null {
  return typeof value === 'number' && Number.isFinite(value) && ok(value) ? value : null;
}

export function readPlanSettings(value: unknown): PlanSettings {
  const row = record(value);
  const start = typeof row['start'] === 'string' && isMonth(row['start']) ? row['start'] : null;
  return {
    start,
    pv: finite(row['pv'], (number) => number >= 0),
    pmt: finite(row['pmt'], (number) => number >= 0),
    stepUp: finite(row['step_up']),
    expectedReturn: finite(row['expected_return']),
    inflation: finite(row['inflation'], (number) => number > -1),
    years: finite(row['years'], (number) => Number.isInteger(number) && number >= 0),
  };
}

/** The saved plan; null until every part of it is there. */
export function savedPlan(settings: PlanSettings): SavedPlan | null {
  const { start, pv, pmt, stepUp, expectedReturn, inflation, years } = settings;
  if (start === null || pv === null || pmt === null || stepUp === null || expectedReturn === null || inflation === null || years === null) return null;
  return { start, pv, pmt, stepUp, expectedReturn, inflation, years };
}

/** The shape the config row stores. */
export function planValue(plan: SavedPlan): Record<string, string | number> {
  return { start: plan.start, pv: plan.pv, pmt: plan.pmt, step_up: plan.stepUp, expected_return: plan.expectedReturn, inflation: plan.inflation, years: plan.years };
}

// ---------------------------------------------------------------------------
// Actual vs plan
// ---------------------------------------------------------------------------

export interface MonthEnd {
  /** YYYY-MM. */
  month: string;
  /** The month's last day, or the series' last day in a month still running. */
  date: string;
  /** The scope's value at that close, TWD. */
  value: number;
  /** Money put in during the month, net of money taken out, TWD. */
  putIn: number;
  /** False for the month still running. */
  complete: boolean;
}

/** The scope's value at each month end, and the money put in during each month. */
export function monthEnds(days: readonly DayPoint[], scope: Scope = 'regular'): MonthEnd[] {
  const out: MonthEnd[] = [];
  for (const day of days) {
    const month = day.date.slice(0, 7);
    let last = out[out.length - 1];
    if (!last || last.month !== month) {
      last = { month, date: day.date, value: 0, putIn: 0, complete: false };
      out.push(last);
    }
    last.date = day.date;
    last.value = day.value[scope];
    // DayPoint.flow is from the investor's side: money put in is negative.
    last.putIn -= day.flow[scope];
    last.complete = day.date === lastDayOf(month);
  }
  return out;
}

export interface PlanRow {
  /** YYYY-MM; the row is that month's end. */
  month: string;
  date: string;
  /** Months since the plan's start; 0 is the end of the month before it. */
  index: number;
  actual: number;
  planned: number;
  /** The actual value at the start plus the money put in since, TWD. */
  actualContributed: number;
  /** The plan's PV plus its contributions so far, TWD. */
  plannedContributed: number;
}

/**
 * The plan against the actual month ends, from the end of the month before `start` (YYYY-MM)
 * through the last month that has ended, within the plan's years. Before the series' first month
 * the actual value is 0.
 */
export function againstPlan(ends: readonly MonthEnd[], start: string, plan: Plan): PlanRow[] {
  const path = planPath(plan);
  const r = monthlyReturn(plan.expectedReturn);
  const planned = simulate(path, () => r);
  const before = addMonths(start, -1);
  const first = ends[0];
  if (!first) return [];
  const byMonth = new Map(ends.map((end) => [end.month, end]));
  // A month before the series' first held nothing; a later one missing from it has not begun.
  const ended = (month: string) => {
    const end = byMonth.get(month);
    return end ? end.complete : month < first.month;
  };
  if (!ended(before)) return [];

  const startPoint = planned[0] as MonthPoint;
  const startValue = byMonth.get(before)?.value ?? 0;
  const rows: PlanRow[] = [
    { month: before, date: lastDayOf(before), index: 0, actual: startValue, planned: startPoint.value, actualContributed: startValue, plannedContributed: startPoint.contributed },
  ];
  let contributed = startValue;
  for (let index = 1; index < planned.length; index++) {
    const month = addMonths(before, index);
    const point = planned[index] as MonthPoint;
    if (!ended(month)) break;
    const end = byMonth.get(month);
    contributed += end?.putIn ?? 0;
    rows.push({ month, date: lastDayOf(month), index, actual: end?.value ?? 0, planned: point.value, actualContributed: contributed, plannedContributed: point.contributed });
  }
  return rows;
}

export interface Gap {
  /** Actual − planned value. */
  total: number;
  /** How much of it is money: actual − planned contributions. */
  contributed: number;
  /** The rest: actual − planned growth. */
  growth: number;
}

export function gap(row: PlanRow): Gap {
  const contributed = row.actualContributed - row.plannedContributed;
  const total = row.actual - row.planned;
  return { total, contributed, growth: total - contributed };
}
