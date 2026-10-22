/**
 * Form parsing shared by the browser (instant feedback) and the server actions (the authority;
 * the server never trusts what the browser sends). Every error message is bilingual.
 */
import { isIsoDate, isMonth } from './dates';
import type { Bilingual } from './i18n';
import type { DraftOrder } from './models/engine';
import type { SavedPlan } from './models/projection';
import type { AssetClass, CashFlow, FlowType, Market, Pool, ProductType, Security, Side } from './models/types';

export type RawForm = Record<string, string | undefined>;
export type FieldErrors<K extends string> = Partial<Record<K, Bilingual>>;
export type Parsed<T, K extends string> = { ok: true; value: T } | { ok: false; errors: FieldErrors<K> };

export const MESSAGES = {
  required: { en: 'Required.', zh: '必填。' },
  date: { en: 'Enter a date as YYYY-MM-DD.', zh: '請以 YYYY-MM-DD 格式輸入日期。' },
  future: { en: 'The date cannot be in the future.', zh: '日期不能晚於今天。' },
  positive: { en: 'Enter a number above 0.', zh: '請輸入大於 0 的數字。' },
  nonNegative: { en: 'Enter 0 or more.', zh: '請輸入 0 或以上的數字。' },
  unknownTicker: { en: 'Unknown ticker: add it as a security first.', zh: '找不到這個代號，請先新增證券。' },
  tickerFormat: { en: 'Use capital letters, digits, "." or "-", up to 12 characters.', zh: '請用大寫英文字母、數字、「.」或「-」，最多 12 個字元。' },
  tickerTaken: { en: 'This ticker already exists.', zh: '這個代號已存在。' },
  currency: { en: 'Use a three-letter code such as USD.', zh: '請輸入三個字母的幣別代碼，例如 USD。' },
  country: { en: 'Use a two-letter country code such as US or IE.', zh: '請輸入兩個字母的國家代碼，例如 US 或 IE。' },
  choice: { en: 'Pick one of the options.', zh: '請從選項中選擇。' },
  tooLong: { en: 'Too long.', zh: '太長了。' },
  dividendTicker: { en: 'Name the security that paid the dividend.', zh: '請填寫發放股利的證券代號。' },
  percent: { en: 'Enter a percentage from 0 to 100, with at most two decimals.', zh: '請輸入 0 到 100 的百分比，最多兩位小數。' },
  expectedReturn: { en: 'Enter a yearly return from −50% to 50%.', zh: '請輸入 −50% 到 50% 之間的年報酬。' },
  volatility: { en: 'Enter a yearly volatility from 0% to 100%.', zh: '請輸入 0% 到 100% 之間的年化波動度。' },
  source: { en: 'Say where the assumption comes from.', zh: '請註明假設的來源。' },
  month: { en: 'Enter a month as YYYY-MM.', zh: '請以 YYYY-MM 格式輸入月份。' },
  stepUp: { en: 'Enter a yearly step-up from 0% to 30%, with at most two decimals.', zh: '請輸入 0% 到 30% 之間的每年調升比例，最多兩位小數。' },
  inflation: { en: 'Enter a yearly inflation from −5% to 20%, with at most two decimals.', zh: '請輸入 −5% 到 20% 之間的年通膨率，最多兩位小數。' },
  years: { en: 'Enter a whole number of years from 1 to 60.', zh: '請輸入 1 到 60 之間的整數年數。' },
  shares: { en: 'Enter whole shares, 0 or more; 0 drops the order.', zh: '請輸入整數股數（0 或以上）；0 代表刪除這筆。' },
  wholeTwd: { en: 'Enter whole NT$, 0 or more; 0 drops the order.', zh: '請輸入整數台幣金額（0 或以上）；0 代表刪除這筆。' },
  fraction: { en: 'Enter a number between 0 and 1, e.g. 0.05 for 5%.', zh: '請輸入 0 到 1 之間的數字，例如 5% 填 0.05。' },
  wholeNumber: { en: 'Enter a whole number, 0 or more.', zh: '請輸入 0 或以上的整數。' },
  cooldown: { en: 'Enter whole days from 0 to 365.', zh: '請輸入 0 到 365 的整數天數。' },
  dcaDay: { en: 'Enter a day of the month from 1 to 31, or leave it blank.', zh: '請輸入 1 到 31 的日期，或留白。' },
  expiryDays: { en: 'Enter whole days from 1 to 365.', zh: '請輸入 1 到 365 的整數天數。' },
} as const satisfies Record<string, Bilingual>;

