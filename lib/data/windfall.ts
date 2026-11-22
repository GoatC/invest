/**
 * F3 windfall tranche planner: the plan, its settings, ACWI's gauge and the windfall page's data.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { addDays } from '../dates';
import type { FiredTier, WindfallInput, WindfallTranche } from '../models/engine';
import { loadAssetClassSettings, type AssetClassSettings } from './allocation';
import { DataError, orDataError, rows, setting } from './core';
import { loadCashFlows, loadHoldingsData, type CashFlowRecord, type HoldingsData } from './holdings';
import { loadMarketSeries, type SeriesPoint } from './market';
import { loadProposals, loadRules, type Proposal, type RuleRecord } from './rules';

/** The gauge's window and a little more: 53 weeks of ACWI closes. */
const GAUGE_DAYS = 380;

export interface WindfallPlanRecord {
  id: number;
  totalTwd: number;
  startDate: string;
  capePercentile: number | null;
  trancheCount: number | null;
  tiersFired: FiredTier[];
  peakClose: number | null;
  tranches: Array<WindfallTranche & { proposalId: number | null }>;
}

function readFired(value: unknown): FiredTier[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const { drawdown, peak_date: peakDate, fired_on: firedOn } = row;
    return typeof drawdown === 'number' && typeof peakDate === 'string' ? [{ drawdown, peakDate, firedOn: typeof firedOn === 'string' ? firedOn : '' }] : [];
  });
}

/** The newest windfall plan with its tranches; undefined when none has been started. */
async function loadWindfallPlanUncached(supabase: SupabaseClient): Promise<WindfallPlanRecord | undefined> {
  const [plan] = await rows<{ id: number; total_twd: number; received_on: string; cape_percentile: number | null; tranche_count: number | null; tiers_fired: unknown; current_drawdown_peak: number | null }>(
    'windfall_plan',
    supabase.from('windfall_plan').select('id, total_twd, received_on, cape_percentile, tranche_count, tiers_fired, current_drawdown_peak').order('id', { ascending: false }).limit(1),
  );
  if (!plan) return undefined;
  const tranches = await rows<{ id: number; due_date: string; amount_twd: number; status: WindfallTranche['status']; proposal_id: number | null }>(
    'windfall_tranches',
    supabase.from('windfall_tranches').select('id, due_date, amount_twd, status, proposal_id').eq('plan_id', plan.id).order('due_date').order('id'),
  );
  return {
    id: plan.id,
    totalTwd: Number(plan.total_twd),
    startDate: plan.received_on,
    capePercentile: plan.cape_percentile === null ? null : Number(plan.cape_percentile),
    trancheCount: plan.tranche_count,
    tiersFired: readFired(plan.tiers_fired),
    peakClose: plan.current_drawdown_peak === null ? null : Number(plan.current_drawdown_peak),
    tranches: tranches.map((row) => ({ id: row.id, dueDate: row.due_date, amountTwd: Number(row.amount_twd), status: row.status, proposalId: row.proposal_id })),
  };
}

/** config windfall: the fund each core class is bought through, the waiting cash's return and the backtest's span. */
export interface WindfallSettings {
  vehicles: Record<string, string>;
  cashReturn: number;
  fromYear: number;
  horizonMonths: number;
}

export function readWindfallSettings(value: unknown): WindfallSettings {
  const vehicles = setting(value, 'vehicles');
  const backtest = setting(value, 'backtest');
  const cashReturn = setting(value, 'cash_return');
  const fromYear = setting(backtest, 'from_year');
  const horizon = setting(backtest, 'horizon_months');
  return {
    vehicles:
      typeof vehicles === 'object' && vehicles !== null && !Array.isArray(vehicles)
        ? Object.fromEntries(Object.entries(vehicles).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''))
        : {},
    cashReturn: typeof cashReturn === 'number' && cashReturn > -0.5 && cashReturn < 0.5 ? cashReturn : 0,
    fromYear: typeof fromYear === 'number' && Number.isInteger(fromYear) ? fromYear : 1900,
    horizonMonths: typeof horizon === 'number' && Number.isInteger(horizon) && horizon >= 1 ? horizon : 60,
  };
}

export function windfallSettingsValue(settings: WindfallSettings): Record<string, unknown> {
  return { vehicles: settings.vehicles, cash_return: settings.cashReturn, backtest: { from_year: settings.fromYear, horizon_months: settings.horizonMonths } };
}

/** ACWI's closes over the gauge's window, the drawdown's measure (F3). */
export async function loadGauge(supabase: SupabaseClient, today: string): Promise<Array<{ date: string; close: number }>> {
  const found = await rows<{ price_date: string; close: number }>(
    'prices',
    supabase.from('prices').select('price_date, close').eq('ticker', 'ACWI').gte('price_date', addDays(today, -GAUGE_DAYS)).lte('price_date', today).order('price_date'),
  );
  return found.map((row) => ({ date: row.price_date, close: Number(row.close) }));
}

/** What the two windfall rules read; the plan is null until one is started (or before the migration). */
export async function loadWindfallInput(supabase: SupabaseClient, today: string): Promise<WindfallInput | undefined> {
  const [plan, gauge, settings] = await Promise.all([
    orDataError(loadWindfallPlan(supabase)),
    orDataError(loadGauge(supabase, today)),
    orDataError(rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'windfall'))),
  ]);
  if (plan instanceof DataError || gauge instanceof DataError || settings instanceof DataError) return undefined;
  return {
    plan: plan ? { id: plan.id, totalTwd: plan.totalTwd, startDate: plan.startDate, tranches: plan.tranches, tiersFired: plan.tiersFired } : null,
    gauge,
    vehicles: readWindfallSettings(settings[0]?.value).vehicles,
  };
}

/** Everything the Windfall page reads. */
export interface WindfallData extends HoldingsData {
  plan: WindfallPlanRecord | undefined;
  settings: WindfallSettings;
  pace: unknown;
  rules: RuleRecord[];
  market: { series: Record<string, SeriesPoint[]>; sources: Record<string, string> };
  gauge: Array<{ date: string; close: number }>;
  flows: CashFlowRecord[];
  proposals: Proposal[];
  classSettings: AssetClassSettings[];
}

export async function loadWindfallData(supabase: SupabaseClient, today: string): Promise<WindfallData> {
  const [holdings, plan, config, rules, market, gauge, flows, proposals, classSettings] = await Promise.all([
    loadHoldingsData(supabase),
    loadWindfallPlan(supabase),
    rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').in('key', ['windfall', 'windfall_pace'])),
    loadRules(supabase),
    loadMarketSeries(supabase),
    loadGauge(supabase, today),
    loadCashFlows(supabase),
    loadProposals(supabase, today),
    loadAssetClassSettings(supabase),
  ]);
  const value = (key: string) => config.find((row) => row.key === key)?.value;
  return { ...holdings, plan, settings: readWindfallSettings(value('windfall')), pace: value('windfall_pace'), rules, market, gauge, flows, proposals, classSettings };
}

// One read per request (core.ts).
export const loadWindfallPlan = cache(loadWindfallPlanUncached);
