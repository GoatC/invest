import type { SupabaseClient } from '@supabase/supabase-js';

import { MAPPING_PREFIX, parseSavedMapping, type SavedMapping } from './csv/mapping';
import { addDays, addMonths } from './dates';
import { dataHealth, failureThreshold, NIGHTLY_JOB, parseRunDetail, type JobRun, type RunStatus } from './models/data-health';
import { GOLD } from './models/fx';
import { driftBands, type DriftBands } from './models/allocation';
import { mixReturn, readAssumptions, type Assumptions } from './models/cma';
import { readBrokers, readFeeSettings, readFundCosts, readTaxSettings, type Broker, type CostSettings, type FeeSettings, type FundCost, type TaxSettings } from './models/costs';
import {
  evaluate,
  readDetail,
  readOrders,
  type ClosedReason,
  type DraftOrder,
  type EngineInput,
  type EngineQuote,
  type EngineRule,
  type FiredTier,
  type Outcome,
  type ProposalDetail,
  type ProposalRecord,
  type ProposalStatus,
  type WatchInput,
  type WindfallInput,
  type WindfallTranche,
} from './models/engine';
import { manualHistories } from './models/manual-history';
import { benchmarkWeights, firstDay, type PerformanceInput } from './models/performance';
import { buildPortfolio, type PortfolioData } from './models/portfolio';
import { readPlanSettings, type PlanSettings } from './models/projection';
import { readQuietHours, readWeeklyReview, weeklySummary, type Message, type PlanInput, type ProposalForPush, type WeeklySummary } from './models/notify';
import { proposalTitle } from './proposal-text';
import { pushToAll, type DeviceSubscription, type PushResult, type Sender, type Vapid } from './push';
import { candidateProxies, gridStart, lookbackWeeks, readRiskSettings, type RiskInput, type VarPoint } from './models/risk';
import { capsFromRules, type Caps, type RuleRow } from './models/rules';
import { latestFx, latestPrices } from './models/valuation';
import { INDICES, loadFrom, readRegressionSettings, regressTicker, RISK_FREE_SERIES, type Close as SeriesClose, type RegressionSettings } from './models/regression';
import { MARKET_SERIES } from './models/windfall';
import { CAPM_SERIES, readCapmSettings, stockCostOfEquity, type BetaInput, type CapmSettings, type CostOutcome, type MonthValue } from './models/capm';
import type { AssetClass, CashFlow, FlowType, FxQuote, ManualAsset, Market, Pool, PriceQuote, ProductType, Security, Side, Sleeve, Trade } from './models/types';
import type { Figures, Quarter } from './models/fundamentals';
import { assumed, readAssumptions as readStockAssumptions, readValuationSettings, valueStock, type Assumed, type StockAssumptions, type Valuation, type ValuationSettings } from './models/intrinsic';
import { filedSince, readSaved, valuationInput, valuationRows, watchInputs, type InputProblem, type SavedValuation, type StockSeries, type Trigger } from './models/workbench';
import {
  assess,
  EVENT_INDICATORS,
  readRedFlagSettings,
  readScans,
  scanDue,
  scanRows,
  type Assessment,
  type CompanyInput,
  type EventIndicator,
  type FlagEvent,
  type ManualEntry,
  type ManualIndicator,
  type Profile,
  type RedFlagSettings,
  type Scan,
} from './models/red-flags';

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
      [...MARKET_SERIES, ...Object.values(RISK_FREE_SERIES), ...Object.values(CAPM_SERIES)].map((name) =>
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

// ---------------------------------------------------------------------------
// F2 compounding calculator (Phase 1, step 8)
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

export async function loadPlanData(supabase: SupabaseClient, today: string): Promise<PlanData> {
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
// Rules engine and proposals (Phase 1, step 9)
// ---------------------------------------------------------------------------

/** A rule as the rules table holds it. */
export interface RuleRecord extends EngineRule {
  feature: string;
  descEn: string;
  descZh: string;
  action: string;
  updatedAt: string;
}

export async function loadRules(supabase: SupabaseClient): Promise<RuleRecord[]> {
  const found = await rows<{
    id: string;
    feature: string;
    desc_en: string;
    desc_zh: string;
    condition: string;
    threshold: unknown;
    action: string;
    cooldown_days: number;
    enabled: boolean;
    updated_at: string;
  }>('rules', supabase.from('rules').select('id, feature, desc_en, desc_zh, condition, threshold, action, cooldown_days, enabled, updated_at').order('id'));
  return found.map((row) => ({
    id: row.id,
    feature: row.feature,
    descEn: row.desc_en,
    descZh: row.desc_zh,
    condition: row.condition,
    threshold: row.threshold,
    action: row.action,
    cooldownDays: Number(row.cooldown_days),
    enabled: row.enabled,
    updatedAt: row.updated_at,
  }));
}

/** One edit to a rule, from rule_changes. */
export interface RuleChange {
  id: number;
  ruleId: string;
  changedAt: string;
  changes: FieldChange[];
}

export async function loadRuleChanges(supabase: SupabaseClient): Promise<RuleChange[]> {
  const found = await rows<{ id: number; rule_id: string; changed_at: string; old_value: Record<string, unknown>; new_value: Record<string, unknown> }>(
    'rule_changes',
    supabase.from('rule_changes').select('id, rule_id, changed_at, old_value, new_value').order('changed_at', { ascending: false }).order('id', { ascending: false }).limit(200),
  );
  return found.map((row) => ({ id: row.id, ruleId: row.rule_id, changedAt: row.changed_at, changes: diffRows(row.old_value, row.new_value) }));
}

/** A saved proposal. */
export interface Proposal extends ProposalRecord {
  orders: DraftOrder[];
  detail: ProposalDetail;
  dismissReason: string | null;
  decidedAt: string | null;
  filledAt: string | null;
  closedReason: ClosedReason | null;
}

const PROPOSAL_COLUMNS = 'id, rule_id, state, status, created_at, expires_at, orders, detail, dismiss_reason, decided_at, filled_at, closed_reason';

interface ProposalRow {
  id: number;
  rule_id: string;
  state: string;
  status: ProposalStatus;
  created_at: string;
  expires_at: string | null;
  orders: unknown;
  detail: unknown;
  dismiss_reason: string | null;
  decided_at: string | null;
  filled_at: string | null;
  closed_reason: ClosedReason | null;
}

function toProposal(row: ProposalRow): Proposal {
  return {
    id: Number(row.id),
    ruleId: row.rule_id,
    state: row.state,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    orders: readOrders(row.orders),
    detail: readDetail(row.detail),
    dismissReason: row.dismiss_reason,
    decidedAt: row.decided_at,
    filledAt: row.filled_at,
    closedReason: row.closed_reason,
  };
}

/** How far back the engine and the page read decided proposals: past a year's review. */
const PROPOSAL_DAYS = 400;

/** Every open and approved proposal, and the others of the last 400 days, newest first. */
export async function loadProposals(supabase: SupabaseClient, today: string): Promise<Proposal[]> {
  const since = addDays(today, -PROPOSAL_DAYS);
  const found = await rows<ProposalRow>(
    'proposals',
    supabase
      .from('proposals')
      .select(PROPOSAL_COLUMNS)
      .or(`status.in.(open,approved),created_at.gte.${since}`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
  );
  return found.map(toProposal);
}

export async function loadProposal(supabase: SupabaseClient, id: number): Promise<Proposal | undefined> {
  const [row] = await rows<ProposalRow>('proposals', supabase.from('proposals').select(PROPOSAL_COLUMNS).eq('id', id));
  return row ? toProposal(row) : undefined;
}

/** How share counts are rounded in draft orders (config orders): fractions for these markets, to these decimals. */
export interface OrderSettings {
  fractionalMarkets: Market[];
  shareDecimals: number;
}

/** config orders, read defensively: without it, every order is in whole shares. */
export function orderSettings(value: unknown): OrderSettings {
  const markets = setting(value, 'fractional_markets');
  const decimals = setting(value, 'share_decimals');
  return {
    fractionalMarkets: Array.isArray(markets) ? markets.filter((market): market is Market => market === 'US' || market === 'UK' || market === 'TW') : [],
    shareDecimals: typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 1 && decimals <= 4 ? decimals : 0,
  };
}

/** The latest close and TWD rate of every security that has both, with the decimals its orders may have. */
export function engineQuotes(data: PortfolioData, orders: OrderSettings = { fractionalMarkets: [], shareDecimals: 0 }): Map<string, EngineQuote> {
  const prices = latestPrices(data.prices, data.trades);
  const fx = latestFx(data.fx, data.trades);
  const out = new Map<string, EngineQuote>();
  for (const security of data.securities) {
    const price = prices.get(security.ticker);
    const rate = fx.get(security.currency);
    const decimals = orders.fractionalMarkets.includes(security.market) ? orders.shareDecimals : 0;
    if (price && rate) out.set(security.ticker, { price: price.value, currency: security.currency, fxRate: rate.value, decimals });
  }
  return out;
}

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
  const [watch, redFlags] = await Promise.all([loadWatchInputs(supabase, data.securities), loadFlagInputs(supabase, today, data)]);
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
  };
  return { input, rules, proposals, orders: orderSettings(value('orders')) };
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
    const { error } = await supabase.from('proposals').insert({ rule_id: draft.ruleId, state: draft.state, orders: draft.orders, detail: draft.detail, expires_at: draft.expiresAt });
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

// ---------------------------------------------------------------------------
// Web Push and the weekly review (Phase 1, step 10)
// ---------------------------------------------------------------------------

/** Both pools' value at the newest NAV snapshot up to `today`, and at the newest one a week or more before it. */
export async function loadValueWeek(supabase: SupabaseClient, today: string): Promise<{ valueTwd: number | null; weekAgoTwd: number | null }> {
  const latest = await rows<{ snapshot_date: string; total_twd: number }>(
    'nav_snapshots',
    supabase.from('nav_snapshots').select('snapshot_date, total_twd').lte('snapshot_date', today).order('snapshot_date', { ascending: false }).limit(1),
  );
  const newest = latest[0];
  if (!newest) return { valueTwd: null, weekAgoTwd: null };
  const weekAgo = await rows<{ total_twd: number }>(
    'nav_snapshots',
    supabase.from('nav_snapshots').select('total_twd').lte('snapshot_date', addDays(newest.snapshot_date, -7)).order('snapshot_date', { ascending: false }).limit(1),
  );
  return { valueTwd: Number(newest.total_twd), weekAgoTwd: weekAgo[0] ? Number(weekAgo[0].total_twd) : null };
}

/**
 * The weekly review's three figures (PRD Section 5): proposals waiting, the core class furthest
 * from its target in the regular pool as held now, and both pools' value at the newest NAV
 * snapshot against the one a week before it.
 */
export async function loadWeeklySummary(supabase: SupabaseClient, today: string): Promise<WeeklySummary> {
  const [holdings, proposals, value] = await Promise.all([
    loadHoldingsData(supabase),
    rows<{ status: ProposalStatus }>('proposals', supabase.from('proposals').select('status').in('status', ['open', 'approved'])),
    loadValueWeek(supabase, today),
  ]);
  const portfolio = buildPortfolio(holdings);
  return weeklySummary({ statuses: proposals.map((row) => row.status), classes: portfolio.classes, poolTwd: portfolio.pool.totalTwd, ...value });
}

/** Everything the push plan reads besides the time (lib/models/notify.ts plan). */
export async function loadNotifyInput(supabase: SupabaseClient, today: string): Promise<Omit<PlanInput, 'now'>> {
  const [proposals, rules, classes, config, planned, summary, jobs] = await Promise.all([
    loadProposals(supabase, today),
    loadRules(supabase),
    loadAssetClasses(supabase),
    rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').in('key', ['quiet_hours', 'weekly_review'])),
    rows<{ kind: string; key: string }>('notifications', supabase.from('notifications').select('kind, key').in('kind', ['proposal', 'weekly']).gte('created_at', addDays(today, -400))),
    loadWeeklySummary(supabase, today),
    loadJobRuns(supabase),
  ]);
  const value = (key: string) => config.find((row) => row.key === key)?.value;
  const pushed = new Set(planned.filter((row) => row.kind === 'proposal').map((row) => row.key));
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const open: ProposalForPush[] = proposals
    .filter((proposal) => proposal.status === 'open' && !pushed.has(String(proposal.id)))
    .map((proposal) => {
      const rule = byId.get(proposal.ruleId) ?? { id: proposal.ruleId, condition: '' };
      return { id: proposal.id, ruleId: proposal.ruleId, condition: rule.condition, title: proposalTitle(rule), state: proposal.state, detail: proposal.detail };
    });
  return {
    proposals: open,
    names: new Map(classes.map((assetClass) => [assetClass.id, { en: assetClass.nameEn, zh: assetClass.nameZh }])),
    weekly: readWeeklyReview(value('weekly_review')),
    weeklyKeys: new Set(planned.filter((row) => row.kind === 'weekly').map((row) => row.key)),
    summary,
    health: dataHealth(jobs.runs, jobs.threshold, today),
    lastGoodRunId: jobs.runs.find((run) => run.status !== 'failed')?.id ?? null,
    quiet: readQuietHours(value('quiet_hours')),
  };
}

/** A planned or sent push, as the notifications table holds it. */
export interface NotificationRecord extends Message {
  id: number;
  createdAt: string;
  sendAfter: string;
  sentAt: string | null;
  delivered: number | null;
  error: string | null;
}

const NOTIFICATION_COLUMNS = 'id, kind, key, title, body, url, created_at, send_after, sent_at, delivered, error';

interface NotificationRow {
  id: number;
  kind: Message['kind'];
  key: string;
  title: string;
  body: string;
  url: string;
  created_at: string;
  send_after: string;
  sent_at: string | null;
  delivered: number | null;
  error: string | null;
}

function toNotification(row: NotificationRow): NotificationRecord {
  return {
    id: Number(row.id),
    kind: row.kind,
    key: row.key,
    title: row.title,
    body: row.body,
    url: row.url,
    createdAt: row.created_at,
    sendAfter: row.send_after,
    sentAt: row.sent_at,
    delivered: row.delivered,
    error: row.error,
  };
}

/** Plans pushes; one already planned (same kind and key) is left as it is. Returns how many are new. */
export async function planNotifications(supabase: SupabaseClient, messages: ReadonlyArray<Message & { sendAfter: Date }>): Promise<number> {
  if (messages.length === 0) return 0;
  const { data, error } = await supabase
    .from('notifications')
    .upsert(
      messages.map((message) => ({ kind: message.kind, key: message.key, title: message.title, body: message.body, url: message.url, send_after: message.sendAfter.toISOString() })),
      { onConflict: 'kind,key', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new DataError('notifications', error.message);
  return data?.length ?? 0;
}

/** Pushes planned and not sent, whose time has come, oldest first. */
export async function dueNotifications(supabase: SupabaseClient, now: Date): Promise<NotificationRecord[]> {
  const found = await rows<NotificationRow>(
    'notifications',
    supabase.from('notifications').select(NOTIFICATION_COLUMNS).is('sent_at', null).lte('send_after', now.toISOString()).order('id'),
  );
  return found.map(toNotification);
}

/** The newest pushes, for the notifications page. */
export async function loadNotifications(supabase: SupabaseClient, limit = 30): Promise<NotificationRecord[]> {
  const found = await rows<NotificationRow>('notifications', supabase.from('notifications').select(NOTIFICATION_COLUMNS).order('id', { ascending: false }).limit(limit));
  return found.map(toNotification);
}

/** A device the owner turned notifications on for. */
export interface DeviceRecord extends DeviceSubscription {
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  lastError: string | null;
}

export async function loadDevices(supabase: SupabaseClient): Promise<DeviceRecord[]> {
  const found = await rows<{ id: number; endpoint: string; keys: { p256dh: string; auth: string }; device_name: string | null; created_at: string; last_used_at: string | null; last_error: string | null }>(
    'push_subscriptions',
    supabase.from('push_subscriptions').select('id, endpoint, keys, device_name, created_at, last_used_at, last_error').order('id'),
  );
  return found.map((row) => ({
    id: Number(row.id),
    endpoint: row.endpoint,
    keys: row.keys,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
  }));
}

/**
 * Sends one planned push to every device, once: the row is claimed first, so two jobs at once
 * cannot both send it. A proposal decided before its push went out is skipped. Devices the push
 * service says are gone are removed. Returns the outcome, or undefined when another run had it.
 */
export async function sendNotification(supabase: SupabaseClient, notification: NotificationRecord, vapid: Vapid, send?: Sender): Promise<(PushResult & { skipped?: boolean }) | undefined> {
  const now = new Date().toISOString();
  const claimed = await supabase.from('notifications').update({ sent_at: now }).eq('id', notification.id).is('sent_at', null).select('id');
  if (claimed.error) throw new DataError('notifications', claimed.error.message);
  if (!claimed.data || claimed.data.length === 0) return undefined;
  const finish = async (delivered: number, error: string | null) => {
    const { error: updateError } = await supabase.from('notifications').update({ delivered, error }).eq('id', notification.id);
    if (updateError) throw new DataError('notifications', updateError.message);
  };
  if (notification.kind === 'proposal') {
    const [proposal] = await rows<{ status: string }>('proposals', supabase.from('proposals').select('status').eq('id', Number(notification.key)));
    if (proposal?.status !== 'open') {
      await finish(0, 'skipped: the proposal was decided first');
      return { delivered: [], gone: [], errors: [], skipped: true };
    }
  }
  const devices = await loadDevices(supabase);
  if (devices.length === 0) {
    await finish(0, 'no devices');
    return { delivered: [], gone: [], errors: [] };
  }
  const result = await pushToAll(devices, { title: notification.title, body: notification.body, url: notification.url, tag: `${notification.kind}-${notification.key}` }, vapid, send);
  if (result.gone.length > 0) {
    const { error } = await supabase.from('push_subscriptions').delete().in('id', result.gone);
    if (error) throw new DataError('push_subscriptions', error.message);
  }
  if (result.delivered.length > 0) {
    const { error } = await supabase.from('push_subscriptions').update({ last_used_at: now, last_error: null }).in('id', result.delivered);
    if (error) throw new DataError('push_subscriptions', error.message);
  }
  await finish(result.delivered.length, result.errors.length > 0 ? result.errors.join('; ') : result.gone.length > 0 ? `${result.gone.length} device(s) gone, removed` : null);
  return result;
}

// ---------------------------------------------------------------------------
// F15 fee and tax drag (Phase 1, step 11)
// ---------------------------------------------------------------------------

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

export async function loadCostConfig(supabase: SupabaseClient): Promise<CostConfig> {
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

export async function loadFeeContext(supabase: SupabaseClient): Promise<FeeContext> {
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

// ---------------------------------------------------------------------------
// F3 windfall tranche planner (Phase 2, step 1)
// ---------------------------------------------------------------------------

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
export async function loadWindfallPlan(supabase: SupabaseClient): Promise<WindfallPlanRecord | undefined> {
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

export interface SeriesPoint {
  month: string;
  value: number;
}

/** Every month of the market series (market_series), oldest first; a few thousand rows, read in pages. */
export async function loadMarketSeries(supabase: SupabaseClient): Promise<{ series: Record<string, SeriesPoint[]>; sources: Record<string, string> }> {
  const found = await allRows<{ series: string; obs_month: string; value: number; source: string }>('market_series', (from, to) =>
    supabase.from('market_series').select('series, obs_month, value, source').order('series').order('obs_month').range(from, to),
  );
  const series: Record<string, SeriesPoint[]> = {};
  const sources: Record<string, string> = {};
  for (const row of found) {
    (series[row.series] ??= []).push({ month: row.obs_month.slice(0, 7), value: Number(row.value) });
    sources[row.series] = row.source;
  }
  return { series, sources };
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

// ---------------------------------------------------------------------------
// N1 Regression Lab (Phase 2, step 2)
// ---------------------------------------------------------------------------

export interface RegressionSetup {
  /** config regression; undefined when missing or malformed (before the migration, say). */
  settings: RegressionSettings | undefined;
  securities: SecurityRecord[];
  /** Every ticker with a close, and its newest close's date. */
  priced: Map<string, string>;
}

export interface RegressionData extends RegressionSetup {
  closes: Map<string, SeriesClose[]>;
  indices: Map<string, SeriesClose[]>;
  fx: Map<string, SeriesClose[]>;
  riskFree: Map<string, Map<string, number>>;
}

/** config regression's raw value; undefined when the row is missing. */
async function regressionConfig(supabase: SupabaseClient): Promise<unknown> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'regression'));
  return found[0]?.value;
}

/** The settings, the securities and which of them have closes. */
export async function loadRegressionSetup(supabase: SupabaseClient): Promise<RegressionSetup> {
  const [config, securities, latest] = await Promise.all([
    regressionConfig(supabase),
    loadSecurities(supabase),
    rows<{ ticker: string; price_date: string }>('latest_prices', supabase.from('latest_prices').select('ticker, price_date')),
  ]);
  return { settings: readRegressionSettings(config), securities, priced: new Map(latest.map((row) => [row.ticker, row.price_date])) };
}

/** The tickers' adjusted closes, the indices', the TWD rates and the bill rate from `from` on. */
export async function loadRegressionData(supabase: SupabaseClient, tickers: readonly string[], from: string, setup?: RegressionSetup): Promise<RegressionData> {
  const base = setup ?? (await loadRegressionSetup(supabase));
  const { settings, securities } = base;
  const known = new Map(securities.map((security) => [security.ticker, security]));
  const wanted = [...new Set(tickers)].filter((ticker) => known.has(ticker));
  const currencies = [...new Set([...wanted.map((ticker) => known.get(ticker)?.currency ?? 'TWD'), ...(settings?.benchmarks.map((benchmark) => benchmark.currency) ?? [])])].filter((currency) => currency !== 'TWD');
  const [closeRows, indexRows, rateRows, billRows] = await Promise.all([
    Promise.all(
      wanted.map((ticker) =>
        allRows<{ price_date: string; close: number; adj_close: number | null }>('prices', (start, end) =>
          supabase.from('prices').select('price_date, close, adj_close').eq('ticker', ticker).gte('price_date', from).order('price_date').range(start, end),
        ),
      ),
    ),
    settings
      ? allRows<{ index_id: string; price_date: string; close: number }>('index_prices', (start, end) =>
          supabase.from('index_prices').select('index_id, price_date, close').gte('price_date', from).order('index_id').order('price_date').range(start, end),
        )
      : Promise.resolve([]),
    Promise.all(
      currencies.map((currency) =>
        allRows<{ rate_date: string; rate: number }>('fx_rates', (start, end) =>
          supabase.from('fx_rates').select('rate_date, rate').eq('pair', `${currency}/TWD`).gte('rate_date', addDays(from, -14)).order('rate_date').range(start, end),
        ),
      ),
    ),
    rows<{ series: string; obs_month: string; value: number }>(
      'market_series',
      supabase.from('market_series').select('series, obs_month, value').in('series', Object.values(RISK_FREE_SERIES)).gte('obs_month', `${from.slice(0, 7)}-01`).order('obs_month'),
    ),
  ]);
  const indices = new Map<string, SeriesClose[]>();
  for (const row of indexRows) {
    const list = indices.get(row.index_id) ?? [];
    list.push({ date: row.price_date, close: Number(row.close) });
    indices.set(row.index_id, list);
  }
  const riskFree = new Map<string, Map<string, number>>();
  for (const [currency, series] of Object.entries(RISK_FREE_SERIES)) {
    riskFree.set(currency, new Map(billRows.filter((row) => row.series === series).map((row) => [row.obs_month.slice(0, 7), Number(row.value)])));
  }
  return {
    ...base,
    closes: new Map(wanted.map((ticker, i) => [ticker, (closeRows[i] ?? []).map((row) => ({ date: row.price_date, close: Number(row.adj_close ?? row.close) }))])),
    indices,
    fx: new Map(currencies.map((currency, i) => [currency, (rateRows[i] ?? []).map((row) => ({ date: row.rate_date, close: Number(row.rate) }))])),
    riskFree,
  };
}

/**
 * Each holding's β against every benchmark at config regression's defaults, saved in beta_results
 * once a month for F11 (N1's monthly refresh); undefined when this month's are saved already.
 */
export async function refreshBetas(supabase: SupabaseClient, today: string): Promise<{ saved: number; runDate: string } | undefined> {
  const [latest] = await rows<{ run_date: string }>('beta_results', supabase.from('beta_results').select('run_date').eq('model', '1F').order('run_date', { ascending: false }).limit(1));
  if (latest && latest.run_date.slice(0, 7) === today.slice(0, 7)) return undefined;
  const settings = readRegressionSettings(await regressionConfig(supabase));
  if (!settings) throw new DataError('config', 'regression is missing or malformed');
  const portfolio = buildPortfolio(await loadHoldingsData(supabase));
  const tickers = [...new Set(portfolio.holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])))].sort();
  const { defaults } = settings;
  const data = await loadRegressionData(supabase, tickers, loadFrom(today, defaults.years, settings.rollingWeeks));
  const securities = new Map(data.securities.map((security) => [security.ticker, security]));
  const out: Array<Record<string, unknown>> = [];
  for (const ticker of tickers) {
    const security = securities.get(ticker);
    if (!security) continue;
    for (const benchmark of settings.benchmarks) {
      const outcome = regressTicker(data, security, benchmark, { freq: defaults.freq, years: defaults.years, basis: defaults.currency }, settings);
      if (!outcome.ok) continue;
      const { result } = outcome;
      out.push({
        ticker,
        benchmark: benchmark.id,
        model: '1F',
        freq: defaults.freq,
        window_years: defaults.years,
        currency_basis: defaults.currency,
        beta: result.beta,
        alpha: result.alphaAnnual,
        factor_loadings: { adjusted: result.adjusted, ci_low: result.ci[0], ci_high: result.ci[1], n: result.n, adjacent: result.adjacent, slopes: result.slopes, from: result.from, to: result.to },
        r2: Math.min(1, Math.max(0, result.r2)),
        std_err: result.stdErr,
        run_date: today,
      });
    }
  }
  if (out.length > 0) {
    const { error } = await supabase.from('beta_results').upsert(out, { onConflict: 'ticker,benchmark,model,freq,window_years,currency_basis,run_date' });
    if (error) throw new DataError('beta_results', error.message);
  }
  return { saved: out.length, runDate: today };
}

/** The newest β saved for each ticker and benchmark (the monthly refresh), for the Regression page. */
export async function loadSavedBetas(supabase: SupabaseClient): Promise<Array<{ ticker: string; benchmark: string; beta: number; runDate: string }>> {
  const found = await rows<{ ticker: string; benchmark: string; beta: number | null; run_date: string }>(
    'beta_results',
    supabase.from('beta_results').select('ticker, benchmark, beta, run_date').eq('model', '1F').order('run_date', { ascending: false }).limit(200),
  );
  const seen = new Set<string>();
  return found.flatMap((row) => {
    const key = `${row.ticker}|${row.benchmark}`;
    if (seen.has(key) || row.beta === null) return [];
    seen.add(key);
    return [{ ticker: row.ticker, benchmark: row.benchmark, beta: Number(row.beta), runDate: row.run_date }];
  });
}

// ---------------------------------------------------------------------------
// F11 CAPM cost of equity (Phase 2, step 3)
// ---------------------------------------------------------------------------

/** Months of F11's series the page reads: enough for the newest and the months before it. */
const CAPM_MONTHS = 13;

export interface StockCost {
  security: SecurityRecord;
  /** Held now in either pool. */
  held: boolean;
  outcome: CostOutcome;
  /** Why no β could be worked out live: too few periods, say (N1's problems). */
  betaProblem?: { problem: 'fx' | 'observations' | 'collinear' | 'settings'; n: number };
}

export interface CapmData {
  /** config capm; undefined when missing or malformed (before its migration, say). */
  settings: CapmSettings | undefined;
  regression: RegressionSettings | undefined;
  /** F11's monthly series, oldest first. */
  series: Map<string, MonthValue[]>;
  stocks: StockCost[];
}

/** The newest β saved for each ticker and benchmark (N1's monthly refresh), raw and adjusted. */
async function savedBetaInputs(supabase: SupabaseClient): Promise<Map<string, BetaInput>> {
  const found = await rows<{ ticker: string; benchmark: string; beta: number | null; factor_loadings: Record<string, unknown> | null; run_date: string }>(
    'beta_results',
    supabase.from('beta_results').select('ticker, benchmark, beta, factor_loadings, run_date').eq('model', '1F').order('run_date', { ascending: false }).limit(500),
  );
  const out = new Map<string, BetaInput>();
  for (const row of found) {
    const key = `${row.ticker}|${row.benchmark}`;
    const adjusted = row.factor_loadings?.['adjusted'];
    if (out.has(key) || row.beta === null || typeof adjusted !== 'number') continue;
    out.set(key, { raw: Number(row.beta), adjusted, runDate: row.run_date });
  }
  return out;
}

/**
 * Each single stock's cost of equity (F11): its market's 10-year yield and ERP, and its β against
 * the market's index, the newest saved by the monthly refresh, else worked out now at N1's defaults.
 */
export async function loadCapmData(supabase: SupabaseClient, today: string): Promise<CapmData> {
  const since = `${addMonths(today.slice(0, 7), -CAPM_MONTHS)}-01`;
  const [capmRow, setup, saved, seriesRows, holdings] = await Promise.all([
    rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'capm')),
    loadRegressionSetup(supabase),
    savedBetaInputs(supabase),
    rows<{ series: string; obs_month: string; value: number }>(
      'market_series',
      supabase.from('market_series').select('series, obs_month, value').in('series', Object.values(CAPM_SERIES)).gte('obs_month', since).order('obs_month'),
    ),
    loadHoldingsData(supabase),
  ]);
  const settings = readCapmSettings(capmRow[0]?.value);
  const regression = setup.settings;
  const series = new Map<string, MonthValue[]>();
  for (const row of seriesRows) {
    const list = series.get(row.series) ?? [];
    list.push({ month: row.obs_month.slice(0, 7), value: Number(row.value) });
    series.set(row.series, list);
  }
  const held = new Set(buildPortfolio(holdings).holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])));
  const stocks = setup.securities.filter((security) => security.productType === 'stock').sort((a, b) => Number(held.has(b.ticker)) - Number(held.has(a.ticker)) || a.ticker.localeCompare(b.ticker));
  if (!settings) return { settings, regression, series, stocks: [] };
  const benchmarkOf = (security: SecurityRecord) => settings.markets[security.market]?.benchmark;
  // A stock with no saved β against its market's index gets one now, as the Regression page would.
  const missing = stocks.filter((security) => setup.priced.has(security.ticker) && benchmarkOf(security) && !saved.has(`${security.ticker}|${benchmarkOf(security)}`));
  const live = new Map<string, { beta?: BetaInput; problem?: StockCost['betaProblem'] }>();
  if (missing.length > 0 && regression) {
    const { defaults } = regression;
    const data = await loadRegressionData(supabase, missing.map((security) => security.ticker), loadFrom(today, defaults.years, regression.rollingWeeks), setup);
    for (const security of missing) {
      const benchmark = regression.benchmarks.find((candidate) => candidate.id === benchmarkOf(security));
      if (!benchmark) continue;
      const outcome = regressTicker(data, security, benchmark, { freq: defaults.freq, years: defaults.years, basis: defaults.currency }, regression);
      live.set(security.ticker, outcome.ok ? { beta: { raw: outcome.result.beta, adjusted: outcome.result.adjusted, runDate: null } } : { problem: { problem: outcome.problem, n: outcome.n } });
    }
  }
  return {
    settings,
    regression,
    series,
    stocks: stocks.map((security) => {
      const benchmark = benchmarkOf(security);
      const found = benchmark ? saved.get(`${security.ticker}|${benchmark}`) : undefined;
      const now = live.get(security.ticker);
      const problem = now?.problem ?? (!found && !now && benchmark && !regression ? { problem: 'settings' as const, n: 0 } : undefined);
      return { security, held: held.has(security.ticker), outcome: stockCostOfEquity(security, found ?? now?.beta, settings, series), ...(problem ? { betaProblem: problem } : {}) };
    }),
  };
}

