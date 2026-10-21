/** TWSE OpenAPI, the fallback for Taiwan closes: the last trading day for every listed security. */
import { FeedError, positive, type DailyPrice } from './types.ts';

export const SOURCE = 'twse';
export const STOCK_DAY_ALL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';

/** "1151020" (ROC year 115) → "2026-10-20". */
export function rocDateToIso(text: string): string | undefined {
  const match = /^(\d{2,3})(\d{2})(\d{2})$/.exec(text.trim());
  return match ? `${Number(match[1]) + 1911}-${match[2]}-${match[3]}` : undefined;
}

/** Closes for the given tickers; the feed carries no dividends, so adjClose is left empty. */
export function twseCloses(json: string, tickers: ReadonlySet<string>): DailyPrice[] {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    throw new FeedError('TWSE STOCK_DAY_ALL: reply is not JSON');
  }
  if (!Array.isArray(rows)) throw new FeedError('TWSE STOCK_DAY_ALL: reply is not a list');
  return rows.flatMap((row: Record<string, unknown>) => {
    const ticker = String(row['Code'] ?? '');
    const date = rocDateToIso(String(row['Date'] ?? ''));
    const close = positive(row['ClosingPrice']);
    return tickers.has(ticker) && date && close ? [{ ticker, date, close, adjClose: null, source: SOURCE }] : [];
  });
}
