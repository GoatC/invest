/**
 * N4 Value at Risk: weekly closes of the holdings and their proxies, and the saved daily VaR.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { addDays } from '../dates';
import { GOLD } from '../models/fx';
import { candidateProxies, gridStart, lookbackWeeks, readRiskSettings, type RiskInput, type VarPoint } from '../models/risk';
import type { ProductType } from '../models/types';
import { allRows, rows } from './core';

/** Days before the window's first Friday read too, so a week without trading there still finds a close. */
const RISK_LEAD_DAYS = 14;

/**
 * What the VaR reads besides the holdings: config var, each class's benchmark (its proxy), every
 * candidate proxy, and their weekly closes (weekly_prices) and the TWD rates, from the window
 * before `from` to `to`. The risk page and the holdings card read it for today; the nightly job
 * from its first snapshot day, so every day has its own three years.
 */
export async function loadRiskInput(supabase: SupabaseClient, from: string, to: string): Promise<RiskInput> {
  const [settings, classes, securities] = await Promise.all([
    rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'var')),
    rows<{ id: string; benchmark_ticker: string | null }>('asset_classes', supabase.from('asset_classes').select('id, benchmark_ticker')),
    rows<{ ticker: string; product_type: ProductType; currency: string }>('securities', supabase.from('securities').select('ticker, product_type, currency')),
  ]);
  const parsed = readRiskSettings(settings[0]?.value);
  const benchmarks = new Map(classes.map((row) => [row.id, row.benchmark_ticker]));
  const proxies = candidateProxies(
    benchmarks,
    securities.map((row) => ({ ticker: row.ticker, productType: row.product_type, currency: row.currency })),
  );
  const input: RiskInput = { settings: parsed, benchmarks, proxies, prices: [], rates: [] };
  if (!parsed || proxies.size === 0) return input;

  const since = addDays(gridStart(from, lookbackWeeks(parsed)), -RISK_LEAD_DAYS);
  const [prices, rates] = await Promise.all([
    allRows<{ ticker: string; price_date: string; close: number; adj_close: number | null }>('weekly_prices', (start, end) =>
      supabase
        .from('weekly_prices')
        .select('ticker, price_date, close, adj_close')
        .in('ticker', [...proxies.keys()])
        .gte('week_ending', since)
        .lte('price_date', to)
        .order('ticker')
        .order('price_date')
        .range(start, end),
    ),
    allRows<{ pair: string; rate_date: string; rate: number }>('fx_rates', (start, end) =>
      supabase
        .from('fx_rates')
        .select('pair, rate_date, rate')
        .like('pair', '%/TWD')
        .neq('pair', `${GOLD}/TWD`)
        .gte('rate_date', since)
        .lte('rate_date', to)
        .order('pair')
        .order('rate_date')
        .range(start, end),
    ),
  ]);
  return {
    ...input,
    prices: prices.map((row) => ({ ticker: row.ticker, date: row.price_date, close: Number(row.close), adjClose: row.adj_close === null ? null : Number(row.adj_close) })),
    rates: rates.map((row) => ({ pair: row.pair, date: row.rate_date, rate: Number(row.rate) })),
  };
}

/** The VaR's inputs for today, and the daily VaR the nightly job saved over the last 52 weeks. */
export interface RiskData {
  input: RiskInput;
  saved: VarPoint[];
}

async function loadRiskDataUncached(supabase: SupabaseClient, today: string): Promise<RiskData> {
  const [input, saved] = await Promise.all([
    loadRiskInput(supabase, today, today),
    rows<{ snapshot_date: string; total_twd: number; var_95_1w: number | null }>(
      'nav_snapshots',
      supabase
        .from('nav_snapshots')
        .select('snapshot_date, total_twd, var_95_1w')
        .gt('snapshot_date', addDays(today, -7 * 52))
        .lte('snapshot_date', today)
        .not('var_95_1w', 'is', null)
        .order('snapshot_date'),
    ),
  ]);
  return {
    input,
    saved: saved.map((row) => ({ date: row.snapshot_date, valueAtRisk: Number(row.var_95_1w), totalTwd: Number(row.total_twd) })),
  };
}

// One read per request (core.ts).
export const loadRiskData = cache(loadRiskDataUncached);