// ---------------------------------------------------------------------------
// F12 valuation workbench (Phase 2, step 4)
// ---------------------------------------------------------------------------

export interface WatchRecord {
  ticker: string;
  addedOn: string;
  /** The stock's own buy and trim multiples; null takes the rule's. */
  buy: number | null;
  trim: number | null;
  active: boolean;
  assumptions: StockAssumptions;
}

export interface StockBench {
  security: SecurityRecord;
  held: boolean;
  watch?: WatchRecord;
  assumed: Assumed;
  series: StockSeries;
  /** Where the filings came from, and the newest quarter's date. */
  source: string | null;
  /** F11's cost of equity, or why there is none. */
  cost?: CostOutcome;
  /** The valuation now, or why there is none. */
  valuation?: Valuation;
  input?: { quarter: Quarter; price: SeriesClose };
  problem?: InputProblem;
  /** Saved values of every model, newest first. */
  saved: SavedValuation[];
}

export interface WorkbenchData {
  /** config valuation; undefined when missing or malformed (before its migration, say). */
  settings: ValuationSettings | undefined;
  /** BUY_ZONE's and TRIM_ZONE's multiples, and TRIM_ZONE's share sold. */
  rules: { buy: number | null; trim: number | null; sellShare: number | null };
  /** Watched and held single stocks, watched first, valued; then the other single stocks, to add. */
  stocks: StockBench[];
  others: SecurityRecord[];
}

