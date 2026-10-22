/**
 * F15 fee and tax drag (PRD Module D): what holding and trading the portfolio costs each year, and
 * what each choice of broker and fund would cost over the plan. Pure functions; lib/data.ts loads
 * the config rows (fees, brokers, fund_costs, tax) and the costs page shows every figure with its
 * inputs (design principle 4).
 *
 * Method:
 * - A fee schedule charges its flat fee per order when it has one, else rate × amount, at least
 *   `min` and at most `max`, in the order's trade currency (USD for 複委託). A Taiwan order pays
 *   0.1425% × the broker's discount, at least the minimum, and a sale the transaction tax (config
 *   tax.tw_transaction_tax: 0.3% on stocks, 0.1% on ETFs); both are rounded down to the dollar.
 * - A fund's yearly drag = its TER + its dividend yield × the withholding on that yield: the
 *   fund's own rate if set, else its domicile's (config tax.withholding: a US-domiciled fund pays a
 *   Taiwan resident with 30% withheld; an Irish fund has about 15% withheld on US dividends inside
 *   the fund). Tracking difference is shown beside it, not added, as it already holds the TER.
 * - A broker's cost on an order = its fee + the FX spread on changing the TWD into dollars (the
 *   broker's own, else config fees.fx_spread), as a share of the order.
 * - The cost of a choice over the plan = the plan's final value without the cost minus with it, on
 *   the projection engine (F2): the yearly drag (fund drag + custody) comes off the expected return,
 *   and the trading cost (fee + FX as a share of each order) comes off each contribution.
 */
import { futureValue, monthlyReturn, monthlyStepUp, savedPlan, type Plan, type PlanSettings } from './projection';
import type { Market, ProductType } from './types';
import type { Holding } from './valuation';

// ---------------------------------------------------------------------------
// Settings as the config rows hold them
// ---------------------------------------------------------------------------

/** A broker's charge on one order: `flat` when set, else rate × amount within [min, max]. */
export interface FeeSchedule {
  rate: number;
  min: number;
  max: number | null;
  flat: number | null;
}

/** A 複委託 broker's prices (config brokers), in USD per order. */
export interface Broker {
  id: string;
  nameEn: string;
  nameZh: string;
  /** US shares, ETFs (null: as shares) and its monthly DCA plan, if it has one. */
  usStock: FeeSchedule | null;
  usEtf: FeeSchedule | null;
  usDca: FeeSchedule | null;
  /** London orders; null when not known. */
  uk: FeeSchedule | null;
  /** Whether it offers London-listed (Irish-domiciled) ETFs; null when not known. */
  lseEtfs: boolean | null;
  /** Yearly custody fee as a share of what it holds, 0 when none. */
  custodyRate: number;
  /** Its TWD-to-dollar spread as a share of the amount; null: config fees.fx_spread. */
  fxSpread: number | null;
  /** The last day of the promotion its prices come from, if they do. */
  promoUntil: string | null;
  noteEn: string;
  noteZh: string;
  source: string;
  /** When the owner last checked these prices against the broker's page; null: not yet. */
  checked: string | null;
}

/** The Taiwan broker's commission: 0.1425% × discount (0.6 is 6折), at least minTwd an order. */
export interface TaiwanFees {
  rate: number;
  discount: number;
  minTwd: number;
}

/** config fees: the 複委託 broker the estimates use, the Taiwan commission and the default FX spread. */
export interface FeeSettings {
  brokerId: string | null;
  tw: TaiwanFees | null;
  fxSpread: number | null;
}

export type Distribution = 'acc' | 'dist';

/** One fund's costs (config fund_costs): the vehicles held and the alternatives to compare. */
export interface FundCost {
  ticker: string;
  name: string;
  assetClassId: string;
  domicile: string;
  market: Market;
  distribution: Distribution;
  /** Yearly, 0.0006 is 0.06%; null when not entered. */
  ter: number | null;
  /** The dividend or interest yield the withholding applies to; for an accumulating fund, its index's. */
  yield: number | null;
  /** The share of that yield lost to withholding, when it differs from the domicile's. */
  withholding: number | null;
  trackingDifference: number | null;
  noteEn: string;
  noteZh: string;
  source: string;
  checked: string | null;
}

