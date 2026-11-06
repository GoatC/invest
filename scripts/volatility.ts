/**
 * The volatility job (N8, added 2026-11-06). GitHub Actions runs it twice a day
 * (.github/workflows/volatility.yml); `npm run volatility` runs it by hand. It needs SUPABASE_URL
 * (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SECRET_KEY and FINMIND_TOKEN, from the environment or
 * .env.local. Exits with 1 when the run failed, so GitHub marks the run red.
 */
import { existsSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { makeGet } from './lib/feeds/get.ts';
import { makeRedactor } from './lib/http.ts';
import { runVolatility } from './lib/volatility/job.ts';
import { volatilityStore } from './lib/volatility/store.ts';
import { volatilitySummary } from './lib/volatility/summary.ts';

const USER_AGENT = 'LongViewInvest-Volatility/0.1 (+https://github.com/GoatC/Invest)';

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
  const redact = makeRedactor([secretKey, finmindToken]);
  try {
    const run = await runVolatility({
      get: makeGet({ userAgent: USER_AGENT, timeoutMs: 90_000, retryAfterMs: 5_000, redact }),
      store: volatilityStore(createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })),
      finmindToken,
      today: taipeiToday(),
      now: () => new Date(),
    });
    for (const line of volatilitySummary(run)) console.log(redact(line));
    return run.status === 'failed' ? 1 : 0;
  } catch (err) {
    console.error(redact(`Volatility job failed 波動排程失敗: ${err instanceof Error ? err.message : String(err)}`));
    return 1;
  }
}

process.exitCode = await main();
