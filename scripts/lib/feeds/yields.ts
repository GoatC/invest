/**
 * The 10-year government bond yields F11 (Phase 2, step 3) takes as R_f, and Damodaran's implied
 * equity risk premium, all as monthly market_series in fractions a year:
 * - us_treasury_10y: FRED's DGS10, the month's last daily value (the current month's newest so
 *   far); the US Treasury's own daily par yield curve (its "10 Yr" column) as the fallback.
 * - tw_govt_10y: the Central Bank of the ROC's capital-market rates (open data EG43M01), its
 *   "十年期政府公債次級市場利率" column, the secondary-market yield's monthly average, about two
 *   months behind. No second free source was found; until it loads the app uses config capm.
 * - us_implied_erp: Damodaran's ERP by month (ERPbymonth.xlsx, sheet "Historical ERP"), the
 *   trailing-12-month cash-yield figure he pairs with the Treasury rate, at the start of each month.
 *   The app falls back to the ERP typed in config capm.
 */
import * as XLSX from 'xlsx';

import { parseCsv } from '../payload.ts';
import { FeedError, type MonthlyPoint } from './types.ts';

export const US_TREASURY_10Y = 'us_treasury_10y';
export const TW_GOVT_10Y = 'tw_govt_10y';
export const US_IMPLIED_ERP = 'us_implied_erp';

export const CBC_CAPITAL_MARKET_RATES = 'https://www.cbc.gov.tw/public/data/OpenData/%E7%B6%93%E7%A0%94%E8%99%95/EG43M01.csv';
export const DAMODARAN_ERP = 'https://pages.stern.nyu.edu/~adamodar/pc/implprem/ERPbymonth.xlsx';

export function treasuryUrl(year: number): string {
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
}

/** A percentage as a fraction, to six decimals; undefined for blanks, "." and "-". */
function fraction(value: string | undefined): number | undefined {
  const text = (value ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  return Number((Number(text) / 100).toFixed(6));
}

/** Daily values (date YYYY-MM-DD) as one point per month: the month's last day. */
export function monthEnds(days: ReadonlyArray<{ date: string; value: number }>, series: string, source: string): MonthlyPoint[] {
  const last = new Map<string, { date: string; value: number }>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    const seen = last.get(month);
    if (!seen || day.date > seen.date) last.set(month, day);
  }
  return [...last.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, day]) => ({ series, month, value: day.value, source }));
}

/** FRED's DGS10 CSV (date, percent; holidays "."), as month ends. */
export function fredTenYear(csv: string): MonthlyPoint[] {
  const days = parseCsv(csv).flatMap(([date = '', value]) => {
    const rate = fraction(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && rate !== undefined ? [{ date, value: rate }] : [];
  });
  return monthEnds(days, US_TREASURY_10Y, 'fred');
}

/** The Treasury's daily par yield curve CSV (Date as MM/DD/YYYY, then a column per maturity), its "10 Yr" as month ends. */
export function treasuryTenYear(csv: string): MonthlyPoint[] {
  const [header, ...rows] = parseCsv(csv);
  const column = (header ?? []).findIndex((cell) => cell.trim() === '10 Yr');
  if (column < 0) throw new FeedError('Treasury yield curve: no "10 Yr" column');
  const days = rows.flatMap((row) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((row[0] ?? '').trim());
    const rate = fraction(row[column]);
    return match && rate !== undefined ? [{ date: `${match[3]}-${match[1]}-${match[2]}`, value: rate }] : [];
  });
  return monthEnds(days, US_TREASURY_10Y, 'treasury');
}

/** The Central Bank's capital-market rates CSV: months as "2026M08", the 10-year secondary-market yield's column found by its name. */
export function cbcTenYear(csv: string): MonthlyPoint[] {
  const [header, ...rows] = parseCsv(csv.replace(/^﻿/, ''));
  const column = (header ?? []).findIndex((cell) => cell.includes('十年期政府公債次級市場利率'));
  if (column < 0) throw new FeedError('Central Bank capital-market rates: no 10-year secondary-market column');
  return rows.flatMap((row) => {
    const match = /^(\d{4})M(\d{2})$/.exec((row[0] ?? '').trim());
    const rate = fraction(row[column]);
    return match && rate !== undefined ? [{ series: TW_GOVT_10Y, month: `${match[1]}-${match[2]}`, value: rate, source: 'cbc' }] : [];
  });
}

/**
 * Damodaran's ERP by month. The workbook is dated in Excel's 1904 system (it is made on a Mac), so
 * dates are read as the workbook says; the header row is found by its labels.
 */
export function damodaranErp(bytes: Uint8Array): MonthlyPoint[] {
  const book = XLSX.read(bytes, { type: 'array' });
  const sheet = book.Sheets['Historical ERP'];
  if (!sheet) throw new FeedError('Damodaran ERP workbook: no Historical ERP sheet');
  const date1904 = Boolean(book.Workbook?.WBProps?.date1904);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const headerAt = rows.findIndex((row) => Array.isArray(row) && row[0] === 'Start of month' && row.includes('ERP (T12m)'));
  const header = rows[headerAt];
  if (!header) throw new FeedError('Damodaran ERP workbook: no header row with Start of month and ERP (T12m)');
  const column = header.indexOf('ERP (T12m)');
  return rows.slice(headerAt + 1).flatMap((row) => {
    const serial = row[0];
    const erp = row[column];
    if (typeof serial !== 'number' || typeof erp !== 'number' || !Number.isFinite(erp) || erp <= 0 || erp >= 0.5) return [];
    const day = XLSX.SSF.parse_date_code(serial, { date1904 });
    if (!day || day.y < 1900) return [];
    return [{ series: US_IMPLIED_ERP, month: `${day.y}-${String(day.m).padStart(2, '0')}`, value: Number(erp.toFixed(6)), source: 'damodaran' }];
  });
}
