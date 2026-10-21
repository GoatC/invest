/**
 * Phase 1, step 2: checks the hosted Supabase project from the outside, the way a stranger with
 * the public publishable key sees it. Every table must refuse to answer, and the private schema
 * must not be reachable at all.
 *
 *   npm run check:supabase
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from .env.local. Both
 * are public by design, so the check needs neither the secret key nor the database password.
 */
import { existsSync } from 'node:fs';

import { describeError } from './lib/http.ts';
import { publicTables } from './lib/migrations.ts';
import { classifySchemaReply, classifyTableReply, keyProblem, type Verdict } from './lib/supabase_check.ts';

const ICON: Record<string, string> = { refused: '✅', hidden: '✅', readable: '❌', exposed: '❌', missing: '⚠️', unexpected: '⚠️' };

/** Same tolerance as the source check: spaces and one pair of quotes from a settings form are dropped. */
function setting(name: string): string {
  return (process.env[name] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
}

async function get(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, body: await res.text() };
}

async function main(): Promise<void> {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  if ((process.env['HTTPS_PROXY'] ?? process.env['https_proxy']) && !process.env['NODE_USE_ENV_PROXY']) {
    console.warn('HTTPS_PROXY is set, but Node fetch ignores it unless NODE_USE_ENV_PROXY=1 (Node 22.21+).');
  }
  const url = setting('NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
  const key = setting('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (!/^https:\/\/[^/]+$/.test(url)) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL in .env.local, e.g. https://abcdefgh.supabase.co 請在 .env.local 設定專案網址');
  }
  if (!key) throw new Error('Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local 請在 .env.local 設定 publishable key');
  const problem = keyProblem(key);
  if (problem) throw new Error(problem);

  const headers = { apikey: key };
  const tables = publicTables();
  console.log(`Supabase check: ${url}, as a stranger with the publishable key 以外人身分檢查\n`);

  const results: Array<{ name: string } & Verdict<string>> = [];
  for (const table of tables) {
    try {
      const reply = await get(`${url}/rest/v1/${table}?select=*&limit=1`, headers);
      results.push({ name: table, ...classifyTableReply(reply.status, reply.body) });
    } catch (err) {
      results.push({ name: table, verdict: 'unexpected', detail: describeError(err) });
    }
    const last = results.at(-1);
    if (last) console.log(`  ${ICON[last.verdict] ?? '?'} ${last.name.padEnd(20)} ${last.detail}`);
  }
  try {
    const reply = await get(`${url}/rest/v1/app_owner?select=*&limit=1`, { ...headers, 'Accept-Profile': 'private' });
    results.push({ name: 'private schema', ...classifySchemaReply(reply.status, reply.body) });
  } catch (err) {
    results.push({ name: 'private schema', verdict: 'unexpected', detail: describeError(err) });
  }
  const schema = results.at(-1);
  if (schema) console.log(`  ${ICON[schema.verdict] ?? '?'} ${schema.name.padEnd(20)} ${schema.detail}`);

  const passed = results.filter((result) => result.verdict === 'refused' || result.verdict === 'hidden').length;
  console.log(`\n${passed} of ${results.length} checks passed 通過 ${passed}／${results.length} 項`);
  if (passed === results.length) {
    console.log('A stranger can read none of your tables. 外人讀不到任何資料表。');
  } else {
    if (results.some((result) => result.verdict === 'readable' || result.verdict === 'exposed')) {
      console.log('Some data is readable by anyone: fix this before entering real holdings. 有資料可被任何人讀取，輸入真實持股前必須先修正。');
    }
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