/** "1,234.5" → 1234.5; empty or not a number → undefined. */
export function parseNumber(raw: string | undefined): number | undefined {
  const text = (raw ?? '').replace(/[,\s]/g, '');
  if (text === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** An optional amount: empty means 0. */
function optionalAmount(raw: string | undefined): number | undefined {
  return (raw ?? '').trim() === '' ? 0 : parseNumber(raw);
}

function text(raw: string | undefined): string {
  return (raw ?? '').trim();
}

function oneOf<T extends string>(raw: string | undefined, options: readonly T[]): T | undefined {
  return options.find((option) => option === raw);
}

function finish<T, K extends string>(errors: FieldErrors<K>, value: () => T): Parsed<T, K> {
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: value() };
}

// ---------------------------------------------------------------------------
// Trades (N5 form fields)
// ---------------------------------------------------------------------------

export interface TradeInput {
  tradeDate: string;
  ticker: string;
  side: Side;
  qty: number;
  price: number;
  currency: string;
  fee: number;
  tax: number;
  fxRate: number;
  pool: Pool;
  note: string | null;
}

export type TradeField = keyof TradeInput;

export function parseTrade(raw: RawForm, securities: ReadonlyMap<string, Security>, today: string): Parsed<TradeInput, TradeField> {
  const errors: FieldErrors<TradeField> = {};
  const tradeDate = text(raw['tradeDate']);
  if (!isIsoDate(tradeDate)) errors.tradeDate = MESSAGES.date;
  else if (tradeDate > today) errors.tradeDate = MESSAGES.future;

  const ticker = text(raw['ticker']).toUpperCase();
  const security = securities.get(ticker);
  if (!ticker) errors.ticker = MESSAGES.required;
  else if (!security) errors.ticker = MESSAGES.unknownTicker;

  const side = oneOf(raw['side'], ['buy', 'sell'] as const);
  if (!side) errors.side = MESSAGES.choice;
  const qty = parseNumber(raw['qty']);
  if (qty === undefined || qty <= 0) errors.qty = MESSAGES.positive;
  const price = parseNumber(raw['price']);
  if (price === undefined || price < 0) errors.price = MESSAGES.nonNegative;

  const typedCurrency = text(raw['currency']).toUpperCase();
  const currency = typedCurrency || security?.currency || '';
  // With an unknown ticker and no currency typed, the ticker error already says what to fix.
  if (!/^[A-Z]{3}$/.test(currency) && (typedCurrency || security)) errors.currency = MESSAGES.currency;
  const fee = optionalAmount(raw['fee']);
  if (fee === undefined || fee < 0) errors.fee = MESSAGES.nonNegative;
  const tax = optionalAmount(raw['tax']);
  if (tax === undefined || tax < 0) errors.tax = MESSAGES.nonNegative;
  // A TWD trade needs no conversion; the database also insists on 1.
  const fxRate = currency === 'TWD' ? 1 : parseNumber(raw['fxRate']);
  if (fxRate === undefined || fxRate <= 0) errors.fxRate = MESSAGES.positive;

  const pool = oneOf(raw['pool'] || 'regular', ['regular', 'windfall'] as const);
  if (!pool) errors.pool = MESSAGES.choice;
  const note = text(raw['note']);
  if (note.length > 500) errors.note = MESSAGES.tooLong;

  return finish(errors, () => ({
    tradeDate,
    ticker,
    side: side as Side,
    qty: qty as number,
    price: price as number,
    currency,
    fee: fee as number,
    tax: tax as number,
    fxRate: fxRate as number,
    pool: pool as Pool,
    note: note || null,
  }));
}

// ---------------------------------------------------------------------------
// Securities
// ---------------------------------------------------------------------------

export interface SecurityInput {
  ticker: string;
  name: string;
  market: Market;
  productType: ProductType;
  assetClassId: string;
  currency: string;
  domicile: string;
}

export type SecurityField = keyof SecurityInput;

const MARKETS = ['US', 'TW', 'UK'] as const;
export const PRODUCT_TYPES = ['equity_etf', 'bond_etf', 'gold', 'cash_mmf', 'stock', 'theme_etf'] as const;

export function parseSecurity(raw: RawForm, existingTickers: ReadonlySet<string>, assetClasses: ReadonlyMap<string, AssetClass>): Parsed<SecurityInput, SecurityField> {
  const errors: FieldErrors<SecurityField> = {};
  const ticker = text(raw['ticker']).toUpperCase();
  if (!ticker) errors.ticker = MESSAGES.required;
  else if (!/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)) errors.ticker = MESSAGES.tickerFormat;
  else if (existingTickers.has(ticker)) errors.ticker = MESSAGES.tickerTaken;
  const name = text(raw['name']);
  if (!name) errors.name = MESSAGES.required;
  else if (name.length > 120) errors.name = MESSAGES.tooLong;
  const market = oneOf(raw['market'], MARKETS);
  if (!market) errors.market = MESSAGES.choice;
  const productType = oneOf(raw['productType'], PRODUCT_TYPES);
  if (!productType) errors.productType = MESSAGES.choice;
  const assetClassId = text(raw['assetClassId']);
  if (!assetClasses.has(assetClassId)) errors.assetClassId = MESSAGES.choice;
  const currency = text(raw['currency']).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = MESSAGES.currency;
  const domicile = text(raw['domicile']).toUpperCase();
  if (!/^[A-Z]{2}$/.test(domicile)) errors.domicile = MESSAGES.country;
  return finish(errors, () => ({ ticker, name, market: market as Market, productType: productType as ProductType, assetClassId, currency, domicile }));
}

