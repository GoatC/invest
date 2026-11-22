/**
 * N5 forms: a trade, a security, a non-listed asset, a cash flow and a split.
 */
import { isIsoDate } from '../dates';
import type { AssetClass, CashFlow, Direction, FlowType, Market, Pool, ProductType, Security, Side } from '../models/types';
import { finish, MESSAGES, oneOf, optionalAmount, parseNumber, text, type FieldErrors, type Parsed, type RawForm } from './core';

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
  direction: Direction;
  leverage: number;
  note: string | null;
}

export type TradeField = keyof TradeInput;

/** The leverage a form may pick, 1.0× to `max` in steps of 0.1×: [1, 1.1, …, max]. */
export function leverageSteps(max: number): number[] {
  const top = Math.max(10, Math.min(100, Math.round(max * 10)));
  return Array.from({ length: top - 9 }, (_, index) => (10 + index) / 10);
}

/** A typed leverage on the 0.1× grid between 1 and `max`, else undefined. Blank is 1×. */
export function parseLeverage(raw: string | undefined, max: number): number | undefined {
  const typed = text(raw);
  if (typed === '') return 1;
  const value = parseNumber(typed.replace(/[x×倍]$/i, ''));
  if (value === undefined) return undefined;
  const tenths = Math.round(value * 10);
  if (Math.abs(value * 10 - tenths) > 1e-6) return undefined;
  return tenths >= 10 && tenths <= Math.round(max * 10) ? tenths / 10 : undefined;
}

/**
 * A trade from the form. `maxLeverage` is config leverage's max; before that setting exists every
 * trade is 1×. A short is a sell that opens and a buy that closes (positions.ts).
 */
export function parseTrade(raw: RawForm, securities: ReadonlyMap<string, Security>, today: string, maxLeverage = 1): Parsed<TradeInput, TradeField> {
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
  const direction = oneOf(raw['direction'] || 'long', ['long', 'short'] as const);
  if (!direction) errors.direction = MESSAGES.choice;
  const leverage = parseLeverage(raw['leverage'], maxLeverage);
  if (leverage === undefined) errors.leverage = MESSAGES.leverage;
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
    direction: direction as Direction,
    leverage: leverage as number,
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
// Stock splits (N5)
// ---------------------------------------------------------------------------

export interface SplitInput {
  ticker: string;
  exDate: string;
  ratio: number;
  note: string | null;
}

export type SplitField = 'ticker' | 'exDate' | 'oldShares' | 'newShares' | 'note';

export const SPLIT_MESSAGES = {
  shares: { en: 'Enter a number of shares above 0.', zh: '請輸入大於 0 的股數。' },
  noChange: { en: 'A split changes the share count: the two numbers cannot be equal.', zh: '分割會改變股數：兩個數字不能相同。' },
  range: { en: 'A split of more than 1 into 100 is unlikely: check the two numbers.', zh: '分割超過 1 拆 100 不太可能，請檢查兩個數字。' },
  taken: { en: 'This security already has a split on that date.', zh: '這檔證券在這一天已有分割紀錄。' },
  future: { en: 'Enter the split once its ex-date arrives: until then the prices are still in old shares.', zh: '請在除權（分割生效）日當天或之後再登錄：在那之前價格仍以舊股計。' },
};

/**
 * A split as N old shares become M new ones on its ex-date; ratio M ÷ N. The form names the
 * security `security`, as the security's own form on the same page holds `ticker`. Not in the future, since
 * the closes before the ex-date are still in old shares, and one split per security a day.
 */
export function parseSplitForm(raw: RawForm, tickers: readonly string[], taken: readonly { ticker: string; exDate: string }[], today: string): Parsed<SplitInput, SplitField> {
  const errors: FieldErrors<SplitField> = {};
  const ticker = oneOf(text(raw['security']).toUpperCase(), tickers);
  if (!ticker) errors.ticker = MESSAGES.unknownTicker;
  const exDate = text(raw['exDate']);
  if (!isIsoDate(exDate)) errors.exDate = MESSAGES.date;
  else if (exDate > today) errors.exDate = SPLIT_MESSAGES.future;
  else if (ticker && taken.some((split) => split.ticker === ticker && split.exDate === exDate)) errors.exDate = SPLIT_MESSAGES.taken;
  const oldShares = parseNumber(raw['oldShares']);
  if (oldShares === undefined || oldShares <= 0) errors.oldShares = SPLIT_MESSAGES.shares;
  const newShares = parseNumber(raw['newShares']);
  if (newShares === undefined || newShares <= 0) errors.newShares = SPLIT_MESSAGES.shares;
  const ratio = oldShares && newShares ? newShares / oldShares : undefined;
  if (ratio !== undefined && Math.abs(ratio - 1) < 1e-9) errors.newShares = SPLIT_MESSAGES.noChange;
  else if (ratio !== undefined && (ratio > 100 || ratio < 0.01)) errors.newShares = SPLIT_MESSAGES.range;
  const note = text(raw['note']);
  if (note.length > 300) errors.note = MESSAGES.tooLong;
  return finish(errors, () => ({ ticker: ticker as string, exDate, ratio: ratio as number, note: note === '' ? null : note }));
}
