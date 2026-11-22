/**
 * The portfolio's own records: trades, securities, asset classes, non-listed assets, cash flows,
 * splits and FX rates, as the holdings page, the forms and every model read them (N5).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { MAPPING_PREFIX, parseSavedMapping, type SavedMapping } from '../csv/mapping';
import { GOLD } from '../models/fx';
import type { PortfolioData } from '../models/portfolio';
import { capsFromRules, type Caps, type RuleRow } from '../models/rules';
import type { Split } from '../models/splits';
import type { AssetClass, CashFlow, Direction, FlowType, FxQuote, ManualAsset, Market, Pool, PriceQuote, ProductType, Security, Side, Sleeve, Trade } from '../models/types';
import { allRows, DataError, rows, setting } from './core';

// ---------------------------------------------------------------------------
// Row shapes as the Data API returns them, and their app-side form
// ---------------------------------------------------------------------------

export interface TransactionRecord extends Trade {
  id: number;
  source: 'manual' | 'csv';
  note: string | null;
}

export interface TransactionRow {
  id: number;
  trade_date: string;
  ticker: string;
  side: Side;
  qty: number;
  price: number;
  currency: string;
  fee: number;
  tax: number;
  fx_rate: number;
  pool: Pool;
  /** Absent only in rows written before the direction / leverage migration. */
  direction?: Direction;
  leverage?: number;
  source: 'manual' | 'csv';
  note: string | null;
}

export const TRANSACTION_COLUMNS = 'id, trade_date, ticker, side, qty, price, currency, fee, tax, fx_rate, pool, direction, leverage, source, note';

export function toTransaction(row: TransactionRow): TransactionRecord {
  return {
    id: row.id,
    tradeDate: row.trade_date,
    ticker: row.ticker,
    side: row.side,
    qty: Number(row.qty),
    price: Number(row.price),
    currency: row.currency,
    fee: Number(row.fee),
    tax: Number(row.tax),
    fxRate: Number(row.fx_rate),
    pool: row.pool,
    direction: row.direction === 'short' ? 'short' : 'long',
    leverage: Number(row.leverage ?? 1),
    source: row.source,
    note: row.note,
  };
}

/** The columns a saved trade writes; source is set on insert only. */
export function transactionColumns(trade: Omit<Trade, 'id'> & { note: string | null }) {
  return {
    trade_date: trade.tradeDate,
    ticker: trade.ticker,
    side: trade.side,
    qty: trade.qty,
    price: trade.price,
    currency: trade.currency,
    fee: trade.fee,
    tax: trade.tax,
    fx_rate: trade.fxRate,
    pool: trade.pool,
    direction: trade.direction ?? 'long',
    leverage: trade.leverage ?? 1,
    note: trade.note,
  };
}

export interface SecurityRecord extends Security {
  domicile: string;
}

interface SecurityRow {
  ticker: string;
  name: string;
  market: Market;
  product_type: ProductType;
  asset_class_id: string;
  sleeve: Sleeve;
  currency: string;
  domicile: string;
}

export interface AssetClassRow {
  id: string;
  name_en: string;
  name_zh: string;
  target_weight: number;
  sleeve: Sleeve;
  sort_order: number;
}

export interface ManualAssetRow {
  id: number;
  name: string;
  asset_class_id: string;
  product_type: 'gold' | 'cash_mmf';
  unit: 'grams' | 'TWD';
  quantity: number;
  last_value_twd: number | null;
  valued_on: string | null;
  pool: Pool;
}

export const MANUAL_ASSET_COLUMNS = 'id, name, asset_class_id, product_type, unit, quantity, last_value_twd, valued_on, pool';

export function toManualAsset(row: ManualAssetRow): ManualAsset {
  return {
    id: row.id,
    name: row.name,
    assetClassId: row.asset_class_id,
    productType: row.product_type,
    unit: row.unit,
    quantity: Number(row.quantity),
    lastValueTwd: row.last_value_twd === null ? null : Number(row.last_value_twd),
    valuedOn: row.valued_on,
    pool: row.pool,
  };
}

export interface CashFlowRecord extends CashFlow {
  id: number;
  /** amount × fx_rate, as the database computes it. */
  amountTwd: number;
}

export interface CashFlowRow {
  id: number;
  flow_date: string;
  type: FlowType;
  amount: number;
  currency: string;
  fx_rate: number;
  amount_twd: number;
  pool: Pool;
  ticker: string | null;
  note: string | null;
}

export const CASH_FLOW_COLUMNS = 'id, flow_date, type, amount, currency, fx_rate, amount_twd, pool, ticker, note';

export function toCashFlow(row: CashFlowRow): CashFlowRecord {
  return {
    id: row.id,
    flowDate: row.flow_date,
    type: row.type,
    amount: Number(row.amount),
    currency: row.currency,
    fxRate: Number(row.fx_rate),
    amountTwd: Number(row.amount_twd),
    pool: row.pool,
    ticker: row.ticker,
    note: row.note,
  };
}

