/**
 * F18 true performance: the trades, flows, closes and rates the TWR and XIRR are worked from.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { addDays } from '../dates';
import { manualHistories } from '../models/manual-history';
import { benchmarkWeights, firstDay, type PerformanceInput } from '../models/performance';
import { restateCloses, restateTrades } from '../models/splits';
import type { AuditRow } from './audit';
import { allRows, rows } from './core';
import { CASH_FLOW_COLUMNS, loadSecurities, loadSplits, MANUAL_ASSET_COLUMNS, toCashFlow, toManualAsset, toTransaction, TRANSACTION_COLUMNS, type CashFlowRow, type ManualAssetRow, type TransactionRow } from './holdings';

/** Days of closes and rates read before the first day, so a start on a weekend or holiday has one. */
const LEAD_DAYS = 14;

/** The gold ETF that extends the gold price back before the nightly job saved one (lib/models/market). */
const GOLD_PROXY = 'GLDM';

/**
 * Everything F18 needs to value the portfolio on each day up to `end`: every trade, the recorded
 * dividends, each non-listed asset's history replayed from the edit log, the SAA benchmark, and
 * the closes and rates from shortly before the first day on. The performance page and the
 * nightly job's NAV snapshots both read it.
 */
export async function loadPerformanceInput(supabase: SupabaseClient, end: string): Promise<PerformanceInput> {
  const [transactions, dividends, manualAssets, audit, securities, assetClasses, splits] = await Promise.all([
    allRows<TransactionRow>('transactions', (from, to) => supabase.from('transactions').select(TRANSACTION_COLUMNS).order('trade_date').order('id').range(from, to)),
    allRows<CashFlowRow>('cash_flows', (from, to) => supabase.from('cash_flows').select(CASH_FLOW_COLUMNS).eq('type', 'dividend').order('flow_date').order('id').range(from, to)),
    rows<ManualAssetRow & { created_at: string }>('manual_assets', supabase.from('manual_assets').select(`${MANUAL_ASSET_COLUMNS}, created_at`).order('id')),
    allRows<AuditRow>('audit_log', (from, to) =>
      supabase
        .from('audit_log')
        .select('id, table_name, row_key, action, changed_at, old_row, new_row')
        .eq('table_name', 'manual_assets')
        .order('changed_at')
        .order('id')
        .range(from, to),
    ),
    loadSecurities(supabase),
    rows<{ target_weight: number; benchmark_ticker: string | null }>('asset_classes', supabase.from('asset_classes').select('target_weight, benchmark_ticker')),
    loadSplits(supabase),
  ]);
  // In today's units, trades and quoted closes alike, so a split moves no value from one day to the next.
  const trades = restateTrades(transactions.map(toTransaction), splits);
  const histories = manualHistories(
    manualAssets.map((row) => ({ ...toManualAsset(row), createdAt: row.created_at })),
    audit.map((row) => ({ rowKey: row.row_key, action: row.action, changedAt: row.changed_at, oldRow: row.old_row, newRow: row.new_row })),
  );
  const benchmark = benchmarkWeights(assetClasses.map((row) => ({ targetWeight: Number(row.target_weight), benchmarkTicker: row.benchmark_ticker })));
  const input: PerformanceInput = { end, trades, cashFlows: dividends.map(toCashFlow), manualAssets: histories, securities, benchmark, prices: [], rates: [] };
  const start = firstDay(input);
  if (!start || start > end) return input;

  const since = addDays(start, -LEAD_DAYS);
  const tickers = [...new Set([...trades.map((trade) => trade.ticker), ...benchmark.map((proxy) => proxy.ticker), GOLD_PROXY])].sort();
  const [prices, rates] = await Promise.all([
    allRows<{ ticker: string; price_date: string; close: number; adj_close: number | null }>('prices', (from, to) =>
      supabase
        .from('prices')
        .select('ticker, price_date, close, adj_close')
        .in('ticker', tickers)
        .gte('price_date', since)
        .lte('price_date', end)
        .order('ticker')
        .order('price_date')
        .range(from, to),
    ),
    allRows<{ pair: string; rate_date: string; rate: number }>('fx_rates', (from, to) =>
      supabase.from('fx_rates').select('pair, rate_date, rate').like('pair', '%/TWD').gte('rate_date', since).lte('rate_date', end).order('pair').order('rate_date').range(from, to),
    ),
  ]);
  return {
    ...input,
    prices: restateCloses(
      prices.map((row) => ({ ticker: row.ticker, date: row.price_date, close: Number(row.close), adjClose: row.adj_close === null ? null : Number(row.adj_close) })),
      splits,
    ),
    rates: rates.map((row) => ({ pair: row.pair, date: row.rate_date, rate: Number(row.rate) })),
  };
}
