/**
 * Form parsing shared by the browser (instant feedback) and the server actions (the authority;
 * the server never trusts what the browser sends). Every error message is bilingual.
 */
import { isIsoDate, isMonth } from './dates';
import type { Bilingual } from './i18n';
import type { Broker, FeeSchedule, FeeSettings, FundCost, TaxSettings } from './models/costs';
import type { DraftOrder } from './models/engine';
import type { SavedPlan } from './models/projection';
import type { LookThroughSettings } from './models/look-through';
import type { FrontierSettings } from './models/frontier';
import type { McSettings } from './models/monte-carlo';
import { MAX_GOALS, type Goal, type TimelineSettings } from './models/timeline';
import type { SectorProxy, SectorSettings } from './models/sectors';
import { GOVERNANCE_TIERS, MANUAL_INDICATORS, type ManualIndicator, type RedFlagSettings } from './models/red-flags';
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
  shareDecimals: { en: 'Enter 1 to 4 decimals.', zh: '請輸入 1 到 4 位小數。' },
  clock: { en: 'Enter a time as HH:MM, 24-hour, e.g. 23:00.', zh: '請以 24 小時制 HH:MM 輸入時間，例如 23:00。' },
  quietSame: { en: 'The quiet hours cannot start and end at the same time.', zh: '安靜時段的開始與結束時間不能相同。' },
  weekday: { en: 'Pick a day of the week.', zh: '請選擇星期幾。' },
  rate: { en: 'Enter a percentage from 0 to 100, with at most four decimals, e.g. 0.1425.', zh: '請輸入 0 到 100 的百分比，最多四位小數，例如 0.1425。' },
  discount: { en: 'Enter the discount in 折, above 0 up to 10 (10 is no discount), e.g. 2.8.', zh: '請以折數輸入折扣，大於 0、最多 10（10 為不打折），例如 2.8。' },
  usd: { en: 'Enter US$ 0 or more, with at most two decimals.', zh: '請輸入 0 或以上的美元金額，最多兩位小數。' },
  wholeTwdAmount: { en: 'Enter whole NT$, 0 or more.', zh: '請輸入 0 或以上的整數台幣金額。' },
  rateRange: { en: 'The highest rate must not be below the lowest.', zh: '最高稅率不能低於最低稅率。' },
  brokerId: { en: 'Use lowercase letters, digits or "_", up to 20 characters.', zh: '請用小寫英文字母、數字或「_」，最多 20 個字元。' },
  idTaken: { en: 'This id is already used.', zh: '這個代號已經使用過。' },
  trackingDifference: { en: 'Enter a percentage from −10 to 10, with at most four decimals.', zh: '請輸入 −10 到 10 的百分比，最多四位小數。' },
  positiveWholeTwd: { en: 'Enter whole NT$ above 0.', zh: '請輸入大於 0 的整數台幣金額。' },
  cashReturn: { en: 'Enter a yearly return from −10% to 20%.', zh: '請輸入 −10% 到 20% 的年報酬。' },
  riskFree: { en: 'Enter a yearly rate from −5% to 30%.', zh: '請輸入 −5% 到 30% 的年利率。' },
  blume: { en: 'Enter a weight from 0 to 1.', zh: '請輸入 0 到 1 之間的權重。' },
  premium: { en: 'Enter a premium from 0% to 20% a year.', zh: '請輸入每年 0% 到 20% 的溢酬。' },
  fromYear: { en: 'Enter a year from 1871 on.', zh: '請輸入 1871 年以後的年份。' },
  horizonMonths: { en: 'Enter whole months from 12 to 240.', zh: '請輸入 12 到 240 的整數月數。' },
  percentile: { en: 'Enter a percentile from 0 to 100.', zh: '請輸入 0 到 100 的百分位。' },
  trancheCount: { en: 'Enter a whole number of tranches from 1 to 120.', zh: '請輸入 1 到 120 的整數批數。' },
  share: { en: 'Enter a percentage above 0, up to 100.', zh: '請輸入大於 0、最多 100 的百分比。' },
  drawdown: { en: 'Enter a fall in percent, above 0 and up to 99.', zh: '請輸入大於 0、最多 99 的跌幅百分比。' },
  ascending: { en: 'Must be above the one before it.', zh: '必須大於前一個數值。' },
  growth: { en: 'Enter a yearly growth from −20% to 40%.', zh: '請輸入 −20% 到 40% 之間的年成長率。' },
  terminal: { en: 'Enter a terminal growth from −2% to 6%.', zh: '請輸入 −2% 到 6% 之間的永續成長率。' },
  scenarioOrder: { en: 'Bear ≤ base ≤ bull.', zh: '悲觀 ≤ 基本 ≤ 樂觀。' },
  forecastYears: { en: 'Enter whole years from 1 to 20.', zh: '請輸入 1 到 20 的整數年數。' },
  millions: { en: 'Enter a number in millions, or leave it blank.', zh: '請輸入以百萬為單位的數字，或留白。' },
  positiveMillions: { en: 'Enter a number in millions above 0, or leave it blank.', zh: '請輸入大於 0 的百萬單位數字，或留白。' },
  optionalRate: { en: 'Enter a percentage from 0 to 60, or leave it blank.', zh: '請輸入 0 到 60 的百分比，或留白。' },
  peers: { en: 'List up to 8 single stocks, by ticker, separated by commas; each a security already.', zh: '請以逗號分隔最多 8 檔個股代號，且都已是證券。' },
  buyMultiple: { en: 'Enter a multiple between 0 and 1, e.g. 0.75, or leave it blank.', zh: '請輸入 0 到 1 之間的倍數，例如 0.75，或留白。' },
  trimMultiple: { en: 'Enter a multiple above 1, e.g. 1.25, or leave it blank.', zh: '請輸入大於 1 的倍數，例如 1.25，或留白。' },
  quarters: { en: 'Enter whole quarters from 1 to 40.', zh: '請輸入 1 到 40 的整數季數。' },
  historyYears: { en: 'Enter whole years from 1 to 10.', zh: '請輸入 1 到 10 的整數年數。' },
  scanDays: { en: 'Enter whole days from 1 to 90.', zh: '請輸入 1 到 90 的整數天數。' },
  score: { en: 'Enter a score, e.g. −1.78 or 2.99.', zh: '請輸入分數，例如 −1.78 或 2.99。' },
  industryCodes: { en: 'List two-digit TWSE industry codes, e.g. 24, 28.', zh: '請列出兩位數的證交所產業別代碼，例如 24、28。' },
  topCompanies: { en: 'Enter a whole number from 5 to 100.', zh: '請輸入 5 到 100 的整數。' },
  codeSectors: { en: 'One per line: a TWSE industry code, "=", a GICS sector, e.g. 24 = Information Technology.', zh: '每行一個：證交所產業別代碼、「=」、GICS 產業，例如 24 = 資訊科技。' },
  indexSectors: { en: 'One per line: an industry index already listed, "=", a GICS sector, e.g. Electronic = Information Technology.', zh: '每行一個：清單中的類股指數、「=」、GICS 產業，例如 Electronic = 資訊科技。' },
  mcTarget: { en: 'Enter whole NT$ above 0 (in today’s money), or leave it blank.', zh: '請輸入大於 0 的整數台幣金額（以今天幣值計），或留白。' },
  mcWindfallMonth: { en: 'Enter the month the money arrives as YYYY-MM.', zh: '請以 YYYY-MM 輸入入帳月份。' },
  mcWindfallAmount: { en: 'Enter whole NT$ above 0, or leave it blank.', zh: '請輸入大於 0 的整數台幣金額，或留白。' },
  goals: { en: 'One per line: month | amount in today’s money (blank for none) | name, e.g. 2045-06 | 3,000,000 | House.', zh: '每行一個：月份 | 以今天幣值計的金額（留白代表沒有）| 名稱，例如 2045-06 | 3,000,000 | 購屋頭期款。' },
  goalCount: { en: `At most ${MAX_GOALS} goals.`, zh: `最多 ${MAX_GOALS} 個目標。` },
  frontierBounds: { en: 'One per line: an asset class id, "=", the minimum and maximum in percent, e.g. us_global_equity = 0 - 50; the minimums must not exceed 100% nor the maximums fall short of it.', zh: '每行一個：資產類別代號、「=」、最小與最大百分比，例如 us_global_equity = 0 - 50；最小值合計不得超過 100%，最大值合計不得低於 100%。' },
  frontierYears: { en: 'Enter whole years from 1 to 30.', zh: '請輸入 1 到 30 的整數年數。' },
  fundCountries: { en: 'One per line: a ticker, "=", a two-letter country code, e.g. BIL = US.', zh: '每行一個：代號、「=」、兩個字母的國家代碼，例如 BIL = US。' },
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

