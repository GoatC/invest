/**
 * Daily index closes for the Regression Lab (N1): the S&P 500 and TAIEX's total return index.
 * FinMind has both; FRED's SP500 (the last ten years, a day late) and TWSE's daily index report
 * (the last trading day only, filling a missing day) are the fallbacks.
 */
import { parseCsv } from '../payload.ts';
import { rocDateToIso } from './twse.ts';
import { FeedError, positive, type Get } from './types.ts';
import type { FinMind } from './finmind.ts';

export interface IndexClose {
  index: string;
  date: string;
  close: number;
  source: string;
}

export const MI_INDEX = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX';
/** TWSE's name for the capitalisation-weighted total return index. */
const TAIEX_TOTAL_RETURN = '發行量加權股價報酬指數';

/** FinMind's USStockPrice rows of ^GSPC. */
export function finmindSpx(rows: ReadonlyArray<Record<string, unknown>>): IndexClose[] {
  return rows.flatMap((row) => {
    const close = positive(row['Close']);
    const date = String(row['date'] ?? '');
    return close && /^\d{4}-\d{2}-\d{2}$/.test(date) ? [{ index: 'SPX', date, close, source: 'finmind' }] : [];
  });
}

/** FinMind's TaiwanStockTotalReturnIndex rows of TAIEX. */
export function finmindTaiex(rows: ReadonlyArray<Record<string, unknown>>): IndexClose[] {
  return rows.flatMap((row) => {
    const close = positive(row['price']);
    const date = String(row['date'] ?? '');
    return close && /^\d{4}-\d{2}-\d{2}$/.test(date) ? [{ index: 'TAIEX', date, close, source: 'finmind' }] : [];
  });
}

/** FRED's SP500 CSV; holidays carry "." and are left out. */
export function fredSpx(csv: string): IndexClose[] {
  return parseCsv(csv).flatMap(([date = '', value = '']) => {
    const close = positive(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && close ? [{ index: 'SPX', date, close, source: 'fred' }] : [];
  });
}

/** TWSE's MI_INDEX reply: the total return index on the last trading day. */
export function twseTaiex(json: string): IndexClose[] {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    throw new FeedError('TWSE MI_INDEX: reply is not JSON');
  }
  if (!Array.isArray(rows)) throw new FeedError('TWSE MI_INDEX: reply is not a list');
  return rows.flatMap((row: Record<string, unknown>) => {
    const date = rocDateToIso(String(row['日期'] ?? ''));
    const close = positive(String(row['收盤指數'] ?? '').replace(/,/g, ''));
    return row['指數'] === TAIEX_TOTAL_RETURN && date && close ? [{ index: 'TAIEX', date, close, source: 'twse' }] : [];
  });
}

export interface IndexAttempt {
  source: string;
  fillOnly?: boolean;
  load: () => Promise<IndexClose[]>;
}

/** Each index's feeds, primary first. */
export function indexAttempts(index: string, finmind: FinMind, get: Get, span: { start: string; end: string }): IndexAttempt[] {
  if (index === 'SPX') {
    return [
      { source: 'finmind', load: async () => finmindSpx(await finmind.rows('USStockPrice', { dataId: '^GSPC', ...span })) },
      { source: 'fred', load: async () => fredSpx(await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500&cosd=${span.start}`)) },
    ];
  }
  if (index === 'TAIEX') {
    return [
      { source: 'finmind', load: async () => finmindTaiex(await finmind.rows('TaiwanStockTotalReturnIndex', { dataId: 'TAIEX', ...span })) },
      { source: 'twse', fillOnly: true, load: async () => twseTaiex(await get(MI_INDEX)) },
    ];
  }
  return [];
}

export { INDICES } from '../../../lib/models/regression.ts';
