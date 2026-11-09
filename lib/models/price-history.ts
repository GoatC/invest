/**
 * A holding's price history (N5 holdings view, added 2026-11-09): the daily closes the nightly job
 * loads, cut to a range (a week to everything) and read at a chosen step (day, week, month, year),
 * with each buy and sell of the ticker as a mark at its trade date and price. Pure functions; the
 * chart on /holdings/chart/[ticker] draws what they return.
 */
import type { Direction, Side } from './types';

export interface ClosePoint {
  /** YYYY-MM-DD. */
  date: string;
  close: number;
}

export const RANGES = ['1W', '1M', '3M', '1Y', '5Y', 'ALL'] as const;
export type Range = (typeof RANGES)[number];

export const STEPS = ['day', 'week', 'month', 'year'] as const;
export type Step = (typeof STEPS)[number];

/** The step each range reads at by default: days up to a year, weeks over five years, months for everything. */
export const DEFAULT_STEP: Record<Range, Step> = { '1W': 'day', '1M': 'day', '3M': 'day', '1Y': 'day', '5Y': 'week', ALL: 'month' };

function shift(date: string, { days = 0, months = 0, years = 0 }: { days?: number; months?: number; years?: number }): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCFullYear(day.getUTCFullYear() + years, day.getUTCMonth() + months, day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The first date a range shows, counted back from the newest close; null for everything. */
export function rangeStart(last: string, range: Range): string | null {
  switch (range) {
    case '1W':
      return shift(last, { days: -7 });
    case '1M':
      return shift(last, { months: -1 });
    case '3M':
      return shift(last, { months: -3 });
    case '1Y':
      return shift(last, { years: -1 });
    case '5Y':
      return shift(last, { years: -5 });
    case 'ALL':
      return null;
  }
}

/** The period a date falls in: itself, its ISO week's Monday, its month or its year. */
export function periodOf(date: string, step: Step): string {
  if (step === 'day') return date;
  if (step === 'month') return date.slice(0, 7);
  if (step === 'year') return date.slice(0, 4);
  const day = new Date(`${date}T00:00:00Z`);
  const weekday = (day.getUTCDay() + 6) % 7; // Monday 0
  return shift(date, { days: -weekday });
}

/** The last close of each period, dated on the day it was taken. Expects closes oldest first. */
export function resample(points: readonly ClosePoint[], step: Step): ClosePoint[] {
  if (step === 'day') return [...points];
  const out: ClosePoint[] = [];
  let current: string | undefined;
  for (const point of points) {
    const period = periodOf(point.date, step);
    if (period === current) out[out.length - 1] = point;
    else out.push(point);
    current = period;
  }
  return out;
}

/** Closes within a range, read at a step. */
export function window(points: readonly ClosePoint[], range: Range, step: Step): ClosePoint[] {
  const last = points[points.length - 1];
  if (!last) return [];
  const from = rangeStart(last.date, range);
  return resample(from === null ? points : points.filter((point) => point.date >= from), step);
}

/** The change from the first close shown to the last, as a fraction; null with fewer than two closes. */
export function change(points: readonly ClosePoint[]): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 2 || first.close <= 0) return null;
  return last.close / first.close - 1;
}

export interface TradeMark {
  date: string;
  side: Side;
  direction: Direction;
  qty: number;
  price: number;
}

/** The ticker's trades as marks, oldest first, kept to the range shown (from the first close shown on). */
export function tradeMarks(
  trades: ReadonlyArray<{ ticker: string; tradeDate: string; side: Side; direction?: Direction; qty: number; price: number }>,
  ticker: string,
  from: string | null,
): TradeMark[] {
  return trades
    .filter((trade) => trade.ticker === ticker && (from === null || trade.tradeDate >= from))
    .map((trade) => ({ date: trade.tradeDate, side: trade.side, direction: trade.direction ?? 'long', qty: trade.qty, price: trade.price }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
