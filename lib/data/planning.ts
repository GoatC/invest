/**
 * Life planning: the F2 calculator's plan, F5 Monte Carlo's inputs and runs, F1's goals.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { mixReturn } from '../models/cma';
import { readMcSettings, readRunSummary, runMonteCarlo, runSummary, type McData } from '../models/monte-carlo';
import type { PerformanceInput } from '../models/performance';
import { buildPortfolio } from '../models/portfolio';
import { readPlanSettings, savedPlan, type PlanSettings } from '../models/projection';
import type { Point as ReturnPoint } from '../models/regression';
import { readTimelineSettings } from '../models/timeline';
import { capePercentile, readAcceleration, readPace } from '../models/windfall';
import { loadAssetClassSettings, loadAssumptions } from './allocation';
import { allRows, DataError, rows, setting } from './core';
import { loadAssetClasses, loadHoldingsData } from './holdings';
import { loadMonthlyReturns } from './market';
import { loadPerformanceInput } from './performance';
import { loadWindfallPlan, readWindfallSettings } from './windfall';

// ---------------------------------------------------------------------------
// F2 compounding calculator
// ---------------------------------------------------------------------------

/** The monthly contribution the calculator starts from (config dca.amount_twd). */
export function dcaAmount(value: unknown): number | null {
  const amount = setting(value, 'amount_twd');
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** The saved plan and what the calculator offers without one, and the portfolio's history. */
export interface PlanData {
  /** Undefined until the step 8 migration is applied. */
  settings: PlanSettings | undefined;
  dcaAmount: number | null;
  /** The target mix's expected return from the capital market assumptions. */
  mix: { expectedReturn: number; share: number } | null;
  /** For the regular pool's month ends. */
  input: PerformanceInput;
}

async function loadPlanDataUncached(supabase: SupabaseClient, today: string): Promise<PlanData> {
  const [config, assetClasses, assumptions, input] = await Promise.all([
    rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').in('key', ['projection', 'dca'])),
    loadAssetClasses(supabase),
    loadAssumptions(supabase),
    loadPerformanceInput(supabase, today),
  ]);
  const value = (key: string) => config.find((row) => row.key === key);
  const projection = value('projection');
  return {
    settings: projection ? readPlanSettings(projection.value) : undefined,
    dcaAmount: dcaAmount(value('dca')?.value),
    mix: assumptions ? mixReturn(assetClasses, assumptions.assumptions) : null,
    input,
  };
}

// ---------------------------------------------------------------------------
// F5 Monte Carlo
// ---------------------------------------------------------------------------

/** The newest saved monthly re-run (simulation_runs) of a model, if any. */
export async function loadLastRun(supabase: SupabaseClient, model: string): Promise<ReturnType<typeof readRunSummary>> {
  const [row] = await rows<{ summary: unknown }>('simulation_runs', supabase.from('simulation_runs').select('summary').eq('model', model).order('run_date', { ascending: false }).limit(1));
  return row ? readRunSummary(row.summary) : null;
}

/** Everything a Monte Carlo run reads (config monte_carlo and projection, F6, F3, the proxies' prices). */
export async function loadMonteCarloInput(supabase: SupabaseClient, today: string): Promise<McData> {
  const [config, classes, assumptions, windfallPlan, holdings, rules, capes] = await Promise.all([
    rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').in('key', ['monte_carlo', 'projection', 'windfall', 'windfall_pace'])),
    loadAssetClassSettings(supabase),
    loadAssumptions(supabase),
    loadWindfallPlan(supabase),
    loadHoldingsData(supabase),
    rows<{ threshold: unknown; enabled: boolean }>('rules', supabase.from('rules').select('threshold, enabled').eq('id', 'WINDFALL_ACCELERATION')),
    allRows<{ obs_month: string; value: number }>('market_series', (from, to) => supabase.from('market_series').select('obs_month, value').eq('series', 'us_cape').order('obs_month').range(from, to)),
  ]);
  const value = (key: string) => config.find((row) => row.key === key)?.value;
  const settings = readMcSettings(value('monte_carlo'));
  const proposed = readPlanSettings(value('projection'));
  const tickers = [...new Set(classes.filter((entry) => entry.targetWeight > 0).flatMap((entry) => (entry.benchmarkTicker ? [entry.benchmarkTicker] : [])))];
  const history = settings ? await loadMonthlyReturns(supabase, tickers, settings.lookbackYears, today) : new Map<string, ReturnPoint[]>();
  const windfallValue = buildPortfolio(holdings).holdings.filter((holding) => holding.pool === 'windfall').reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  return {
    settings,
    plan: savedPlan(proposed),
    classes: classes.map((entry) => ({ id: entry.id, targetWeight: entry.targetWeight, sleeve: entry.sleeve, benchmarkTicker: entry.benchmarkTicker })),
    assumptions: assumptions?.assumptions ?? {},
    history,
    windfallPlan: windfallPlan ?? null,
    windfallValue,
    cashReturn: readWindfallSettings(value('windfall')).cashReturn,
    // F3's pace for an expected windfall, at today's CAPE percentile; its acceleration only while the rule is on.
    pace: readPace(value('windfall_pace')),
    cape: capePercentile(capes.map((row) => ({ month: row.obs_month.slice(0, 7), value: Number(row.value) }))),
    acceleration: rules[0]?.enabled ? readAcceleration(rules[0].threshold) : null,
  };
}

/** The nightly job's monthly re-run: saves this month's summary once; undefined when it is saved or cannot run yet. */
export async function refreshMonteCarlo(supabase: SupabaseClient, today: string): Promise<{ runDate: string; median: number | null } | undefined> {
  const [ready] = await rows<{ key: string }>('config', supabase.from('config').select('key').eq('key', 'monte_carlo'));
  if (!ready) return undefined;
  const [latest] = await rows<{ run_date: string }>('simulation_runs', supabase.from('simulation_runs').select('run_date').eq('model', 'monte_carlo').order('run_date', { ascending: false }).limit(1));
  if (latest && latest.run_date.slice(0, 7) === today.slice(0, 7)) return undefined;
  const run = runMonteCarlo(await loadMonteCarloInput(supabase, today), today);
  if (!run.ok) return undefined;
  const { error } = await supabase.from('simulation_runs').upsert({ model: 'monte_carlo', run_date: today, summary: runSummary(run, today) }, { onConflict: 'model,run_date' });
  if (error) throw new DataError('simulation_runs', error.message);
  return { runDate: today, median: run.result.marks[run.result.marks.length - 1]?.median ?? null };
}

// ---------------------------------------------------------------------------
// F1 life timeline
// ---------------------------------------------------------------------------

/** config timeline: the later goals; undefined before its migration. */
export async function loadTimelineSettings(supabase: SupabaseClient) {
  const [row] = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'timeline'));
  return readTimelineSettings(row?.value);
}

// One read per request (core.ts).
export const loadPlanData = cache(loadPlanDataUncached);
