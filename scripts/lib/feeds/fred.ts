/** FRED, the fallback for USD/TWD: DEXTAUS is published once a week, a few days behind. */
import { parseCsv } from '../payload.ts';
import { positive, type DailyRate } from './types.ts';

export const SOURCE = 'fred';

/** FRED series of TWD per 1 unit of a currency. */
export const FRED_SERIES: Record<string, string> = { USD: 'DEXTAUS' };

export function fredUrl(series: string, start: string): string {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}&cosd=${start}`;
}

/** The CSV's daily values; holidays carry "." and are left out. */
export function fredRates(csv: string, pair: string): DailyRate[] {
  return parseCsv(csv).flatMap(([date = '', value = '']) => {
    const rate = positive(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && rate ? [{ pair, date, rate, source: SOURCE }] : [];
  });
}
