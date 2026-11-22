/**
 * F14 combined look-through: the funds' holdings files against the portfolio.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { readFundCosts, type FundCost } from '../models/costs';
import { directKey, fileDue, lookThrough, readLookThroughSettings, unpackConstituents, type LookThrough, type LookThroughSettings } from '../models/look-through';
import { buildPortfolio } from '../models/portfolio';
import type { Market, Pool } from '../models/types';
import { rows } from './core';
import { loadHoldingsData, type HoldingsData, type SecurityRecord } from './holdings';

async function loadLookThroughSettingsUncached(supabase: SupabaseClient): Promise<LookThroughSettings | undefined> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'look_through'));
  return readLookThroughSettings(found[0]?.value);
}

/** The funds and single stocks held, both pools: what the look-through opens up. */
function heldTickers(data: HoldingsData): { funds: SecurityRecord[]; stocks: SecurityRecord[] } {
  const held = new Set(buildPortfolio(data).holdings.flatMap((holding) => (holding.ticker && (holding.valueTwd ?? 0) > 0 ? [holding.ticker] : [])));
  const securities = data.securities.filter((security) => held.has(security.ticker));
  return { funds: securities.filter((security) => security.productType !== 'stock'), stocks: securities.filter((security) => security.productType === 'stock') };
}

/** What the nightly job reads for F14: the held funds whose file is due, and the held stocks; undefined before config look_through. */
export async function loadLookThroughPlan(
  supabase: SupabaseClient,
  today: string,
): Promise<{ settings: LookThroughSettings; due: Array<{ fund: string; source: 'vanguard' | 'fubon'; id: string }>; stocks: Array<{ ticker: string; market: Market; sector: string | null }> } | undefined> {
  const settings = await loadLookThroughSettings(supabase);
  if (!settings) return undefined;
  const data = await loadHoldingsData(supabase);
  const { funds, stocks } = heldTickers(data);
  const sourced = funds.filter((fund) => settings.sources[fund.ticker]);
  const [loaded, sectors] = await Promise.all([
    sourced.length ? rows<{ fund: string; loaded_at: string }>('fund_holdings', supabase.from('fund_holdings').select('fund, loaded_at').in('fund', sourced.map((fund) => fund.ticker))) : Promise.resolve([]),
    stocks.length ? rows<{ ticker: string; sector: string | null }>('company_profiles', supabase.from('company_profiles').select('ticker, sector').in('ticker', stocks.map((stock) => stock.ticker))) : Promise.resolve([]),
  ]);
  return {
    settings,
    due: sourced
      .filter((fund) => fileDue(loaded.find((row) => row.fund === fund.ticker)?.loaded_at, today, settings.refreshDays))
      .map((fund) => ({ fund: fund.ticker, ...(settings.sources[fund.ticker] as { source: 'vanguard' | 'fubon'; id: string }) })),
    stocks: stocks.map((stock) => ({ ticker: stock.ticker, market: stock.market, sector: sectors.find((row) => row.ticker === stock.ticker)?.sector ?? null })),
  };
}

export interface LookThroughData {
  settings: LookThroughSettings | undefined;
  result?: LookThrough;
  securities: SecurityRecord[];
  /** config fund_costs (F15): each fund's TER and tracking difference. */
  fundCosts: FundCost[];
}

/** The whole portfolio opened up, from the saved holdings files; `pool` keeps one pool's holdings only. */
async function loadLookThroughDataUncached(supabase: SupabaseClient, holdings?: HoldingsData, pool?: Pool): Promise<LookThroughData> {
  const [settings, data, costs] = await Promise.all([
    loadLookThroughSettings(supabase),
    holdings ?? loadHoldingsData(supabase),
    rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'fund_costs')),
  ]);
  const fundCosts = readFundCosts(costs[0]?.value);
  if (!settings) return { settings, securities: data.securities, fundCosts };
  const { funds, stocks } = heldTickers(data);
  const [files, sectors] = await Promise.all([
    funds.length ? rows<{ fund: string; as_of: string; source: string; constituents: unknown }>('fund_holdings', supabase.from('fund_holdings').select('fund, as_of, source, constituents').in('fund', funds.map((fund) => fund.ticker))) : Promise.resolve([]),
    stocks.length ? rows<{ ticker: string; sector: string | null }>('company_profiles', supabase.from('company_profiles').select('ticker, sector').in('ticker', stocks.map((stock) => stock.ticker))) : Promise.resolve([]),
  ]);
  const byTicker = new Map(data.securities.map((security) => [security.ticker, security]));
  const result = lookThrough({
    holdings: buildPortfolio(data).holdings.filter((holding) => !pool || holding.pool === pool),
    files: new Map(files.map((row) => [row.fund, { fund: row.fund, asOf: row.as_of, source: row.source, constituents: unpackConstituents(row.constituents) }])),
    sectors: new Map(sectors.flatMap((row) => (row.sector && byTicker.get(row.ticker) ? [[directKey((byTicker.get(row.ticker) as SecurityRecord).market, row.ticker), row.sector] as [string, string]] : []))),
    settings,
  });
  return { settings, result, securities: data.securities, fundCosts };
}

// One read per request (core.ts).
export const loadLookThroughSettings = cache(loadLookThroughSettingsUncached);
export const loadLookThroughData = cache(loadLookThroughDataUncached);
