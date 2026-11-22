/**
 * Dividend prompts: the dividends the nightly job saved, which ones wait on Hugo, and the push plan.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { dividendHoldings, dividendsDue, eventsSince, readDividendSettings, type DividendDue, type DividendEvent, type DividendPlan, type DividendSecurity, type DividendSettings } from '../models/dividends';
import type { Market, Pool } from '../models/types';
import { latestFx } from '../models/valuation';
import { DataError, rows } from './core';
import { loadCashFlows, loadHoldingsData } from './holdings';

/** config dividends; undefined before its migration. */
async function loadDividendSettingsUncached(supabase: SupabaseClient): Promise<DividendSettings | undefined> {
  const [row] = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'dividends'));
  return row ? readDividendSettings(row.value) : undefined;
}

interface DividendEventRow {
  id: number;
  ticker: string;
  ex_date: string;
  pay_date: string | null;
  amount: number;
  currency: string;
  source: string;
  skipped_pools: string[] | null;
}

async function loadDividendEvents(supabase: SupabaseClient, since: string): Promise<DividendEvent[]> {
  const found = await rows<DividendEventRow>(
    'dividend_events',
    supabase.from('dividend_events').select('id, ticker, ex_date, pay_date, amount, currency, source, skipped_pools').gte('ex_date', since).order('ex_date', { ascending: false }),
  );
  return found.map((row) => ({
    id: Number(row.id),
    ticker: row.ticker,
    exDate: row.ex_date,
    payDate: row.pay_date,
    amount: Number(row.amount),
    currency: row.currency,
    source: row.source,
    skippedPools: (row.skipped_pools ?? []).filter((pool): pool is Pool => pool === 'regular' || pool === 'windfall'),
  }));
}

/** One dividend by its id, for the cash-flow form a prompt opens. */
export async function loadDividendEvent(supabase: SupabaseClient, id: number): Promise<DividendEvent | undefined> {
  const [row] = await rows<DividendEventRow>('dividend_events', supabase.from('dividend_events').select('id, ticker, ex_date, pay_date, amount, currency, source, skipped_pools').eq('id', id));
  return row ? { id: Number(row.id), ticker: row.ticker, exDate: row.ex_date, payDate: row.pay_date, amount: Number(row.amount), currency: row.currency, source: row.source, skippedPools: [] } : undefined;
}

/** Every security with what the dividend model reads, the reinvesting flag included (a column the main read leaves out, so it works before the migration). */
async function loadDividendSecurities(supabase: SupabaseClient): Promise<DividendSecurity[]> {
  const found = await rows<{ ticker: string; name: string; market: Market; domicile: string; currency: string; dividends_reinvested: boolean; dividends_checked_on: string | null }>(
    'securities',
    supabase.from('securities').select('ticker, name, market, domicile, currency, dividends_reinvested, dividends_checked_on').order('ticker'),
  );
  return found.map((row) => ({ ticker: row.ticker, name: row.name, market: row.market, domicile: row.domicile, currency: row.currency, reinvested: row.dividends_reinvested, checkedOn: row.dividends_checked_on }));
}

/** The dividends to ask about and those ahead, with what they were worked out from. */
export interface DividendView {
  settings: DividendSettings;
  due: DividendDue[];
  upcoming: DividendDue[];
  securities: DividendSecurity[];
}

/** Undefined before config dividends exists (the migration is not applied yet). */
async function loadDividendViewUncached(supabase: SupabaseClient, today: string): Promise<DividendView | undefined> {
  const settings = await loadDividendSettings(supabase);
  if (!settings) return undefined;
  const [holdings, flows, events, securities] = await Promise.all([loadHoldingsData(supabase), loadCashFlows(supabase), loadDividendEvents(supabase, eventsSince(settings, today)), loadDividendSecurities(supabase)]);
  const fx = new Map([...latestFx(holdings.fx, holdings.trades)].map(([currency, quote]) => [currency, quote.value]));
  return { settings, securities, ...dividendsDue({ events, trades: holdings.trades, splits: holdings.splits, securities, flows, fx }, settings, today) };
}

/** What the nightly job's dividend step looks up; undefined before config dividends exists. */
export async function loadDividendPlan(supabase: SupabaseClient, today: string): Promise<DividendPlan | undefined> {
  const settings = await loadDividendSettings(supabase);
  if (!settings) return undefined;
  const since = eventsSince(settings, today);
  const [holdings, events, securities] = await Promise.all([loadHoldingsData(supabase), loadDividendEvents(supabase, since), loadDividendSecurities(supabase)]);
  const stocks = new Set(holdings.securities.filter((security) => security.productType === 'stock').map((security) => security.ticker));
  return {
    since,
    holdings: dividendHoldings(holdings.trades, holdings.splits, securities, since).map((security) => ({
      ticker: security.ticker,
      market: security.market,
      currency: security.currency,
      etf: !stocks.has(security.ticker),
      known: Object.fromEntries(events.filter((event) => event.ticker === security.ticker).map((event) => [event.exDate, { payDate: event.payDate, source: event.source }])),
      checkedOn: security.checkedOn ?? null,
    })),
  };
}

/** Upserts dividends by security and ex-dividend date; the pools already answered "skip" stay as they are. */
export async function saveDividendEvents(supabase: SupabaseClient, events: ReadonlyArray<Omit<DividendEvent, 'id' | 'skippedPools'>>): Promise<void> {
  if (events.length === 0) return;
  const { error } = await supabase
    .from('dividend_events')
    .upsert(events.map((event) => ({ ticker: event.ticker, ex_date: event.exDate, pay_date: event.payDate, amount: event.amount, currency: event.currency, source: event.source })), { onConflict: 'ticker,ex_date' });
  if (error) throw new DataError('dividend_events', error.message);
}

/** Notes the day Alpha Vantage answered for these securities' dividends (securities.dividends_checked_on). */
export async function markDividendsChecked(supabase: SupabaseClient, tickers: readonly string[], today: string): Promise<void> {
  if (tickers.length === 0) return;
  const { error } = await supabase.from('securities').update({ dividends_checked_on: today }).in('ticker', [...tickers]);
  if (error) throw new DataError('securities', error.message);
}

// One read per request (core.ts).
export const loadDividendSettings = cache(loadDividendSettingsUncached);
export const loadDividendView = cache(loadDividendViewUncached);
