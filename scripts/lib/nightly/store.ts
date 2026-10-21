/** The nightly job's database side: reads and upserts through the Data API with the secret key. */
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadPerformanceInput } from '../../../lib/data.ts';
import type { Snapshot } from '../../../lib/models/performance.ts';
import type { DailyPrice, DailyRate } from '../feeds/types.ts';
import type { JobRun, Security, Store } from './job.ts';

/** Rows per upsert request; a full history is a few thousand rows. */
const BATCH = 500;

function batches<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < rows.length; at += BATCH) out.push(rows.slice(at, at + BATCH));
  return out;
}

function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function supabaseStore(client: SupabaseClient): Store {
  return {
    async securities() {
      const { data, error } = await client.from('securities').select('ticker, market, currency').order('ticker');
      check('securities', error);
      return (data ?? []) as Security[];
    },
    async earliestTradeDate() {
      const { data, error } = await client.from('transactions').select('trade_date').order('trade_date').limit(1);
      check('transactions', error);
      return (data?.[0] as { trade_date?: string } | undefined)?.trade_date;
    },
    async lookbackYears() {
      const { data, error } = await client.from('config').select('value').eq('key', 'var');
      check('config', error);
      const value = (data?.[0] as { value?: Record<string, unknown> } | undefined)?.value;
      const years = value?.['lookback_years'];
      if (typeof years !== 'number' || years <= 0) throw new Error('config var.lookback_years is missing or not a positive number');
      return years;
    },
    async earliestPriceDate(ticker) {
      const { data, error } = await client.from('prices').select('price_date').eq('ticker', ticker).order('price_date').limit(1);
      check('prices', error);
      return (data?.[0] as { price_date?: string } | undefined)?.price_date;
    },
    async savePrices(rows: readonly DailyPrice[], options: { fillOnly?: boolean } = {}) {
      for (const batch of batches(rows)) {
        const { error } = await client.from('prices').upsert(
          batch.map((row) => ({ ticker: row.ticker, price_date: row.date, close: row.close, adj_close: row.adjClose, source: row.source })),
          { onConflict: 'ticker,price_date', ignoreDuplicates: options.fillOnly ?? false },
        );
        check('prices', error);
      }
    },
    async saveRates(rows: readonly DailyRate[]) {
      for (const batch of batches(rows)) {
        const { error } = await client
          .from('fx_rates')
          .upsert(batch.map((row) => ({ pair: row.pair, rate_date: row.date, rate: row.rate, source: row.source })), { onConflict: 'pair,rate_date' });
        check('fx_rates', error);
      }
    },
    performanceInput: (end) => loadPerformanceInput(client, end),
    async saveSnapshots(rows: readonly Snapshot[]) {
      const first = rows[0]?.date;
      // Days before the first one were left by trades since deleted; with nothing held, none stay.
      const stale = client.from('nav_snapshots').delete();
      const { error: staleError } = await (first ? stale.lt('snapshot_date', first) : stale.gte('snapshot_date', '1900-01-01'));
      check('nav_snapshots', staleError);
      // var_95_1w is left as it is: an upsert writes only the columns it sends.
      for (const batch of batches(rows)) {
        const { error } = await client
          .from('nav_snapshots')
          .upsert(batch.map((row) => ({ snapshot_date: row.date, total_twd: row.totalTwd, weights_by_class: row.weightsByClass })), { onConflict: 'snapshot_date' });
        check('nav_snapshots', error);
      }
    },
    async recordRun(run: JobRun) {
      const { error } = await client
        .from('job_runs')
        .insert({ job: run.job, started_at: run.startedAt, finished_at: run.finishedAt, status: run.status, detail: run.detail });
      check('job_runs', error);
    },
  };
}
