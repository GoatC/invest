/**
 * F15 fee and tax drag: brokers, fund costs, the tax settings and the costs page's data.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { mixReturn } from '../models/cma';
import { readBrokers, readFeeSettings, readFundCosts, readTaxSettings, type Broker, type CostSettings, type FeeSettings, type FundCost, type TaxSettings } from '../models/costs';
import { readPlanSettings, type PlanSettings } from '../models/projection';
import type { Market, ProductType } from '../models/types';
import { loadAssetClassSettings, loadAssumptions, type AssetClassSettings } from './allocation';
import { rows } from './core';
import { loadCashFlows, loadHoldingsData, loadSecurities, type CashFlowRecord, type HoldingsData } from './holdings';
import { dcaAmount } from './planning';
import { loadRules, type RuleRecord } from './rules';

/** The F15 config rows as the app reads them; `applied` is false until the step 11 migration is. */
export interface CostConfig {
  applied: boolean;
  fees: FeeSettings;
  brokers: Broker[];
  funds: FundCost[];
  /** Undefined while a threshold the checks need is missing. */
  tax: TaxSettings | undefined;
  taxVerifiedOn: string | null;
}

export const COST_KEYS = ['fees', 'brokers', 'fund_costs', 'tax'] as const;

async function loadCostConfigUncached(supabase: SupabaseClient): Promise<CostConfig> {
  const found = await rows<{ key: string; value: unknown; last_verified: string | null }>('config', supabase.from('config').select('key, value, last_verified').in('key', [...COST_KEYS]));
  const row = (key: string) => found.find((candidate) => candidate.key === key);
  return {
    applied: COST_KEYS.every((key) => row(key) !== undefined),
    fees: readFeeSettings(row('fees')?.value),
    brokers: readBrokers(row('brokers')?.value),
    funds: readFundCosts(row('fund_costs')?.value),
    tax: readTaxSettings(row('tax')?.value),
    taxVerifiedOn: row('tax')?.last_verified ?? null,
  };
}

/** The broker the estimates use, from config fees; null until one is chosen. */
export function chosenBroker(config: CostConfig): Broker | null {
  return config.brokers.find((broker) => broker.id === config.fees.brokerId) ?? null;
}

/** What the fee estimates on draft orders need: the chosen broker, the Taiwan commission, the tax, and each security's market and kind. */
export interface FeeContext {
  costs: CostSettings;
  securities: Map<string, { market: Market; productType: ProductType }>;
}

async function loadFeeContextUncached(supabase: SupabaseClient): Promise<FeeContext> {
  const [config, securities] = await Promise.all([loadCostConfig(supabase), loadSecurities(supabase)]);
  return {
    costs: { broker: chosenBroker(config), tw: config.fees.tw, tax: config.tax },
    securities: new Map(securities.map((security) => [security.ticker, { market: security.market, productType: security.productType }])),
  };
}

/** Everything the costs page reads. */
export interface CostsData extends HoldingsData {
  config: CostConfig;
  classSettings: AssetClassSettings[];
  flows: CashFlowRecord[];
  rules: RuleRecord[];
  /** config projection, dca and the target mix's expected return, for the plan costs are measured over. */
  planSettings: PlanSettings | undefined;
  dcaAmount: number | null;
  mix: { expectedReturn: number; share: number } | null;
}

export async function loadCostsData(supabase: SupabaseClient): Promise<CostsData> {
  const [holdings, config, classSettings, flows, rules, planConfig, assumptions] = await Promise.all([
    loadHoldingsData(supabase),
    loadCostConfig(supabase),
    loadAssetClassSettings(supabase),
    loadCashFlows(supabase),
    loadRules(supabase),
    rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').in('key', ['projection', 'dca'])),
    loadAssumptions(supabase),
  ]);
  const value = (key: string) => planConfig.find((row) => row.key === key);
  const projection = value('projection');
  return {
    ...holdings,
    config,
    classSettings,
    flows,
    rules,
    planSettings: projection ? readPlanSettings(projection.value) : undefined,
    dcaAmount: dcaAmount(value('dca')?.value),
    mix: assumptions ? mixReturn(classSettings, assumptions.assumptions) : null,
  };
}

// One read per request (core.ts).
export const loadCostConfig = cache(loadCostConfigUncached);
export const loadFeeContext = cache(loadFeeContextUncached);
