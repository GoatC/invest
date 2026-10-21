/**
 * Price, FX and gold-price history for any date: the newest value on or before it, as a closed
 * market keeps its last price (weekends, holidays, a feed that is a day behind).
 */
import { GOLD } from './fx';
import type { FxQuote } from './types';
import { GRAMS_PER_TROY_OUNCE } from './valuation';

export interface PriceRow {
  ticker: string;
  date: string;
  close: number;
  /** The close with later dividends folded in (a total-return series); null when the feed has none. */
  adjClose: number | null;
}

/** The last entry dated on or before `date`, by binary search over entries sorted by date. */
function onOrBefore<T extends { date: string }>(list: readonly T[] | undefined, date: string): T | undefined {
  if (!list || list.length === 0) return undefined;
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((list[middle]?.date ?? '') <= date) low = middle + 1;
    else high = middle;
  }
  return list[low - 1];
}

function byKey<T extends { date: string }>(rows: readonly T[], key: (row: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const name = key(row);
    if (name === undefined) continue;
    const list = out.get(name) ?? [];
    list.push(row);
    out.set(name, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export class MarketHistory {
  private readonly prices: Map<string, PriceRow[]>;
  /** "<CUR>/TWD" rates by currency. */
  private readonly rates: Map<string, FxQuote[]>;
  /** XAU/TWD: TWD per troy ounce. */
  private readonly gold: readonly FxQuote[];
  /** The gold ETF whose TWD return extends the gold price back before the nightly job saved it (PRD N4 proxy). */
  private readonly goldProxy: { ticker: string; currency: string };

  constructor(prices: readonly PriceRow[], rates: readonly FxQuote[], goldProxy = { ticker: 'GLDM', currency: 'USD' }) {
    this.prices = byKey(prices, (row) => row.ticker);
    this.rates = byKey(rates, (rate) => {
      const [base, quote] = rate.pair.split('/');
      return base && quote === 'TWD' ? base : undefined;
    });
    this.gold = this.rates.get(GOLD) ?? [];
    this.goldProxy = goldProxy;
  }

  close(ticker: string, date: string): number | undefined {
    return onOrBefore(this.prices.get(ticker), date)?.close;
  }

  /**
   * What 1 unit at `from` is worth at `to`, dividends reinvested: the ratio of the adjusted closes
   * when both days have one, else of the closes. Undefined without a close on or before each date.
   */
  growth(ticker: string, from: string, to: string): number | undefined {
    const list = this.prices.get(ticker);
    const then = onOrBefore(list, from);
    const now = onOrBefore(list, to);
    if (!then || !now) return undefined;
    return then.adjClose !== null && now.adjClose !== null ? now.adjClose / then.adjClose : now.close / then.close;
  }

  /** TWD per 1 unit of a currency; TWD itself is 1. */
  fx(currency: string, date: string): number | undefined {
    return currency === 'TWD' ? 1 : onOrBefore(this.rates.get(currency), date)?.rate;
  }

  /** How the currency moved against TWD from one date to another, as a ratio. */
  fxGrowth(currency: string, from: string, to: string): number | undefined {
    const then = this.fx(currency, from);
    const now = this.fx(currency, to);
    return then !== undefined && now !== undefined ? now / then : undefined;
  }

  /** A security's growth in TWD: its own growth times its currency's. */
  twdGrowth(ticker: string, currency: string, from: string, to: string): number | undefined {
    const price = this.growth(ticker, from, to);
    const fx = this.fxGrowth(currency, from, to);
    return price !== undefined && fx !== undefined ? price * fx : undefined;
  }

  /**
   * TWD per gram of gold: the saved XAU/TWD price, or, before the first one, that price moved back
   * by the gold ETF's TWD return. Undefined when neither exists.
   */
  goldPerGram(date: string): number | undefined {
    const saved = onOrBefore(this.gold, date);
    if (saved) return saved.rate / GRAMS_PER_TROY_OUNCE;
    const first = this.gold[0];
    if (!first) return undefined;
    const back = this.twdGrowth(this.goldProxy.ticker, this.goldProxy.currency, first.date, date);
    return back === undefined ? undefined : (first.rate / GRAMS_PER_TROY_OUNCE) * back;
  }
}