/** config tax: thresholds and rates that change with the law, with the date they were checked. */
export interface TaxSettings {
  /** Withholding on distributions by fund domicile (ISO code). */
  withholding: Record<string, number>;
  /** Taiwan securities transaction tax on a sale, by kind. */
  twTransactionTax: { stock: number; etf: number; bondEtf: number };
  /** 所得基本稅額: overseas income counts in full from this much a year; the household exemption; the rate. */
  amt: { overseasFloorTwd: number; exemptionTwd: number; rate: number };
  /** 二代健保 supplementary premium on a single Taiwan dividend payment from this much, up to the cap. */
  nhi: { rate: number; singlePaymentTwd: number; maxPaymentTwd: number };
  /** US estate tax on a non-resident's US assets above the exemption (the rule US_ESTATE_TAX holds it). */
  usEstate: { minRate: number; maxRate: number };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function number(value: unknown, ok: (value: number) => boolean = () => true): number | null {
  return typeof value === 'number' && Number.isFinite(value) && ok(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function date(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

const share = (value: number) => value >= 0 && value < 1;
const nonNegative = (value: number) => value >= 0;

export function readSchedule(value: unknown): FeeSchedule | null {
  const row = record(value);
  const flat = number(row['flat'], nonNegative);
  const rate = number(row['rate'], share);
  if (flat === null && rate === null) return null;
  return { rate: rate ?? 0, min: number(row['min'], nonNegative) ?? 0, max: number(row['max'], nonNegative), flat };
}

export function scheduleValue(schedule: FeeSchedule | null): Record<string, number> | null {
  if (!schedule) return null;
  return schedule.flat !== null
    ? { flat: schedule.flat }
    : { rate: schedule.rate, ...(schedule.min > 0 ? { min: schedule.min } : {}), ...(schedule.max !== null ? { max: schedule.max } : {}) };
}

/** config brokers read defensively: an entry without an id and a name is left out. */
export function readBrokers(value: unknown): Broker[] {
  if (!Array.isArray(value)) return [];
  const out: Broker[] = [];
  for (const entry of value) {
    const row = record(entry);
    const id = text(row['id']);
    const nameEn = text(row['name_en']);
    if (!/^[a-z0-9_]+$/.test(id) || nameEn === '' || out.some((broker) => broker.id === id)) continue;
    out.push({
      id,
      nameEn,
      nameZh: text(row['name_zh']) || nameEn,
      usStock: readSchedule(row['us_stock']),
      usEtf: readSchedule(row['us_etf']),
      usDca: readSchedule(row['us_dca']),
      uk: readSchedule(row['uk']),
      lseEtfs: typeof row['lse_etfs'] === 'boolean' ? row['lse_etfs'] : null,
      custodyRate: number(row['custody_rate'], share) ?? 0,
      fxSpread: number(row['fx_spread'], share),
      promoUntil: date(row['promo_until']),
      noteEn: text(row['note_en']),
      noteZh: text(row['note_zh']),
      source: text(row['source']),
      checked: date(row['checked']),
    });
  }
  return out;
}

/** The shape config brokers stores. */
export function brokerValue(broker: Broker): Record<string, unknown> {
  return {
    id: broker.id,
    name_en: broker.nameEn,
    name_zh: broker.nameZh,
    us_stock: scheduleValue(broker.usStock),
    us_etf: scheduleValue(broker.usEtf),
    us_dca: scheduleValue(broker.usDca),
    uk: scheduleValue(broker.uk),
    lse_etfs: broker.lseEtfs,
    custody_rate: broker.custodyRate,
    fx_spread: broker.fxSpread,
    promo_until: broker.promoUntil,
    note_en: broker.noteEn,
    note_zh: broker.noteZh,
    source: broker.source,
    checked: broker.checked,
  };
}

export function readFeeSettings(value: unknown): FeeSettings {
  const row = record(value);
  const tw = record(row['tw']);
  const rate = number(tw['rate'], share);
  const discount = number(tw['discount'], (value) => value > 0 && value <= 1);
  return {
    brokerId: typeof row['broker'] === 'string' && row['broker'] !== '' ? row['broker'] : null,
    tw: rate !== null && discount !== null ? { rate, discount, minTwd: number(tw['min_twd'], nonNegative) ?? 0 } : null,
    fxSpread: number(row['fx_spread'], share),
  };
}

export function feeSettingsValue(settings: FeeSettings): Record<string, unknown> {
  return {
    broker: settings.brokerId,
    tw: settings.tw ? { rate: settings.tw.rate, discount: settings.tw.discount, min_twd: settings.tw.minTwd } : null,
    fx_spread: settings.fxSpread,
  };
}

const MARKETS: readonly Market[] = ['US', 'TW', 'UK'];

/** config fund_costs read defensively: an entry without a ticker, class, domicile and market is left out. */
export function readFundCosts(value: unknown): FundCost[] {
  if (!Array.isArray(value)) return [];
  const out: FundCost[] = [];
  for (const entry of value) {
    const row = record(entry);
    const ticker = text(row['ticker']);
    const market = row['market'];
    const domicile = text(row['domicile']);
    const assetClassId = text(row['asset_class_id']);
    if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(ticker) || !MARKETS.includes(market as Market) || !/^[A-Z]{2}$/.test(domicile) || assetClassId === '') continue;
    if (out.some((fund) => fund.ticker === ticker)) continue;
    out.push({
      ticker,
      name: text(row['name']) || ticker,
      assetClassId,
      domicile,
      market: market as Market,
      distribution: row['distribution'] === 'acc' ? 'acc' : 'dist',
      ter: number(row['ter'], share),
      yield: number(row['yield'], share),
      withholding: number(row['withholding'], (value) => value >= 0 && value <= 1),
      trackingDifference: number(row['tracking_difference'], (value) => Math.abs(value) < 1),
      noteEn: text(row['note_en']),
      noteZh: text(row['note_zh']),
      source: text(row['source']),
      checked: date(row['checked']),
    });
  }
  return out;
}

export function fundCostValue(fund: FundCost): Record<string, unknown> {
  return {
    ticker: fund.ticker,
    name: fund.name,
    asset_class_id: fund.assetClassId,
    domicile: fund.domicile,
    market: fund.market,
    distribution: fund.distribution,
    ter: fund.ter,
    yield: fund.yield,
    withholding: fund.withholding,
    tracking_difference: fund.trackingDifference,
    note_en: fund.noteEn,
    note_zh: fund.noteZh,
    source: fund.source,
    checked: fund.checked,
  };
}

/** config tax read defensively; undefined while a part the checks need is missing. */
export function readTaxSettings(value: unknown): TaxSettings | undefined {
  const row = record(value);
  const withholding: Record<string, number> = {};
  for (const [domicile, rate] of Object.entries(record(row['withholding']))) {
    const found = number(rate, (value) => value >= 0 && value <= 1);
    if (/^[A-Z]{2}$/.test(domicile) && found !== null) withholding[domicile] = found;
  }
  const tw = record(row['tw_transaction_tax']);
  const amt = record(row['amt']);
  const nhi = record(row['nhi']);
  const estate = record(row['us_estate']);
  const parts = {
    stock: number(tw['stock'], share),
    etf: number(tw['etf'], share),
    bondEtf: number(tw['bond_etf'], share) ?? 0,
    floor: number(amt['overseas_floor_twd'], nonNegative),
    exemption: number(amt['exemption_twd'], nonNegative),
    amtRate: number(amt['rate'], share),
    nhiRate: number(nhi['rate'], share),
    single: number(nhi['single_payment_twd'], nonNegative),
    cap: number(nhi['max_payment_twd'], nonNegative),
    minRate: number(estate['min_rate'], share),
    maxRate: number(estate['max_rate'], share),
  };
  if (Object.values(parts).some((part) => part === null)) return undefined;
  return {
    withholding,
    twTransactionTax: { stock: parts.stock as number, etf: parts.etf as number, bondEtf: parts.bondEtf },
    amt: { overseasFloorTwd: parts.floor as number, exemptionTwd: parts.exemption as number, rate: parts.amtRate as number },
    nhi: { rate: parts.nhiRate as number, singlePaymentTwd: parts.single as number, maxPaymentTwd: parts.cap as number },
    usEstate: { minRate: parts.minRate as number, maxRate: parts.maxRate as number },
  };
}

export function taxSettingsValue(tax: TaxSettings): Record<string, unknown> {
  return {
    withholding: tax.withholding,
    tw_transaction_tax: { stock: tax.twTransactionTax.stock, etf: tax.twTransactionTax.etf, bond_etf: tax.twTransactionTax.bondEtf },
    amt: { overseas_floor_twd: tax.amt.overseasFloorTwd, exemption_twd: tax.amt.exemptionTwd, rate: tax.amt.rate },
    nhi: { rate: tax.nhi.rate, single_payment_twd: tax.nhi.singlePaymentTwd, max_payment_twd: tax.nhi.maxPaymentTwd },
    us_estate: { min_rate: tax.usEstate.minRate, max_rate: tax.usEstate.maxRate },
  };
}

// ---------------------------------------------------------------------------
// Fees on one order
// ---------------------------------------------------------------------------

/** What a schedule charges on an order of `amount`, in the schedule's currency. */
export function scheduleFee(schedule: FeeSchedule, amount: number): number {
  if (amount <= 0) return 0;
  if (schedule.flat !== null) return schedule.flat;
  const fee = Math.max(schedule.rate * amount, schedule.min);
  return schedule.max === null ? fee : Math.min(fee, schedule.max);
}

/** The amount from which a minimum fee no longer applies (min ÷ rate); null without one. */
export function minimumUpTo(schedule: FeeSchedule): number | null {
  return schedule.flat === null && schedule.min > 0 && schedule.rate > 0 ? schedule.min / schedule.rate : null;
}

/** Shares pay the share schedule; every listed fund the ETF one where the broker has one. */
export function usSchedule(broker: Broker, productType: ProductType): FeeSchedule | null {
  return productType === 'stock' ? broker.usStock : (broker.usEtf ?? broker.usStock);
}

/** The broker schedule a market's orders pay; null for Taiwan, which has its own. */
export function brokerSchedule(broker: Broker, market: Market, productType: ProductType): FeeSchedule | null {
  if (market === 'US') return usSchedule(broker, productType);
  if (market === 'UK') return broker.uk;
  return null;
}

export function twCommission(amountTwd: number, fees: TaiwanFees): number {
  if (amountTwd <= 0) return 0;
  return Math.max(Math.floor(amountTwd * fees.rate * fees.discount), fees.minTwd);
}

export function twTransactionTax(amountTwd: number, productType: ProductType, tax: TaxSettings): number {
  const rate = productType === 'stock' ? tax.twTransactionTax.stock : productType === 'bond_etf' ? tax.twTransactionTax.bondEtf : tax.twTransactionTax.etf;
  return Math.floor(amountTwd * rate);
}

/** An order as the fee estimate needs it. */
export interface PricedOrder {
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  currency: string;
  /** TWD per unit of the currency. */
  fxRate: number;
}

/** Estimated fee and tax on one order, in its trade currency and in TWD; `known` false when no schedule covers it. */
export interface OrderCost {
  fee: number;
  tax: number;
  feeTwd: number;
  taxTwd: number;
  known: boolean;
}

export interface CostSettings {
  broker: Broker | null;
  tw: TaiwanFees | null;
  tax: TaxSettings | undefined;
}

export function orderCost(order: PricedOrder, security: { market: Market; productType: ProductType }, settings: CostSettings): OrderCost {
  const amount = order.qty * order.price;
  const unknown: OrderCost = { fee: 0, tax: 0, feeTwd: 0, taxTwd: 0, known: false };
  if (security.market === 'TW') {
    if (!settings.tw) return unknown;
    const fee = twCommission(amount, settings.tw);
    const tax = order.side === 'sell' && settings.tax ? twTransactionTax(amount, security.productType, settings.tax) : 0;
    return { fee, tax, feeTwd: fee * order.fxRate, taxTwd: tax * order.fxRate, known: order.side === 'buy' || settings.tax !== undefined };
  }
  const schedule = settings.broker ? brokerSchedule(settings.broker, security.market, security.productType) : null;
  if (!schedule) return unknown;
  const fee = Math.round(scheduleFee(schedule, amount) * 100) / 100;
  return { fee, tax: 0, feeTwd: fee * order.fxRate, taxTwd: 0, known: true };
}

// ---------------------------------------------------------------------------
// Fund drag and the portfolio's yearly cost
// ---------------------------------------------------------------------------

export interface FundDrag {
  ter: number | null;
  yield: number | null;
  /** The rate withheld on the yield; null when neither the fund nor its domicile has one. */
  withholding: number | null;
  /** yield × withholding; 0 for a fund without a yield. */
  withholdingDrag: number | null;
  /** TER + withholding drag; null while either is unknown. */
  total: number | null;
}

export function withholdingRate(fund: Pick<FundCost, 'withholding' | 'domicile'>, tax: TaxSettings | undefined): number | null {
  return fund.withholding ?? tax?.withholding[fund.domicile] ?? null;
}

export function fundDrag(fund: FundCost, tax: TaxSettings | undefined): FundDrag {
  const withholding = withholdingRate(fund, tax);
  // Nothing withheld (a Taiwan fund at home) or nothing paid out costs nothing, whatever the other is.
  const withholdingDrag = fund.yield === 0 || withholding === 0 ? 0 : fund.yield !== null && withholding !== null ? fund.yield * withholding : null;
  return {
    ter: fund.ter,
    yield: fund.yield,
    withholding,
    withholdingDrag,
    total: fund.ter !== null && withholdingDrag !== null ? fund.ter + withholdingDrag : null,
  };
}

/** One holding's yearly cost: its fund's drag, plus the broker's custody fee on what it holds abroad. */
export interface HoldingCost {
  key: string;
  label: string;
  ticker: string | null;
  valueTwd: number;
  drag: FundDrag | null;
  custody: number;
  /** Yearly share of the holding's value; null while unknown. */
  rate: number | null;
  yearlyTwd: number | null;
}

export interface PortfolioCost {
  rows: HoldingCost[];
  valueTwd: number;
  /** The yearly cost of the holdings whose drag is known. */
  yearlyTwd: number;
  /** yearlyTwd ÷ the value of those holdings. */
  rate: number | null;
  /** Value whose drag is not known yet (no fund costs entered). */
  unknownTwd: number;
}

/**
 * Every priced holding, both pools: a fund or a share by its fund_costs entry (a share's TER is 0;
 * its yield carries the withholding); gold in grams and TWD balances cost nothing a year. Custody
 * applies to what is held through the 複委託 broker (US and London listings).
 */
export function portfolioCost(holdings: readonly Holding[], funds: ReadonlyMap<string, FundCost>, tax: TaxSettings | undefined, broker: Broker | null): PortfolioCost {
  const rows: HoldingCost[] = [];
  for (const holding of holdings) {
    const valueTwd = holding.valueTwd ?? 0;
    if (valueTwd <= 0) continue;
    const custody = holding.market === 'US' || holding.market === 'UK' ? (broker?.custodyRate ?? 0) : 0;
    let drag: FundDrag | null;
    if (holding.ticker === null) {
      drag = { ter: 0, yield: 0, withholding: null, withholdingDrag: 0, total: 0 };
    } else {
      const fund = funds.get(holding.ticker);
      drag = fund ? fundDrag(fund, tax) : null;
    }
    const rate = drag === null || drag.total === null ? null : drag.total + custody;
    rows.push({ key: holding.key, label: holding.label, ticker: holding.ticker, valueTwd, drag, custody, rate, yearlyTwd: rate === null ? null : rate * valueTwd });
  }
  const known = rows.filter((row) => row.yearlyTwd !== null);
  const knownValue = known.reduce((sum, row) => sum + row.valueTwd, 0);
  const yearlyTwd = known.reduce((sum, row) => sum + (row.yearlyTwd ?? 0), 0);
  const valueTwd = rows.reduce((sum, row) => sum + row.valueTwd, 0);
  return { rows, valueTwd, yearlyTwd, rate: knownValue > 0 ? yearlyTwd / knownValue : null, unknownTwd: valueTwd - knownValue };
}

// ---------------------------------------------------------------------------
// Brokers compared on a typical order
// ---------------------------------------------------------------------------

/** A broker's cost on one order of `orderTwd`: fee (in USD and TWD) plus the FX spread. */
export interface BrokerQuote {
  feeUsd: number;
  feeTwd: number;
  fxTwd: number;
  costTwd: number;
  /** costTwd ÷ orderTwd. */
  share: number;
}

export function quoteOrder(schedule: FeeSchedule | null, orderTwd: number, usdTwd: number, spread: number): BrokerQuote | null {
  if (!schedule || orderTwd <= 0 || usdTwd <= 0) return null;
  const feeUsd = scheduleFee(schedule, orderTwd / usdTwd);
  const feeTwd = feeUsd * usdTwd;
  const fxTwd = orderTwd * spread;
  return { feeUsd, feeTwd, fxTwd, costTwd: feeTwd + fxTwd, share: (feeTwd + fxTwd) / orderTwd };
}

export function spreadOf(broker: Broker, settings: FeeSettings): number {
  return broker.fxSpread ?? settings.fxSpread ?? 0;
}

// ---------------------------------------------------------------------------
// The cost of a choice over the plan
// ---------------------------------------------------------------------------

/**
 * The plan costs are measured over: the saved F2 plan, else what the calculator offers until one
 * is saved (today's regular pool, the DCA amount and the target mix's return, with config
 * projection's step-up, inflation and years); null while there is no expected return.
 */
export function planForCosts(settings: PlanSettings | undefined, today: { poolTwd: number; dcaTwd: number | null; mixReturn: number | null }): { plan: Plan; saved: boolean } | null {
  if (!settings) return null;
  const saved = savedPlan(settings);
  if (saved) return { plan: saved, saved: true };
  const expectedReturn = settings.expectedReturn ?? today.mixReturn;
  const pmt = settings.pmt ?? today.dcaTwd;
  if (expectedReturn === null || pmt === null || settings.years === null || settings.stepUp === null) return null;
  return { plan: { pv: settings.pv ?? today.poolTwd, pmt, stepUp: settings.stepUp, expectedReturn, inflation: settings.inflation ?? 0, years: settings.years }, saved: false };
}

/** The plan's final value without the costs and with them, and the difference. */
export interface PlanCost {
  base: number;
  after: number;
  cost: number;
}

/**
 * A yearly drag (off the expected return) and a trading cost (a share of every contribution) over
 * the plan, compounded month by month as F2 does.
 */
export function costOverPlan(plan: Plan, yearlyDrag: number, tradeShare: number): PlanCost {
  const path = { pv: plan.pv, g: monthlyStepUp(plan.stepUp), months: Math.round(plan.years * 12) };
  const base = futureValue({ ...path, pmt: plan.pmt, r: monthlyReturn(plan.expectedReturn) });
  const after = futureValue({ ...path, pmt: plan.pmt * (1 - tradeShare), r: monthlyReturn(plan.expectedReturn - yearlyDrag) });
  return { base, after, cost: base - after };
}

/** One class's slice of the plan: its target share of the starting value and of every contribution. */
export function classPlan(plan: Plan, target: number): Plan {
  return { ...plan, pv: plan.pv * target, pmt: plan.pmt * target };
}

/** One fund for a class, with what it would cost bought through the chosen broker (or Taiwan's). */
export interface FundChoice {
  fund: FundCost;
  drag: FundDrag;
  /** The trading cost as a share of a typical order; null when no schedule covers its market. */
  tradeShare: number | null;
  /** Over the class's slice of the plan; null while the drag is unknown. Trading counts when known. */
  overPlan: PlanCost | null;
}

export interface ChoiceInput {
  plan: Plan;
  /** The class's target share of the regular pool. */
  target: number;
  /** A typical order into the class, TWD. */
  orderTwd: number;
  usdTwd: number | null;
  broker: Broker | null;
  settings: FeeSettings;
  tax: TaxSettings | undefined;
}

/** A fund order's trading cost as a share of the order: the Taiwan commission, or the broker's fee plus FX. */
export function tradeShareOf(fund: Pick<FundCost, 'market'>, input: Pick<ChoiceInput, 'orderTwd' | 'usdTwd' | 'broker' | 'settings'>): number | null {
  if (input.orderTwd <= 0) return null;
  if (fund.market === 'TW') return input.settings.tw ? twCommission(input.orderTwd, input.settings.tw) / input.orderTwd : null;
  if (!input.broker || input.usdTwd === null) return null;
  const quote = quoteOrder(brokerSchedule(input.broker, fund.market, 'equity_etf'), input.orderTwd, input.usdTwd, spreadOf(input.broker, input.settings));
  return quote ? quote.share : null;
}

/** Each fund of a class with its yearly drag and its cost over the class's slice of the plan, cheapest first. */
export function fundChoices(funds: readonly FundCost[], input: ChoiceInput): FundChoice[] {
  const slice = classPlan(input.plan, input.target);
  return funds
    .map((fund) => {
      const drag = fundDrag(fund, input.tax);
      const tradeShare = tradeShareOf(fund, input);
      const custody = fund.market === 'TW' ? 0 : (input.broker?.custodyRate ?? 0);
      const overPlan = drag.total === null ? null : costOverPlan(slice, drag.total + custody, tradeShare ?? 0);
      return { fund, drag, tradeShare, overPlan };
    })
    .sort((a, b) => (a.overPlan?.cost ?? Number.POSITIVE_INFINITY) - (b.overPlan?.cost ?? Number.POSITIVE_INFINITY) || a.fund.ticker.localeCompare(b.fund.ticker));
}

/** A broker over the plan: its trading cost on every order abroad and its custody fee, on the plan's foreign share. */
export interface BrokerChoice {
  broker: Broker;
  order: BrokerQuote | null;
  dca: BrokerQuote | null;
  /** Where its minimum fee stops applying, in USD; null without one. */
  minimumUpToUsd: number | null;
  overPlan: PlanCost | null;
  /** The promotion its prices come from has ended. */
  promoEnded: boolean;
}

export interface BrokerInput {
  plan: Plan;
  /** The regular pool's target share bought abroad (classes whose vehicles list in the US or London). */
  foreignShare: number;
  orderTwd: number;
  usdTwd: number | null;
  settings: FeeSettings;
  today: string;
}

export function brokerChoices(brokers: readonly Broker[], input: BrokerInput): BrokerChoice[] {
  const slice = classPlan(input.plan, input.foreignShare);
  return brokers
    .map((broker) => {
      const spread = spreadOf(broker, input.settings);
      const etf = usSchedule(broker, 'equity_etf');
      const order = input.usdTwd === null ? null : quoteOrder(etf, input.orderTwd, input.usdTwd, spread);
      const dca = input.usdTwd === null ? null : quoteOrder(broker.usDca, input.orderTwd, input.usdTwd, spread);
      const overPlan = order ? costOverPlan(slice, broker.custodyRate, order.share) : null;
      return { broker, order, dca, minimumUpToUsd: etf ? minimumUpTo(etf) : null, overPlan, promoEnded: broker.promoUntil !== null && broker.promoUntil < input.today };
    })
    .sort((a, b) => (a.overPlan?.cost ?? Number.POSITIVE_INFINITY) - (b.overPlan?.cost ?? Number.POSITIVE_INFINITY) || a.broker.nameEn.localeCompare(b.broker.nameEn));
}
