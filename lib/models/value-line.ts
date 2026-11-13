/**
 * The line on the dashboard's poster (PRD Section 5, dashboard weekly view 1; asked by Hugo on
 * 2026-11-13): how far the whole portfolio, both pools together, has risen or fallen since its
 * first day, as F18's time-weighted return, so money put in or taken out does not bend the line.
 * Beside it, the gain in TWD net of the money moved, since the start and over the last seven days.
 * Display only: nothing here raises a rule or a push (principle 2).
 */
import { addDays } from '../dates';
import { cumulativeReturns, periodReturn, type DayPoint } from './performance';

/** A gain over a stretch of days: TWD net of the money moved, and the time-weighted return. */
export interface Gain {
  /** The close it is measured from. */
  from: string;
  gain: number;
  /** 0.08 is +8%; null when nothing was held over the stretch. */
  change: number | null;
}

export interface ValueLine {
  /** The cumulative return at each point kept, oldest first: 0 at the first close. */
  points: Array<{ date: string; change: number }>;
  /** The newest day of the series. */
  to: string;
  /** Since the first day anything was held. */
  total: Gain;
  /** The last seven days; null while the series is younger than that. */
  week: Gain | null;
}

/** At most `max` of the rows, evenly spaced, always the first and the last. */
export function sample<T>(rows: readonly T[], max: number): T[] {
  if (max < 2 || rows.length <= max) return [...rows];
  const last = rows.length - 1;
  const out: T[] = [];
  for (let index = 0; index < max; index += 1) {
    const row = rows[Math.round((index * last) / (max - 1))];
    if (row !== undefined) out.push(row);
  }
  return out;
}

/** The poster's line and figures from the daily series; null until two closes hold a value. */
export function valueLine(days: readonly DayPoint[], maxPoints = 60): ValueLine | null {
  const line = cumulativeReturns(days, 'all');
  const first = line[0];
  const last = line[line.length - 1];
  if (!first || !last || line.length < 2) return null;
  const gainOver = (from: string): Gain => {
    const period = periodReturn(days, 'all', from, last.date);
    return { from: period.from, gain: period.gain, change: period.twr };
  };
  const weekStart = addDays(last.date, -7);
  return {
    points: sample(line, maxPoints).map((point) => ({ date: point.date, change: point.twr })),
    to: last.date,
    // From the day before the first, so the first day's fee and tax count as a loss.
    total: gainOver(addDays(days[0]?.date ?? first.date, -1)),
    week: first.date <= weekStart ? gainOver(weekStart) : null,
  };
}

/**
 * The points as an SVG path in a box of `width` × `height`, `pad` kept clear above and below: a
 * smooth curve through every point (monotone cubic, so it never swings past a point's own value),
 * and the height of the zero line, where the series started.
 */
export function linePath(changes: readonly number[], width: number, height: number, pad: number): { path: string; zero: number; end: { x: number; y: number } } | null {
  if (changes.length < 2) return null;
  const low = Math.min(...changes);
  const high = Math.max(...changes);
  const span = high - low;
  const step = width / (changes.length - 1);
  // A flat series sits in the middle of the box.
  const y = (value: number) => (span === 0 ? height / 2 : pad + ((high - value) * (height - 2 * pad)) / span);
  const ys = changes.map(y);

  // Fritsch–Carlson tangents: the slope at each point, flattened at a peak or a trough.
  const slopes = ys.slice(1).map((value, index) => (value - (ys[index] ?? value)) / step);
  const tangents = ys.map((_, index) => {
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before === undefined) return after ?? 0;
    if (after === undefined) return before;
    if (before * after <= 0) return 0;
    return (2 * before * after) / (before + after);
  });

  const fixed = (value: number) => value.toFixed(1);
  let path = `M0 ${fixed(ys[0] ?? 0)}`;
  for (let index = 1; index < ys.length; index += 1) {
    const x0 = (index - 1) * step;
    const x1 = index * step;
    const y0 = ys[index - 1] ?? 0;
    const y1 = ys[index] ?? 0;
    path += ` C${fixed(x0 + step / 3)} ${fixed(y0 + ((tangents[index - 1] ?? 0) * step) / 3)} ${fixed(x1 - step / 3)} ${fixed(y1 - ((tangents[index] ?? 0) * step) / 3)} ${fixed(x1)} ${fixed(y1)}`;
  }
  return { path, zero: y(0), end: { x: width, y: ys[ys.length - 1] ?? 0 } };
}
