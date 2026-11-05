import { GOLD } from './fx';
import { chronological, equityLocal, positionKey, sign, type Position } from './positions';
import type { AssetClass, Direction, FxQuote, ManualAsset, Market, Pool, PriceQuote, ProductType, Security, Sleeve, Trade } from './types';

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
  /** Where it trades (N6 listing-country lens); null for a non-listed asset. */
  market: Market | null;
  qty: number;
  currency: string;
  /**
   * Own money in it now, TWD: the market value for a plain long, margin ± the move since entry for
   * a short or a leveraged line (it can fall below 0). Null when no price or FX rate is known yet.
   * Totals, the pools and net worth add this up.
   */
  valueTwd: number | null;
  /** Own money put in, TWD, at the opening trades' rates (the cost basis of a plain long); null for manual assets. */
  costTwd: number | null;
  /** Long for manual assets. */
  direction: Direction;
  /** Exposure ÷ own money at entry; 1 for manual assets. */
  leverage: number;
  /**
   * What the line moves with the market, TWD: qty × price, negative for a short. Equals valueTwd
   * for a plain long and a manual asset. R1, R2, the class weights and the risk figures read this.
   */
  exposureTwd: number | null;
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

/** What a holding moves with: its exposure, else its value (a line saved before exposure existed). */
export function exposureOf(holding: Pick<Holding, 'valueTwd'> & { exposureTwd?: number | null }): number {
  return holding.exposureTwd ?? holding.valueTwd ?? 0;
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
    const known = price && rate ? { price: price.value, rate: rate.value } : null;
    holdings.push({
      key: positionKey(position.pool, position.ticker, position.direction),
      ticker: position.ticker,
      label: security.name,
      pool: position.pool,
      sleeve: security.sleeve,
      assetClassId: security.assetClassId,
      productType: security.productType,
      market: security.market,
      qty: position.qty,
      currency: position.currency,
      valueTwd: known ? equityLocal(position, known.price) * known.rate : null,
      costTwd: position.marginTwd,
      direction: position.direction,
      leverage: position.leverage,
      exposureTwd: known ? sign(position.direction) * position.qty * known.price * known.rate : null,
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
      market: null,
      qty: asset.quantity,
      currency: 'TWD',
      valueTwd,
      costTwd: null,
      direction: 'long',
      leverage: 1,
      exposureTwd: valueTwd,
      estimated: asset.unit === 'grams' && !atGoldPrice,
      priceDate: atGoldPrice ? gold.date : asset.valuedOn,
    });
  }
  return holdings;
}
