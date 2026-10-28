/**
 * The nightly price and FX job (PRD Phase 1, step 4). GitHub Actions runs it every night
 * (.github/workflows/nightly.yml); `npm run nightly` runs it by hand. It needs SUPABASE_URL (or
 * NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SECRET_KEY and FINMIND_TOKEN, from the environment or
 * .env.local; ALPHAVANTAGE_API_KEY is an optional fallback, and SEC_USER_AGENT (a name and a contact
 * email) lets it read US filings for F12. Exits with 1 when the run failed, so
 * GitHub marks the run red.
 */
import { existsSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { makeGet, makeGetBytes } from './lib/feeds/get.ts';
import { makeRedactor } from './lib/http.ts';
import { runNightly } from './lib/nightly/job.ts';
import { supabaseStore } from './lib/nightly/store.ts';
import { fullSummary, publicSummary } from './lib/nightly/summary.ts';

const USER_AGENT = 'LongViewInvest-Nightly/0.1 (+https://github.com/GoatC/Invest)';

function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

async function main(): Promise<number> {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const env = process.env;
  const url = env['SUPABASE_URL'] || env['NEXT_PUBLIC_SUPABASE_URL'];
  const secretKey = env['SUPABASE_SECRET_KEY'];
  const finmindToken = env['FINMIND_TOKEN'];
  const missing = [!url && 'SUPABASE_URL', !secretKey && 'SUPABASE_SECRET_KEY', !finmindToken && 'FINMIND_TOKEN'].filter(Boolean);
  if (!url || !secretKey || !finmindToken) {
    console.error(`Missing ${missing.join(', ')}: set them as GitHub secrets or in .env.local 缺少設定，請加入 GitHub secrets 或 .env.local`);
    return 1;
  }
  const redact = makeRedactor([secretKey, finmindToken, env['ALPHAVANTAGE_API_KEY']]);
  try {
    const run = await runNightly({
      get: makeGet({ userAgent: USER_AGENT, timeoutMs: 90_000, retryAfterMs: 5_000, redact }),
      getBytes: makeGetBytes({ userAgent: USER_AGENT, timeoutMs: 90_000, retryAfterMs: 5_000, redact }),
      store: supabaseStore(createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })),
      finmindToken,
      alphaVantageKey: env['ALPHAVANTAGE_API_KEY'] || undefined,
      secUserAgent: env['SEC_USER_AGENT'] || undefined,
      today: taipeiToday(),
      now: () => new Date(),
    });
    const summary = env['GITHUB_ACTIONS'] === 'true' ? publicSummary(run) : fullSummary(run);
    for (const line of summary) console.log(redact(line));
    return run.status === 'failed' ? 1 : 0;
  } catch (err) {
    // Even the run record could not be written: the database is out of reach.
    console.error(redact(`Nightly prices failed 每夜價格失敗: ${err instanceof Error ? err.message : String(err)}`));
    return 1;
  }
}

process.exitCode = await main();
