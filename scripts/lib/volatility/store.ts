/** The volatility job's database side: reads and upserts through the Data API with the secret key. */
import type { SupabaseClient } from '@supabase/supabase-js';

import { readVolatilitySettings, type Close } from '../../../lib/models/volatility.ts';
import type { IndexClose } from '../feeds/indices.ts';
import type { ScoreRow, VolatilityRun, VolatilityStore } from './job.ts';

/** Rows per upsert request, and per page read (the Data API's default page). */
const BATCH = 500;
const PAGE = 1000;

function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function volatilityStore(client: SupabaseClient): VolatilityStore {
  return {
    async settings() {
      const { data, error } = await client.from('config').select('value').eq('key', 'volatility');
      check('config', error);
      return readVolatilitySettings((data?.[0] as { value?: unknown } | undefined)?.value);
    },
    async saveIndexPrices(rows: readonly IndexClose[], options: { fillOnly?: boolean } = {}) {
      for (let at = 0; at < rows.length; at += BATCH) {
        const batch = rows.slice(at, at + BATCH);
        const { error } = await client
          .from('index_prices')
          .upsert(batch.map((row) => ({ index_id: row.index, price_date: row.date, close: row.close, source: row.source })), { onConflict: 'index_id,price_date', ignoreDuplicates: options.fillOnly ?? false });
        check('index_prices', error);
      }
    },
    async series(ids: readonly string[], from: string) {
      const out = new Map<string, Close[]>();
      for (let start = 0; ; start += PAGE) {
        const { data, error } = await client
          .from('index_prices')
          .select('index_id, price_date, close')
          .in('index_id', [...ids])
          .gte('price_date', from)
          .order('index_id')
          .order('price_date')
          .range(start, start + PAGE - 1);
        check('index_prices', error);
        const rows = (data ?? []) as Array<{ index_id: string; price_date: string; close: number }>;
        for (const row of rows) out.set(row.index_id, [...(out.get(row.index_id) ?? []), { date: row.price_date, close: Number(row.close) }]);
        if (rows.length < PAGE) return out;
      }
    },
    async saveScore(row: ScoreRow) {
      const { error } = await client
        .from('volatility_scores')
        .upsert({ score_date: row.date, score: row.score, mean: row.mean, coverage: row.coverage, components: row.components, computed_at: new Date().toISOString() }, { onConflict: 'score_date' });
      check('volatility_scores', error);
    },
    async recordRun(run: VolatilityRun) {
      const { error } = await client.from('job_runs').insert({ job: run.job, started_at: run.startedAt, finished_at: run.finishedAt, status: run.status, detail: run.detail });
      check('job_runs', error);
    },
  };
}