const WATCH_COLUMNS = 'ticker, added_on, buy_threshold, trim_threshold, active, assumptions';

function toWatch(row: { ticker: string; added_on: string; buy_threshold: number | null; trim_threshold: number | null; active: boolean; assumptions: unknown }): WatchRecord {
  return {
    ticker: row.ticker,
    addedOn: row.added_on,
    buy: row.buy_threshold === null ? null : Number(row.buy_threshold),
    trim: row.trim_threshold === null ? null : Number(row.trim_threshold),
    active: row.active,
    assumptions: readStockAssumptions(row.assumptions),
  };
}

async function loadValuationConfig(supabase: SupabaseClient): Promise<ValuationSettings | undefined> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'valuation'));
  return readValuationSettings(found[0]?.value);
}

async function loadSavedValuations(supabase: SupabaseClient, tickers?: readonly string[]): Promise<SavedValuation[]> {
  const found = await allRows<Parameters<typeof readSaved>[0]>('valuations', (from, to) => {
    const query = supabase.from('valuations').select('ticker, valuation_date, model, iv_bear, iv_base, iv_bull, inputs');
    return (tickers ? query.in('ticker', [...tickers]) : query).order('valuation_date', { ascending: false }).range(from, to);
  });
  return found.flatMap((row) => readSaved(row) ?? []);
}

