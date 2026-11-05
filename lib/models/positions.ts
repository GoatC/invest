import type { Direction, Pool, Trade } from './types';

/**
 * What remains of one ticker in one pool and one direction after every trade, at weighted-average
 * cost. A long position is opened by buys and closed by sells; a short one is opened by sells of
 * borrowed shares and closed by buys. With leverage only part of each opening trade is own money:
 * qty × price ÷ leverage, plus the fee and tax of a buy; the rest is borrowed.
 *
 * In the trade currency, a position's own money now (its equity) is
 *   margin + s × (qty × price now − cost), s = +1 long, −1 short,
 * which for a long at 1× is just qty × price now: the figures before direction and leverage.
 */
export interface Position {
  ticker: string;
  pool: Pool;
  currency: string;
  direction: Direction;
  qty: number;
  /**
   * Remaining entry value in the trade currency: for a long what the shares cost, buy fees and
   * taxes included; for a short what selling them brought in, net of fee and tax.
   */
  costLocal: number;
  /** The same entry value in TWD, at each opening trade's own FX rate. */
  costTwd: number;
  /** Own money in the position, in the trade currency: equals costLocal for a long at 1×. */
  marginLocal: number;
  /** The same own money in TWD, at each opening trade's rate: what unrealized gains are measured against. */
  marginTwd: number;
  /** Exposure at entry ÷ own money at entry, fees left out: 1 for an unleveraged position. */
  leverage: number;
  /** Gains already taken by closing trades, in TWD, after their fees and taxes. */
  realizedTwd: number;
}

/** One closing trade's gain or loss against the average cost of what it closed, TWD, after its fee and tax. */
export interface Sale {
  tradeDate: string;
  ticker: string;
  pool: Pool;
  direction: Direction;
  gainTwd: number;
}

/** A closing trade larger than the position on its date: an opening trade is missing or a quantity is wrong. */
export interface Shortfall {
  ticker: string;
  pool: Pool;
  tradeDate: string;
  missingQty: number;
  /** Long when absent. */
  direction?: Direction;
}

const EPSILON = 1e-9;

/** A trade's direction, long for every trade saved before direction existed. */
export function directionOf(trade: Pick<Trade, 'direction'>): Direction {
  return trade.direction ?? 'long';
}

/** A trade's leverage, 1 for every trade saved before leverage existed. */
export function leverageOf(trade: Pick<Trade, 'leverage'>): number {
  const value = trade.leverage;
  return value !== undefined && Number.isFinite(value) && value >= 1 ? value : 1;
}

/** True when a trade opens (or adds to) its position: a long buy or a short sell. */
export function opens(trade: Pick<Trade, 'side' | 'direction'>): boolean {
  return directionOf(trade) === 'long' ? trade.side === 'buy' : trade.side === 'sell';
}

/** +1 for a long, −1 for a short: the sign of its exposure. */
export function sign(direction: Direction): 1 | -1 {
  return direction === 'short' ? -1 : 1;
}

/** Own money now in the trade currency: margin + s × (qty × price − cost). */
export function equityLocal(position: Pick<Position, 'direction' | 'qty' | 'costLocal' | 'marginLocal'>, price: number): number {
  return position.marginLocal + sign(position.direction) * (position.qty * price - position.costLocal);
}

/** True for a long at 1×: a plain holding, valued exactly as before direction and leverage. */
export function isPlain(position: { direction?: Direction | undefined; leverage?: number | undefined }): boolean {
  return (position.direction ?? 'long') === 'long' && Math.abs((position.leverage ?? 1) - 1) < 1e-9;
}

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

/** A long keeps the key it always had (`pool:ticker`); a short adds `:short`. */
export function positionKey(pool: Pool, ticker: string, direction: Direction = 'long'): string {
  return direction === 'short' ? `${pool}:${ticker}:short` : `${pool}:${ticker}`;
}

/** The ticker in a position key, or a holding key such as `regular:VOO:short`. */
export function tickerOfKey(key: string): string {
  return key.split(':')[1] ?? '';
}

