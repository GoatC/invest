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

function body(json: string): Record<string, unknown> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new FeedError('Alpha Vantage: reply is not JSON');
  }
  const refusal = parsed['Information'] ?? parsed['Note'] ?? parsed['Error Message'];
  if (typeof refusal === 'string') throw new FeedError(`Alpha Vantage refused: ${refusal.slice(0, 120)}`);
  return parsed;
}

const num = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '' || value === 'None' || value === '-') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** One fiscal year's consensus EPS (the shape lib/models/forward-pe.ts reads). */
export interface AvYearEstimate {
  periodEnd: string;
  mean: number;
  high?: number;
  low?: number;
  analysts?: number;
  mean30?: number;
  up30?: number;
  down30?: number;
}

/** EARNINGS_ESTIMATES: each fiscal year's consensus EPS; quarters are left out. */
export function avEstimates(json: string): AvYearEstimate[] {
  const estimates = body(json)['estimates'];
  if (!Array.isArray(estimates)) throw new FeedError('Alpha Vantage: no "estimates" in the reply');
  return estimates
    .flatMap((entry): AvYearEstimate[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const row = entry as Record<string, unknown>;
      const mean = num(row['eps_estimate_average']);
      const date = row['date'];
      if (row['horizon'] !== 'fiscal year' || mean === undefined || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      const out: AvYearEstimate = { periodEnd: date, mean };
      const fields: Array<[keyof AvYearEstimate, string]> = [
        ['high', 'eps_estimate_high'],
        ['low', 'eps_estimate_low'],
        ['analysts', 'eps_estimate_analyst_count'],
        ['mean30', 'eps_estimate_average_30_days_ago'],
        ['up30', 'eps_estimate_revision_up_trailing_30_days'],
        ['down30', 'eps_estimate_revision_down_trailing_30_days'],
      ];
      for (const [key, field] of fields) {
        const value = num(row[field]);
        if (value !== undefined) (out as unknown as Record<string, number>)[key] = value;
      }
      return [out];
    })
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

/** OVERVIEW: the analysts' mean target price, the count of each rating, and the currency. */
export function avOverview(json: string): { currency?: string; targetPrice?: number; ratings?: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } } {
  const row = body(json);
  const target = num(row['AnalystTargetPrice']);
  const counts = ['AnalystRatingStrongBuy', 'AnalystRatingBuy', 'AnalystRatingHold', 'AnalystRatingSell', 'AnalystRatingStrongSell'].map((key) => num(row[key]));
  const currency = typeof row['Currency'] === 'string' && /^[A-Z]{3}$/.test(row['Currency']) ? row['Currency'] : undefined;
  return {
    ...(currency ? { currency } : {}),
    ...(target !== undefined && target > 0 ? { targetPrice: target } : {}),
    ...(counts.some((count) => count !== undefined) ? { ratings: { strongBuy: counts[0] ?? 0, buy: counts[1] ?? 0, hold: counts[2] ?? 0, sell: counts[3] ?? 0, strongSell: counts[4] ?? 0 } } : {}),
  };
}
