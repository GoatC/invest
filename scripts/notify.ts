/**
 * The push job (PRD Sections 4 and 5, Phase 1 step 10). GitHub Actions runs it every hour and
 * after the nightly job (.github/workflows/notify.yml, nightly.yml); `npm run notify` runs it by
 * hand. It needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY, plus the VAPID
 * settings (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT); without the VAPID ones it says so
 * and does nothing. Exits with 1 only when the database is out of reach.
 */
import { existsSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { vapidFromEnv } from '../lib/push.ts';
import { makeRedactor } from './lib/http.ts';
import { notifySummary, runNotify } from './lib/notify/job.ts';
import { supabaseNotifyStore } from './lib/notify/store.ts';

function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

async function main(): Promise<number> {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const env = process.env;
  const url = env['SUPABASE_URL'] || env['NEXT_PUBLIC_SUPABASE_URL'];
  const secretKey = env['SUPABASE_SECRET_KEY'];
  if (!url || !secretKey) {
    console.error(`Missing ${[!url && 'SUPABASE_URL', !secretKey && 'SUPABASE_SECRET_KEY'].filter(Boolean).join(', ')}: set them as GitHub secrets or in .env.local 缺少設定，請加入 GitHub secrets 或 .env.local`);
    return 1;
  }
  const redact = makeRedactor([secretKey, env['VAPID_PRIVATE_KEY']]);
  try {
    const run = await runNotify({
      store: supabaseNotifyStore(createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })),
      vapid: vapidFromEnv(env),
      now: new Date(),
      today: taipeiToday(),
    });
    for (const line of notifySummary(run)) console.log(redact(line));
    return 0;
  } catch (err) {
    console.error(redact(`Web Push failed 推播失敗: ${err instanceof Error ? err.message : String(err)}`));
    return 1;
  }
}

process.exitCode = await main();