/** Each stock's saved quarters (fundamentals), oldest first, with its reporting currency and source. */
async function loadQuarters(supabase: SupabaseClient, tickers: readonly string[]): Promise<Map<string, { quarters: Quarter[]; currency: string; source: string }>> {
  if (tickers.length === 0) return new Map();
  const found = await allRows<{ ticker: string; period_end: string; figures: Figures; currency: string; filed_on: string | null; source: string }>('fundamentals', (from, to) =>
    supabase.from('fundamentals').select('ticker, period_end, figures, currency, filed_on, source').in('ticker', [...tickers]).order('ticker').order('period_end').range(from, to),
  );
  const out = new Map<string, { quarters: Quarter[]; currency: string; source: string }>();
  for (const row of found) {
    const entry = out.get(row.ticker) ?? { quarters: [], currency: row.currency, source: row.source };
    entry.quarters.push({ periodEnd: row.period_end, figures: row.figures ?? {}, filed: row.filed_on });
    entry.currency = row.currency;
    entry.source = row.source;
    out.set(row.ticker, entry);
  }
  return out;
}

/** Quoted closes (not adjusted: multiples set a day's price against that day's figures), from `from` on. */
async function loadQuotedCloses(supabase: SupabaseClient, tickers: readonly string[], from: string): Promise<Map<string, SeriesClose[]>> {
  const lists = await Promise.all(
    tickers.map((ticker) =>
      allRows<{ price_date: string; close: number }>('prices', (start, end) => supabase.from('prices').select('price_date, close').eq('ticker', ticker).gte('price_date', from).order('price_date').range(start, end)),
    ),
  );
  return new Map(tickers.map((ticker, i) => [ticker, (lists[i] ?? []).map((row) => ({ date: row.price_date, close: Number(row.close) }))]));
}

