import type { SupabaseClient } from '@supabase/supabase-js';

import { MAPPING_PREFIX, parseSavedMapping, type SavedMapping } from './csv/mapping';
import { addDays } from './dates';
import { failureThreshold, NIGHTLY_JOB, parseRunDetail, type JobRun, type RunStatus } from './models/data-health';
import { GOLD } from './models/fx';
import { driftBands, type DriftBands } from './models/allocation';
import { readAssumptions, type Assumptions } from './models/cma';
import { manualHistories } from './models/manual-history';
import { benchmarkWeights, firstDay, type PerformanceInput } from './models/performance';
import type { PortfolioData } from './models/portfolio';
import { candidateProxies, gridStart, lookbackWeeks, readRiskSettings, type RiskInput, type VarPoint } from './models/risk';
import { capsFromRules, type Caps, type RuleRow } from './models/rules';
import type { AssetClass, CashFlow, FlowType, FxQuote, ManualAsset, Market, Pool, PriceQuote, ProductType, Security, Side, Sleeve, Trade } from './models/types';

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

export interface CashFlowRecord extends CashFlow {
  id: number;
  /** amount × fx_rate, as the database computes it. */
  amountTwd: number;
}

interface CashFlowRow {
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

function toAssetClass(row: AssetClassRow): AssetClass {
  return { id: row.id, nameEn: row.name_en, nameZh: row.name_zh, targetWeight: Number(row.target_weight), sleeve: row.sleeve, sortOrder: row.sort_order };
}

export async function loadAssetClasses(supabase: SupabaseClient): Promise<AssetClass[]> {
  const assetClasses = await rows<AssetClassRow>('asset_classes', supabase.from('asset_classes').select('id, name_en, name_zh, target_weight, sleeve, sort_order').order('sort_order'));
  return assetClasses.map(toAssetClass);
}

function setting(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
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

/** Everything the holdings page and the trade form need, plus the R1 / R2 thresholds from the rules table. */
export interface HoldingsData extends PortfolioData {
  trades: TransactionRecord[];
  securities: SecurityRecord[];
  caps: Caps;
  fxMaxGap: number | null;
  fxMaxAgeDays: number | null;
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
    fxMaxAgeDays: fxMaxAgeDays(settings[0]?.value),
  };
}

/** Every daily TWD rate the nightly job has loaded, gold aside, for the trade date's rate (lib/models/fx). */
export async function loadFxHistory(supabase: SupabaseClient): Promise<FxQuote[]> {
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
// Nightly job status (Phase 1, step 4)
// ---------------------------------------------------------------------------

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
export async function loadJobRuns(supabase: SupabaseClient): Promise<{ runs: JobRun[]; threshold: number | null }> {
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

/** What the data status page shows: the runs, and the newest close of every security and rate of every pair. */
export interface DataStatus {
  runs: JobRun[];
  threshold: number | null;
  securities: SecurityRecord[];
  prices: LatestQuote[];
  rates: LatestQuote[];
}

export async function loadDataStatus(supabase: SupabaseClient): Promise<DataStatus> {
  const [{ runs, threshold }, securities, prices, rates] = await Promise.all([
    loadJobRuns(supabase),
    loadSecurities(supabase),
    rows<{ ticker: string; price_date: string; close: number; source: string }>('latest_prices', supabase.from('latest_prices').select('ticker, price_date, close, source')),
    rows<{ pair: string; rate_date: string; rate: number; source: string }>('latest_fx_rates', supabase.from('latest_fx_rates').select('pair, rate_date, rate, source').order('pair')),
  ]);
  return {
    runs,
    threshold,
    securities,
    prices: prices.map((row) => ({ key: row.ticker, date: row.price_date, value: Number(row.close), source: row.source })),
    rates: rates.map((row) => ({ key: row.pair, date: row.rate_date, value: Number(row.rate), source: row.source })),
  };
}

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
export async function loadCashFlows(supabase: SupabaseClient): Promise<CashFlowRecord[]> {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Columns whose value differs between two logged versions of a row; bookkeeping columns are left
 * out. A JSON setting that changed is opened one level, as "column.key", so its history names the
 * part that changed rather than repeating the whole setting.
 */
export function diffRows(before: Record<string, unknown> | null, after: Record<string, unknown> | null): FieldChange[] {
  const columns = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: FieldChange[] = [];
  for (const column of columns) {
    if (['id', 'created_at', 'updated_at'].includes(column)) continue;
    const old = before?.[column] ?? null;
    const now = after?.[column] ?? null;
    if (JSON.stringify(old) === JSON.stringify(now)) continue;
    if (before && after && isPlainObject(old) && isPlainObject(now)) {
      for (const key of new Set([...Object.keys(old), ...Object.keys(now)])) {
        const was = old[key] ?? null;
        const is = now[key] ?? null;
        if (JSON.stringify(was) !== JSON.stringify(is)) changes.push({ column: `${column}.${key}`, before: was, after: is });
      }
    } else changes.push({ column, before: old, after: now });
  }
  return changes;
}

interface AuditRow {
  id: number;
  table_name: string;
  row_key: string;
  action: AuditEntry['action'];
  changed_at: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}

/** One line of the whole edit history, with the row it concerns. */
export interface LogEntry extends AuditEntry {
  table: string;
  rowKey: string;
  /** The row after the edit, or as it was when deleted. */
  row: Record<string, unknown> | null;
}

/** Entries per page of the edit history. */
export const LOG_PAGE = 50;

/** Every logged edit and delete, newest first, one page at a time; `more` says whether older entries exist. */
export async function loadAuditLog(supabase: SupabaseClient, page: number): Promise<{ entries: LogEntry[]; more: boolean }> {
  const from = page * LOG_PAGE;
  // One row past the page tells whether there is another page.
  const found = await rows<AuditRow>(
    'audit_log',
    supabase
      .from('audit_log')
      .select('id, table_name, row_key, action, changed_at, old_row, new_row')
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + LOG_PAGE),
  );
  return { entries: found.slice(0, LOG_PAGE).map(toLogEntry), more: found.length > LOG_PAGE };
}

function toLogEntry(entry: AuditRow): LogEntry {
  return {
    id: entry.id,
    action: entry.action,
    changedAt: entry.changed_at,
    changes: entry.action === 'update' ? diffRows(entry.old_row, entry.new_row) : [],
    table: entry.table_name,
    rowKey: entry.row_key,
    row: entry.action === 'delete' ? entry.old_row : (entry.new_row ?? entry.old_row),
  };
}

/** The newest logged edits of one table, every row of it: the asset classes' targets, say. */
export async function loadTableLog(supabase: SupabaseClient, table: string): Promise<LogEntry[]> {
  const found = await rows<AuditRow>(
    'audit_log',
    supabase
      .from('audit_log')
      .select('id, table_name, row_key, action, changed_at, old_row, new_row')
      .eq('table_name', table)
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LOG_PAGE),
  );
  return found.map(toLogEntry);
}

export async function loadAuditHistory(supabase: SupabaseClient, table: string, rowKey: string): Promise<AuditEntry[]> {
  const entries = await rows<{ id: number; action: AuditEntry['action']; changed_at: string; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null }>(
    'audit_log',
    supabase.from('audit_log').select('id, action, changed_at, old_row, new_row').eq('table_name', table).eq('row_key', rowKey).order('changed_at', { ascending: false }),
  );
  return entries.map((entry) => ({ id: entry.id, action: entry.action, changedAt: entry.changed_at, changes: diffRows(entry.old_row, entry.action === 'delete' ? null : entry.new_row) }));
}

// ---------------------------------------------------------------------------
// F18 performance (Phase 1, step 5)
// ---------------------------------------------------------------------------

/** Days of closes and rates read before the first day, so a start on a weekend or holiday has one. */
const LEAD_DAYS = 14;
/** The gold ETF that extends the gold price back before the nightly job saved one (lib/models/market). */
const GOLD_PROXY = 'GLDM';

/**
 * Everything F18 needs to value the portfolio on each day up to `end`: every trade, the recorded
 * dividends, each non-listed asset's history replayed from the edit log, the SAA benchmark, and
 * the closes and rates from shortly before the first day on. The performance page and the
 * nightly job's NAV snapshots both read it.
 */
export async function loadPerformanceInput(supabase: SupabaseClient, end: string): Promise<PerformanceInput> {
  const [transactions, dividends, manualAssets, audit, securities, assetClasses] = await Promise.all([
    allRows<TransactionRow>('transactions', (from, to) => supabase.from('transactions').select(TRANSACTION_COLUMNS).order('trade_date').order('id').range(from, to)),
    allRows<CashFlowRow>('cash_flows', (from, to) => supabase.from('cash_flows').select(CASH_FLOW_COLUMNS).eq('type', 'dividend').order('flow_date').order('id').range(from, to)),
    rows<ManualAssetRow & { created_at: string }>('manual_assets', supabase.from('manual_assets').select(`${MANUAL_ASSET_COLUMNS}, created_at`).order('id')),
    allRows<AuditRow>('audit_log', (from, to) =>
      supabase
        .from('audit_log')
        .select('id, table_name, row_key, action, changed_at, old_row, new_row')
        .eq('table_name', 'manual_assets')
        .order('changed_at')
        .order('id')
        .range(from, to),
    ),
    loadSecurities(supabase),
    rows<{ target_weight: number; benchmark_ticker: string | null }>('asset_classes', supabase.from('asset_classes').select('target_weight, benchmark_ticker')),
  ]);
  const trades = transactions.map(toTransaction);
  const histories = manualHistories(
    manualAssets.map((row) => ({ ...toManualAsset(row), createdAt: row.created_at })),
    audit.map((row) => ({ rowKey: row.row_key, action: row.action, changedAt: row.changed_at, oldRow: row.old_row, newRow: row.new_row })),
  );
  const benchmark = benchmarkWeights(assetClasses.map((row) => ({ targetWeight: Number(row.target_weight), benchmarkTicker: row.benchmark_ticker })));
  const input: PerformanceInput = { end, trades, cashFlows: dividends.map(toCashFlow), manualAssets: histories, securities, benchmark, prices: [], rates: [] };
  const start = firstDay(input);
  if (!start || start > end) return input;

  const since = addDays(start, -LEAD_DAYS);
  const tickers = [...new Set([...trades.map((trade) => trade.ticker), ...benchmark.map((proxy) => proxy.ticker), GOLD_PROXY])].sort();
  const [prices, rates] = await Promise.all([
    allRows<{ ticker: string; price_date: string; close: number; adj_close: number | null }>('prices', (from, to) =>
      supabase
        .from('prices')
        .select('ticker, price_date, close, adj_close')
        .in('ticker', tickers)
        .gte('price_date', since)
        .lte('price_date', end)
        .order('ticker')
        .order('price_date')
        .range(from, to),
    ),
    allRows<{ pair: string; rate_date: string; rate: number }>('fx_rates', (from, to) =>
      supabase.from('fx_rates').select('pair, rate_date, rate').like('pair', '%/TWD').gte('rate_date', since).lte('rate_date', end).order('pair').order('rate_date').range(from, to),
    ),
  ]);
  return {
    ...input,
    prices: prices.map((row) => ({ ticker: row.ticker, date: row.price_date, close: Number(row.close), adjClose: row.adj_close === null ? null : Number(row.adj_close) })),
    rates: rates.map((row) => ({ pair: row.pair, date: row.rate_date, rate: Number(row.rate) })),
  };
}

// ---------------------------------------------------------------------------
// F6 targets and N6 allocation (Phase 1, step 6)
// ---------------------------------------------------------------------------

/** An asset class with the benchmark ETF its returns are measured against (F6, F18, N4). */
export interface AssetClassSettings extends AssetClass {
  benchmarkTicker: string | null;
}

export async function loadAssetClassSettings(supabase: SupabaseClient): Promise<AssetClassSettings[]> {
  const found = await rows<AssetClassRow & { benchmark_ticker: string | null }>(
    'asset_classes',
    supabase.from('asset_classes').select('id, name_en, name_zh, target_weight, sleeve, sort_order, benchmark_ticker').order('sort_order'),
  );
  return found.map((row) => ({ ...toAssetClass(row), benchmarkTicker: row.benchmark_ticker }));
}

/** The capital market assumptions (config cma) and when they were last reviewed; missing is undefined. */
export async function loadAssumptions(supabase: SupabaseClient): Promise<{ assumptions: Assumptions; verifiedOn: string | null } | undefined> {
  const [row] = await rows<{ value: unknown; last_verified: string | null }>('config', supabase.from('config').select('value, last_verified').eq('key', 'cma'));
  return row ? { assumptions: readAssumptions(row.value), verifiedOn: row.last_verified } : undefined;
}

/** R1 and R2 as the rules table holds them. */
export async function loadCaps(supabase: SupabaseClient): Promise<Caps> {
  return capsFromRules(await rows<RuleRow>('rules', supabase.from('rules').select('id, threshold, enabled').in('id', ['R1', 'R2'])));
}

/** The holdings, plus the targets' benchmarks, F8's drift band and the assumptions. */
export interface AllocationData extends HoldingsData {
  classSettings: AssetClassSettings[];
  /** Undefined while the F8_DRIFT rule is off. */
  bands: DriftBands | undefined;
  /** Undefined until the step 6 migration is applied. */
  assumptions: { assumptions: Assumptions; verifiedOn: string | null } | undefined;
}

export async function loadAllocationData(supabase: SupabaseClient): Promise<AllocationData> {
  const [holdings, classSettings, drift, display, assumptions] = await Promise.all([
    loadHoldingsData(supabase),
    loadAssetClassSettings(supabase),
    rows<RuleRow>('rules', supabase.from('rules').select('id, threshold, enabled').eq('id', 'F8_DRIFT')),
    rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'drift_display')),
    loadAssumptions(supabase),
  ]);
  return { ...holdings, classSettings, bands: driftBands(drift[0], display[0]?.value), assumptions };
}

