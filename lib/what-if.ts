/**
 * The long / short and leverage assumptions the analysis pages take from their query string
 * (stress test, efficient frontier, Regression Lab). Analysis only: nothing here is saved, and
 * no rule reads it. Leverage is always on a 0.1× grid.
 */
import type { Direction } from './models/types';

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Every step from `min` to `max` in 0.1×: tenths, so 0.1 + 0.2 never drifts. */
export function tenths(min: number, max: number): number[] {
  const low = Math.round(min * 10);
  const high = Math.round(max * 10);
  return high < low ? [] : Array.from({ length: high - low + 1 }, (_, index) => (low + index) / 10);
}

/** A leverage from the query, snapped to the 0.1× grid within [min, max]; `fallback` when missing or unreadable. */
export function queryLeverage(params: Params, key: string, min: number, max: number, fallback: number): number {
  const value = Number(first(params[key]));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}

export function queryDirection(params: Params, key: string): Direction {
  return first(params[key]) === 'short' ? 'short' : 'long';
}

/** A positive TWD amount from the query, else `fallback`. */
export function queryAmount(params: Params, key: string, fallback: number): number {
  const value = Number(first(params[key]));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function queryText(params: Params, key: string): string | undefined {
  const value = first(params[key]);
  return value && value.trim() !== '' ? value.trim() : undefined;
}

/** +1 for a long, −1 for a short. */
export function directionSign(direction: Direction): 1 | -1 {
  return direction === 'short' ? -1 : 1;
}
