/**
 * The news job (N8 step 4, added 2026-11-07). GitHub Actions runs it every 30 minutes
 * (.github/workflows/news.yml); `npm run news` runs it by hand. It needs SUPABASE_URL (or
 * NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY, from the environment or .env.local; no news
 * key: the feeds are free. Exits with 1 when the run failed, so GitHub marks the run red.
 */
import { existsSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { makeGet } from './lib/feeds/get.ts';
import { makeRedactor } from './lib/http.ts';
import { newsSummary, runNews } from './lib/news/job.ts';
import { newsStore } from './lib/news/store.ts';

const USER_AGENT = 'LongViewInvest-News/0.1 (+https://github.com/GoatC/Invest)';

async function main(): Promise<number> {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const env = process.env;
  const url = env['SUPABASE_URL'] || env['NEXT_PUBLIC_SUPABASE_URL'];
  const secretKey = env['SUPABASE_SECRET_KEY'];
  if (!url || !secretKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY: set them as GitHub secrets or in .env.local 缺少設定，請加入 GitHub secrets 或 .env.local');
    return 1;
  }
  const redact = makeRedactor([secretKey]);
  try {
    const run = await runNews({
      get: makeGet({ userAgent: USER_AGENT, timeoutMs: 30_000, retryAfterMs: 3_000, redact }),
      store: newsStore(createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })),
      now: () => new Date(),
    });
    for (const line of newsSummary(run)) console.log(redact(line));
    return run.status === 'failed' ? 1 : 0;
  } catch (err) {
    console.error(redact(`News job failed 新聞排程失敗: ${err instanceof Error ? err.message : String(err)}`));
    return 1;
  }
}

process.exitCode = await main();
