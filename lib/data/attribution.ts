/**
 * N2 Brinson attribution: the inputs, the saved monthly result and its rows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { brinson, monthInputs, sectorInputs, type ClassSpec, type MonthInput, type SatelliteStock, type SectorBenchmark } from '../models/attribution';
import { unpackConstituents } from '../models/look-through';
import { MarketHistory } from '../models/market';
import { buildSeries, type PerformanceInput } from '../models/performance';
import { loadAssetClassSettings } from './allocation';
import { allRows, DataError, rows } from './core';
import { loadPerformanceInput } from './performance';
import { loadSectorSettings } from './sectors';

export interface AttributionData {
  input: PerformanceInput;
  classes: ClassSpec[];
  /** The satellite's single stocks and their GICS sectors (level 2). */
  stocks: SatelliteStock[];
  /** The core equity fund's sector weights and the fund pricing each sector (level 2); empty without them. */
  sectorBenchmark: SectorBenchmark[];
  /** The fund level 2's benchmark weights come from, and the date of its holdings file. */
  coreFund: { ticker: string; asOf: string } | null;
  /** The sector funds' closes, as index_prices holds them. */
  sectorPrices: Array<{ ticker: string; date: string; close: number; adjClose: number | null }>;
}

export async function loadAttributionData(supabase: SupabaseClient, today: string): Promise<AttributionData> {
  const [input, classes, sectorSettings, profiles] = await Promise.all([
    loadPerformanceInput(supabase, today),
    loadAssetClassSettings(supabase),
    loadSectorSettings(supabase),
    rows<{ ticker: string; sector: string | null }>('company_profiles', supabase.from('company_profiles').select('ticker, sector')),
  ]);
  const currency = new Map(input.securities.map((security) => [security.ticker, security.currency]));
  const specs: ClassSpec[] = classes.map((entry) => ({ id: entry.id, targetWeight: entry.targetWeight, benchmarkTicker: entry.benchmarkTicker, benchmarkCurrency: (entry.benchmarkTicker ? currency.get(entry.benchmarkTicker) : undefined) ?? 'USD' }));
  const sectorOf = new Map(profiles.map((row) => [row.ticker, row.sector]));
  const stocks = input.securities.filter((security) => security.productType === 'stock' && security.sleeve === 'satellite').map((security) => ({ ticker: security.ticker, currency: security.currency, sector: sectorOf.get(security.ticker) ?? null }));

  const fund = classes.find((entry) => entry.id === 'us_global_equity')?.benchmarkTicker ?? null;
  const [file] = fund ? await rows<{ fund: string; as_of: string; constituents: unknown }>('fund_holdings', supabase.from('fund_holdings').select('fund, as_of, constituents').eq('fund', fund)) : [];
  const proxies = new Map((sectorSettings?.proxies ?? []).filter((proxy) => proxy.market === 'US').map((proxy) => [proxy.sector, proxy.id]));
  const weights = new Map<string, number>();
  for (const constituent of file ? unpackConstituents(file.constituents) : []) {
    if (constituent.sector && constituent.assetType === 'equity' && proxies.has(constituent.sector)) weights.set(constituent.sector, (weights.get(constituent.sector) ?? 0) + constituent.weight);
  }
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  const sectorBenchmark: SectorBenchmark[] = total > 0 ? [...weights].map(([sector, weight]) => ({ sector, weight: weight / total, proxy: proxies.get(sector) as string, currency: 'USD' })) : [];
  const ids = sectorBenchmark.map((entry) => entry.proxy);
  const found = ids.length
    ? await allRows<{ index_id: string; price_date: string; close: number }>('index_prices', (from, to) => supabase.from('index_prices').select('index_id, price_date, close').in('index_id', ids).order('index_id').order('price_date').range(from, to))
    : [];
  return {
    input,
    classes: specs,
    stocks,
    sectorBenchmark,
    coreFund: file ? { ticker: file.fund, asOf: file.as_of } : null,
    sectorPrices: found.map((row) => ({ ticker: row.index_id, date: row.price_date, close: Number(row.close), adjClose: null })),
  };
}

/** The effects of each complete month by segment, ready for the attribution table (level 1 by class, 2 by sector). */
export function attributionRows(level: 1 | 2, month: MonthInput): Array<Record<string, unknown>> {
  const result = brinson(month.segments);
  return result.segments.map((row) => ({
    period_start: `${month.month}-01`,
    period_end: month.to,
    level,
    segment: row.id,
    allocation: row.allocation,
    selection: row.selection,
    interaction: row.interaction,
    fx: row.currency,
  }));
}

/**
 * The nightly job's monthly run: saves each complete month's effects, both levels, that the table
 * does not have yet; undefined when there is nothing new or no history to attribute.
 */
export async function refreshAttribution(supabase: SupabaseClient, today: string): Promise<{ months: number } | undefined> {
  const saved = await rows<{ period_end: string }>('attribution', supabase.from('attribution').select('period_end').eq('level', 1));
  const done = new Set(saved.map((row) => row.period_end));
  const data = await loadAttributionData(supabase, today);
  const days = buildSeries(data.input);
  const market = new MarketHistory([...data.input.prices, ...data.sectorPrices], data.input.rates);
  const complete = monthInputs(days, market, data.classes).filter((month) => month.complete);
  const fresh = complete.filter((month) => !done.has(month.to));
  if (fresh.length === 0) return undefined;
  const level2 = sectorInputs(fresh, days, market, data.stocks, data.sectorBenchmark);
  const out = [...fresh.flatMap((month) => attributionRows(1, month)), ...level2.flatMap((month) => attributionRows(2, month))];
  const { error } = await supabase.from('attribution').upsert(out, { onConflict: 'period_start,period_end,level,segment' });
  if (error) throw new DataError('attribution', error.message);
  return { months: fresh.length };
}

/** The newest month saved by the monthly run: its date, when it was saved and level 1's effects summed. */
export async function loadLastAttribution(supabase: SupabaseClient): Promise<{ periodEnd: string; savedAt: string; allocation: number; selection: number; interaction: number; fx: number } | null> {
  const [latest] = await rows<{ period_end: string }>('attribution', supabase.from('attribution').select('period_end').eq('level', 1).order('period_end', { ascending: false }).limit(1));
  if (!latest) return null;
  const found = await rows<{ allocation: number; selection: number; interaction: number; fx: number; created_at: string }>(
    'attribution',
    supabase.from('attribution').select('allocation, selection, interaction, fx, created_at').eq('level', 1).eq('period_end', latest.period_end),
  );
  const sum = (key: 'allocation' | 'selection' | 'interaction' | 'fx') => found.reduce((total, row) => total + Number(row[key]), 0);
  return { periodEnd: latest.period_end, savedAt: found.map((row) => row.created_at).sort().pop() ?? '', allocation: sum('allocation'), selection: sum('selection'), interaction: sum('interaction'), fx: sum('fx') };
}
