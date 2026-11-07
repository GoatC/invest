/** The news job's database side: reads and writes through the Data API with the secret key. */
import type { SupabaseClient } from '@supabase/supabase-js';

import { readNewsSettings } from '../../../lib/models/news.ts';
import type { NewsAlertRow, NewsRun, NewsStore } from './job.ts';

const PAGE = 1000;

function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function newsStore(client: SupabaseClient): NewsStore {
  return {
    async settings() {
      const { data, error } = await client.from('config').select('value').eq('key', 'news');
      check('config', error);
      return readNewsSettings((data?.[0] as { value?: unknown } | undefined)?.value);
    },
    async history(since: string) {
      const out = new Map<string, number[]>();
      for (let start = 0; ; start += PAGE) {
        const { data, error } = await client.from('news_counts').select('topic, sources').gte('counted_at', since).order('topic').order('counted_at').range(start, start + PAGE - 1);
        check('news_counts', error);
        const rows = (data ?? []) as Array<{ topic: string; sources: number }>;
        for (const row of rows) out.set(row.topic, [...(out.get(row.topic) ?? []), Number(row.sources)]);
        if (rows.length < PAGE) return out;
      }
    },
    async lastAlerts() {
      const { data, error } = await client.from('news_alerts').select('topic, detected_at').order('detected_at', { ascending: false }).limit(200);
      check('news_alerts', error);
      const out = new Map<string, string>();
      for (const row of (data ?? []) as Array<{ topic: string; detected_at: string }>) if (!out.has(row.topic)) out.set(row.topic, row.detected_at);
      return out;
    },
    async saveCounts(rows, at) {
      if (rows.length === 0) return;
      const { error } = await client.from('news_counts').upsert(rows.map((row) => ({ topic: row.topic, counted_at: at, sources: row.sources })), { onConflict: 'topic,counted_at' });
      check('news_counts', error);
    },
    async saveAlert(row: NewsAlertRow) {
      const { error } = await client.from('news_alerts').insert({ topic: row.topic, sources: row.sources, baseline: row.baseline, window_hours: row.windowHours, headlines: row.headlines });
      check('news_alerts', error);
    },
    async prune(before: string) {
      const { error } = await client.from('news_counts').delete().lt('counted_at', before);
      check('news_counts', error);
    },
    async recordRun(run: NewsRun) {
      const { error } = await client.from('job_runs').insert({ job: run.job, started_at: run.startedAt, finished_at: run.finishedAt, status: run.status, detail: run.detail });
      check('job_runs', error);
    },
  };
}