// ---------------------------------------------------------------------------
// Non-listed assets: physical gold in grams, savings and money-market funds as TWD balances
// ---------------------------------------------------------------------------

export interface ManualAssetInput {
  name: string;
  assetClassId: string;
  productType: 'gold' | 'cash_mmf';
  unit: 'grams' | 'TWD';
  quantity: number;
  valuationMethod: 'twd_gold_price' | 'balance';
  lastValueTwd: number | null;
  valuedOn: string | null;
  pool: Pool;
}

export type ManualAssetField = 'name' | 'assetClassId' | 'productType' | 'quantity' | 'lastValueTwd' | 'valuedOn' | 'pool';

export function parseManualAsset(raw: RawForm, assetClasses: ReadonlyMap<string, AssetClass>, today: string): Parsed<ManualAssetInput, ManualAssetField> {
  const errors: FieldErrors<ManualAssetField> = {};
  const name = text(raw['name']);
  if (!name) errors.name = MESSAGES.required;
  else if (name.length > 120) errors.name = MESSAGES.tooLong;
  const productType = oneOf(raw['productType'], ['gold', 'cash_mmf'] as const);
  if (!productType) errors.productType = MESSAGES.choice;
  const assetClassId = text(raw['assetClassId']);
  if (!assetClasses.has(assetClassId)) errors.assetClassId = MESSAGES.choice;
  const quantity = parseNumber(raw['quantity']);
  if (quantity === undefined || quantity < 0) errors.quantity = MESSAGES.nonNegative;

  // A balance is its own value; gold is valued at the TWD gold price, entered here until a feed exists.
  const isGold = productType === 'gold';
  const enteredValue = text(raw['lastValueTwd']) === '' ? null : parseNumber(raw['lastValueTwd']);
  if (isGold && enteredValue !== null && (enteredValue === undefined || enteredValue < 0)) errors.lastValueTwd = MESSAGES.nonNegative;
  const valuedOnText = text(raw['valuedOn']);
  if (valuedOnText && !isIsoDate(valuedOnText)) errors.valuedOn = MESSAGES.date;
  else if (valuedOnText > today) errors.valuedOn = MESSAGES.future;
  const pool = oneOf(raw['pool'] || 'regular', ['regular', 'windfall'] as const);
  if (!pool) errors.pool = MESSAGES.choice;

  return finish(errors, () => {
    const lastValueTwd = isGold ? (enteredValue ?? null) : (quantity as number);
    return {
      name,
      assetClassId,
      productType: productType as 'gold' | 'cash_mmf',
      unit: isGold ? ('grams' as const) : ('TWD' as const),
      quantity: quantity as number,
      valuationMethod: isGold ? ('twd_gold_price' as const) : ('balance' as const),
      lastValueTwd,
      valuedOn: valuedOnText || (lastValueTwd === null ? null : today),
      pool: pool as Pool,
    };
  });
}