/** The columns a saved cash flow writes; amount_twd is computed by the database. */
export function cashFlowColumns(flow: Omit<CashFlow, 'id'>) {
  return {
    flow_date: flow.flowDate,
    type: flow.type,
    amount: flow.amount,
    currency: flow.currency,
    fx_rate: flow.fxRate,
    pool: flow.pool,
    ticker: flow.ticker,
    note: flow.note,
  };
}

// ---------------------------------------------------------------------------
// Securities and asset classes
// ---------------------------------------------------------------------------

async function loadSecuritiesUncached(supabase: SupabaseClient): Promise<SecurityRecord[]> {
  const securities = await rows<SecurityRow>(
    'securities',
    supabase.from('securities').select('ticker, name, market, product_type, asset_class_id, sleeve, currency, domicile').order('ticker'),
  );
  return securities.map((row) => ({
    ticker: row.ticker,
    name: row.name,
    market: row.market,
    productType: row.product_type,
    assetClassId: row.asset_class_id,
    sleeve: row.sleeve,
    currency: row.currency,
    domicile: row.domicile,
  }));
}

export function toAssetClass(row: AssetClassRow): AssetClass {
  return { id: row.id, nameEn: row.name_en, nameZh: row.name_zh, targetWeight: Number(row.target_weight), sleeve: row.sleeve, sortOrder: row.sort_order };
}

async function loadAssetClassesUncached(supabase: SupabaseClient): Promise<AssetClass[]> {
  const assetClasses = await rows<AssetClassRow>('asset_classes', supabase.from('asset_classes').select('id, name_en, name_zh, target_weight, sleeve, sort_order').order('sort_order'));
  return assetClasses.map(toAssetClass);
}

/** The share an FX rate may stray from the trade date's rate before a warning (config fx_rate_check); null turns the check off. */
export function fxMaxGap(value: unknown): number | null {
  const gap = setting(value, 'max_gap');
  return typeof gap === 'number' && gap > 0 ? gap : null;
}

/**
 * How many days before a trade the rate filled in for it may be (config fx_rate_check); null
 * leaves FX rates to be typed, with the newest known rate as the only suggestion.
 */
export function fxMaxAgeDays(value: unknown): number | null {
  const days = setting(value, 'max_age_days');
  return typeof days === 'number' && Number.isInteger(days) && days >= 0 ? days : null;
}

// ---------------------------------------------------------------------------
// Splits, leverage and the holdings
// ---------------------------------------------------------------------------

interface SplitRow {
  id: number;
  ticker: string;
  ex_date: string;
  ratio: number;
  note: string | null;
}

/** A saved split, with its note. */
export interface SplitRecord extends Split {
  id: number;
  note: string | null;
}

const SPLIT_COLUMNS = 'id, ticker, ex_date, ratio, note';

/**
 * Every split entered, oldest first. Nearly every page reads it, so before its migration is
 * applied (the Data API's PGRST205, table not found) it reads as no splits rather than an error.
 */
async function loadSplitsUncached(supabase: SupabaseClient): Promise<SplitRecord[]> {
  const { data, error } = await supabase.from('splits').select(SPLIT_COLUMNS).order('ex_date').order('id');
  if (error && (error as { code?: string }).code === 'PGRST205') return [];
  if (error) throw new DataError('splits', error.message);
  return ((data ?? []) as SplitRow[]).map((row) => ({ id: row.id, ticker: row.ticker, exDate: row.ex_date, ratio: Number(row.ratio), note: row.note }));
}

/** The trade form's leverage choices and the margin-call warning (config leverage). */
export interface LeverageSettings {
  /** Highest leverage offered, a multiple of 0.1 from 1.0 to 10.0. */
  max: number;
  /** Share of a leveraged or short line's own money left at which the holdings page warns; null turns it off. */
  marginCallShare: number | null;
}

/** config leverage read defensively; before its migration is applied, 1× only and no warning. */
export function leverageSettings(value: unknown): LeverageSettings {
  const max = setting(value, 'max');
  const share = setting(value, 'margin_call_share');
  return {
    max: typeof max === 'number' && max >= 1 && max <= 10 ? Math.round(max * 10) / 10 : 1,
    marginCallShare: typeof share === 'number' && share > 0 && share < 1 ? share : null,
  };
}

/** Everything the holdings page and the trade form need, plus the R1 / R2 thresholds from the rules table. */
export interface HoldingsData extends PortfolioData {
  /** As saved, in the units they were traded in; the models restate them with `splits`. */
  trades: TransactionRecord[];
  splits: SplitRecord[];
  securities: SecurityRecord[];
  caps: Caps;
  fxMaxGap: number | null;
  fxMaxAgeDays: number | null;
  leverage: LeverageSettings;
}

