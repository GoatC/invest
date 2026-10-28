/**
 * multpl.com's monthly tables, the fallback for Shiller's workbook (F3): the same series from
 * Shiller's data, one HTML table per series, newest first. A table also lists today's value
 * mid-month; only the month's own row (dated the 1st, or the month's last day for the yield) is kept.
 */
import { FeedError, type MonthlyPoint } from './types.ts';

export const SOURCE = 'multpl';

/** Each series and its table; the yield is a percentage there and a fraction here. */
export const MULTPL_TABLES: Record<string, { path: string; percent: boolean }> = {
  us_cape: { path: 'shiller-pe', percent: false },
  sp500_price: { path: 's-p-500-historical-prices', percent: false },
  sp500_yield: { path: 's-p-500-dividend-yield', percent: true },
};

export function multplUrl(series: string): string {
  const table = MULTPL_TABLES[series];
  if (!table) throw new FeedError(`multpl: no table for ${series}`);
  return `https://www.multpl.com/${table.path}/table/by-month`;
}

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The rows of a by-month table as one series, a point per month. */
export function multplMonthly(html: string, series: string): MonthlyPoint[] {
  const table = MULTPL_TABLES[series];
  if (!table) throw new FeedError(`multpl: no table for ${series}`);
  const out = new Map<string, MonthlyPoint>();
  for (const match of html.matchAll(/<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
    const date = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec((match[1] ?? '').trim());
    const number = Number((match[2] ?? '').replace(/<[^>]+>|&#x?[0-9a-f]+;/gi, '').replace(/[^0-9.]/g, ''));
    const monthNumber = date ? MONTHS[date[1] ?? ''] : undefined;
    if (!date || !monthNumber || !Number.isFinite(number) || number <= 0) continue;
    const [day, year] = [Number(date[2]), Number(date[3])];
    if (day !== 1 && day !== lastDay(year, Number(monthNumber))) continue;
    const month = `${year}-${monthNumber}`;
    if (!out.has(month)) out.set(month, { series, month, value: table.percent ? Number((number / 100).toFixed(8)) : number, source: SOURCE });
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
}
