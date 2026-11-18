/**
 * Kenneth French's Data Library (PRD Section 6, N1's five-factor mode): the monthly Fama–French
 * five factors (Mkt − Rf, SMB, HML, RMW, CMA) and the risk-free rate, in percent, one zip of a CSV
 * per region. The file starts with a few lines of text, then the monthly rows ("199007, 0.77,
 * 0.63, …"), then a blank line and the annual rows; a factor that is missing is -99.99.
 * Saved as ff5_<region>_<factor> (market_series), as fractions.
 */
import { seriesName, type Factor, type Region } from '../../../lib/models/five-factor.ts';
import { unzip } from '../payload.ts';
import { FeedError, type MonthlyPoint } from './types.ts';

export const SOURCE = 'french';
const BASE = 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/';

/** The library's file of each region's five factors. */
export const FRENCH_FILES: Record<Region, string> = {
  us: 'F-F_Research_Data_5_Factors_2x3_CSV.zip',
  developed: 'Developed_5_Factors_CSV.zip',
  emerging: 'Emerging_5_Factors_CSV.zip',
};

export function frenchUrl(region: Region): string {
  return `${BASE}${FRENCH_FILES[region]}`;
}

const COLUMNS: Array<Factor | 'rf'> = ['mkt', 'smb', 'hml', 'rmw', 'cma', 'rf'];

/**
 * A region's monthly factors from its zip, from `since` (YYYY-MM) on. A month with any of the six
 * missing is left out, so a regression never reads a hole as a zero.
 */
export function frenchSeries(bytes: Uint8Array, region: Region, since: string): MonthlyPoint[] {
  const files = unzip(bytes, (name) => /\.csv$/i.test(name));
  const file = Object.values(files)[0];
  if (!file) throw new FeedError(`French ${region}: no CSV in the zip`);
  const out: MonthlyPoint[] = [];
  let header = false;
  for (const line of new TextDecoder('latin1').decode(file).split(/\r?\n/)) {
    if (/^,\s*Mkt-RF/i.test(line.trim())) {
      header = true;
      continue;
    }
    if (!header) continue;
    const cells = line.split(',').map((cell) => cell.trim());
    const [stamp = '', ...values] = cells;
    // The monthly block ends at the first line that is not a month: a blank line, then the years.
    if (!/^\d{6}$/.test(stamp)) {
      if (stamp === '' && cells.every((cell) => cell === '')) break;
      continue;
    }
    const numbers = values.slice(0, 6).map(Number);
    if (numbers.length < 6 || numbers.some((value) => !Number.isFinite(value) || value <= -99)) continue;
    const month = `${stamp.slice(0, 4)}-${stamp.slice(4)}`;
    if (month < since) continue;
    COLUMNS.forEach((column, i) => out.push({ series: seriesName(region, column), month, value: Number(((numbers[i] as number) / 100).toFixed(6)), source: SOURCE }));
  }
  if (out.length === 0) throw new FeedError(`French ${region}: no monthly rows from ${since}`);
  return out;
}
