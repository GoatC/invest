/**
 * F1 30-year life timeline (PRD Module A, Phase 3 step 2): one chart of the whole plan. The weekly
 * dashboard is the home screen; this is the long view behind it, and shows
 * - the phases: accumulation (the plan's own start to end), the windfall's deployment (its
 *   tranches, from the saved F3 plan, else the expected windfall) and the later goals you set;
 * - F2's path (the plan at its expected return) and F5's band around it (the Monte Carlo median
 *   and its outer percentiles), both on the F5 run: the regular pool plus the windfall;
 * - the actual value at each month end, and today's, overlaid as the weeks go by.
 * The goals are config `timeline`: a month, an amount in today's money (optional) and a name.
 *
 * Pure functions; the Timeline page uses them.
 */
import { addMonths, isMonth, lastDayOf, monthsBetween } from '../dates';
import { shareAtLeast, type McResult, type YearFigures } from './monte-carlo';
import type { MonthEnd } from './projection';

// ---------------------------------------------------------------------------
// Settings (config timeline)
// ---------------------------------------------------------------------------

export interface Goal {
  /** YYYY-MM the goal falls due. */
  month: string;
  /** In today's money; null for a milestone with no amount. */
  amountTwd: number | null;
  name: string;
}

export interface TimelineSettings {
  goals: Goal[];
}

export const MAX_GOALS = 12;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The config value read defensively; undefined when it is missing or its goals are not a list. */
export function readTimelineSettings(value: unknown): TimelineSettings | undefined {
  const goals = record(value)['goals'];
  if (!Array.isArray(goals)) return undefined;
  const parsed = goals.flatMap((entry): Goal[] => {
    const row = record(entry);
    const { month, amount_twd: amount, name } = row;
    if (typeof month !== 'string' || !isMonth(month) || typeof name !== 'string' || name.trim() === '') return [];
    return [{ month, amountTwd: typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : null, name: name.trim() }];
  });
  return { goals: parsed.sort((a, b) => a.month.localeCompare(b.month)) };
}

/** The shape the config row stores. */
export function timelineSettingsValue(settings: TimelineSettings): Record<string, unknown> {
  return { goals: settings.goals.map((goal) => ({ month: goal.month, amount_twd: goal.amountTwd, name: goal.name })) };
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export type PhaseKind = 'accumulation' | 'windfall';

export interface Phase {
  kind: PhaseKind;
  /** First and last day of the phase, YYYY-MM-DD. */
  from: string;
  to: string;
}

/** The date a year of the plan ends: year 0 is the end of the month before it starts. */
export function yearEnd(start: string, year: number): string {
  return lastDayOf(addMonths(start, 12 * year - 1));
}

/**
 * The plan's accumulation, and the windfall's deployment from its first tranche's month to its
 * last's; the deployment is left out when no tranche is known.
 */
export function phases(start: string, years: number, tranches: ReadonlyArray<{ dueDate: string }>): Phase[] {
  const out: Phase[] = [{ kind: 'accumulation', from: `${start}-01`, to: yearEnd(start, years) }];
  const dates = tranches.map((tranche) => tranche.dueDate).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first && last) out.push({ kind: 'windfall', from: `${first.slice(0, 7)}-01`, to: lastDayOf(last.slice(0, 7)) });
  return out;
}

// ---------------------------------------------------------------------------
// The projection at a month, and the chance of a goal
// ---------------------------------------------------------------------------

export interface Projected {
  low: number;
  median: number;
  high: number;
  /** The mean path (F2's engine). */
  expected: number;
}

/**
 * The F5 band and the plan's path at the end of a month, nominal TWD, interpolated between the two
 * year ends around it; null before the plan starts or after it ends.
 */
export function projectedAt(fan: ReadonlyArray<Pick<YearFigures, 'year' | 'low' | 'median' | 'high' | 'expected'>>, start: string, month: string): Projected | null {
  const months = monthsBetween(start, month) + 1;
  const last = fan[fan.length - 1];
  if (!last || months < 0 || months > last.year * 12) return null;
  const below = Math.floor(months / 12);
  const lower = fan[below];
  const upper = fan[Math.min(below + 1, fan.length - 1)];
  if (!lower || !upper) return null;
  const share = (months - below * 12) / 12;
  const mix = (a: number, b: number) => a + (b - a) * share;
  return { low: mix(lower.low, upper.low), median: mix(lower.median, upper.median), high: mix(lower.high, upper.high), expected: mix(lower.expected, upper.expected) };
}

/**
 * The share of paths whose value in today's money is at least `amountToday` at the year end
 * nearest `month`; null beyond the plan. Nominal = today's money × (1 + inflation)^years.
 */
export function chanceAt(result: Pick<McResult, 'columns' | 'years'>, start: string, month: string, amountToday: number, inflation: number): number | null {
  const months = monthsBetween(start, month) + 1;
  if (months < 0 || months > result.years * 12) return null;
  const year = Math.round(months / 12);
  const column = result.columns[year];
  return column ? shareAtLeast(column, amountToday * (1 + inflation) ** (months / 12)) : null;
}

// ---------------------------------------------------------------------------
// Actuals
// ---------------------------------------------------------------------------

export interface Actual {
  date: string;
  value: number;
}

/** The scope's value at each month end that has passed, and the latest value (the month still running) as the last point. */
export function actuals(ends: readonly MonthEnd[]): Actual[] {
  return ends.filter((end, index) => end.complete || index === ends.length - 1).map((end) => ({ date: end.date, value: end.value }));
}

/** The months from `from` to `to` (both YYYY-MM), as a rounded number of years for a phase's length. */
export function yearsBetween(from: string, to: string): number {
  return Math.round((monthsBetween(from.slice(0, 7), to.slice(0, 7)) + 1) / 12 * 10) / 10;
}
