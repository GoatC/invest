/**
 * Market data several features read: the monthly market series, monthly returns, and a holding's daily closes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { addDays } from '../dates';
import { inTwd, periodReturns, type Point as ReturnPoint } from '../models/regression';
import { allRows, rows } from './core';
import { loadSecurities } from './holdings';

/** Every daily close of one ticker, oldest first, as quoted (the holding's price chart, N5). */
export async function loadPriceHistory(supabase: SupabaseClient, ticker: string): Promise<Array<{ date: string; close: number }>> {
  const found = await allRows<{ price_date: string; close: number }>('prices', (start, end) =>
    supabase.from('prices').select('price_date, close').eq('ticker', ticker).order('price_date').range(start, end),
  );
  return found.map((row) => ({ date: row.price_date, close: Number(row.close) }));
}

/**
 * Each ticker's daily closes from a date on, oldest first, for the holdings overview (the cards'
 * three months, the last session's move, the 52-week range): one read per ticker, all at once.
 */
export async function loadHoldingCloses(supabase: SupabaseClient, tickers: readonly string[], from: string): Promise<Map<string, Array<{ date: string; close: number }>>> {
  const unique = [...new Set(tickers)];
  const found = await Promise.all(
    unique.map((ticker) =>
      rows<{ price_date: string; close: number }>('prices', supabase.from('prices').select('price_date, close').eq('ticker', ticker).gte('price_date', from).order('price_date')),
    ),
  );
  return new Map(unique.map((ticker, index) => [ticker, (found[index] ?? []).map((row) => ({ date: row.price_date, close: Number(row.close) }))]));
}

export interface SeriesPoint {
  month: string;
  value: number;
}

/** Every month of the market series (market_series), oldest first; a few thousand rows, read in pages. */
async function loadMarketSeriesUncached(supabase: SupabaseClient): Promise<{ series: Record<string, SeriesPoint[]>; sources: Record<string, string> }> {
  const found = await allRows<{ series: string; obs_month: string; value: number; source: string }>('market_series', (from, to) =>
    supabase.from('market_series').select('series, obs_month, value, source').order('series').order('obs_month').range(from, to),
  );
  const series: Record<string, SeriesPoint[]> = {};
  const sources: Record<string, string> = {};
  for (const row of found) {
    (series[row.series] ??= []).push({ month: row.obs_month.slice(0, 7), value: Number(row.value) });
    sources[row.series] = row.source;
  }
  return { series, sources };
}

/** Each class benchmark's monthly returns in TWD over the last `years` (and a little more), the month still running left out. */
export async function loadMonthlyReturns(supabase: SupabaseClient, tickers: readonly string[], years: number, today: string): Promise<Map<string, ReturnPoint[]>> {
  if (tickers.length === 0) return new Map();
  const from = addDays(today, -(years * 366 + 62));
  const securities = new Map((await loadSecurities(supabase)).map((security) => [security.ticker, security]));
  const wanted = tickers.filter((ticker) => securities.has(ticker));
  const currencies = [...new Set(wanted.map((ticker) => securities.get(ticker)?.currency ?? 'TWD'))].filter((currency) => currency !== 'TWD');
  const [closeRows, rateRows] = await Promise.all([
    Promise.all(
      wanted.map((ticker) =>
        allRows<{ price_date: string; close: number; adj_close: number | null }>('prices', (start, end) =>
          supabase.from('prices').select('price_date, close, adj_close').eq('ticker', ticker).gte('price_date', from).order('price_date').range(start, end),
        ),
      ),
    ),
    Promise.all(
      currencies.map((currency) =>
        allRows<{ rate_date: string; rate: number }>('fx_rates', (start, end) =>
          supabase.from('fx_rates').select('rate_date, rate').eq('pair', `${currency}/TWD`).gte('rate_date', addDays(from, -14)).order('rate_date').range(start, end),
        ),
      ),
    ),
  ]);
  const rates = new Map(currencies.map((currency, i) => [currency, (rateRows[i] ?? []).map((row) => ({ date: row.rate_date, close: Number(row.rate) }))]));
  const month = today.slice(0, 7);
  return new Map(
    wanted.map((ticker, i) => {
      const closes = (closeRows[i] ?? []).map((row) => ({ date: row.price_date, close: Number(row.adj_close ?? row.close) }));
      const currency = securities.get(ticker)?.currency ?? 'TWD';
      const twd = currency === 'TWD' ? closes : inTwd(closes, rates.get(currency) ?? []);
      return [ticker, periodReturns(twd, 'monthly').filter((point) => point.date.slice(0, 7) < month)];
    }),
  );
}

// One read per request (core.ts).
export const loadMarketSeries = cache(loadMarketSeriesUncached);
