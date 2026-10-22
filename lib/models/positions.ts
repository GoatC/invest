import type { Pool, Trade } from './types';

/** What remains of one ticker in one pool after every trade, at weighted-average cost. */
export interface Position {
  ticker: string;
  pool: Pool;
  currency: string;
  qty: number;
  /** Remaining cost basis, buy fees and taxes included, in the trade currency. */
  costLocal: number;
  /** The same cost basis in TWD, at each buy's own FX rate. */
  costTwd: number;
  /** Gains already taken by sells, in TWD, after sell fees and taxes. */
  realizedTwd: number;
}

/** One sell's gain or loss against the average cost of what it sold, TWD, after its fee and tax. */
export interface Sale {
  tradeDate: string;
  ticker: string;
  pool: Pool;
  gainTwd: number;
}

/** A sell larger than the holding on its date: a buy is missing or a quantity is wrong. */
export interface Shortfall {
  ticker: string;
  pool: Pool;
  tradeDate: string;
  missingQty: number;
}

const EPSILON = 1e-9;

function byId(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

/** Trades in the order they happened: by date, then by id, with unsaved trades last on their day. */
export function chronological(trades: readonly Trade[]): Trade[] {
  return [...trades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || byId(a.id, b.id));
}

export function positionKey(pool: Pool, ticker: string): string {
  return `${pool}:${ticker}`;
}

/**
 * Replays every trade in date order. A buy adds its quantity and its full cost (fee and tax
 * included); a sell removes the average cost of what it sells and books the difference to its
 * proceeds, net of fee and tax, as a realized gain. Pools are kept apart, so windfall money never
 * mixes into the regular pool's cost or weights.
 */
export function buildPositions(trades: readonly Trade[]): { positions: Position[]; shortfalls: Shortfall[]; sales: Sale[] } {
  const book = new Map<string, Position>();
  const shortfalls: Shortfall[] = [];
  const sales: Sale[] = [];
  for (const trade of chronological(trades)) {
    const key = positionKey(trade.pool, trade.ticker);
    const position = book.get(key) ?? {
      ticker: trade.ticker,
      pool: trade.pool,
      currency: trade.currency,
      qty: 0,
      costLocal: 0,
      costTwd: 0,
      realizedTwd: 0,
    };
    if (trade.side === 'buy') {
      const costLocal = trade.qty * trade.price + trade.fee + trade.tax;
      position.qty += trade.qty;
      position.costLocal += costLocal;
      position.costTwd += costLocal * trade.fxRate;
    } else {
      if (trade.qty - position.qty > EPSILON) {
        shortfalls.push({ ticker: trade.ticker, pool: trade.pool, tradeDate: trade.tradeDate, missingQty: trade.qty - position.qty });
      }
      const sold = Math.min(trade.qty, position.qty);
      const share = position.qty > 0 ? sold / position.qty : 0;
      const costOutLocal = position.costLocal * share;
      const costOutTwd = position.costTwd * share;
      const proceedsTwd = (sold * trade.price - trade.fee - trade.tax) * trade.fxRate;
      position.qty -= sold;
      position.costLocal -= costOutLocal;
      position.costTwd -= costOutTwd;
      position.realizedTwd += proceedsTwd - costOutTwd;
      sales.push({ tradeDate: trade.tradeDate, ticker: trade.ticker, pool: trade.pool, gainTwd: proceedsTwd - costOutTwd });
      if (position.qty < EPSILON) {
        position.qty = 0;
        position.costLocal = 0;
        position.costTwd = 0;
      }
    }
    book.set(key, position);
  }
  return { positions: [...book.values()], shortfalls, sales };
}
