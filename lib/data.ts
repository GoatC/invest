import type { SupabaseClient } from '@supabase/supabase-js';

import type { PortfolioData } from './models/portfolio';
import { capsFromRules, type Caps, type RuleRow } from './models/rules';
import type { AssetClass, FxQuote, ManualAsset, Market, Pool, PriceQuote, ProductType, Security, Side, Sleeve, Trade } from './models/types';

/** A query failed; the table name tells which part of the database to look at. */
export class DataError extends Error {
  constructor(
    readonly table: string,
    readonly detail: string,
  ) {
    super(`${table}: ${detail}`);
    this.name = 'DataError';
  }
}

/** The result, or the DataError a failed read threw, so a form can show it instead of an error page. */
export async function orDataError<T>(promise: Promise<T>): Promise<T | DataError> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof DataError) return err;
    throw err;
  }
}

type Result<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function rows<T>(table: string, query: Result<T>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new DataError(table, error.message);
  return data ?? [];
}

/** The Data API returns at most 1,000 rows per request by default, so long tables are read in pages. */
const PAGE = 1000;

async function allRows<T>(table: string, page: (from: number, to: number) => Result<T>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const batch = await rows(table, page(from, from + PAGE - 1));
    all.push(...batch);
    if (batch.length < PAGE) return all;
  }
}

// ---------------------------------------------------------------------------
// Row shapes as the Data API returns them, and their app-side form
// ---------------------------------------------------------------------------

export interface TransactionRecord extends Trade {
  id: number;
  source: 'manual' | 'csv';
  note: string | null;
}

interface TransactionRow {
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
  source: 'manual' | 'csv';
  note: string | null;
}

export const TRANSACTION_COLUMNS = 'id, trade_date, ticker, side, qty, price, currency, fee, tax, fx_rate, pool, source, note';

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

interface AssetClassRow {
  id: string;
  name_en: string;
  name_zh: string;
  target_weight: number;
  sleeve: Sleeve;
  sort_order: number;
}

interface ManualAssetRow {
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

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export async function loadSecurities(supabase: SupabaseClient): Promise<SecurityRecord[]> {
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

export async function loadAssetClasses(supabase: SupabaseClient): Promise<AssetClass[]> {
  const assetClasses = await rows<AssetClassRow>('asset_classes', supabase.from('asset_classes').select('id, name_en, name_zh, target_weight, sleeve, sort_order').order('sort_order'));
  return assetClasses.map((row) => ({ id: row.id, nameEn: row.name_en, nameZh: row.name_zh, targetWeight: Number(row.target_weight), sleeve: row.sleeve, sortOrder: row.sort_order }));
}

/** The share an FX rate may stray from the newest known one before a warning (config fx_rate_check); null turns the check off. */
export function fxMaxGap(value: unknown): number | null {
  const gap = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)['max_gap'] : undefined;
  return typeof gap === 'number' && gap > 0 ? gap : null;
}

/** Everything the holdings page and the trade form need, plus the R1 / R2 thresholds from the rules table. */
export interface HoldingsData extends PortfolioData {
  trades: TransactionRecord[];
  securities: SecurityRecord[];
  caps: Caps;
  fxMaxGap: number | null;
}

export async function loadHoldingsData(supabase: SupabaseClient): Promise<HoldingsData> {
  const [transactions, securities, assetClasses, prices, fx, manualAssets, rules, settings] = await Promise.all([
    allRows<TransactionRow>('transactions', (from, to) =>
      supabase.from('transactions').select(TRANSACTION_COLUMNS).order('trade_date', { ascending: false }).order('id', { ascending: false }).range(from, to),
    ),
    loadSecurities(supabase),
    loadAssetClasses(supabase),
    rows<{ ticker: string; price_date: string; close: number }>('latest_prices', supabase.from('latest_prices').select('ticker, price_date, close')),
    rows<{ pair: string; rate_date: string; rate: number }>('latest_fx_rates', supabase.from('latest_fx_rates').select('pair, rate_date, rate')),
    rows<ManualAssetRow>('manual_assets', supabase.from('manual_assets').select(MANUAL_ASSET_COLUMNS).order('id')),
    rows<RuleRow>('rules', supabase.from('rules').select('id, threshold, enabled').in('id', ['R1', 'R2'])),
    rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'fx_rate_check')),
  ]);
  return {
    trades: transactions.map(toTransaction),
    securities,
    assetClasses,
    prices: prices.map((row): PriceQuote => ({ ticker: row.ticker, date: row.price_date, close: Number(row.close) })),
    fx: fx.map((row): FxQuote => ({ pair: row.pair, date: row.rate_date, rate: Number(row.rate) })),
    manualAssets: manualAssets.map(toManualAsset),
    caps: capsFromRules(rules),
    fxMaxGap: fxMaxGap(settings[0]?.value),
  };
}

/** One non-listed asset, or undefined when the id does not exist. */
export async function loadManualAsset(supabase: SupabaseClient, id: number): Promise<ManualAsset | undefined> {
  const [row] = await rows<ManualAssetRow>('manual_assets', supabase.from('manual_assets').select(MANUAL_ASSET_COLUMNS).eq('id', id));
  return row ? toManualAsset(row) : undefined;
}

// ---------------------------------------------------------------------------
// Edit history (N5: every entry can be edited or deleted, with an audit log)
// ---------------------------------------------------------------------------

export interface FieldChange {
  column: string;
  before: unknown;
  after: unknown;
}

export interface AuditEntry {
  id: number;
  action: 'insert' | 'update' | 'delete';
  changedAt: string;
  changes: FieldChange[];
}

/** Columns whose value differs between two logged versions of a row; bookkeeping columns are left out. */
export function diffRows(before: Record<string, unknown> | null, after: Record<string, unknown> | null): FieldChange[] {
  const columns = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: FieldChange[] = [];
  for (const column of columns) {
    if (['id', 'created_at', 'updated_at'].includes(column)) continue;
    const old = before?.[column] ?? null;
    const now = after?.[column] ?? null;
    if (JSON.stringify(old) !== JSON.stringify(now)) changes.push({ column, before: old, after: now });
  }
  return changes;
}

export async function loadAuditHistory(supabase: SupabaseClient, table: string, rowKey: string): Promise<AuditEntry[]> {
  const entries = await rows<{ id: number; action: AuditEntry['action']; changed_at: string; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null }>(
    'audit_log',
    supabase.from('audit_log').select('id, action, changed_at, old_row, new_row').eq('table_name', table).eq('row_key', rowKey).order('changed_at', { ascending: false }),
  );
  return entries.map((entry) => ({ id: entry.id, action: entry.action, changedAt: entry.changed_at, changes: diffRows(entry.old_row, entry.action === 'delete' ? null : entry.new_row) }));
}
