/**
 * Form parsing shared by the browser (instant feedback) and the server actions (the authority;
 * the server never trusts what the browser sends). Every error message is bilingual.
 */
import { isIsoDate } from './dates';
import type { Bilingual } from './i18n';
import type { AssetClass, Market, Pool, ProductType, Security, Side } from './models/types';

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