function zoneRules(rules: readonly RuleRecord[]): WorkbenchData['rules'] {
  const number = (id: string, key: string) => {
    const rule = rules.find((candidate) => candidate.id === id);
    const value = rule && typeof rule.threshold === 'object' && rule.threshold !== null ? (rule.threshold as Record<string, unknown>)[key] : undefined;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  return { buy: number('BUY_ZONE', 'multiple'), trim: number('TRIM_ZONE', 'multiple'), sellShare: number('TRIM_ZONE', 'sell_share') };
}

/**
 * The workbench: every watched or held single stock valued now by all three models from its saved
 * quarters, its newest close and F11's cost of equity, with its saved values; `only` limits the
 * valuing to those tickers (the nightly job's re-run, a save).
 */
export async function loadWorkbench(supabase: SupabaseClient, today: string, only?: readonly string[]): Promise<WorkbenchData> {
  const [settings, watchRows, holdings, capm, rules] = await Promise.all([
    loadValuationConfig(supabase),
    rows<Parameters<typeof toWatch>[0]>('watchlist', supabase.from('watchlist').select(WATCH_COLUMNS).order('ticker')),
    loadHoldingsData(supabase),
    loadCapmData(supabase, today),
    loadRules(supabase),
  ]);
  const watch = new Map(watchRows.map((row) => [row.ticker, toWatch(row)]));
  const held = new Set(buildPortfolio(holdings).holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])));
  const stocks = holdings.securities.filter((security) => security.productType === 'stock');
  const benched = stocks
    .filter((security) => watch.has(security.ticker) || held.has(security.ticker))
    .filter((security) => !only || only.includes(security.ticker))
    .sort((a, b) => Number(watch.has(b.ticker)) - Number(watch.has(a.ticker)) || Number(held.has(b.ticker)) - Number(held.has(a.ticker)) || a.ticker.localeCompare(b.ticker));
  const others = stocks.filter((security) => !watch.has(security.ticker) && !held.has(security.ticker));
  if (!settings) return { settings, rules: zoneRules(rules), stocks: [], others };
  const assumedOf = (ticker: string) => assumed(settings, watch.get(ticker)?.assumptions ?? {});
  const known = new Map(holdings.securities.map((security) => [security.ticker, security]));
  const peers = [...new Set(benched.flatMap((security) => assumedOf(security.ticker).peers))].filter((ticker) => known.has(ticker));
  const tickers = [...new Set([...benched.map((security) => security.ticker), ...peers])];
  const from = `${Number(today.slice(0, 4)) - settings.historyYears - 1}${today.slice(4)}`;
  const [quarters, closes, saved] = await Promise.all([loadQuarters(supabase, tickers), loadQuotedCloses(supabase, tickers, from), loadSavedValuations(supabase, benched.map((security) => security.ticker))]);
  const seriesOf = (security: SecurityRecord): StockSeries => {
    const filings = quarters.get(security.ticker);
    return { ticker: security.ticker, market: security.market, currency: security.currency, reportCurrency: filings?.currency ?? null, quarters: filings?.quarters ?? [], closes: closes.get(security.ticker) ?? [] };
  };
  const costs = new Map(capm.stocks.map((stock) => [stock.security.ticker, stock.outcome]));
  return {
    settings,
    rules: zoneRules(rules),
    others,
    stocks: benched.map((security) => {
      const series = seriesOf(security);
      const choice = assumedOf(security.ticker);
      const cost = costs.get(security.ticker);
      const built = valuationInput(
        series,
        choice.peers.flatMap((ticker) => (known.has(ticker) && ticker !== security.ticker ? [seriesOf(known.get(ticker) as SecurityRecord)] : [])),
        cost?.ok ? { costOfEquity: cost.result.rate, riskFree: cost.result.riskFree.value } : undefined,
        choice,
        settings,
      );
      const watched = watch.get(security.ticker);
      return {
        security,
        held: held.has(security.ticker),
        ...(watched ? { watch: watched } : {}),
        assumed: choice,
        series,
        source: quarters.get(security.ticker)?.source ?? null,
        ...(cost ? { cost } : {}),
        ...(built.ok ? { valuation: valueStock(built.input), input: { quarter: built.quarter, price: built.price } } : { problem: built.problem }),
        saved: saved.filter((row) => row.ticker === security.ticker),
      };
    }),
  };
}

