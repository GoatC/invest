/**
 * Alpha Vantage, the fallback for US and London prices: 25 requests a day on a free key, counted
 * per IP address as well, and shared cloud addresses are often refused (source check, 2026-10-21).
 */
import { FeedError, positive, type DailyPrice } from './types.ts';

export const SOURCE = 'alphavantage';

/** The symbol Alpha Vantage uses: London lines carry ".LON"; Taiwan is not covered. */
export function avSymbol(ticker: string, market: string): string | undefined {
  if (market === 'US') return ticker;
  if (market === 'UK') return `${ticker}.LON`;
  return undefined;
}

export function avUrl(fn: string, symbol: string, key: string): string {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', fn);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('apikey', key);
  return url.toString();
}

function series(json: string, name: string): Record<string, Record<string, string>> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new FeedError('Alpha Vantage: reply is not JSON');
  }
  const refusal = body['Information'] ?? body['Note'] ?? body['Error Message'];
  if (typeof refusal === 'string') throw new FeedError(`Alpha Vantage refused: ${refusal.slice(0, 120)}`);
  const data = body[name];
  if (typeof data !== 'object' || data === null) throw new FeedError(`Alpha Vantage: no "${name}" in the reply`);
  return data as Record<string, Record<string, string>>;
}

/** TIME_SERIES_DAILY: unadjusted closes, the last 100 trading days on a free key. */
export function avDaily(json: string, ticker: string): DailyPrice[] {
  return Object.entries(series(json, 'Time Series (Daily)')).flatMap(([date, values]) => {
    const close = positive(values['4. close']);
    return close ? [{ ticker, date, close, adjClose: null, source: SOURCE }] : [];
  });
}

/** TIME_SERIES_WEEKLY_ADJUSTED: weekly closes with an adjusted close. */
export function avWeeklyAdjusted(json: string, ticker: string): DailyPrice[] {
  return Object.entries(series(json, 'Weekly Adjusted Time Series')).flatMap(([date, values]) => {
    const close = positive(values['4. close']);
    return close ? [{ ticker, date, close, adjClose: positive(values['5. adjusted close']) ?? null, source: SOURCE }] : [];
  });
}
