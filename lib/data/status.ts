/**
 * The nightly job's runs and the newest close of each feed (the data status page and toast).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { CAPM_SERIES } from '../models/capm';
import { failureThreshold, NIGHTLY_JOB, parseRunDetail, type JobRun, type RunStatus } from '../models/data-health';
import { REGIONS, seriesName } from '../models/five-factor';
import { INDICES, RISK_FREE_SERIES } from '../models/regression';
import type { RuleRow } from '../models/rules';
import { MARKET_SERIES } from '../models/windfall';
import { allRows, rows } from './core';
import { loadSecurities, type SecurityRecord } from './holdings';

/** Runs read for the status: enough to count misses in a row against any sensible threshold. */
const RUNS_READ = 14;

interface JobRunRow {
  id: number;
  started_at: string;
  finished_at: string;
  status: RunStatus;
  detail: unknown;
}

/** The newest nightly runs, newest first, and the DATA_FAILURE rule's threshold. */
async function loadJobRunsUncached(supabase: SupabaseClient): Promise<{ runs: JobRun[]; threshold: number | null }> {
  const [found, rules] = await Promise.all([
    rows<JobRunRow>(
      'job_runs',
      supabase.from('job_runs').select('id, started_at, finished_at, status, detail').eq('job', NIGHTLY_JOB).order('finished_at', { ascending: false }).limit(RUNS_READ),
    ),
    rows<RuleRow>('rules', supabase.from('rules').select('id, threshold, enabled').eq('id', 'DATA_FAILURE')),
  ]);
  return {
    runs: found.map((row) => ({ id: row.id, startedAt: row.started_at, finishedAt: row.finished_at, status: row.status, detail: parseRunDetail(row.detail) })),
    threshold: failureThreshold(rules[0]),
  };
}

/** A newest close or rate and the feed it came from. */
export interface LatestQuote {
  key: string;
  date: string;
  value: number;
  source: string;
}

/**
 * What the data status page shows: the runs, the newest close of every security and rate of every
 * pair, and the newest month of each market series (F3; `date` is YYYY-MM, empty before Phase 2).
 */
export interface DataStatus {
  runs: JobRun[];
  threshold: number | null;
  securities: SecurityRecord[];
  prices: LatestQuote[];
  rates: LatestQuote[];
  series: LatestQuote[];
  /** Each index's newest close (N1, Phase 2 step 2). */
  indices: LatestQuote[];
  /** Each single stock's newest quarter end from its filings (F12, step 4); `value` is the quarters loaded, `filed` when known. */
  filings: Array<LatestQuote & { filed: string | null }>;
}

export async function loadDataStatus(supabase: SupabaseClient): Promise<DataStatus> {
  const [{ runs, threshold }, securities, prices, rates, series, indices, quarters] = await Promise.all([
    loadJobRuns(supabase),
    loadSecurities(supabase),
    rows<{ ticker: string; price_date: string; close: number; source: string }>('latest_prices', supabase.from('latest_prices').select('ticker, price_date, close, source')),
    rows<{ pair: string; rate_date: string; rate: number; source: string }>('latest_fx_rates', supabase.from('latest_fx_rates').select('pair, rate_date, rate, source').order('pair')),
    Promise.all(
      [...MARKET_SERIES, ...Object.values(RISK_FREE_SERIES), ...Object.values(CAPM_SERIES), ...REGIONS.map((region) => seriesName(region, 'mkt'))].map((name) =>
        rows<{ series: string; obs_month: string; value: number; source: string }>(
          'market_series',
          supabase.from('market_series').select('series, obs_month, value, source').eq('series', name).order('obs_month', { ascending: false }).limit(1),
        ),
      ),
    ),
    Promise.all(
      INDICES.map((index) =>
        rows<{ index_id: string; price_date: string; close: number; source: string }>(
          'index_prices',
          supabase.from('index_prices').select('index_id, price_date, close, source').eq('index_id', index).order('price_date', { ascending: false }).limit(1),
        ),
      ),
    ),
    allRows<{ ticker: string; period_end: string; filed_on: string | null; source: string }>('fundamentals', (from, to) =>
      supabase.from('fundamentals').select('ticker, period_end, filed_on, source').order('ticker').order('period_end', { ascending: false }).range(from, to),
    ),
  ]);
  const filings = new Map<string, LatestQuote & { filed: string | null }>();
  for (const row of quarters) {
    const held = filings.get(row.ticker);
    if (held) held.value += 1;
    else filings.set(row.ticker, { key: row.ticker, date: row.period_end, value: 1, source: row.source, filed: row.filed_on });
  }
  return {
    runs,
    threshold,
    securities,
    prices: prices.map((row) => ({ key: row.ticker, date: row.price_date, value: Number(row.close), source: row.source })),
    rates: rates.map((row) => ({ key: row.pair, date: row.rate_date, value: Number(row.rate), source: row.source })),
    series: series.flat().map((row) => ({ key: row.series, date: row.obs_month.slice(0, 7), value: Number(row.value), source: row.source })),
    indices: indices.flat().map((row) => ({ key: row.index_id, date: row.price_date, value: Number(row.close), source: row.source })),
    filings: [...filings.values()],
  };
}

// One read per request (core.ts).
export const loadJobRuns = cache(loadJobRunsUncached);
