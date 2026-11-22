/**
 * What the rules engine reads (lib/models/engine.ts) and saving what it decides: run after the
 * nightly refresh and by "check the rules now".
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { addDays } from '../dates';
import { evaluate, type EngineInput, type Outcome } from '../models/engine';
import { buildPortfolio } from '../models/portfolio';
import { latestFx } from '../models/valuation';
import { loadAssetClassSettings } from './allocation';
import { DataError, rows, setting } from './core';
import { loadHoldingsData } from './holdings';
import { dcaAmount } from './planning';
import { loadFlagInputs } from './red-flags';
import { engineQuotes, loadProposals, loadRules, orderSettings, type OrderSettings, type Proposal, type RuleRecord } from './rules';
import { loadWatchInputs } from './valuation';
import { loadVolatilitySettings } from './volatility';
import { loadWindfallInput } from './windfall';

function configNumber(value: unknown, key?: string): number | null {
  const found = key === undefined ? value : setting(value, key);
  return typeof found === 'number' && Number.isFinite(found) ? found : null;
}

/** Everything the rules engine reads, as of `now`, and the rules for the page. */
export async function loadEngineInput(
  supabase: SupabaseClient,
  today: string,
  now: string,
): Promise<{ input: EngineInput; rules: RuleRecord[]; proposals: Proposal[]; orders: OrderSettings }> {
  const [data, classes, rules, config, proposals, windfall] = await Promise.all([
    loadHoldingsData(supabase),
    loadAssetClassSettings(supabase),
    loadRules(supabase),
    rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').in('key', ['dca', 'proposal_expiry_days', 'orders'])),
    loadProposals(supabase, today),
    loadWindfallInput(supabase, today),
  ]);
  const [watch, redFlags, volatility] = await Promise.all([loadWatchInputs(supabase, data.securities), loadFlagInputs(supabase, today, data), loadVolatilityInput(supabase, today)]);
  const value = (key: string) => config.find((row) => row.key === key)?.value;
  const day = configNumber(value('dca'), 'day_of_month');
  const expiry = configNumber(value('proposal_expiry_days'));
  const usd = latestFx(data.fx, data.trades).get('USD');
  const input: EngineInput = {
    today,
    now,
    holdings: buildPortfolio(data).holdings,
    assetClasses: classes,
    quotes: engineQuotes(data, orderSettings(value('orders'))),
    rules,
    dca: { amountTwd: dcaAmount(value('dca')), dayOfMonth: day !== null && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null },
    expiryDays: expiry !== null && expiry > 0 ? expiry : null,
    proposals,
    domiciles: new Map(data.securities.map((security) => [security.ticker, security.domicile])),
    usdTwd: usd?.value ?? null,
    windfall,
    ...(watch ? { watch } : {}),
    ...(redFlags ? { redFlags } : {}),
    ...(volatility ? { volatility } : {}),
  };
  return { input, rules, proposals, orders: orderSettings(value('orders')) };
}

/** The days of saved volatility scores the N8 rules read: a run is followed back this far at most. */
const VOLATILITY_RUN_DAYS = 120;

/** The saved volatility scores (N8 step 3), oldest first; undefined before config volatility exists. */
async function loadVolatilityInput(supabase: SupabaseClient, today: string): Promise<EngineInput['volatility']> {
  const settings = await loadVolatilitySettings(supabase);
  if (!settings) return undefined;
  const found = await rows<{ score_date: string; score: number }>(
    'volatility_scores',
    supabase.from('volatility_scores').select('score_date, score').gte('score_date', addDays(today, -VOLATILITY_RUN_DAYS)).lte('score_date', today).order('score_date'),
  );
  return { scores: found.map((row) => ({ date: row.score_date, score: Number(row.score) })), maxAgeDays: settings.maxAgeDays };
}

/** Closes and drafts what the engine decided. Two runs at once cannot draft the same open proposal twice. */
export async function saveOutcome(supabase: SupabaseClient, outcome: Outcome): Promise<{ created: number; closed: number }> {
  let closed = 0;
  for (const { id, reason } of outcome.close) {
    const { data, error } = await supabase.from('proposals').update({ status: 'expired', closed_reason: reason }).eq('id', id).eq('status', 'open').select('id');
    if (error) throw new DataError('proposals', error.message);
    closed += data?.length ?? 0;
  }
  let created = 0;
  let tierDrafted = false;
  for (const draft of outcome.create) {
    const { error } = await supabase.from('proposals').insert({ rule_id: draft.ruleId, state: draft.state, orders: draft.orders, detail: draft.detail });
    if (error && error.code !== '23505') throw new DataError('proposals', error.message);
    if (!error) created += 1;
    if (!error && draft.state.startsWith('tier:')) tierDrafted = true;
  }
  // The plan keeps the record of the tiers fired, once their proposal is in (F3: once per drawdown).
  if (outcome.windfall && tierDrafted) {
    const { planId, tiersFired, peakClose } = outcome.windfall;
    const { error } = await supabase
      .from('windfall_plan')
      .update({ tiers_fired: tiersFired.map((tier) => ({ drawdown: tier.drawdown, peak_date: tier.peakDate, fired_on: tier.firedOn })), current_drawdown_peak: peakClose })
      .eq('id', planId);
    if (error) throw new DataError('windfall_plan', error.message);
  }
  return { created, closed };
}

/** Evaluates every rule now and saves the outcome: the nightly job after its refresh, and "Check now". */
export async function runRules(supabase: SupabaseClient, today: string, now: string): Promise<{ created: number; closed: number }> {
  const { input } = await loadEngineInput(supabase, today, now);
  return saveOutcome(supabase, evaluate(input));
}