// ---------------------------------------------------------------------------
// N4 Value at Risk (Phase 1, step 7)
// ---------------------------------------------------------------------------

/** Days before the window's first Friday read too, so a week without trading there still finds a close. */
const RISK_LEAD_DAYS = 14;

/**
 * What the VaR reads besides the holdings: config var, each class's benchmark (its proxy), every
 * candidate proxy, and their weekly closes (weekly_prices) and the TWD rates, from the window
 * before `from` to `to`. The risk page and the holdings card read it for today; the nightly job
 * from its first snapshot day, so every day has its own three years.
 */
export async function loadRiskInput(supabase: SupabaseClient, from: string, to: string): Promise<RiskInput> {
  const [settings, classes, securities] = await Promise.all([
    rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'var')),
    rows<{ id: string; benchmark_ticker: string | null }>('asset_classes', supabase.from('asset_classes').select('id, benchmark_ticker')),
    rows<{ ticker: string; product_type: ProductType; currency: string }>('securities', supabase.from('securities').select('ticker, product_type, currency')),
  ]);
  const parsed = readRiskSettings(settings[0]?.value);
  const benchmarks = new Map(classes.map((row) => [row.id, row.benchmark_ticker]));
  const proxies = candidateProxies(
    benchmarks,
    securities.map((row) => ({ ticker: row.ticker, productType: row.product_type, currency: row.currency })),
  );
  const input: RiskInput = { settings: parsed, benchmarks, proxies, prices: [], rates: [] };
  if (!parsed || proxies.size === 0) return input;

  const since = addDays(gridStart(from, lookbackWeeks(parsed)), -RISK_LEAD_DAYS);
  const [prices, rates] = await Promise.all([
    allRows<{ ticker: string; price_date: string; close: number; adj_close: number | null }>('weekly_prices', (start, end) =>
      supabase
        .from('weekly_prices')
        .select('ticker, price_date, close, adj_close')
        .in('ticker', [...proxies.keys()])
        .gte('week_ending', since)
        .lte('price_date', to)
        .order('ticker')
        .order('price_date')
        .range(start, end),
    ),
    allRows<{ pair: string; rate_date: string; rate: number }>('fx_rates', (start, end) =>
      supabase
        .from('fx_rates')
        .select('pair, rate_date, rate')
        .like('pair', '%/TWD')
        .neq('pair', `${GOLD}/TWD`)
        .gte('rate_date', since)
        .lte('rate_date', to)
        .order('pair')
        .order('rate_date')
        .range(start, end),
    ),
  ]);
  return {
    ...input,
    prices: prices.map((row) => ({ ticker: row.ticker, date: row.price_date, close: Number(row.close), adjClose: row.adj_close === null ? null : Number(row.adj_close) })),
    rates: rates.map((row) => ({ pair: row.pair, date: row.rate_date, rate: Number(row.rate) })),
  };
}

/** The VaR's inputs for today, and the daily VaR the nightly job saved over the last 52 weeks. */
export interface RiskData {
  input: RiskInput;
  saved: VarPoint[];
}

export async function loadRiskData(supabase: SupabaseClient, today: string): Promise<RiskData> {
  const [input, saved] = await Promise.all([
    loadRiskInput(supabase, today, today),
    rows<{ snapshot_date: string; total_twd: number; var_95_1w: number | null }>(
      'nav_snapshots',
      supabase
        .from('nav_snapshots')
        .select('snapshot_date, total_twd, var_95_1w')
        .gt('snapshot_date', addDays(today, -7 * 52))
        .lte('snapshot_date', today)
        .not('var_95_1w', 'is', null)
        .order('snapshot_date'),
    ),
  ]);
  return {
    input,
    saved: saved.map((row) => ({ date: row.snapshot_date, valueAtRisk: Number(row.var_95_1w), totalTwd: Number(row.total_twd) })),
  };
}
