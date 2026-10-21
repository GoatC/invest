import { GOLD } from './fx';
import { chronological, type Position } from './positions';
import type { AssetClass, FxQuote, ManualAsset, Pool, PriceQuote, ProductType, Security, Sleeve, Trade } from './types';

/** Grams in one troy ounce, the unit gold prices are quoted in. */
export const GRAMS_PER_TROY_OUNCE = 31.1034768;

/** A price or FX rate and where it came from: a trade-derived value is an estimate until the nightly job loads a real one. */
export interface Quote {
  value: number;
  date: string;
  estimated: boolean;
}

/** Keeps the newest quote per key; on the same date a real quote beats an estimate. */
function keepNewest(quotes: Map<string, Quote>, key: string, quote: Quote): void {
  const current = quotes.get(key);
  if (!current || quote.date > current.date || (quote.date === current.date && current.estimated && !quote.estimated)) {
    quotes.set(key, quote);
  }
}

/** Newest close per ticker; a ticker the nightly job has not priced yet falls back to its newest trade price. */
export function latestPrices(prices: readonly PriceQuote[], trades: readonly Trade[]): Map<string, Quote> {
  const quotes = new Map<string, Quote>();
  for (const price of prices) keepNewest(quotes, price.ticker, { value: price.close, date: price.date, estimated: false });
  for (const trade of chronological(trades)) {
    if (trade.price > 0) keepNewest(quotes, trade.ticker, { value: trade.price, date: trade.tradeDate, estimated: true });
  }
  return quotes;
}

/**
 * TWD per 1 unit of each currency: the newest "<CUR>/TWD" rate, else the newest trade rate in that
 * currency. Gold comes along as XAU, TWD per troy ounce, from the nightly job's XAU/TWD.
 */
export function latestFx(rates: readonly FxQuote[], trades: readonly Trade[]): Map<string, Quote> {
  const quotes = new Map<string, Quote>([['TWD', { value: 1, date: '', estimated: false }]]);
  for (const rate of rates) {
    const [base, quote] = rate.pair.split('/');
    if (base && quote === 'TWD' && base !== 'TWD') keepNewest(quotes, base, { value: rate.rate, date: rate.date, estimated: false });
  }
  for (const trade of chronological(trades)) {
    if (trade.currency !== 'TWD') keepNewest(quotes, trade.currency, { value: trade.fxRate, date: trade.tradeDate, estimated: true });
  }
  return quotes;
}

/** One line of the holdings view: a listed position or a manual asset, valued in TWD when a price is known. */
export interface Holding {
  key: string;
  ticker: string | null;
  label: string;
  pool: Pool;
  sleeve: Sleeve;
  assetClassId: string;
  productType: ProductType;
  qty: number;
  currency: string;
  /** Market value in TWD; null when no price or FX rate is known yet. */
  valueTwd: number | null;
  /** Remaining cost basis in TWD; null for manual assets. */
  costTwd: number | null;
  /** True when the price or FX rate came from a trade, or gold carries the value entered by hand. */
  estimated: boolean;
  /** Date of the close, gold price, balance or entered value behind valueTwd; null when there is none. */
  priceDate: string | null;
}

export interface ValuationInput {
  positions: readonly Position[];
  securities: ReadonlyMap<string, Security>;
  assetClasses: ReadonlyMap<string, AssetClass>;
  prices: ReadonlyMap<string, Quote>;
  fx: ReadonlyMap<string, Quote>;
  manualAssets: readonly ManualAsset[];
}

/** Values every open position and manual asset in TWD. Closed positions (quantity 0) are left out. */
export function valueHoldings(input: ValuationInput): Holding[] {
  const holdings: Holding[] = [];
  for (const position of input.positions) {
    if (position.qty <= 0) continue;
    const security = input.securities.get(position.ticker);
    if (!security) continue;
    const price = input.prices.get(position.ticker);
    const rate = input.fx.get(position.currency);
    holdings.push({
      key: `${position.pool}:${position.ticker}`,
      ticker: position.ticker,
      label: security.name,
      pool: position.pool,
      sleeve: security.sleeve,
      assetClassId: security.assetClassId,
      productType: security.productType,
      qty: position.qty,
      currency: position.currency,
      valueTwd: price && rate ? position.qty * price.value * rate.value : null,
      costTwd: position.costTwd,
      estimated: Boolean(price?.estimated || rate?.estimated),
      priceDate: price?.date ?? null,
    });
  }
  const gold = input.fx.get(GOLD);
  for (const asset of input.manualAssets) {
    const assetClass = input.assetClasses.get(asset.assetClassId);
    if (!assetClass) continue;
    // A TWD balance is its own value. Gold is grams at the loaded gold price; the value entered by
    // hand stands in only until the nightly job has loaded one.
    const atGoldPrice = asset.unit === 'grams' && gold !== undefined;
    const valueTwd = asset.unit === 'TWD' ? asset.quantity : atGoldPrice ? (asset.quantity * gold.value) / GRAMS_PER_TROY_OUNCE : asset.lastValueTwd;
    holdings.push({
      key: `manual:${asset.id}`,
      ticker: null,
      label: asset.name,
      pool: asset.pool,
      sleeve: assetClass.sleeve,
      assetClassId: asset.assetClassId,
      productType: asset.productType,
      qty: asset.quantity,
      currency: 'TWD',
      valueTwd,
      costTwd: null,
      estimated: asset.unit === 'grams' && !atGoldPrice,
      priceDate: atGoldPrice ? gold.date : asset.valuedOn,
    });
  }
  return holdings;
}
