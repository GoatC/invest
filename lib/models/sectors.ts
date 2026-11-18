/**
 * The sector tab (N7, PRD Module C, Phase 2 step 7): which of the 11 GICS sectors are moving, and
 * how much of the portfolio sits in each. Display only: no rule, no push.
 *
 * - US sectors are priced by the Select Sector SPDR funds (dividend-adjusted closes); Taiwan's by
 *   the TWSE industry indices (price indices: dividends left out), each mapped to a GICS sector in
 *   config sectors. A sector with several Taiwan indices takes their equal-weighted average.
 * - Returns over 1 week, 1 month, 3 months, the year to date and 1 year, from the close on or
 *   before the period's start to the newest close; a series that does not reach back gives none.
 * - Volatility: the standard deviation of the last 52 weekly returns (each 7 days back from the
 *   newest close), × √52.
 * - Exposure from F14's look-through: each company's TWD value through the funds and directly, by
 *   its sector and its country (US, Taiwan, or elsewhere, which no proxy here prices).
 * Pure functions; lib/data loads the closes and the look-through.
 */
import { addDays, addMonths } from '../dates';
import { GICS_SECTORS, type Exposure } from './look-through';

export const PERIODS = ['1W', '1M', '3M', 'YTD', '1Y'] as const;
/** Days of closes the tab reads and the nightly job loads: a year, the year's start, and a margin for holidays. */
export const SECTOR_DAYS = 400;
export type Period = (typeof PERIODS)[number];
export type SectorMarket = 'US' | 'TW';

/** One sector proxy: the index_prices id it is saved under, where it comes from, and its sector. */
export interface SectorProxy {
  id: string;
  market: SectorMarket;
  /** The FinMind id: the fund's ticker, or the industry index's English name. */
  symbol: string;
  /** The TWSE name of an industry index (the fallback feed's), or the fund's ticker. */
  name: string;
  sector: string;
}

