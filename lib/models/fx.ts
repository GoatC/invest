import { isIsoDate } from '../dates';
import type { FxQuote } from './types';

/** ISO 4217 code for one troy ounce of gold: the nightly job stores the gold price as XAU/TWD. */
export const GOLD = 'XAU';

/** TWD rates per currency, oldest first, from the "<CUR>/TWD" pairs the nightly job loads; gold is not a currency here. */
export type RateHistory = ReadonlyMap<string, readonly FxQuote[]>;

export function rateHistory(rates: readonly FxQuote[]): RateHistory {
  const history = new Map<string, FxQuote[]>();
  for (const rate of rates) {
    const [base, quote] = rate.pair.split('/');
    if (!base || quote !== 'TWD' || base === 'TWD' || base === GOLD) continue;
    const list = history.get(base) ?? [];
    list.push(rate);
    history.set(base, list);
  }
  for (const list of history.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return history;
}

/** Whole days from one ISO date to a later one. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The rate for a trade on `date`: that day's, else the newest one before it, at most maxAgeDays
 * older (banks publish no rate on weekends and holidays). Undefined when none is that recent.
 */
export function rateOn(history: RateHistory, currency: string, date: string, maxAgeDays: number): FxQuote | undefined {
  const rates = history.get(currency);
  if (!rates) return undefined;
  // The last rate dated on or before `date`, by binary search over the sorted dates.
  let low = 0;
  let high = rates.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((rates[middle]?.date ?? '') <= date) low = middle + 1;
    else high = middle;
  }
  const found = rates[low - 1];
  return found && daysBetween(found.date, date) <= maxAgeDays ? found : undefined;
}

/**
 * The rate a trade starts with in the trade form: the trade date's rate (rateOn), or, with no
 * max age configured, the newest known one. A rate typed by hand is never replaced by it.
 */
export function suggestedRate(
  currency: string,
  tradeDate: string,
  history: RateHistory,
  maxAgeDays: number | null,
  newest: ReadonlyMap<string, { value: number }>,
): number | undefined {
  if (currency === 'TWD') return 1;
  if (maxAgeDays === null) return newest.get(currency)?.value;
  return isIsoDate(tradeDate) ? rateOn(history, currency, tradeDate, maxAgeDays)?.rate : undefined;
}
