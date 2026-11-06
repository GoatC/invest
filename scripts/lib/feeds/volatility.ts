/**
 * The volatility alert's feeds (N8, added 2026-11-06), each saved in index_prices under its id:
 *
 * - VIX and VIX3M: CBOE's daily history files (the VIX since 1990, the VIX3M since 2009, one row a
 *   session, posted after the US close); FRED's VIXCLS and VXVCLS (a day late) as the fallback.
 * - TWVIX: Taiwan's VIX 臺指選擇權波動率指數, TAIFEX's monthly files of each session's close (the
 *   last three months only, so the job keeps the history itself).
 * - EPU: the US daily economic policy uncertainty index, a count of newspaper articles on
 *   uncertainty, economy and policy (policyuncertainty.com); FRED's USEPUINDXD as the fallback.
 * - HY_OAS: the ICE BofA US high-yield option-adjusted spread, percent (FRED only; without it the
 *   score counts one component fewer).
 */
import { parseCsv } from '../payload.ts';
import type { IndexClose, IndexAttempt } from './indices.ts';
import { FeedError, positive, type Get } from './types.ts';

export const CBOE_IDS = { VIX: 'VIX', VIX3M: 'VIX3M' } as const;

export function cboeUrl(index: keyof typeof CBOE_IDS): string {
  return `https://cdn.cboe.com/api/global/us_indices/daily_prices/${CBOE_IDS[index]}_History.csv`;
}

/** CBOE's DATE,OPEN,HIGH,LOW,CLOSE file (dates MM/DD/YYYY), from `start` on. */
export function cboeHistory(csv: string, index: string, start: string): IndexClose[] {
  return parseCsv(csv).flatMap(([date = '', , , , value = '']) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
    const close = positive(value);
    if (!match || !close) return [];
    const iso = `${match[3]}-${match[1]}-${match[2]}`;
    return iso >= start ? [{ index, date: iso, close, source: 'cboe' }] : [];
  });
}

export const FRED_DAILY: Record<string, string> = { VIX: 'VIXCLS', VIX3M: 'VXVCLS', HY_OAS: 'BAMLH0A0HYM2', EPU: 'USEPUINDXD' };

export function fredDailyUrl(series: string, start: string): string {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}&cosd=${start}`;
}

/** A FRED daily CSV under an index_prices id; holidays carry "." and are left out. */
export function fredDaily(csv: string, index: string, start: string): IndexClose[] {
  return parseCsv(csv).flatMap(([date = '', value = '']) => {
    const close = positive(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= start && close ? [{ index, date, close, source: 'fred' }] : [];
  });
}

/** TAIFEX's file of a month's daily closes of Taiwan's VIX; month is YYYYMM. */
export function taifexVixUrl(month: string): string {
  return `https://www.taifex.com.tw/file/taifex/Dailydownload/vix/log2data/${month}new.txt`;
}

/**
 * The file's data lines: date (YYYYMMDD), time, the index at the close, the last minute's mean,
 * tab-separated after a Big5 header. A month without a file yet is TAIFEX's 404 page, with no line.
 */
export function taifexVix(text: string): IndexClose[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d{4})(\d{2})(\d{2})\s+\d+\s+([\d.]+)/.exec(line);
    const close = match ? positive(match[4]) : undefined;
    return match && close ? [{ index: 'TWVIX', date: `${match[1]}-${match[2]}-${match[3]}`, close, source: 'taifex' }] : [];
  });
}

/** The months, YYYYMM, from `months - 1` before today's to today's. */
export function recentMonths(today: string, months: number): string[] {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: months }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1 - (months - 1 - i), 1));
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export const EPU_URL = 'https://www.policyuncertainty.com/media/All_Daily_Policy_Data.csv';

/** policyuncertainty.com's day,month,year,daily_policy_index file, from `start` on. */
export function epuDaily(csv: string, start: string): IndexClose[] {
  return parseCsv(csv).flatMap(([day = '', month = '', year = '', value = '']) => {
    if (!/^\d{1,2}$/.test(day.trim()) || !/^\d{1,2}$/.test(month.trim()) || !/^\d{4}$/.test(year.trim())) return [];
    const close = positive(value);
    const date = `${year.trim()}-${month.trim().padStart(2, '0')}-${day.trim().padStart(2, '0')}`;
    return close && date >= start ? [{ index: 'EPU', date, close, source: 'policyuncertainty' }] : [];
  });
}

/** Every month's file that answers; a failure only when none does. */
async function taifexMonths(get: Get, today: string): Promise<IndexClose[]> {
  const rows: IndexClose[] = [];
  const failures: string[] = [];
  for (const month of recentMonths(today, 3)) {
    try {
      rows.push(...taifexVix(await get(taifexVixUrl(month))));
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (rows.length === 0 && failures.length > 0) throw new FeedError(failures[0] as string);
  return rows;
}

/** Each series' feeds, primary first, from `start` on. */
export function volatilityAttempts(index: string, get: Get, start: string, today: string): IndexAttempt[] {
  const fred = (id: string): IndexAttempt => ({ source: 'fred', load: async () => fredDaily(await get(fredDailyUrl(FRED_DAILY[id] as string, start)), id, start) });
  switch (index) {
    case 'VIX':
    case 'VIX3M':
      return [{ source: 'cboe', load: async () => cboeHistory(await get(cboeUrl(index)), index, start) }, fred(index)];
    case 'TWVIX':
      return [{ source: 'taifex', load: () => taifexMonths(get, today) }];
    case 'EPU':
      return [{ source: 'policyuncertainty', load: async () => epuDaily(await get(EPU_URL), start) }, fred('EPU')];
    case 'HY_OAS':
      return [fred('HY_OAS')];
    default:
      return [];
  }
}