interface Book extends Position {
  /** Exposure and own money at entry, fees left out, for the effective leverage. */
  notionalLocal: number;
  ownLocal: number;
}

/**
 * Replays every trade in date order. An opening trade adds its quantity, its entry value and its
 * own money; a closing trade removes the average share of each and books what it frees, net of
 * its fee and tax, against the own money it releases as a realized gain. Pools and directions are
 * kept apart, so windfall money never mixes into the regular pool's cost or weights, and a short
 * never nets against a long.
 */
export function buildPositions(trades: readonly Trade[]): { positions: Position[]; shortfalls: Shortfall[]; sales: Sale[] } {
  const book = new Map<string, Book>();
  const shortfalls: Shortfall[] = [];
  const sales: Sale[] = [];
  for (const trade of chronological(trades)) {
    const direction = directionOf(trade);
    const key = positionKey(trade.pool, trade.ticker, direction);
    const position = book.get(key) ?? {
      ticker: trade.ticker,
      pool: trade.pool,
      currency: trade.currency,
      direction,
      qty: 0,
      costLocal: 0,
      costTwd: 0,
      marginLocal: 0,
      marginTwd: 0,
      leverage: 1,
      realizedTwd: 0,
      notionalLocal: 0,
      ownLocal: 0,
    };
    const gross = trade.qty * trade.price;
    const own = gross / leverageOf(trade);
    if (opens(trade)) {
      // A long pays its fee and tax from own money; a short's come out of the sale's proceeds.
      const entryLocal = direction === 'long' ? gross + trade.fee + trade.tax : gross - trade.fee - trade.tax;
      const marginLocal = direction === 'long' ? own + trade.fee + trade.tax : own;
      position.qty += trade.qty;
      position.costLocal += entryLocal;
      position.costTwd += entryLocal * trade.fxRate;
      position.marginLocal += marginLocal;
      position.marginTwd += marginLocal * trade.fxRate;
      position.notionalLocal += gross;
      position.ownLocal += own;
      position.leverage = position.ownLocal > 0 ? position.notionalLocal / position.ownLocal : 1;
    } else {
      if (trade.qty - position.qty > EPSILON) {
        shortfalls.push({ ticker: trade.ticker, pool: trade.pool, tradeDate: trade.tradeDate, missingQty: trade.qty - position.qty, ...(direction === 'short' ? { direction } : {}) });
      }
      const closed = Math.min(trade.qty, position.qty);
      const share = position.qty > 0 ? closed / position.qty : 0;
      const costOutLocal = position.costLocal * share;
      const marginOutLocal = position.marginLocal * share;
      const marginOutTwd = position.marginTwd * share;
      const settle = closed * trade.price;
      // What closing frees in the trade currency: the own money released plus or minus the move.
      const freedLocal = direction === 'long' ? marginOutLocal + settle - trade.fee - trade.tax - costOutLocal : marginOutLocal + costOutLocal - settle - trade.fee - trade.tax;
      const gainTwd = freedLocal * trade.fxRate - marginOutTwd;
      position.qty -= closed;
      position.costLocal -= costOutLocal;
      position.costTwd -= position.costTwd * share;
      position.marginLocal -= marginOutLocal;
      position.marginTwd -= marginOutTwd;
      position.notionalLocal -= position.notionalLocal * share;
      position.ownLocal -= position.ownLocal * share;
      position.realizedTwd += gainTwd;
      sales.push({ tradeDate: trade.tradeDate, ticker: trade.ticker, pool: trade.pool, direction, gainTwd });
      if (position.qty < EPSILON) {
        position.qty = 0;
        position.costLocal = 0;
        position.costTwd = 0;
        position.marginLocal = 0;
        position.marginTwd = 0;
        position.notionalLocal = 0;
        position.ownLocal = 0;
        position.leverage = 1;
      }
    }
    book.set(key, position);
  }
  const positions = [...book.values()].map(({ notionalLocal: _n, ownLocal: _o, ...position }) => position);
  return { positions, shortfalls, sales };
}