/** The message for a fractional order's share count. */
export function fractionalShares(decimals: number): Bilingual {
  return { en: `Enter shares, 0 or more, with at most ${decimals} decimals; 0 drops the order.`, zh: `請輸入股數（0 或以上），最多 ${decimals} 位小數；0 代表刪除這筆。` };
}

/** Each order's new size: shares (whole, or to the order's decimals) for a trade, whole NT$ for a balance; 0 drops it. */
export function parseOrderSizes(raw: RawForm, orders: readonly DraftOrder[]): { sizes: number[]; errors: FieldErrors<string> } {
  const errors: FieldErrors<string> = {};
  const sizes = orders.map((order, index) => {
    const name = sizeField(index);
    const value = parseNumber(raw[name]);
    const decimals = order.kind === 'trade' ? (order.decimals ?? 0) : 0;
    const scaled = value === undefined ? Number.NaN : value * 10 ** decimals;
    if (value === undefined || value < 0 || Math.abs(scaled - Math.round(scaled)) > 1e-6) {
      errors[name] = order.kind === 'balance' ? MESSAGES.wholeTwd : decimals > 0 ? fractionalShares(decimals) : MESSAGES.shares;
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
  /** config orders: US and UK share counts in fractions, and to how many decimals. */
  fractionalUs: boolean;
  fractionalUk: boolean;
  shareDecimals: number;
}

export type EngineSettingsField = keyof EngineSettingsInput;

/** The monthly DCA (config dca), how long a proposal stays open (config proposal_expiry_days) and how orders round shares (config orders). */
export function parseEngineSettings(raw: RawForm): Parsed<EngineSettingsInput, EngineSettingsField> {
  const errors: FieldErrors<EngineSettingsField> = {};
  const dcaAmountTwd = parseNumber(raw['dcaAmountTwd']);
  if (dcaAmountTwd === undefined || dcaAmountTwd < 0) errors.dcaAmountTwd = MESSAGES.nonNegative;
  const dayText = text(raw['dcaDay']);
  const dcaDay = dayText === '' ? null : parseNumber(dayText);
  if (dcaDay === undefined || (dcaDay !== null && (!Number.isInteger(dcaDay) || dcaDay < 1 || dcaDay > 31))) errors.dcaDay = MESSAGES.dcaDay;
  const expiryDays = parseNumber(raw['expiryDays']);
  if (expiryDays === undefined || !Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 365) errors.expiryDays = MESSAGES.expiryDays;
  const fractionalUs = raw['fractionalUs'] === 'on';
  const fractionalUk = raw['fractionalUk'] === 'on';
  const shareDecimals = parseNumber(raw['shareDecimals']);
  if (shareDecimals === undefined || !Number.isInteger(shareDecimals) || shareDecimals < 1 || shareDecimals > 4) errors.shareDecimals = MESSAGES.shareDecimals;
  return finish(errors, () => ({ dcaAmountTwd: dcaAmountTwd ?? 0, dcaDay: dcaDay ?? null, expiryDays: expiryDays ?? 14, fractionalUs, fractionalUk, shareDecimals: shareDecimals ?? 4 }));
}

// ---------------------------------------------------------------------------
// Web Push: a device's subscription, and when pushes may go (notifications page)
// ---------------------------------------------------------------------------

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceName: string | null;
}

/** A browser's push subscription as the page sends it; undefined when it is not one. */
export function parseSubscription(value: unknown): SubscriptionInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const row = value as Record<string, unknown>;
  const keys = (typeof row['keys'] === 'object' && row['keys'] !== null ? row['keys'] : {}) as Record<string, unknown>;
  const endpoint = typeof row['endpoint'] === 'string' ? row['endpoint'] : '';
  const key = (name: string) => (typeof keys[name] === 'string' && /^[A-Za-z0-9_-]{8,200}={0,2}$/.test(keys[name] as string) ? (keys[name] as string) : undefined);
  const [p256dh, auth] = [key('p256dh'), key('auth')];
  let url: URL | undefined;
  try {
    url = new URL(endpoint);
  } catch {
    url = undefined;
  }
  if (!url || url.protocol !== 'https:' || endpoint.length > 1000 || !p256dh || !auth) return undefined;
  const name = typeof row['deviceName'] === 'string' ? row['deviceName'].trim().slice(0, 60) : '';
  return { endpoint, keys: { p256dh, auth }, deviceName: name || null };
}

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface ScheduleInput {
  quietStart: string;
  quietEnd: string;
  weeklyDay: Weekday;
  weeklyTime: string;
}

export type ScheduleField = keyof ScheduleInput;

function clockText(raw: string | undefined): string | undefined {
  const value = text(raw);
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  return `${match[1]?.padStart(2, '0')}:${match[2]}`;
}

/** Quiet hours (config quiet_hours) and the weekly review's day and time (config weekly_review), in Taipei time. */
export function parseSchedule(raw: RawForm): Parsed<ScheduleInput, ScheduleField> {
  const errors: FieldErrors<ScheduleField> = {};
  const quietStart = clockText(raw['quietStart']);
  if (!quietStart) errors.quietStart = MESSAGES.clock;
  const quietEnd = clockText(raw['quietEnd']);
  if (!quietEnd) errors.quietEnd = MESSAGES.clock;
  else if (quietStart === quietEnd) errors.quietEnd = MESSAGES.quietSame;
  const weeklyDay = oneOf(raw['weeklyDay'], WEEKDAYS);
  if (!weeklyDay) errors.weeklyDay = MESSAGES.weekday;
  const weeklyTime = clockText(raw['weeklyTime']);
  if (!weeklyTime) errors.weeklyTime = MESSAGES.clock;
  return finish(errors, () => ({ quietStart: quietStart ?? '', quietEnd: quietEnd ?? '', weeklyDay: weeklyDay ?? 'sunday', weeklyTime: weeklyTime ?? '' }));
}

// ---------------------------------------------------------------------------
// F15 fee and tax drag (costs page): fees, tax thresholds, brokers, fund costs
// ---------------------------------------------------------------------------

/** "0.1425" (percent) → 0.001425, from min to max, at most four decimals of a percent. */
function ratePercent(raw: string | undefined, min = 0, max = 100): number | undefined {
  const value = parseNumber(raw);
  if (value === undefined || value < min || value > max || Math.abs(Math.round(value * 10_000) - value * 10_000) > 1e-6) return undefined;
  return Math.round(value * 10_000) / 1_000_000;
}

/** The date a form's entry was checked before, carried by a hidden field; only a real date counts. */
function previouslyChecked(raw: RawForm): string | null {
  const value = text(raw['checkedOn']);
  return isIsoDate(value) ? value : null;
}

/** An optional percent: blank is null. */
function optionalRate(raw: string | undefined, min = 0, max = 100): number | null | undefined {
  return text(raw) === '' ? null : ratePercent(raw, min, max);
}

/** US$ with at most two decimals; blank is null. */
function optionalUsd(raw: string | undefined): number | null | undefined {
  if (text(raw) === '') return null;
  const value = parseNumber(raw);
  return value === undefined || value < 0 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6 ? undefined : Math.round(value * 100) / 100;
}

function wholeTwd(raw: string | undefined): number | undefined {
  const value = parseNumber(raw);
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export type FeeField = 'broker' | 'twRate' | 'twDiscount' | 'twMin' | 'fxSpread';

/** config fees: the 複委託 broker the estimates use, the Taiwan commission (rate, discount in 折, minimum) and the default FX spread. */
export function parseFeeForm(raw: RawForm, brokerIds: readonly string[]): Parsed<FeeSettings, FeeField> {
  const errors: FieldErrors<FeeField> = {};
  const broker = text(raw['broker']);
  if (broker !== '' && !brokerIds.includes(broker)) errors.broker = MESSAGES.choice;
  const rate = ratePercent(raw['twRate'], 0, 1);
  if (rate === undefined) errors.twRate = MESSAGES.rate;
  const discount = parseNumber(raw['twDiscount']);
  if (discount === undefined || discount <= 0 || discount > 10) errors.twDiscount = MESSAGES.discount;
  const minTwd = wholeTwd(raw['twMin']);
  if (minTwd === undefined) errors.twMin = MESSAGES.wholeTwdAmount;
  const fxSpread = ratePercent(raw['fxSpread'], 0, 5);
  if (fxSpread === undefined) errors.fxSpread = MESSAGES.rate;
  return finish(errors, () => ({
    brokerId: broker === '' ? null : broker,
    tw: { rate: rate ?? 0, discount: Math.round((discount ?? 10) * 1000) / 10_000, minTwd: minTwd ?? 0 },
    fxSpread: fxSpread ?? 0,
  }));
}

/** Field name of a domicile's withholding rate. */
export function withholdingField(domicile: string): string {
  return `withholding_${domicile}`;
}

export const TAX_FIELDS = ['twStock', 'twEtf', 'twBondEtf', 'amtFloor', 'amtExemption', 'amtRate', 'nhiRate', 'nhiSingle', 'nhiMax', 'estateMin', 'estateMax'] as const;

/** config tax: withholding per domicile already in it, then the Taiwan and US thresholds; `checked` stamps last_verified. */
export function parseTaxForm(raw: RawForm, domiciles: readonly string[]): Parsed<{ tax: TaxSettings; checked: boolean }, string> {
  const errors: FieldErrors<string> = {};
  const withholding: Record<string, number> = {};
  for (const domicile of domiciles) {
    const rate = ratePercent(raw[withholdingField(domicile)]);
    if (rate === undefined) errors[withholdingField(domicile)] = MESSAGES.rate;
    else withholding[domicile] = rate;
  }
  const rate = (name: string, max = 100) => {
    const value = ratePercent(raw[name], 0, max);
    if (value === undefined) errors[name] = MESSAGES.rate;
    return value ?? 0;
  };
  const amount = (name: string) => {
    const value = wholeTwd(raw[name]);
    if (value === undefined) errors[name] = MESSAGES.wholeTwdAmount;
    return value ?? 0;
  };
  const tax: TaxSettings = {
    withholding,
    twTransactionTax: { stock: rate('twStock', 10), etf: rate('twEtf', 10), bondEtf: rate('twBondEtf', 10) },
    amt: { overseasFloorTwd: amount('amtFloor'), exemptionTwd: amount('amtExemption'), rate: rate('amtRate', 99) },
    nhi: { rate: rate('nhiRate', 99), singlePaymentTwd: amount('nhiSingle'), maxPaymentTwd: amount('nhiMax') },
    usEstate: { minRate: rate('estateMin', 99), maxRate: rate('estateMax', 99) },
  };
  if (!errors['estateMax'] && !errors['estateMin'] && tax.usEstate.maxRate < tax.usEstate.minRate) errors['estateMax'] = MESSAGES.rateRange;
  return finish(errors, () => ({ tax, checked: raw['checked'] === 'on' }));
}

/** A schedule from its fields: a flat fee, or a rate with an optional minimum and maximum; all blank is none. */
function scheduleFrom(raw: RawForm, names: { rate?: string; min?: string; max?: string; flat?: string }, errors: FieldErrors<string>): FeeSchedule | null {
  const read = (name: string | undefined, parse: (value: string | undefined) => number | null | undefined, message: Bilingual) => {
    if (!name) return null;
    const value = parse(raw[name]);
    if (value === undefined) errors[name] = message;
    return value ?? null;
  };
  const flat = read(names.flat, optionalUsd, MESSAGES.usd);
  const rate = read(names.rate, (value) => optionalRate(value, 0, 10), MESSAGES.rate);
  const min = read(names.min, optionalUsd, MESSAGES.usd);
  const max = read(names.max, optionalUsd, MESSAGES.usd);
  if (flat !== null) return { rate: 0, min: 0, max: null, flat };
  if (rate === null) return null;
  return { rate, min: min ?? 0, max, flat: null };
}

export const LSE_CHOICES = ['yes', 'no', 'unknown'] as const;

/** A 複委託 broker's prices; `editing` is its id when it is being edited, else a new id is required and must be free. */
export function parseBrokerForm(raw: RawForm, takenIds: readonly string[], editing: string | null, today: string): Parsed<Broker, string> {
  const errors: FieldErrors<string> = {};
  const id = editing ?? text(raw['id']);
  if (editing === null) {
    if (!/^[a-z0-9_]{1,20}$/.test(id)) errors['id'] = MESSAGES.brokerId;
    else if (takenIds.includes(id)) errors['id'] = MESSAGES.idTaken;
  }
  const nameEn = text(raw['nameEn']);
  if (nameEn === '') errors['nameEn'] = MESSAGES.required;
  const usStock = scheduleFrom(raw, { rate: 'usRate', min: 'usMin' }, errors);
  if (usStock === null && !errors['usRate']) errors['usRate'] = MESSAGES.required;
  const usEtf = scheduleFrom(raw, { flat: 'etfFlat' }, errors);
  const usDca = scheduleFrom(raw, { flat: 'dcaFlat', rate: 'dcaRate', max: 'dcaMax' }, errors);
  const uk = scheduleFrom(raw, { rate: 'ukRate', min: 'ukMin' }, errors);
  const lse = oneOf(raw['lseEtfs'], LSE_CHOICES);
  if (!lse) errors['lseEtfs'] = MESSAGES.choice;
  const custody = ratePercent(raw['custody'], 0, 5);
  if (custody === undefined) errors['custody'] = MESSAGES.rate;
  const fxSpread = optionalRate(raw['fxSpread'], 0, 5);
  if (fxSpread === undefined) errors['fxSpread'] = MESSAGES.rate;
  const promo = text(raw['promoUntil']);
  if (promo !== '' && !isIsoDate(promo)) errors['promoUntil'] = MESSAGES.date;
  const source = text(raw['source']);
  const notes = { noteEn: text(raw['noteEn']), noteZh: text(raw['noteZh']) };
  for (const [name, value] of [['source', source], ['noteEn', notes.noteEn], ['noteZh', notes.noteZh]] as const) {
    if (value.length > 500) errors[name] = MESSAGES.tooLong;
  }
  return finish(errors, () => ({
    id,
    nameEn,
    nameZh: text(raw['nameZh']) || nameEn,
    usStock,
    usEtf,
    usDca,
    uk,
    lseEtfs: lse === 'yes' ? true : lse === 'no' ? false : null,
    custodyRate: custody ?? 0,
    fxSpread: fxSpread ?? null,
    promoUntil: promo === '' ? null : promo,
    ...notes,
    source,
    checked: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

/** One fund's costs; `editing` is its ticker when it is being edited, else the ticker is required and must be new. */
export function parseFundForm(raw: RawForm, takenTickers: readonly string[], editing: string | null, assetClasses: ReadonlySet<string>, today: string): Parsed<FundCost, string> {
  const errors: FieldErrors<string> = {};
  const ticker = editing ?? text(raw['ticker']).toUpperCase();
  if (editing === null) {
    if (!/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)) errors['ticker'] = MESSAGES.tickerFormat;
    else if (takenTickers.includes(ticker)) errors['ticker'] = MESSAGES.tickerTaken;
  }
  const assetClassId = text(raw['assetClass']);
  if (!assetClasses.has(assetClassId)) errors['assetClass'] = MESSAGES.choice;
  const domicile = text(raw['domicile']).toUpperCase();
  if (!/^[A-Z]{2}$/.test(domicile)) errors['domicile'] = MESSAGES.country;
  const market = oneOf(raw['market'], ['US', 'TW', 'UK'] as const);
  if (!market) errors['market'] = MESSAGES.choice;
  const distribution = oneOf(raw['distribution'], ['acc', 'dist'] as const);
  if (!distribution) errors['distribution'] = MESSAGES.choice;
  const ter = optionalRate(raw['ter'], 0, 10);
  if (ter === undefined) errors['ter'] = MESSAGES.rate;
  const fundYield = optionalRate(raw['yield'], 0, 50);
  if (fundYield === undefined) errors['yield'] = MESSAGES.rate;
  const withholding = optionalRate(raw['withholding']);
  if (withholding === undefined) errors['withholding'] = MESSAGES.rate;
  const trackingDifference = optionalRate(raw['trackingDifference'], -10, 10);
  if (trackingDifference === undefined) errors['trackingDifference'] = MESSAGES.trackingDifference;
  const name = text(raw['name']);
  const source = text(raw['source']);
  const notes = { noteEn: text(raw['noteEn']), noteZh: text(raw['noteZh']) };
  for (const [field, value] of [['name', name], ['source', source], ['noteEn', notes.noteEn], ['noteZh', notes.noteZh]] as const) {
    if (value.length > 500) errors[field] = MESSAGES.tooLong;
  }
  return finish(errors, () => ({
    ticker,
    name: name || ticker,
    assetClassId,
    domicile,
    market: market ?? 'US',
    distribution: distribution ?? 'dist',
    ter: ter ?? null,
    yield: fundYield ?? null,
    withholding: withholding ?? null,
    trackingDifference: trackingDifference ?? null,
    ...notes,
    source,
    checked: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

// ---------------------------------------------------------------------------
// F3 windfall planner (Windfall page): the plan's start, its settings, the pace and the tiers
// ---------------------------------------------------------------------------

export interface PlanStartInput {
  totalTwd: number;
  startDate: string;
}

/** The windfall to deploy, in whole NT$, and the day the first tranche falls due. */
export function parsePlanStart(raw: RawForm): Parsed<PlanStartInput, 'totalTwd' | 'startDate'> {
  const errors: FieldErrors<'totalTwd' | 'startDate'> = {};
  const totalTwd = parseNumber(raw['totalTwd']);
  if (totalTwd === undefined || !Number.isInteger(totalTwd) || totalTwd <= 0) errors.totalTwd = MESSAGES.positiveWholeTwd;
  const startDate = text(raw['startDate']);
  if (!isIsoDate(startDate)) errors.startDate = MESSAGES.date;
  return finish(errors, () => ({ totalTwd: totalTwd ?? 0, startDate }));
}

/** Field name of a core class's windfall vehicle. */
export function vehicleField(classId: string): string {
  return `vehicle_${classId}`;
}

export interface WindfallSettingsInput {
  vehicles: Record<string, string>;
  cashReturn: number;
  fromYear: number;
  horizonMonths: number;
}

/** Each core class's windfall vehicle (blank: its benchmark; else one of its securities), and the backtest's settings. */
export function parseWindfallSettingsForm(raw: RawForm, classes: ReadonlyMap<string, readonly string[]>): Parsed<WindfallSettingsInput, string> {
  const errors: FieldErrors<string> = {};
  const vehicles: Record<string, string> = {};
  for (const [classId, tickers] of classes) {
    const ticker = text(raw[vehicleField(classId)]);
    if (ticker === '') continue;
    if (!tickers.includes(ticker)) errors[vehicleField(classId)] = MESSAGES.choice;
    else vehicles[classId] = ticker;
  }
  const cashReturn = ratePercent(raw['cashReturn'], -10, 20);
  if (cashReturn === undefined) errors['cashReturn'] = MESSAGES.cashReturn;
  const fromYear = parseNumber(raw['fromYear']);
  if (fromYear === undefined || !Number.isInteger(fromYear) || fromYear < 1871 || fromYear > 2100) errors['fromYear'] = MESSAGES.fromYear;
  const horizonMonths = parseNumber(raw['horizonMonths']);
  if (horizonMonths === undefined || !Number.isInteger(horizonMonths) || horizonMonths < 12 || horizonMonths > 240) errors['horizonMonths'] = MESSAGES.horizonMonths;
  return finish(errors, () => ({ vehicles, cashReturn: cashReturn ?? 0, fromYear: fromYear ?? 1900, horizonMonths: horizonMonths ?? 60 }));
}

export const PACE_FIELDS = ['cutLow', 'cutHigh', 'tranchesLow', 'tranchesMid', 'tranchesHigh', 'tier1', 'tier2', 'tier2Share', 'tier3', 'tier3Share'] as const;
export type PaceField = (typeof PACE_FIELDS)[number];

export interface PaceInput {
  cutoffs: [number, number];
  tranches: [number, number, number];
  /** Three tiers, shallowest first: the first pulls the next tranche forward, the others deploy a share of the cash waiting. */
  tiers: [{ drawdown: number }, { drawdown: number; share: number }, { drawdown: number; share: number }];
}

/** The pace's CAPE cutoffs (percentiles) and tranche counts, and the three acceleration tiers in percent. */
export function parsePaceForm(raw: RawForm): Parsed<PaceInput, PaceField> {
  const errors: FieldErrors<PaceField> = {};
  const percentile = (name: PaceField) => {
    const value = parseNumber(raw[name]);
    if (value === undefined || value < 0 || value > 100) errors[name] = MESSAGES.percentile;
    return value ?? 0;
  };
  const count = (name: PaceField) => {
    const value = parseNumber(raw[name]);
    if (value === undefined || !Number.isInteger(value) || value < 1 || value > 120) errors[name] = MESSAGES.trancheCount;
    return value ?? 1;
  };
  const share = (name: PaceField, max: number) => {
    const value = ratePercent(raw[name], 0, max);
    if (value === undefined || value <= 0) errors[name] = max < 100 ? MESSAGES.drawdown : MESSAGES.share;
    return value ?? 0;
  };
  const cutLow = percentile('cutLow');
  const cutHigh = percentile('cutHigh');
  if (!errors.cutLow && !errors.cutHigh && cutHigh < cutLow) errors.cutHigh = MESSAGES.ascending;
  const tranches: [number, number, number] = [count('tranchesLow'), count('tranchesMid'), count('tranchesHigh')];
  const tier1 = share('tier1', 99);
  const tier2 = share('tier2', 99);
  const tier3 = share('tier3', 99);
  if (!errors.tier1 && !errors.tier2 && tier2 <= tier1) errors.tier2 = MESSAGES.ascending;
  if (!errors.tier2 && !errors.tier3 && tier3 <= tier2) errors.tier3 = MESSAGES.ascending;
  const tier2Share = share('tier2Share', 100);
  const tier3Share = share('tier3Share', 100);
  return finish(errors, () => ({
    cutoffs: [cutLow, cutHigh],
    tranches,
    tiers: [{ drawdown: tier1 }, { drawdown: tier2, share: tier2Share }, { drawdown: tier3, share: tier3Share }],
  }));
}

// ---------------------------------------------------------------------------
// N1 Regression Lab (Phase 2, step 2)
// ---------------------------------------------------------------------------

export const REGRESSION_FIELDS = ['freq', 'windowYears', 'currency', 'blumeWeight', 'rfTWD', 'rfUSD'] as const;
export type RegressionField = (typeof REGRESSION_FIELDS)[number];

export interface RegressionSettingsInput {
  freq: 'daily' | 'weekly' | 'monthly';
  windowYears: number;
  currency: 'local' | 'TWD';
  blumeWeight: number;
  /** Yearly risk-free rates as fractions. */
  riskFree: { TWD: number; USD: number };
  /** Today when "checked today" is ticked, else the date it was checked before. */
  checked: string | null;
}

/** The lab's defaults (the monthly β use them), Blume's weight, and the risk-free rates in percent. */
export function parseRegressionForm(raw: RawForm, windows: readonly number[], today: string): Parsed<RegressionSettingsInput, RegressionField> {
  const errors: FieldErrors<RegressionField> = {};
  const freq = oneOf(raw['freq'], ['daily', 'weekly', 'monthly'] as const);
  if (!freq) errors.freq = MESSAGES.choice;
  const windowYears = parseNumber(raw['windowYears']);
  if (windowYears === undefined || !windows.includes(windowYears)) errors.windowYears = MESSAGES.choice;
  const currency = oneOf(raw['currency'], ['local', 'TWD'] as const);
  if (!currency) errors.currency = MESSAGES.choice;
  const blumeWeight = parseNumber(raw['blumeWeight']);
  if (blumeWeight === undefined || blumeWeight < 0 || blumeWeight > 1) errors.blumeWeight = MESSAGES.blume;
  const twd = ratePercent(raw['rfTWD'], -5, 30);
  if (twd === undefined) errors.rfTWD = MESSAGES.riskFree;
  const usd = ratePercent(raw['rfUSD'], -5, 30);
  if (usd === undefined) errors.rfUSD = MESSAGES.riskFree;
  return finish(errors, () => ({
    freq: freq ?? 'weekly',
    windowYears: windowYears ?? 2,
    currency: currency ?? 'local',
    blumeWeight: blumeWeight ?? 0.67,
    riskFree: { TWD: twd ?? 0, USD: usd ?? 0 },
    checked: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

// ---------------------------------------------------------------------------
// F11 CAPM cost of equity (Phase 2, step 3)
// ---------------------------------------------------------------------------

export interface CapmSettingsInput {
  beta: 'adjusted' | 'raw';
  erpSource: 'damodaran' | 'manual';
  /** Fractions a year. */
  erpManual: number;
  /** By market: the yield used until its series loads, and the country risk premium. */
  markets: Record<string, { riskFree: number; countryPremium: number }>;
  /** Today when "checked today" is ticked, else the date it was checked before. */
  checked: string | null;
}

/** The cost of equity's settings in percent: the ERP and, per market, the fallback yield (rf_US) and the country premium (crp_US). */
export function parseCapmForm(raw: RawForm, markets: readonly string[], today: string): Parsed<CapmSettingsInput, string> {
  const errors: FieldErrors<string> = {};
  const beta = oneOf(raw['beta'], ['adjusted', 'raw'] as const);
  if (!beta) errors['beta'] = MESSAGES.choice;
  const erpSource = oneOf(raw['erpSource'], ['damodaran', 'manual'] as const);
  if (!erpSource) errors['erpSource'] = MESSAGES.choice;
  const erpManual = ratePercent(raw['erpManual'], 0, 20);
  if (erpManual === undefined || erpManual <= 0) errors['erpManual'] = MESSAGES.premium;
  const values: CapmSettingsInput['markets'] = {};
  for (const market of markets) {
    const riskFree = ratePercent(raw[`rf_${market}`], -5, 30);
    if (riskFree === undefined) errors[`rf_${market}`] = MESSAGES.riskFree;
    const countryPremium = ratePercent(raw[`crp_${market}`], 0, 20);
    if (countryPremium === undefined) errors[`crp_${market}`] = MESSAGES.premium;
    values[market] = { riskFree: riskFree ?? 0, countryPremium: countryPremium ?? 0 };
  }
  return finish(errors, () => ({
    beta: beta ?? 'adjusted',
    erpSource: erpSource ?? 'damodaran',
    erpManual: erpManual ?? 0,
    markets: values,
    checked: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

// ---------------------------------------------------------------------------
// F12 valuation workbench (Phase 2, step 4)
// ---------------------------------------------------------------------------

type ScenarioKey = 'bear' | 'base' | 'bull';
const SCENARIO_KEYS: readonly ScenarioKey[] = ['bear', 'base', 'bull'];
type ValuationModel = 'dcf' | 'ddm' | 'multiples';
const VALUATION_MODELS: readonly ValuationModel[] = ['dcf', 'ddm', 'multiples'];

/** Each scenario's rate from `${prefix}_bear` and so on, in percent, in order bear to bull. */
function scenarioRates(raw: RawForm, prefix: string, min: number, max: number, message: Bilingual, errors: FieldErrors<string>): Record<ScenarioKey, number> {
  const out = {} as Record<ScenarioKey, number>;
  for (const scenario of SCENARIO_KEYS) {
    const value = ratePercent(raw[`${prefix}_${scenario}`], min, max);
    if (value === undefined) errors[`${prefix}_${scenario}`] = message;
    out[scenario] = value ?? 0;
  }
  if (!errors[`${prefix}_bear`] && !errors[`${prefix}_base`] && !errors[`${prefix}_bull`] && (out.bear > out.base || out.base > out.bull)) errors[`${prefix}_base`] = MESSAGES.scenarioOrder;
  return out;
}

/** An optional figure typed in millions: blank is null. */
function optionalMillions(raw: string | undefined, positive: boolean): number | null | undefined {
  if (text(raw) === '') return null;
  const value = parseNumber(raw);
  if (value === undefined || (positive && value <= 0)) return undefined;
  return Math.round(value * 1e6);
}

function wholeIn(raw: string | undefined, min: number, max: number): number | undefined {
  const value = parseNumber(raw);
  return value !== undefined && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

export interface AssumptionsInput {
  active: boolean;
  buy: number | null;
  trim: number | null;
  assumptions: {
    model: ValuationModel;
    years: number;
    growth: Record<ScenarioKey, number>;
    terminal: Record<ScenarioKey, number>;
    overrides: { fcff?: number; netDebt?: number; shares?: number; taxRate?: number; costOfDebt?: number };
    peers: string[];
  };
}

/** A stock's assumptions on its Valuation page; FCFF, net debt and shares in millions of the reporting currency. */
export function parseAssumptionsForm(raw: RawForm, stocks: readonly string[], self: string): Parsed<AssumptionsInput, string> {
  const errors: FieldErrors<string> = {};
  const model = oneOf(raw['model'], VALUATION_MODELS);
  if (!model) errors['model'] = MESSAGES.choice;
  const years = wholeIn(raw['years'], 1, 20);
  if (years === undefined) errors['years'] = MESSAGES.forecastYears;
  const growth = scenarioRates(raw, 'growth', -20, 40, MESSAGES.growth, errors);
  const terminal = scenarioRates(raw, 'terminal', -2, 6, MESSAGES.terminal, errors);
  const overrides: AssumptionsInput['assumptions']['overrides'] = {};
  for (const [field, positive] of [['fcff', true], ['netDebt', false], ['shares', true]] as const) {
    const value = optionalMillions(raw[field], positive);
    if (value === undefined) errors[field] = positive ? MESSAGES.positiveMillions : MESSAGES.millions;
    else if (value !== null) overrides[field] = value;
  }
  for (const field of ['taxRate', 'costOfDebt'] as const) {
    const value = optionalRate(raw[field], 0, 60);
    if (value === undefined) errors[field] = MESSAGES.optionalRate;
    else if (value !== null) overrides[field] = value;
  }
  const peers = [...new Set(text(raw['peers']).toUpperCase().split(/[,\s，、]+/).filter(Boolean))];
  if (peers.length > 8 || peers.some((peer) => peer === self || !stocks.includes(peer))) errors['peers'] = MESSAGES.peers;
  const multiple = (field: string, check: (value: number) => boolean, message: Bilingual): number | null => {
    if (text(raw[field]) === '') return null;
    const value = parseNumber(raw[field]);
    if (value === undefined || !check(value)) {
      errors[field] = message;
      return null;
    }
    return value;
  };
  const buy = multiple('buy', (value) => value > 0 && value < 1, MESSAGES.buyMultiple);
  const trim = multiple('trim', (value) => value > 1 && value <= 5, MESSAGES.trimMultiple);
  return finish(errors, () => ({
    active: raw['active'] === 'on',
    buy,
    trim,
    assumptions: { model: model ?? 'dcf', years: years ?? 5, growth, terminal, overrides, peers },
  }));
}

export interface ValuationSettingsInput {
  model: ValuationModel;
  years: number;
  growth: Record<ScenarioKey, number>;
  terminal: Record<ScenarioKey, number>;
  debtSpread: number;
  taxRate: Record<string, number>;
  historyYears: number;
  minQuarters: number;
  checked: string | null;
}

/** config valuation: the defaults a stock starts from. */
export function parseValuationSettingsForm(raw: RawForm, markets: readonly string[], today: string): Parsed<ValuationSettingsInput, string> {
  const errors: FieldErrors<string> = {};
  const model = oneOf(raw['model'], VALUATION_MODELS);
  if (!model) errors['model'] = MESSAGES.choice;
  const years = wholeIn(raw['years'], 1, 20);
  if (years === undefined) errors['years'] = MESSAGES.forecastYears;
  const growth = scenarioRates(raw, 'growth', -20, 40, MESSAGES.growth, errors);
  const terminal = scenarioRates(raw, 'terminal', -2, 6, MESSAGES.terminal, errors);
  const debtSpread = ratePercent(raw['debtSpread'], 0, 20);
  if (debtSpread === undefined) errors['debtSpread'] = MESSAGES.premium;
  const taxRate: Record<string, number> = {};
  for (const market of markets) {
    const value = ratePercent(raw[`tax_${market}`], 0, 60);
    if (value === undefined) errors[`tax_${market}`] = MESSAGES.optionalRate;
    taxRate[market] = value ?? 0;
  }
  const historyYears = wholeIn(raw['historyYears'], 1, 10);
  if (historyYears === undefined) errors['historyYears'] = MESSAGES.historyYears;
  const minQuarters = wholeIn(raw['minQuarters'], 1, 40);
  if (minQuarters === undefined) errors['minQuarters'] = MESSAGES.quarters;
  return finish(errors, () => ({
    model: model ?? 'dcf',
    years: years ?? 5,
    growth,
    terminal,
    debtSpread: debtSpread ?? 0,
    taxRate,
    historyYears: historyYears ?? 5,
    minQuarters: minQuarters ?? 8,
    checked: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

// ---------------------------------------------------------------------------
// The red-flag indicator (N3, Phase 2 step 5)
// ---------------------------------------------------------------------------

export interface FlagEntryInput {
  ticker: string;
  indicator: ManualIndicator;
  asOf: string;
  value: number;
  note: string;
}

export type FlagEntryField = keyof FlagEntryInput;

/** An owner's entry: events found as of a date (0 for checked, none), or the governance evaluation tier. */
export function parseFlagEntryForm(raw: RawForm, tickers: readonly string[], today: string): Parsed<FlagEntryInput, FlagEntryField> {
  const errors: FieldErrors<FlagEntryField> = {};
  const ticker = oneOf(raw['ticker'], tickers);
  if (!ticker) errors.ticker = MESSAGES.choice;
  const indicator = oneOf(raw['indicator'], MANUAL_INDICATORS);
  if (!indicator) errors.indicator = MESSAGES.choice;
  const asOf = text(raw['asOf']);
  if (!isIsoDate(asOf)) errors.asOf = MESSAGES.date;
  else if (asOf > today) errors.asOf = MESSAGES.future;
  const value = parseNumber(raw['value']);
  if (indicator === 'governance_rating') {
    if (value === undefined || !(GOVERNANCE_TIERS as readonly number[]).includes(value)) errors.value = MESSAGES.choice;
  } else if (value === undefined || !Number.isInteger(value) || value < 0 || value > 999) {
    errors.value = MESSAGES.wholeNumber;
  }
  const note = text(raw['note']);
  if (note.length > 300) errors.note = MESSAGES.tooLong;
  return finish(errors, () => ({ ticker: ticker as string, indicator: indicator as ManualIndicator, asOf, value: value as number, note }));
}

/** A list typed one per line or separated by commas, blanks dropped. */
export function listField(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(/[\n,，、]/).map((entry) => entry.trim()).filter(Boolean))];
}

export type FlagSettingsField =
  | 'lookbackYears'
  | 'scanDays'
  | 'beneish'
  | 'zRed'
  | 'zAmber'
  | 'z2Red'
  | 'z2Amber'
  | 'cashFlowYears'
  | 'governance'
  | 'manufacturing'
  | 'financial'
  | 'industries'
  | 'tickers';

function score(raw: string | undefined, min: number, max: number): number | undefined {
  const value = parseNumber(raw);
  return value !== undefined && value >= min && value <= max ? Math.round(value * 1000) / 1000 : undefined;
}

/** config red_flags: thresholds, the Taiwan industries counted as manufacturers and as financial, and the exclusion list. */
export function parseFlagSettingsForm(raw: RawForm, current: RedFlagSettings, today: string): Parsed<RedFlagSettings, FlagSettingsField> {
  const errors: FieldErrors<FlagSettingsField> = {};
  const lookbackYears = wholeIn(raw['lookbackYears'], 1, 10);
  if (lookbackYears === undefined) errors.lookbackYears = MESSAGES.historyYears;
  const scanDays = wholeIn(raw['scanDays'], 1, 90);
  if (scanDays === undefined) errors.scanDays = MESSAGES.scanDays;
  const beneish = score(raw['beneish'], -10, 10);
  if (beneish === undefined) errors.beneish = MESSAGES.score;
  const zone = (redKey: FlagSettingsField, amberKey: FlagSettingsField) => {
    const [red, amber] = [score(raw[redKey], 0, 10), score(raw[amberKey], 0, 10)];
    if (red === undefined) errors[redKey] = MESSAGES.score;
    if (amber === undefined) errors[amberKey] = MESSAGES.score;
    else if (red !== undefined && amber < red) errors[amberKey] = MESSAGES.ascending;
    return { redBelow: red ?? 0, amberBelow: amber ?? 0 };
  };
  const z = zone('zRed', 'zAmber');
  const z2 = zone('z2Red', 'z2Amber');
  const cashFlowYears = wholeIn(raw['cashFlowYears'], 1, 10);
  if (cashFlowYears === undefined) errors.cashFlowYears = MESSAGES.historyYears;
  const bottom = percentField(raw['governance'], 1, 99);
  if (bottom === undefined) errors.governance = MESSAGES.percent;
  const codes = (key: FlagSettingsField) => {
    const list = listField(raw[key]).map((code) => code.padStart(2, '0'));
    if (list.some((code) => !/^\d{2}$/.test(code))) errors[key] = MESSAGES.industryCodes;
    return list;
  };
  const manufacturing = codes('manufacturing');
  const financial = codes('financial');
  const industries = listField(raw['industries']);
  if (industries.some((entry) => entry.length > 60) || industries.length > 50) errors.industries = MESSAGES.tooLong;
  const tickers = listField(raw['tickers']).map((ticker) => ticker.toUpperCase());
  if (tickers.some((ticker) => !/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker))) errors.tickers = MESSAGES.tickerFormat;
  return finish(errors, () => ({
    ...current,
    lookbackYears: lookbackYears as number,
    scanDays: scanDays as number,
    beneish: { redAbove: beneish as number },
    altman: { z, z2 },
    cashFlowYears: cashFlowYears as number,
    governanceBottomShare: bottom as number,
    manufacturing: { ...current.manufacturing, twIndustries: manufacturing },
    financial: { ...current.financial, twIndustries: financial },
    excluded: { industries, tickers },
    lastVerified: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

// ---------------------------------------------------------------------------
// The combined look-through (F14, Phase 2 step 6)
// ---------------------------------------------------------------------------

export type LookThroughField = 'topCompanies' | 'refreshDays' | 'twSectors' | 'fundCountry';

/** "24 = Information Technology", one per line, to {"24": "Information Technology"}; the Chinese sector names are read too. */
export function parseCodeSectors(raw: string | undefined, sectors: ReadonlyMap<string, string>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of (raw ?? '').split('\n').map((one) => one.trim()).filter(Boolean)) {
    const match = /^(\d{1,2})\s*[=:：]\s*(.+)$/.exec(line);
    const sector = match ? sectors.get((match[2] as string).trim().toLowerCase()) : undefined;
    if (!match || !sector) return undefined;
    out[(match[1] as string).padStart(2, '0')] = sector;
  }
  return out;
}

/** "BIL = US", one per line, to {"BIL": "US"}. */
export function parseFundCountries(raw: string | undefined): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of (raw ?? '').split('\n').map((one) => one.trim()).filter(Boolean)) {
    const match = /^([A-Za-z0-9.-]{1,12})\s*[=:：]\s*([A-Za-z]{2})$/.exec(line);
    if (!match) return undefined;
    out[(match[1] as string).toUpperCase()] = (match[2] as string).toUpperCase();
  }
  return out;
}

/** config look_through: companies named, days between holdings files, each TWSE industry's sector, each whole fund's country. */
export function parseLookThroughForm(raw: RawForm, current: LookThroughSettings, sectorNames: ReadonlyMap<string, string>, today: string): Parsed<LookThroughSettings, LookThroughField> {
  const errors: FieldErrors<LookThroughField> = {};
  const topCompanies = wholeIn(raw['topCompanies'], 5, 100);
  if (topCompanies === undefined) errors.topCompanies = MESSAGES.topCompanies;
  const refreshDays = wholeIn(raw['refreshDays'], 1, 90);
  if (refreshDays === undefined) errors.refreshDays = MESSAGES.scanDays;
  const twSectors = parseCodeSectors(raw['twSectors'], sectorNames);
  if (!twSectors) errors.twSectors = MESSAGES.codeSectors;
  const fundCountry = parseFundCountries(raw['fundCountry']);
  if (!fundCountry) errors.fundCountry = MESSAGES.fundCountries;
  return finish(errors, () => ({
    ...current,
    topCompanies: topCompanies as number,
    refreshDays: refreshDays as number,
    twSectors: twSectors as Record<string, string>,
    fundCountry: fundCountry as Record<string, string>,
    lastVerified: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

// ---------------------------------------------------------------------------
// The sector tab (N7, Phase 2 step 7)
// ---------------------------------------------------------------------------

export type SectorField = 'colour' | 'tw';

/** config sectors: the colour convention and each Taiwan industry index's GICS sector, "Electronic = Information Technology" per line. */
export function parseSectorForm(raw: RawForm, current: SectorSettings, sectorNames: ReadonlyMap<string, string>, today: string): Parsed<SectorSettings, SectorField> {
  const errors: FieldErrors<SectorField> = {};
  const colour = oneOf(raw['colour'], ['red_up', 'green_up'] as const);
  if (!colour) errors.colour = MESSAGES.choice;
  const known = new Map(current.proxies.filter((proxy) => proxy.market === 'TW').map((proxy) => [proxy.symbol.toLowerCase(), proxy]));
  const tw: SectorProxy[] = [];
  for (const line of (raw['tw'] ?? '').split('\n').map((one) => one.trim()).filter(Boolean)) {
    const match = /^([A-Za-z]+)\s*[=:：]\s*(.+)$/.exec(line);
    const proxy = match ? known.get((match[1] as string).toLowerCase()) : undefined;
    const sector = match ? sectorNames.get((match[2] as string).trim().toLowerCase()) : undefined;
    if (!proxy || !sector) {
      errors.tw = MESSAGES.indexSectors;
      break;
    }
    tw.push({ ...proxy, sector });
  }
  return finish(errors, () => ({ ...current, colour: colour as SectorSettings['colour'], proxies: [...current.proxies.filter((proxy) => proxy.market === 'US'), ...tw], lastVerified: raw['checked'] === 'on' ? today : previouslyChecked(raw) }));
}

// ---------------------------------------------------------------------------
// Monte Carlo (F5)
// ---------------------------------------------------------------------------

export type McField = 'target' | 'windfallAmount' | 'windfallMonth' | 'windfallTranches';

/** config monte_carlo's goal in today's money and the expected windfall; the rest of the row stays as it is. */
export function parseMonteCarloForm(raw: RawForm, current: McSettings): Parsed<McSettings, McField> {
  const errors: FieldErrors<McField> = {};
  const blank = (name: string) => text(raw[name]) === '';
  let target: number | null = null;
  if (!blank('target')) {
    const value = wholeTwd(raw['target']);
    if (value === undefined || value <= 0) errors.target = MESSAGES.mcTarget;
    else target = value;
  }
  let amount: number | null = null;
  if (!blank('windfallAmount')) {
    const value = wholeTwd(raw['windfallAmount']);
    if (value === undefined || value <= 0) errors.windfallAmount = MESSAGES.mcWindfallAmount;
    else amount = value;
  }
  const month = text(raw['windfallMonth']);
  if (amount !== null && !isMonth(month)) errors.windfallMonth = MESSAGES.mcWindfallMonth;
  if (amount === null && month !== '' && !isMonth(month)) errors.windfallMonth = MESSAGES.mcWindfallMonth;
  const tranches = blank('windfallTranches') ? current.windfall.tranches : parseNumber(raw['windfallTranches']);
  if (tranches === undefined || !Number.isInteger(tranches) || tranches < 1 || tranches > 120) errors.windfallTranches = MESSAGES.trancheCount;
  return finish(errors, () => ({
    ...current,
    targetTwd: target,
    windfall: { amountTwd: amount, month: isMonth(month) ? month : null, tranches: tranches ?? current.windfall.tranches },
  }));
}

// ---------------------------------------------------------------------------
// Life timeline (F1)
// ---------------------------------------------------------------------------

export type TimelineField = 'goals';

/** config timeline: "2045-06 | 3,000,000 | House" per line. */
export function parseTimelineForm(raw: RawForm): Parsed<TimelineSettings, TimelineField> {
  const errors: FieldErrors<TimelineField> = {};
  const goals: Goal[] = [];
  const lines = (raw['goals'] ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_GOALS) errors.goals = MESSAGES.goalCount;
  for (const line of lines) {
    const [month = '', amount = '', ...rest] = line.split('|').map((part) => part.trim());
    const name = rest.join('|').trim();
    const value = amount === '' ? null : wholeTwd(amount);
    if (!isMonth(month) || value === undefined || value === 0 || name === '' || name.length > 60) {
      errors.goals = MESSAGES.goals;
      break;
    }
    goals.push({ month, amountTwd: value, name });
  }
  return finish(errors, () => ({ goals: goals.sort((a, b) => a.month.localeCompare(b.month)) }));
}

// ---------------------------------------------------------------------------
// Efficient frontier (F7)
// ---------------------------------------------------------------------------

export type FrontierField = 'riskFree' | 'lookbackYears' | 'bounds';

/** config frontier: the risk-free rate, the years of history and each class's weight bounds, "us_global_equity = 0 - 50" per line. */
export function parseFrontierForm(raw: RawForm, current: FrontierSettings, classIds: readonly string[], today: string): Parsed<FrontierSettings, FrontierField> {
  const errors: FieldErrors<FrontierField> = {};
  const riskFree = percentField(raw['riskFree'], -5, 30);
  if (riskFree === undefined) errors.riskFree = MESSAGES.riskFree;
  const years = parseNumber(raw['lookbackYears']);
  if (years === undefined || !Number.isInteger(years) || years < 1 || years > 30) errors.lookbackYears = MESSAGES.frontierYears;
  const known = new Set(classIds);
  const bounds: Record<string, [number, number]> = {};
  for (const line of (raw['bounds'] ?? '').split('\n').map((one) => one.trim()).filter(Boolean)) {
    const match = /^([a-z0-9_]+)\s*[=:：]\s*([\d.]+)\s*[-–—]\s*([\d.]+)$/.exec(line);
    const id = match?.[1];
    const min = match ? percentField(match[2], 0, 100) : undefined;
    const max = match ? percentField(match[3], 0, 100) : undefined;
    if (!id || !known.has(id) || min === undefined || max === undefined || min > max) {
      errors.bounds = MESSAGES.frontierBounds;
      break;
    }
    bounds[id] = [min, max];
  }
  const entries = Object.values(bounds);
  if (!errors.bounds && (entries.length === 0 || entries.reduce((sum, bound) => sum + bound[0], 0) > 1 + 1e-9 || entries.reduce((sum, bound) => sum + bound[1], 0) < 1 - 1e-9)) errors.bounds = MESSAGES.frontierBounds;
  return finish(errors, () => ({
    ...current,
    riskFree: riskFree ?? current.riskFree,
    lookbackYears: years ?? current.lookbackYears,
    bounds,
    lastVerified: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}
