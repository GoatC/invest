/**
 * The combined look-through's feeds (F14, Phase 2 step 6): each fund's holdings from its issuer's
 * free files, and the sectors of the companies in them, read once a month by the nightly job.
 *
 * - Vanguard (VT, VOO): the portfolio-holding JSON the fund pages use, 500 lines a page, with each
 *   line's ticker, ISIN and weight.
 * - Fubon (00692): the fund's assets page, a table of each stock's code, name and weight, dated.
 * - State Street's Select Sector SPDR funds (XLK, XLF, …): each one's holdings list the S&P 500
 *   members of its GICS sector, which names the sector of most of the US equity held.
 * Taiwan companies take their sector from their TWSE industry code (company profiles), through
 * config look_through.tw_sectors.
 */
import * as XLSX from 'xlsx';

import { constituentKey, currencyOf, type Constituent } from '../../../lib/models/look-through.ts';
import { FeedError } from './types.ts';

export const VANGUARD_PAGE = 500;

export function vanguardUrl(id: string, start: number): string {
  return `https://investor.vanguard.com/vmf/api/${encodeURIComponent(id)}/portfolio-holding/stock.json?start=${start}&count=${VANGUARD_PAGE}`;
}

/** A Vanguard line before weighting: its market value, and the weight Vanguard rounds to two decimals. */
export interface VanguardLine extends Constituent {
  marketValue: number | null;
}

/** One page of a Vanguard fund's stocks: its lines, how many the page had, the fund's line count and the holdings' date. */
export function vanguardPage(text: string): { size: number; lines: number; asOf: string | null; constituents: VanguardLine[] } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FeedError('Vanguard holdings: reply is not JSON');
  }
  const reply = (body ?? {}) as { size?: unknown; asOfDate?: unknown; fund?: { entity?: unknown } };
  const entities = reply.fund?.entity;
  if (!Array.isArray(entities)) throw new FeedError('Vanguard holdings: no holdings in the reply');
  const constituents = entities.flatMap((raw): VanguardLine[] => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const percent = Number(row['percentWeight']);
    const value = typeof row['marketValue'] === 'number' && Number.isFinite(row['marketValue']) && row['marketValue'] > 0 ? row['marketValue'] : null;
    const name = typeof row['longName'] === 'string' ? row['longName'].trim() : '';
    if (name === '' || (value === null && !(percent > 0))) return [];
    const ticker = typeof row['ticker'] === 'string' && row['ticker'].trim() ? row['ticker'].trim().toUpperCase() : null;
    const isin = typeof row['isin'] === 'string' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(row['isin']) ? row['isin'] : null;
    const country = isin ? isin.slice(0, 2) : null;
    return [{ key: constituentKey(ticker, isin, name), name, ticker, country, currency: currencyOf(country), sector: null, assetType: 'equity', weight: Number.isFinite(percent) && percent > 0 ? Math.round(percent * 1e6) / 1e8 : 0, marketValue: value }];
  });
  const size = Number(reply.size);
  const asOf = typeof reply.asOfDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(reply.asOfDate) ? reply.asOfDate.slice(0, 10) : null;
  return { size: Number.isFinite(size) ? size : entities.length, lines: entities.length, asOf, constituents };
}

/**
 * A whole Vanguard file's lines, weighted by market value: Vanguard rounds each weight to two
 * decimals, which leaves the long tail at 0.00%. The stocks' share of the fund (the rest is cash)
 * comes from the lines of 0.5% or more, where the rounding barely matters: their stated weights
 * over their share of the stocks' value. Without market values, the rounded weights stand.
 */
export function vanguardWeights(lines: readonly VanguardLine[]): Constituent[] {
  const total = lines.reduce((sum, line) => sum + (line.marketValue ?? 0), 0);
  const large = lines.filter((line) => line.weight >= 0.005 && line.marketValue !== null);
  const stated = large.reduce((sum, line) => sum + line.weight, 0);
  const valued = total > 0 ? large.reduce((sum, line) => sum + (line.marketValue as number) / total, 0) : 0;
  const share = valued > 0 ? Math.min(1, Math.max(0.5, stated / valued)) : 1;
  return lines.flatMap(({ marketValue, ...line }) => {
    const weight = total > 0 && marketValue !== null ? (marketValue / total) * share : line.weight;
    return weight > 0 ? [{ ...line, weight: Math.round(weight * 1e10) / 1e10 }] : [];
  });
}

export function fubonUrl(id: string): string {
  return `https://websys.fsit.com.tw/FubonETF/Trade/Assets.aspx?stkId=${encodeURIComponent(id)}`;
}

function cellText(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .trim();
}

/** A Fubon ETF's stocks: each row's code, name and weight, and the page's 資料日期. */
export function fubonHoldings(html: string): { asOf: string | null; constituents: Constituent[] } {
  const date = /資料日期[：:]\s*(\d{4})\/(\d{2})\/(\d{2})/.exec(html.replace(/<[^>]+>/g, ' '));
  const constituents: Constituent[] = [];
  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...(row ?? '').matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((match) => cellText(match[1] ?? ''));
    const [code, name] = cells;
    const weight = Number((cells[cells.length - 1] ?? '').replace(/[,%\s]/g, ''));
    if (!code || !/^\d{4,6}[A-Z]?$/.test(code) || !name || cells.length < 3 || !Number.isFinite(weight) || weight <= 0 || weight > 100) continue;
    constituents.push({ key: `TW:${code}`, name, ticker: code, country: 'TW', currency: 'TWD', sector: null, assetType: 'equity', weight: Math.round(weight * 1e6) / 1e8 });
  }
  if (constituents.length === 0) throw new FeedError('Fubon holdings: no stock rows on the page');
  return { asOf: date ? `${date[1]}-${date[2]}-${date[3]}` : null, constituents };
}

export function sectorFundUrl(fund: string): string {
  return `https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-${fund.toLowerCase()}.xlsx`;
}

/** The tickers a Select Sector SPDR fund holds: the S&P 500 members of its sector. */
export function sectorMembers(bytes: Uint8Array): string[] {
  let rows: unknown[][];
  try {
    const book = XLSX.read(bytes, { type: 'array' });
    const sheet = book.Sheets[book.SheetNames[0] ?? ''];
    rows = sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]) : [];
  } catch {
    throw new FeedError('Select Sector SPDR holdings: not a workbook');
  }
  const header = rows.findIndex((row) => row[0] === 'Name' && row[1] === 'Ticker');
  if (header < 0) throw new FeedError('Select Sector SPDR holdings: no Name / Ticker header');
  const out: string[] = [];
  for (const row of rows.slice(header + 1)) {
    const ticker = typeof row[1] === 'string' ? row[1].trim().toUpperCase() : '';
    if (/^[A-Z][A-Z0-9.]{0,6}$/.test(ticker)) out.push(ticker);
  }
  return out;
}

/** Each constituent with its sector: US tickers by the sector funds, Taiwan codes by their TWSE industry. */
export function withSectors(constituents: readonly Constituent[], usSectors: ReadonlyMap<string, string>, twIndustries: ReadonlyMap<string, string>, twSectors: Readonly<Record<string, string>>): Constituent[] {
  return constituents.map((row) => {
    if (row.sector || !row.ticker) return row;
    const sector = row.country === 'US' ? usSectors.get(row.ticker) : row.country === 'TW' ? twSectors[twIndustries.get(row.ticker) ?? ''] : undefined;
    return sector ? { ...row, sector } : row;
  });
}
