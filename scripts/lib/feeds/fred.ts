/**
 * FRED, the fallback for USD/TWD (DEXTAUS is published once a week, a few days behind), and since
 * Phase 2, step 2 the source of the US risk-free rate the Regression Lab (N1) uses: TB3MS, the
 * 3-month Treasury bill's monthly average, in percent a year.
 */
import { parseCsv } from '../payload.ts';
import { positive, type DailyRate, type MonthlyPoint } from './types.ts';

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

/** A monthly series in percent a year as fractions, one point per month; "." months are left out. */
export function fredMonthly(csv: string, series: string): MonthlyPoint[] {
  return parseCsv(csv).flatMap(([date = '', value = '']) => {
    const percent = Number(value);
    return /^\d{4}-\d{2}-01$/.test(date) && value.trim() !== '' && Number.isFinite(percent) ? [{ series, month: date.slice(0, 7), value: Number((percent / 100).toFixed(6)), source: SOURCE }] : [];
  });
}
