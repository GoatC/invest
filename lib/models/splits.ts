/**
 * Stock splits (N5, PRD Section 9 open question): a split multiplies the units held, so a trade
 * entered before it counts in old units. Trades stay saved as they were traded; the models read
 * them restated in today's units, so quantities, average cost a share, market value and R1 / R2
 * come out right after a split. A reverse split is a ratio below 1 (1-for-10 is 0.1).
 *
 * Returns need nothing: they come from adjusted closes, already in today's units. Only the
 * day-by-day replay (F18) also reads quoted closes, so those are restated the same way.
 */

import type { Trade } from './types';

/** One split: from `exDate` on, each share held before it is `ratio` shares (4 for a 1-into-4 split). */
export interface Split {
  id?: number;
  ticker: string;
  /** The first day the shares trade split, YYYY-MM-DD: a trade on this day is already in new units. */
  exDate: string;
  ratio: number;
}

/** How many of today's shares one share held on `date` is: every split of the ticker after that day. */
export function splitFactor(splits: readonly Split[], ticker: string, date: string): number {
  let factor = 1;
  for (const split of splits) {
    if (split.ticker === ticker && split.exDate > date) factor *= split.ratio;
  }
  return factor;
}

/** Each trade in today's units: quantity × the factor, price ÷ it; fee, tax and every total unchanged. */
export function restateTrades<T extends Trade>(trades: readonly T[], splits: readonly Split[] | undefined): T[] {
  if (!splits || splits.length === 0) return [...trades];
  return trades.map((trade) => {
    const factor = splitFactor(splits, trade.ticker, trade.tradeDate);
    return factor === 1 ? trade : { ...trade, qty: trade.qty * factor, price: trade.price / factor };
  });
}

/** Quoted closes in today's units (close ÷ the factor); adjusted closes are left as they are. */
export function restateCloses<P extends { ticker: string; date: string; close: number }>(prices: readonly P[], splits: readonly Split[] | undefined): P[] {
  if (!splits || splits.length === 0) return [...prices];
  return prices.map((price) => {
    const factor = splitFactor(splits, price.ticker, price.date);
    return factor === 1 ? price : { ...price, close: price.close / factor };
  });
}
