/**
 * Robert Shiller's online data (PRD Section 6, F3): the monthly S&P 500 price, dividends and CAPE
 * since 1871, in one legacy Excel workbook (ie_data.xls) whose download link changes with each
 * update, so it is read from the data page every time. The price is the month's average close,
 * the dividend the year's, and CAPE the price over ten years of inflation-adjusted earnings.
 */
import * as XLSX from 'xlsx';

import { extractLinks } from '../payload.ts';
import { FeedError, type MonthlyPoint } from './types.ts';

export const SHILLER_PAGE = 'https://shillerdata.com/';
export const SOURCE = 'shiller';

/** The current ie_data.xls link on the data page. */
export function shillerLink(html: string, pageUrl = SHILLER_PAGE): string | undefined {
  return extractLinks(html, pageUrl).find((url) => /ie_data\.xls/i.test(url));
}

/** "1871.01" is January 1871 and "1871.1" October: the decimals are the month. */
export function shillerMonth(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const year = Math.floor(value);
  const month = Math.round((value - year) * 100);
  return year >= 1800 && month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, '0')}` : undefined;
}

const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);

/**
 * The workbook's Data sheet as three monthly series: us_cape, sp500_price and sp500_yield (the
 * year's dividends over the month's price). The header row is found by its labels, as rows are
 * added above it now and then.
 */
export function shillerSeries(bytes: Uint8Array): MonthlyPoint[] {
  const book = XLSX.read(bytes, { type: 'array' });
  const sheet = book.Sheets['Data'];
  if (!sheet) throw new FeedError('Shiller workbook: no Data sheet');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const headerAt = rows.findIndex((row) => Array.isArray(row) && row[0] === 'Date' && row.includes('CAPE'));
  const header = rows[headerAt];
  if (!header) throw new FeedError('Shiller workbook: no header row with Date and CAPE');
  const column = (label: string) => header.findIndex((cell) => cell === label);
  const [price, dividend, cape] = [column('P'), column('D'), column('CAPE')];
  if (price < 0 || dividend < 0 || cape < 0) throw new FeedError('Shiller workbook: the P, D or CAPE column is missing');
  const out: MonthlyPoint[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const month = shillerMonth(row[0]);
    if (!month) continue;
    const p = number(row[price]);
    const d = number(row[dividend]);
    const c = number(row[cape]);
    if (p !== undefined) out.push({ series: 'sp500_price', month, value: p, source: SOURCE });
    if (p !== undefined && d !== undefined) out.push({ series: 'sp500_yield', month, value: d / p, source: SOURCE });
    if (c !== undefined) out.push({ series: 'us_cape', month, value: c, source: SOURCE });
  }
  return out;
}