export async function loadHoldingsDataUncached(supabase: SupabaseClient): Promise<HoldingsData> {
  const [transactions, securities, assetClasses, prices, fx, manualAssets, rules, settings, splits] = await Promise.all([
    allRows<TransactionRow>('transactions', (from, to) =>
      supabase.from('transactions').select(TRANSACTION_COLUMNS).order('trade_date', { ascending: false }).order('id', { ascending: false }).range(from, to),
    ),
    loadSecurities(supabase),
    loadAssetClasses(supabase),
    rows<{ ticker: string; price_date: string; close: number }>('latest_prices', supabase.from('latest_prices').select('ticker, price_date, close')),
    rows<{ pair: string; rate_date: string; rate: number }>('latest_fx_rates', supabase.from('latest_fx_rates').select('pair, rate_date, rate')),
    rows<ManualAssetRow>('manual_assets', supabase.from('manual_assets').select(MANUAL_ASSET_COLUMNS).order('id')),
    rows<RuleRow>('rules', supabase.from('rules').select('id, threshold, enabled').in('id', ['R1', 'R2'])),
    rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').in('key', ['fx_rate_check', 'leverage'])),
    loadSplits(supabase),
  ]);
  const fxCheck = settings.find((row) => row.key === 'fx_rate_check')?.value;
  return {
    trades: transactions.map(toTransaction),
    splits,
    securities,
    assetClasses,
    prices: prices.map((row): PriceQuote => ({ ticker: row.ticker, date: row.price_date, close: Number(row.close) })),
    fx: fx.map((row): FxQuote => ({ pair: row.pair, date: row.rate_date, rate: Number(row.rate) })),
    manualAssets: manualAssets.map(toManualAsset),
    caps: capsFromRules(rules),
    fxMaxGap: fxMaxGap(fxCheck),
    fxMaxAgeDays: fxMaxAgeDays(fxCheck),
    leverage: leverageSettings(settings.find((row) => row.key === 'leverage')?.value),
  };
}

/** Every daily TWD rate the nightly job has loaded, gold aside, for the trade date's rate (lib/models/fx). */
async function loadFxHistoryUncached(supabase: SupabaseClient): Promise<FxQuote[]> {
  const found = await allRows<{ pair: string; rate_date: string; rate: number }>('fx_rates', (from, to) =>
    supabase.from('fx_rates').select('pair, rate_date, rate').like('pair', '%/TWD').neq('pair', `${GOLD}/TWD`).order('rate_date').order('pair').range(from, to),
  );
  return found.map((row) => ({ pair: row.pair, date: row.rate_date, rate: Number(row.rate) }));
}

/** The newest gold price in TWD per troy ounce (XAU/TWD), if the nightly job has loaded one. */
export async function loadGoldPrice(supabase: SupabaseClient): Promise<FxQuote | undefined> {
  const [row] = await rows<{ pair: string; rate_date: string; rate: number }>(
    'latest_fx_rates',
    supabase.from('latest_fx_rates').select('pair, rate_date, rate').eq('pair', `${GOLD}/TWD`),
  );
  return row ? { pair: row.pair, date: row.rate_date, rate: Number(row.rate) } : undefined;
}

// ---------------------------------------------------------------------------
// Cash flows, non-listed assets and CSV mappings
// ---------------------------------------------------------------------------

/** The CSV column mappings saved per broker by the import (config keys csv_mapping.*), by broker name. */
export async function loadCsvMappings(supabase: SupabaseClient): Promise<SavedMapping[]> {
  const settings = await rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').like('key', `${MAPPING_PREFIX}%`));
  return settings
    .filter((row) => row.key.startsWith(MAPPING_PREFIX))
    .map((row) => parseSavedMapping(row.value))
    .filter((saved) => saved !== undefined)
    .sort((a, b) => a.broker.localeCompare(b.broker));
}

/** Every cash flow, newest first. */
async function loadCashFlowsUncached(supabase: SupabaseClient): Promise<CashFlowRecord[]> {
  const found = await allRows<CashFlowRow>('cash_flows', (from, to) =>
    supabase.from('cash_flows').select(CASH_FLOW_COLUMNS).order('flow_date', { ascending: false }).order('id', { ascending: false }).range(from, to),
  );
  return found.map(toCashFlow);
}

/** One cash flow, or undefined when the id does not exist. */
export async function loadCashFlow(supabase: SupabaseClient, id: number): Promise<CashFlowRecord | undefined> {
  const [row] = await rows<CashFlowRow>('cash_flows', supabase.from('cash_flows').select(CASH_FLOW_COLUMNS).eq('id', id));
  return row ? toCashFlow(row) : undefined;
}

/** One non-listed asset, or undefined when the id does not exist. */
export async function loadManualAsset(supabase: SupabaseClient, id: number): Promise<ManualAsset | undefined> {
  const [row] = await rows<ManualAssetRow>('manual_assets', supabase.from('manual_assets').select(MANUAL_ASSET_COLUMNS).eq('id', id));
  return row ? toManualAsset(row) : undefined;
}

// One read per request (core.ts).
export const loadSecurities = cache(loadSecuritiesUncached);
export const loadCashFlows = cache(loadCashFlowsUncached);
export const loadAssetClasses = cache(loadAssetClassesUncached);
export const loadSplits = cache(loadSplitsUncached);
export const loadHoldingsData = cache(loadHoldingsDataUncached);
export const loadFxHistory = cache(loadFxHistoryUncached);
