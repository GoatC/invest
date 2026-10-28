/** What the nightly job's data feeds return, before it is written to the prices and fx_rates tables. */

/** A daily close in the security's currency; adjClose folds in dividends and splits, when the feed knows them. */
export interface DailyPrice {
  ticker: string;
  date: string;
  close: number;
  adjClose: number | null;
  source: string;
}

/** pair "USD/TWD" is TWD per 1 USD; "XAU/USD" is USD per troy ounce of gold. */
export interface DailyRate {
  pair: string;
  date: string;
  rate: number;
  source: string;
}

/** A failed fetch or a reply that is not what the feed expects; the message never holds a key. */
export class FeedError extends Error {
  override name = 'FeedError';
}

/** Fetches a URL as text, throwing FeedError on a failure; injected so tests can supply recorded replies. */
export type Get = (url: string, headers?: Record<string, string>) => Promise<string>;

export function positive(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** One month of a market-level series (F3): CAPE, the S&P 500's price and its dividend yield. month is YYYY-MM. */
export interface MonthlyPoint {
  series: string;
  month: string;
  value: number;
  source: string;
}

/** Fetches a URL as bytes (a binary spreadsheet), throwing FeedError on a failure. */
export type GetBytes = (url: string, headers?: Record<string, string>) => Promise<Uint8Array>;
