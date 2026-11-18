/**
 * The figures of the iPhone home-screen widget (asked by Hugo on 2026-11-18; docs/superpowers/specs/
 * 2026-11-18-ios-widget-design.md): the whole portfolio's value at the last close, both pools, the
 * poster's 7-day change and its line, read at a glance to see that nothing is wrong. The nightly job
 * saves them (widget_snapshot) from the same daily series the dashboard draws, so the widget and the
 * poster never disagree. Display only: nothing here raises a rule or a push.
 */
import { addDays } from '../dates';
import type { DayPoint } from './performance';
import { sample, valueLine } from './value-line';

/** At most this many points of the line: a widget is about 170 points wide. */
export const WIDGET_POINTS = 40;

export interface WidgetFigures {
  /** The last close of the series. */
  asOf: string;
  /** Both pools' value at that close, TWD (nav_snapshots.total_twd). */
  totalTwd: number;
  /** The poster's 7-day time-weighted return, 0.01 is +1%; null while the series is younger than a week. */
  weekChange: number | null;
  /** The poster's line, the cumulative return since the first day, oldest first. */
  points: number[];
  /** config sectors: Taiwan's red up unless green up was chosen. */
  redUp: boolean;
}

/** The widget's figures from the daily series; null until two closes hold a value. */
export function widgetFigures(days: readonly DayPoint[], redUp: boolean): WidgetFigures | null {
  const line = valueLine(days);
  const last = days[days.length - 1];
  if (!line || !last) return null;
  return {
    asOf: line.to,
    totalTwd: Math.round(last.value.all * 100) / 100,
    weekChange: line.week?.change ?? null,
    points: sample(line.points, WIDGET_POINTS).map((point) => Math.round(point.change * 1e4) / 1e4),
    redUp,
  };
}

/** Whether a close is older than `staleDays` before today (config widget.stale_days): a ⚠︎ beside its date. */
export function isStale(asOf: string, today: string, staleDays: number): boolean {
  return asOf < addDays(today, -staleDays);
}