/** Saves a stock's valuation now, one row per model that gave values (upserted by day and model). */
export async function saveValuation(supabase: SupabaseClient, bench: StockBench, trigger: Trigger, today: string): Promise<number> {
  if (!bench.valuation || !bench.input) return 0;
  const cost = bench.cost?.ok ? bench.cost.result.rate : undefined;
  const out = valuationRows(bench.security.ticker, today, bench.valuation, {
    trigger,
    periodEnd: bench.input.quarter.periodEnd,
    filed: bench.input.quarter.filed,
    price: bench.input.price.close,
    currency: bench.security.currency,
    ...(cost !== undefined ? { costOfEquity: cost } : {}),
    assumptions: bench.assumed,
  });
  if (out.length === 0) return 0;
  const { error } = await supabase.from('valuations').upsert(out, { onConflict: 'ticker,valuation_date,model' });
  if (error) throw new DataError('valuations', error.message);
  return out.length;
}

/** The nightly re-run (F12: "re-runs after each filing"): every active watched stock with a quarter newer than its last value. */
export async function revalueOnFilings(supabase: SupabaseClient, today: string): Promise<{ valued: string[] } | undefined> {
  const data = await loadWorkbench(supabase, today);
  if (!data.settings) return undefined;
  const valued: string[] = [];
  for (const bench of data.stocks) {
    if (!bench.watch?.active || !filedSince(bench.series.quarters, bench.saved, bench.security.ticker)) continue;
    if ((await saveValuation(supabase, bench, 'filing', today)) > 0) valued.push(bench.security.ticker);
  }
  return { valued };
}