// ---------------------------------------------------------------------------
// Cash flows: contributions, the windfall arriving, dividends and withdrawals
// ---------------------------------------------------------------------------

export type CashFlowInput = Omit<CashFlow, 'id'>;
export type CashFlowField = keyof CashFlowInput;

export const FLOW_TYPES = ['contribution', 'windfall', 'dividend', 'withdrawal'] as const satisfies readonly FlowType[];

/**
 * A dividend names its security and defaults to its currency; the other types carry no ticker and
 * default to TWD. The windfall arriving always lands in the windfall pool (the database insists).
 */
export function parseCashFlow(raw: RawForm, securities: ReadonlyMap<string, Security>, today: string): Parsed<CashFlowInput, CashFlowField> {
  const errors: FieldErrors<CashFlowField> = {};
  const flowDate = text(raw['flowDate']);
  if (!isIsoDate(flowDate)) errors.flowDate = MESSAGES.date;
  else if (flowDate > today) errors.flowDate = MESSAGES.future;

  const type = oneOf(raw['type'], FLOW_TYPES);
  if (!type) errors.type = MESSAGES.choice;
  const amount = parseNumber(raw['amount']);
  if (amount === undefined || amount <= 0) errors.amount = MESSAGES.positive;

  const isDividend = type === 'dividend';
  const ticker = isDividend ? text(raw['ticker']).toUpperCase() : '';
  const security = securities.get(ticker);
  if (isDividend && !ticker) errors.ticker = MESSAGES.dividendTicker;
  else if (isDividend && !security) errors.ticker = MESSAGES.unknownTicker;

  const currency = text(raw['currency']).toUpperCase() || security?.currency || (isDividend ? '' : 'TWD');
  if (!/^[A-Z]{3}$/.test(currency) && (!isDividend || security)) errors.currency = MESSAGES.currency;
  // TWD needs no conversion; the database also insists on 1. Without a currency yet (a dividend
  // missing its security), the ticker error already says what to fix.
  const fxRate = currency === 'TWD' ? 1 : parseNumber(raw['fxRate']);
  if (currency && (fxRate === undefined || fxRate <= 0)) errors.fxRate = MESSAGES.positive;

  const pool = type === 'windfall' ? 'windfall' : oneOf(raw['pool'] || 'regular', ['regular', 'windfall'] as const);
  if (!pool) errors.pool = MESSAGES.choice;
  const note = text(raw['note']);
  if (note.length > 500) errors.note = MESSAGES.tooLong;

  return finish(errors, () => ({
    flowDate,
    type: type as FlowType,
    amount: amount as number,
    currency,
    fxRate: fxRate as number,
    pool: pool as Pool,
    ticker: isDividend ? ticker : null,
    note: note || null,
  }));
}

// ---------------------------------------------------------------------------
// F6: SAA targets and capital market assumptions, one row per asset class
// ---------------------------------------------------------------------------