export interface SectorSettings {
  /** Taiwan's convention by default: red up, green down; or the US's green up. */
  colour: 'red_up' | 'green_up';
  proxies: SectorProxy[];
  lastVerified: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const isSector = (value: unknown): value is string => typeof value === 'string' && (GICS_SECTORS as readonly string[]).includes(value);

/** The id a Taiwan industry index is saved under in index_prices: "TW_SEMICONDUCTOR". */
export function twIndexId(symbol: string): string {
  return `TW_${symbol.toUpperCase()}`;
}

/** config sectors read defensively; undefined when missing or malformed. */
export function readSectorSettings(value: unknown): SectorSettings | undefined {
  const row = record(value);
  const colour = row['colour'];
  if (colour !== 'red_up' && colour !== 'green_up') return undefined;
  const proxies: SectorProxy[] = [];
  for (const [symbol, sector] of Object.entries(record(row['us']))) {
    if (!/^[A-Z]{2,5}$/.test(symbol) || !isSector(sector)) return undefined;
    proxies.push({ id: symbol, market: 'US', symbol, name: symbol, sector });
  }
  for (const [symbol, entry] of Object.entries(record(row['tw']))) {
    const { name, sector } = record(entry);
    if (!/^[A-Za-z]+$/.test(symbol) || typeof name !== 'string' || !isSector(sector)) return undefined;
    proxies.push({ id: twIndexId(symbol), market: 'TW', symbol, name, sector });
  }
  if (proxies.length === 0) return undefined;
  const verified = row['last_verified'];
  return { colour, proxies, lastVerified: typeof verified === 'string' ? verified : null };
}

export function sectorSettingsValue(settings: SectorSettings): Record<string, unknown> {
  return {
    colour: settings.colour,
    us: Object.fromEntries(settings.proxies.filter((proxy) => proxy.market === 'US').map((proxy) => [proxy.symbol, proxy.sector])),
    tw: Object.fromEntries(settings.proxies.filter((proxy) => proxy.market === 'TW').map((proxy) => [proxy.symbol, { name: proxy.name, sector: proxy.sector }])),
    last_verified: settings.lastVerified,
  };
}

// ---------------------------------------------------------------------------
// Returns and volatility
// ---------------------------------------------------------------------------

export interface Close {
  date: string;
  close: number;
}

/** A date `months` from another, the day kept where the month has it, else the month's last. */
export function shiftMonths(date: string, months: number): string {
  const month = addMonths(date.slice(0, 7), months);
  const [year, number] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, '0')}`;
}

/** The first day a period's return is measured from: its start, the base close on or before it. */
export function periodStart(period: Period, newest: string): string {
  switch (period) {
    case '1W':
      return addDays(newest, -7);
    case '1M':
      return shiftMonths(newest, -1);
    case '3M':
      return shiftMonths(newest, -3);
    case 'YTD':
      return `${Number(newest.slice(0, 4)) - 1}-12-31`;
    case '1Y':
      return shiftMonths(newest, -12);
  }
}

/** The newest close on or before `date`, from closes sorted oldest first. */
export function closeAt(closes: readonly Close[], date: string): Close | undefined {
  let found: Close | undefined;
  for (const close of closes) {
    if (close.date > date) break;
    found = close;
  }
  return found;
}

/** A base close more than this many days before a period's start means the series has a gap there. */
const BASE_SLACK_DAYS = 10;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The return over a period ending at the newest close on or before `today`; null when the closes do not reach back. */
export function periodReturn(closes: readonly Close[], period: Period, today: string): number | null {
  const last = closeAt(closes, today);
  if (!last) return null;
  const start = periodStart(period, last.date);
  const base = closeAt(closes, start);
  if (!base || daysBetween(base.date, start) > BASE_SLACK_DAYS || base.close <= 0) return null;
  return last.close / base.close - 1;
}

/** The 52 weekly returns before the newest close on or before `today`, oldest first; fewer when the closes stop. */
export function weeklyReturns(closes: readonly Close[], today: string, weeks = 52): number[] {
  const last = closeAt(closes, today);
  if (!last) return [];
  const points: Close[] = [];
  for (let i = weeks; i >= 0; i--) {
    const at = closeAt(closes, addDays(last.date, -7 * i));
    if (!at || daysBetween(at.date, addDays(last.date, -7 * i)) > BASE_SLACK_DAYS) continue;
    points.push(at);
  }
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) out.push((points[i] as Close).close / (points[i - 1] as Close).close - 1);
  return out;
}

/** The annualised volatility of weekly returns: their sample standard deviation × √52; null with fewer than 26. */
export function annualVolatility(returns: readonly number[]): number | null {
  if (returns.length < 26) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(52);
}

function average(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length;
}

// ---------------------------------------------------------------------------
// The sector view
// ---------------------------------------------------------------------------

export interface SectorRow {
  sector: string;
  market: SectorMarket;
  /** The proxies behind it, by id. */
  proxies: string[];
  returns: Record<Period, number | null>;
  volatility: number | null;
  /** The portfolio's exposure to the sector's companies of this market, TWD. */
  exposureTwd: number;
}

export interface SectorTile {
  sector: string;
  exposureTwd: number;
  share: number;
  /** The sector's return, its US and Taiwan returns weighted by the exposure in each (equal without any). */
  returns: Record<Period, number | null>;
  /** Exposure by the company's country: US, TW, or other. */
  byMarket: { US: number; TW: number; other: number };
}

export interface SectorView {
  /** The newest close among the proxies. */
  asOf: string | null;
  rows: SectorRow[];
  tiles: SectorTile[];
  /** The exposure-weighted point of the bubbles that have exposure: 1-year return and volatility. */
  portfolio: { ret: number; volatility: number } | null;
}

/** Each sector and market's returns and volatility, and the portfolio's exposure to each. */
export function sectorView(proxies: readonly SectorProxy[], closes: ReadonlyMap<string, readonly Close[]>, exposures: readonly Exposure[], today: string): SectorView {
  const groups = new Map<string, SectorProxy[]>();
  for (const proxy of proxies) groups.set(`${proxy.sector}|${proxy.market}`, [...(groups.get(`${proxy.sector}|${proxy.market}`) ?? []), proxy]);
  const exposureOf = (sector: string, market: 'US' | 'TW' | 'other') =>
    exposures
      .filter((exposure) => exposure.assetType === 'equity' && !exposure.whole && exposure.sector === sector && (market === 'other' ? exposure.country !== 'US' && exposure.country !== 'TW' : exposure.country === market))
      .reduce((sum, exposure) => sum + exposure.valueTwd, 0);
  const rows: SectorRow[] = [];
  for (const sector of GICS_SECTORS) {
    for (const market of ['US', 'TW'] as const) {
      const members = groups.get(`${sector}|${market}`) ?? [];
      if (members.length === 0) continue;
      const series = members.map((proxy) => closes.get(proxy.id) ?? []);
      const returns = Object.fromEntries(PERIODS.map((period) => [period, average(series.map((one) => periodReturn(one, period, today)))])) as Record<Period, number | null>;
      // Equal-weighted weekly returns across the sector's proxies, week by week.
      const weekly = series.map((one) => weeklyReturns(one, today));
      const length = Math.min(...weekly.map((one) => one.length));
      const blended = Array.from({ length }, (_, i) => average(weekly.map((one) => one[one.length - length + i] ?? null)) as number);
      rows.push({ sector, market, proxies: members.map((proxy) => proxy.id), returns, volatility: annualVolatility(blended), exposureTwd: exposureOf(sector, market) });
    }
  }
  const equity = exposures.filter((exposure) => exposure.assetType === 'equity' && !exposure.whole);
  const equityTotal = equity.reduce((sum, exposure) => sum + exposure.valueTwd, 0);
  const tiles: SectorTile[] = [...GICS_SECTORS, 'unclassified']
    .map((sector) => {
      const byMarket = sector === 'unclassified' ? { US: 0, TW: 0, other: equity.filter((exposure) => !exposure.sector).reduce((sum, exposure) => sum + exposure.valueTwd, 0) } : { US: exposureOf(sector, 'US'), TW: exposureOf(sector, 'TW'), other: exposureOf(sector, 'other') };
      const exposureTwd = byMarket.US + byMarket.TW + byMarket.other;
      const us = rows.find((row) => row.sector === sector && row.market === 'US');
      const tw = rows.find((row) => row.sector === sector && row.market === 'TW');
      const returns = Object.fromEntries(
        PERIODS.map((period) => {
          const parts = [
            { weight: byMarket.US, value: us?.returns[period] ?? null },
            { weight: byMarket.TW, value: tw?.returns[period] ?? null },
          ].filter((part) => part.value !== null) as Array<{ weight: number; value: number }>;
          const weight = parts.reduce((sum, part) => sum + part.weight, 0);
          const value = parts.length === 0 ? null : weight > 0 ? parts.reduce((sum, part) => sum + part.weight * part.value, 0) / weight : parts.reduce((sum, part) => sum + part.value, 0) / parts.length;
          return [period, value];
        }),
      ) as Record<Period, number | null>;
      return { sector, exposureTwd, share: equityTotal > 0 ? exposureTwd / equityTotal : 0, returns, byMarket };
    })
    .filter((tile) => tile.exposureTwd > 0 || tile.sector !== 'unclassified')
    .sort((a, b) => b.exposureTwd - a.exposureTwd || a.sector.localeCompare(b.sector));
  const weighted = rows.filter((row) => row.exposureTwd > 0 && row.returns['1Y'] !== null && row.volatility !== null);
  const weight = weighted.reduce((sum, row) => sum + row.exposureTwd, 0);
  const newest = [...closes.values()].map((one) => closeAt(one, today)?.date ?? '').reduce((max, date) => (date > max ? date : max), '');
  return {
    asOf: newest || null,
    rows,
    tiles,
    portfolio:
      weight > 0
        ? { ret: weighted.reduce((sum, row) => sum + row.exposureTwd * (row.returns['1Y'] as number), 0) / weight, volatility: weighted.reduce((sum, row) => sum + row.exposureTwd * (row.volatility as number), 0) / weight }
        : null,
  };
}