/** What the zone rules read (F12); undefined before config valuation exists, so the rules wait. */
export async function loadWatchInputs(supabase: SupabaseClient, securities: readonly SecurityRecord[]): Promise<WatchInput[] | undefined> {
  const [settings, watchRows] = await Promise.all([
    loadValuationConfig(supabase),
    rows<Parameters<typeof toWatch>[0]>('watchlist', supabase.from('watchlist').select(WATCH_COLUMNS).order('ticker')),
  ]);
  if (!settings) return undefined;
  const entries = watchRows.map(toWatch);
  const saved = await loadSavedValuations(supabase, entries.map((entry) => entry.ticker));
  const known = new Map(securities.map((security) => [security.ticker, security]));
  return watchInputs(
    entries.flatMap((entry) => {
      const security = known.get(entry.ticker);
      return security ? [{ ticker: entry.ticker, active: entry.active, model: assumed(settings, entry.assumptions).model, buy: entry.buy, trim: entry.trim, assetClassId: security.assetClassId, currency: security.currency }] : [];
    }),
    saved,
  );
}

/** The single stocks whose filings the nightly job loads: held or actively watched, and their peers. */
export async function loadFilingTickers(supabase: SupabaseClient): Promise<Array<{ ticker: string; market: Market }>> {
  const [holdings, watchRows] = await Promise.all([loadHoldingsData(supabase), rows<Parameters<typeof toWatch>[0]>('watchlist', supabase.from('watchlist').select(WATCH_COLUMNS))]);
  const held = new Set(buildPortfolio(holdings).holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])));
  const watched = watchRows.map(toWatch).filter((entry) => entry.active);
  const wanted = new Set([...held, ...watched.map((entry) => entry.ticker), ...watched.flatMap((entry) => entry.assumptions.peers ?? [])]);
  return holdings.securities.filter((security) => security.productType === 'stock' && wanted.has(security.ticker)).map((security) => ({ ticker: security.ticker, market: security.market }));
}

// ---------------------------------------------------------------------------
// The red-flag indicator (N3, Phase 2 step 5)
// ---------------------------------------------------------------------------

/** A company profile as saved, with what the nightly job needs to update it. */
export interface ProfileRecord extends Profile {
  ticker: string;
  businessId: string | null;
  source: string;
}

interface ProfileRow {
  ticker: string;
  industry_code: string | null;
  industry: string | null;
  sic: number | null;
  auditor: string | null;
  business_id: string | null;
  checked: unknown;
  source: string;
}

const PROFILE_COLUMNS = 'ticker, industry_code, industry, sic, auditor, business_id, checked, source';

function readChecked(value: unknown): Profile['checked'] {
  const out: Profile['checked'] = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!(EVENT_INDICATORS as readonly string[]).includes(key) || typeof entry !== 'object' || entry === null) continue;
    const { on, since } = entry as Record<string, unknown>;
    if (typeof on === 'string') out[key as EventIndicator] = { on, ...(typeof since === 'string' ? { since } : {}) };
  }
  return out;
}

export function toProfile(row: ProfileRow): ProfileRecord {
  return {
    ticker: row.ticker,
    industryCode: row.industry_code,
    industry: row.industry,
    sic: row.sic === null ? null : Number(row.sic),
    auditor: row.auditor,
    businessId: row.business_id,
    checked: readChecked(row.checked),
    source: row.source,
  };
}

/** The columns a profile is saved with. */
export function profileColumns(profile: ProfileRecord): ProfileRow & { updated_at: string } {
  return {
    ticker: profile.ticker,
    industry_code: profile.industryCode,
    industry: profile.industry,
    sic: profile.sic,
    auditor: profile.auditor,
    business_id: profile.businessId,
    checked: profile.checked,
    source: profile.source,
    updated_at: new Date().toISOString(),
  };
}

export interface EntryRecord extends ManualEntry {
  ticker: string;
}

const ENTRY_COLUMNS = 'id, ticker, indicator, as_of, value, note';

export async function loadRedFlagSettings(supabase: SupabaseClient): Promise<RedFlagSettings | undefined> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'red_flags'));
  return readRedFlagSettings(found[0]?.value);
}

/** The single stocks N3 lights: held, or actively watched. */
async function flagSecurities(supabase: SupabaseClient, holdings?: HoldingsData): Promise<{ securities: SecurityRecord[]; held: Set<string>; watched: Set<string>; data: HoldingsData }> {
  const [data, watchRows] = await Promise.all([holdings ?? loadHoldingsData(supabase), rows<{ ticker: string; active: boolean }>('watchlist', supabase.from('watchlist').select('ticker, active'))]);
  const held = new Set(buildPortfolio(data).holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 ? [holding.ticker] : [])));
  const watched = new Set(watchRows.filter((row) => row.active).map((row) => row.ticker));
  return { securities: data.securities.filter((security) => security.productType === 'stock' && (held.has(security.ticker) || watched.has(security.ticker))), held, watched, data };
}