/** "12.5" (percent) → 0.125; at most two decimals of a percent. */
function percentField(raw: string | undefined, min: number, max: number): number | undefined {
  const value = parseNumber(raw);
  if (value === undefined || value < min || value > max || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return undefined;
  return Math.round(value * 100) / 10_000;
}

export interface TargetInput {
  id: string;
  targetWeight: number;
  benchmarkTicker: string | null;
}

/** Fields are named target_<class id> and benchmark_<class id>; `total` carries the sum check. */
export function targetFields(id: string): { target: string; benchmark: string } {
  return { target: `target_${id}`, benchmark: `benchmark_${id}` };
}

/** Every class's target, as a percentage of the regular pool, adding up to 100%, and its benchmark ETF. */
export function parseTargets(raw: RawForm, classes: readonly AssetClass[], tickers: ReadonlySet<string>): Parsed<TargetInput[], string> {
  const errors: FieldErrors<string> = {};
  const rows: TargetInput[] = [];
  for (const assetClass of classes) {
    const names = targetFields(assetClass.id);
    const targetWeight = percentField(raw[names.target], 0, 100);
    if (targetWeight === undefined) errors[names.target] = MESSAGES.percent;
    const benchmark = text(raw[names.benchmark]).toUpperCase();
    if (benchmark && !tickers.has(benchmark)) errors[names.benchmark] = MESSAGES.unknownTicker;
    rows.push({ id: assetClass.id, targetWeight: targetWeight ?? 0, benchmarkTicker: benchmark || null });
  }
  const total = rows.reduce((sum, row) => sum + row.targetWeight, 0);
  if (Object.keys(errors).length === 0 && Math.abs(total - 1) > 1e-9) {
    const shown = `${Number((total * 100).toFixed(2))}%`;
    errors['total'] = { en: `The targets add up to ${shown}; they must add up to 100%.`, zh: `目標合計為 ${shown}，必須剛好是 100%。` };
  }
  return finish(errors, () => rows);
}

export interface AssumptionInput {
  id: string;
  expectedReturn: number;
  volatility: number;
  source: string;
}

/** Fields are named return_<class id>, volatility_<class id> and source_<class id>. */
export function assumptionFields(id: string): { expectedReturn: string; volatility: string; source: string } {
  return { expectedReturn: `return_${id}`, volatility: `volatility_${id}`, source: `source_${id}` };
}

/**
 * Each class's assumptions, in percent: a class left blank has none; one with any of the three
 * filled in needs all of them, the source included (PRD F6: "with a source note").
 */
export function parseAssumptionForm(raw: RawForm, classes: readonly AssetClass[]): Parsed<AssumptionInput[], string> {
  const errors: FieldErrors<string> = {};
  const rows: AssumptionInput[] = [];
  for (const assetClass of classes) {
    const names = assumptionFields(assetClass.id);
    const typed = [names.expectedReturn, names.volatility, names.source].some((name) => text(raw[name]) !== '');
    if (!typed) continue;
    const expectedReturn = percentField(raw[names.expectedReturn], -50, 50);
    if (expectedReturn === undefined) errors[names.expectedReturn] = MESSAGES.expectedReturn;
    const volatility = percentField(raw[names.volatility], 0, 100);
    if (volatility === undefined) errors[names.volatility] = MESSAGES.volatility;
    const source = text(raw[names.source]);
    if (!source) errors[names.source] = MESSAGES.source;
    else if (source.length > 200) errors[names.source] = MESSAGES.tooLong;
    rows.push({ id: assetClass.id, expectedReturn: expectedReturn ?? 0, volatility: volatility ?? 0, source });
  }
  return finish(errors, () => rows);
}

// ---------------------------------------------------------------------------
// F2 compounding plan (calculator fields)
// ---------------------------------------------------------------------------

export type PlanField = keyof SavedPlan;

/** The calculator's inputs: amounts in TWD, rates in percent, whole years. */
export function parsePlanForm(raw: RawForm): Parsed<SavedPlan, PlanField> {
  const errors: FieldErrors<PlanField> = {};
  const start = text(raw['start']);
  if (!isMonth(start)) errors.start = MESSAGES.month;
  const pv = parseNumber(raw['pv']);
  if (pv === undefined || pv < 0) errors.pv = MESSAGES.nonNegative;
  const pmt = parseNumber(raw['pmt']);
  if (pmt === undefined || pmt < 0) errors.pmt = MESSAGES.nonNegative;
  const stepUp = percentField(raw['stepUp'], 0, 30);
  if (stepUp === undefined) errors.stepUp = MESSAGES.stepUp;
  const expectedReturn = percentField(raw['expectedReturn'], -50, 50);
  if (expectedReturn === undefined) errors.expectedReturn = MESSAGES.expectedReturn;
  const inflation = percentField(raw['inflation'], -5, 20);
  if (inflation === undefined) errors.inflation = MESSAGES.inflation;
  const years = parseNumber(raw['years']);
  if (years === undefined || !Number.isInteger(years) || years < 1 || years > 60) errors.years = MESSAGES.years;
  return finish(errors, () => ({
    start,
    pv: pv ?? 0,
    pmt: pmt ?? 0,
    stepUp: stepUp ?? 0,
    expectedReturn: expectedReturn ?? 0,
    inflation: inflation ?? 0,
    years: years ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Proposal orders (edit before approving)
// ---------------------------------------------------------------------------

/** Field name of an order's size: shares for a trade, NT$ for a balance. */
export function sizeField(index: number): string {
  return `size_${index}`;
}

/** Each order's new size: whole shares for a trade, whole NT$ for a balance; 0 drops it. */
export function parseOrderSizes(raw: RawForm, orders: readonly DraftOrder[]): { sizes: number[]; errors: FieldErrors<string> } {
  const errors: FieldErrors<string> = {};
  const sizes = orders.map((order, index) => {
    const name = sizeField(index);
    const value = parseNumber(raw[name]);
    if (value === undefined || value < 0 || !Number.isInteger(value)) {
      errors[name] = order.kind === 'trade' ? MESSAGES.shares : MESSAGES.wholeTwd;
      return 0;
    }
    return value;
  });
  return { sizes, errors };
}

// ---------------------------------------------------------------------------
// Rules and the engine's settings (rules page)
// ---------------------------------------------------------------------------

/** Field name of a threshold's number. */
export function thresholdField(key: string): string {
  return `threshold_${key}`;
}

export interface RuleInput {
  enabled: boolean;
  cooldownDays: number;
  /** The threshold with its numbers replaced; other entries (lists, words) kept as they are. */
  threshold: Record<string, unknown>;
}

/**
 * A rule's edit: on or off, its cooldown, and each number in its threshold. A whole number stays
 * whole, a share (between 0 and 1) stays one, and any other number stays above 0 (a multiple such as 1.25).
 */
export function parseRuleForm(raw: RawForm, threshold: Record<string, unknown>): Parsed<RuleInput, string> {
  const errors: FieldErrors<string> = {};
  const cooldownDays = parseNumber(raw['cooldownDays']);
  if (cooldownDays === undefined || !Number.isInteger(cooldownDays) || cooldownDays < 0 || cooldownDays > 365) errors['cooldownDays'] = MESSAGES.cooldown;
  const next: Record<string, unknown> = { ...threshold };
  for (const [key, was] of Object.entries(threshold)) {
    if (typeof was !== 'number') continue;
    const name = thresholdField(key);
    const value = parseNumber(raw[name]);
    if (Number.isInteger(was)) {
      if (value === undefined || value < 0 || !Number.isInteger(value)) errors[name] = MESSAGES.wholeNumber;
    } else if (was > 0 && was < 1) {
      if (value === undefined || value <= 0 || value >= 1) errors[name] = MESSAGES.fraction;
    } else if (value === undefined || value <= 0) {
      errors[name] = MESSAGES.positive;
    }
    if (value !== undefined) next[key] = value;
  }
  return finish(errors, () => ({ enabled: raw['enabled'] === 'on', cooldownDays: cooldownDays ?? 0, threshold: next }));
}

export interface EngineSettingsInput {
  dcaAmountTwd: number;
  dcaDay: number | null;
  expiryDays: number;
}

export type EngineSettingsField = keyof EngineSettingsInput;

/** The monthly DCA (config dca) and how long a proposal stays open (config proposal_expiry_days). */
export function parseEngineSettings(raw: RawForm): Parsed<EngineSettingsInput, EngineSettingsField> {
  const errors: FieldErrors<EngineSettingsField> = {};
  const dcaAmountTwd = parseNumber(raw['dcaAmountTwd']);
  if (dcaAmountTwd === undefined || dcaAmountTwd < 0) errors.dcaAmountTwd = MESSAGES.nonNegative;
  const dayText = text(raw['dcaDay']);
  const dcaDay = dayText === '' ? null : parseNumber(dayText);
  if (dcaDay === undefined || (dcaDay !== null && (!Number.isInteger(dcaDay) || dcaDay < 1 || dcaDay > 31))) errors.dcaDay = MESSAGES.dcaDay;
  const expiryDays = parseNumber(raw['expiryDays']);
  if (expiryDays === undefined || !Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 365) errors.expiryDays = MESSAGES.expiryDays;
  return finish(errors, () => ({ dcaAmountTwd: dcaAmountTwd ?? 0, dcaDay: dcaDay ?? null, expiryDays: expiryDays ?? 14 }));
}
