/**
 * Builds the stress test's scenarios (F10, Phase 3 step 3) from long-history prices: for each of
 * five series, the return in TWD of each month of a window, from month-end closes. A USD series
 * is converted with the month-end USD/TWD rate, so its return carries the currency's move, as the
 * app's own TWD returns do.
 */

export interface Close {
  date: string;
  close: number;
}

/** The last close of each month (YYYY-MM → close); blank, zero or missing closes are left out. */
export function monthEnds(closes: readonly Close[]): Map<string, number> {
  const last = new Map<string, Close>();
  for (const row of closes) {
    if (!(row.close > 0)) continue;
    const month = row.date.slice(0, 7);
    const seen = last.get(month);
    if (!seen || row.date > seen.date) last.set(month, row);
  }
  return new Map([...last].map(([month, row]) => [month, row.close]));
}

function addMonths(month: string, months: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (number - 1) + months;
  const y = Math.floor(index / 12);
  return `${String(y).padStart(4, '0')}-${String(index - y * 12 + 1).padStart(2, '0')}`;
}

/**
 * Monthly returns for `months` months from `from` (YYYY-MM): each month's TWD month-end value over
 * the month before's. `rates` is the TWD per dollar, or null for a series already in TWD. Throws
 * when a month-end is missing, so a hole in the data is never taken for a flat month.
 */
export function monthlyReturns(closes: ReadonlyMap<string, number>, rates: ReadonlyMap<string, number> | null, from: string, months: number): number[] {
  const value = (month: string): number => {
    const close = closes.get(month);
    const rate = rates ? rates.get(month) : 1;
    if (close === undefined || rate === undefined) throw new Error(`no ${close === undefined ? 'close' : 'rate'} for ${month}`);
    return close * rate;
  };
  return Array.from({ length: months }, (_, i) => {
    const month = addMonths(from, i);
    return Number((value(month) / value(addMonths(month, -1)) - 1).toFixed(4));
  });
}