/** Saved scans since `from`, per ticker, newest first. */
async function loadScans(supabase: SupabaseClient, tickers: readonly string[], from: string): Promise<Map<string, Scan[]>> {
  if (tickers.length === 0) return new Map();
  const found = await allRows<Parameters<typeof readScans>[0][number]>('red_flags', (start, end) =>
    supabase.from('red_flags').select('ticker, flag_date, indicator, value, level, coverage_pct, detail').in('ticker', [...tickers]).gte('flag_date', from).order('flag_date', { ascending: false }).order('id').range(start, end),
  );
  return readScans(found);
}

/** What the nightly job reads for N3: the companies, their saved profiles, and whether each is due a scan. Undefined before config red_flags. */
export async function loadRedFlagCompanies(supabase: SupabaseClient, today: string): Promise<{ settings: RedFlagSettings; companies: Array<{ ticker: string; market: Market; due: boolean; profile: ProfileRecord | null }> } | undefined> {
  const settings = await loadRedFlagSettings(supabase);
  if (!settings) return undefined;
  const { securities } = await flagSecurities(supabase);
  const tickers = securities.map((security) => security.ticker);
  const [profiles, newest] = await Promise.all([
    tickers.length ? rows<ProfileRow>('company_profiles', supabase.from('company_profiles').select(PROFILE_COLUMNS).in('ticker', tickers)) : Promise.resolve([]),
    tickers.length ? rows<{ ticker: string; flag_date: string }>('red_flags', supabase.from('red_flags').select('ticker, flag_date').in('ticker', tickers).gte('flag_date', addDays(today, -settings.scanDays * 2)).order('flag_date', { ascending: false })) : Promise.resolve([]),
  ]);
  const byTicker = new Map(profiles.map((row) => [row.ticker, toProfile(row)]));
  return {
    settings,
    companies: securities.map((security) => ({
      ticker: security.ticker,
      market: security.market,
      due: scanDue(newest.find((row) => row.ticker === security.ticker)?.flag_date, today, settings.scanDays),
      profile: byTicker.get(security.ticker) ?? null,
    })),
  };
}

export interface FlagCompany {
  security: SecurityRecord;
  held: boolean;
  watched: boolean;
  profile: ProfileRecord | null;
  events: FlagEvent[];
  entries: EntryRecord[];
  /** The indicators now, from the saved filings, events and entries. */
  assessment: Assessment;
  /** Saved weekly scans, newest first. */
  scans: Scan[];
}

export interface RedFlagData {
  settings: RedFlagSettings | undefined;
  companies: FlagCompany[];
}

/** Every company N3 lights, assessed now, with its saved scans of the last year. */
export async function loadRedFlagData(supabase: SupabaseClient, today: string, only?: readonly string[], holdings?: HoldingsData): Promise<RedFlagData> {
  const settings = await loadRedFlagSettings(supabase);
  if (!settings) return { settings, companies: [] };
  const { securities, held, watched, data } = await flagSecurities(supabase, holdings);
  const chosen = securities.filter((security) => !only || only.includes(security.ticker));
  const tickers = chosen.map((security) => security.ticker);
  if (tickers.length === 0) return { settings, companies: [] };
  const [profiles, events, entries, quarters, scans] = await Promise.all([
    rows<ProfileRow>('company_profiles', supabase.from('company_profiles').select(PROFILE_COLUMNS).in('ticker', tickers)),
    rows<{ ticker: string; indicator: EventIndicator; event_date: string; source: string; title: string; url: string | null; value: number | null }>(
      'red_flag_events',
      supabase.from('red_flag_events').select('ticker, indicator, event_date, source, title, url, value').in('ticker', tickers).order('event_date', { ascending: false }),
    ),
    rows<{ id: number; ticker: string; indicator: ManualIndicator; as_of: string; value: number; note: string }>('red_flag_entries', supabase.from('red_flag_entries').select(ENTRY_COLUMNS).in('ticker', tickers).order('as_of', { ascending: false })),
    loadQuarters(supabase, tickers),
    loadScans(supabase, tickers, addDays(today, -366)),
  ]);
  const prices = new Map(data.prices.map((price) => [price.ticker, price]));
  const profileOf = new Map(profiles.map((row) => [row.ticker, toProfile(row)]));
  return {
    settings,
    companies: chosen
      .map((security) => {
        const profile = profileOf.get(security.ticker) ?? null;
        const mine = events.filter((row) => row.ticker === security.ticker).map((row): FlagEvent => ({ indicator: row.indicator, date: row.event_date, source: row.source, title: row.title, url: row.url, value: row.value === null ? null : Number(row.value) }));
        const typed = entries.filter((row) => row.ticker === security.ticker).map((row): EntryRecord => ({ id: Number(row.id), ticker: row.ticker, indicator: row.indicator, asOf: row.as_of, value: Number(row.value), note: row.note }));
        const filings = quarters.get(security.ticker);
        const price = prices.get(security.ticker);
        const input: CompanyInput = {
          ticker: security.ticker,
          market: security.market,
          quarters: filings?.quarters ?? [],
          reportCurrency: filings?.currency ?? null,
          price: price ? { close: price.close, date: price.date, currency: security.currency } : null,
          profile,
          events: mine,
          entries: typed,
        };
        return { security, held: held.has(security.ticker), watched: watched.has(security.ticker), profile, events: mine, entries: typed, assessment: assess(input, settings, today), scans: scans.get(security.ticker) ?? [] };
      })
      .sort((a, b) => Number(b.held) - Number(a.held) || a.security.ticker.localeCompare(b.security.ticker)),
  };
}

/** The weekly scan: each company asked for assessed now and saved as today's rows (upserted by day and indicator). */
export async function scanRedFlags(supabase: SupabaseClient, today: string, tickers: readonly string[]): Promise<{ scanned: string[] }> {
  if (tickers.length === 0) return { scanned: [] };
  const data = await loadRedFlagData(supabase, today, tickers);
  const out = data.companies.flatMap((company) => scanRows(company.assessment, today));
  for (let at = 0; at < out.length; at += 500) {
    const { error } = await supabase.from('red_flags').upsert(out.slice(at, at + 500), { onConflict: 'ticker,flag_date,indicator' });
    if (error) throw new DataError('red_flags', error.message);
  }
  return { scanned: data.companies.map((company) => company.security.ticker) };
}

/** What the two N3 rules read: each company's saved scans of the last half year; undefined before config red_flags. */
export async function loadFlagInputs(supabase: SupabaseClient, today: string, holdings: HoldingsData): Promise<EngineInput['redFlags']> {
  const settings = await loadRedFlagSettings(supabase);
  if (!settings) return undefined;
  const { securities } = await flagSecurities(supabase, holdings);
  const scans = await loadScans(supabase, securities.map((security) => security.ticker), addDays(today, -183));
  return [...scans.entries()].map(([ticker, list]) => ({ ticker, scans: list }));
}
