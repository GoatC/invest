/**
 * The cash-flow book (asked by Hugo on 2026-11-12): every buy and sell counts by itself, read from
 * the trades, so a purchase is recorded once, on the holdings page. cash_flows keeps what no trade
 * tells: the windfall arriving, dividends and withdrawals.
 *
 * - A buy (or a short opened) counts its own money: qty × price ÷ leverage, plus a long's fee and
 *   tax, at the trade's FX rate. A sell (or a cover) counts what it frees, after its fee and tax.
 * - Regular pool: net put in = bought − sold.
 * - Windfall pool: deployed = bought − sold, against what arrived; the rest is still waiting.
 * - A contribution typed in before this (cash_flows.type contribution) stays listed but is not
 *   added: the buy it paid for is already counted.
 */
import { buildPositions } from './positions';
import { restateTrades, type Split } from './splits';
import type { CashFlow, Direction, FlowType, Pool, Trade } from './types';

/** TWD totals per type of cash flow; each amount at its own day's rate, as the database computes amount_twd. */
export function flowTotals(flows: readonly CashFlow[]): Record<FlowType, number> {
  const totals: Record<FlowType, number> = { contribution: 0, windfall: 0, dividend: 0, withdrawal: 0 };
  for (const flow of flows) totals[flow.type] += flow.amount * flow.fxRate;
  return totals;
}

/** What a line of the book is: a trade's side of it, or a cash flow's type. */
export type LedgerKind = 'buy' | 'sell' | FlowType;

export interface LedgerLine {
  /** Unique in the book: t + the trade's id, f + the cash flow's. */
  key: string;
  /** Where it was recorded: a trade counts by itself, a cash flow was typed in or imported. */
  source: 'trade' | 'flow';
  id: number | undefined;
  date: string;
  kind: LedgerKind;
  pool: Pool;
  ticker: string | null;
  /** The money in its own currency, always positive. */
  amount: number;
  currency: string;
  fxRate: number;
  amountTwd: number;
  /** A trade's quantity and price as traded, and its direction; absent for a cash flow. */
  trade?: { qty: number; price: number; direction: Direction; leverage: number };
  note: string | null;
  /** False for a contribution typed in by hand: listed, not added. */
  counted: boolean;
}

/** The book, newest first: the trades' own money and the cash flows. */
export function ledger(trades: readonly Trade[], splits: readonly Split[] | undefined, flows: readonly CashFlow[]): LedgerLine[] {
  const asTraded = new Map(trades.flatMap((trade) => (trade.id === undefined ? [] : [[trade.id, trade] as const])));
  const lines: LedgerLine[] = buildPositions(restateTrades(trades, splits)).money.map((move, index) => {
    const traded = move.id === undefined ? undefined : asTraded.get(move.id);
    return {
      key: `t${move.id ?? `-${index}`}`,
      source: 'trade',
      id: move.id,
      date: move.tradeDate,
      kind: move.opens ? 'buy' : 'sell',
      pool: move.pool,
      ticker: move.ticker,
      amount: move.local,
      currency: move.currency,
      fxRate: move.fxRate,
      amountTwd: move.twd,
      trade: { qty: traded?.qty ?? move.qty, price: traded?.price ?? move.price, direction: move.direction, leverage: traded?.leverage ?? 1 },
      note: null,
      counted: true,
    };
  });
  flows.forEach((flow, index) => {
    lines.push({
      key: `f${flow.id ?? `-${index}`}`,
      source: 'flow',
      id: flow.id,
      date: flow.flowDate,
      kind: flow.type,
      pool: flow.pool,
      ticker: flow.ticker,
      amount: flow.amount,
      currency: flow.currency,
      fxRate: flow.fxRate,
      amountTwd: flow.amount * flow.fxRate,
      note: flow.note,
      counted: flow.type !== 'contribution',
    });
  });
  // Newest first; on a day, the later entry first (a higher id was saved later).
  return lines.sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0) || a.key.localeCompare(b.key));
}

export interface LedgerTotals {
  /** The regular pool's own money through trades. */
  regular: { boughtTwd: number; soldTwd: number; netTwd: number; buys: number; sells: number };
  /** The windfall: what arrived, what the windfall pool's trades put to work (bought − sold), and the rest. */
  windfall: { arrivedTwd: number; deployedTwd: number; waitingTwd: number; share: number | null };
  dividendTwd: number;
  dividends: number;
  withdrawnTwd: number;
  /** Contributions typed in by hand before buys counted by themselves: listed, not added. */
  uncounted: { twd: number; lines: number };
}

export function ledgerTotals(lines: readonly LedgerLine[]): LedgerTotals {
  const totals: LedgerTotals = {
    regular: { boughtTwd: 0, soldTwd: 0, netTwd: 0, buys: 0, sells: 0 },
    windfall: { arrivedTwd: 0, deployedTwd: 0, waitingTwd: 0, share: null },
    dividendTwd: 0,
    dividends: 0,
    withdrawnTwd: 0,
    uncounted: { twd: 0, lines: 0 },
  };
  for (const line of lines) {
    if (line.kind === 'buy' || line.kind === 'sell') {
      const signed = line.kind === 'buy' ? line.amountTwd : -line.amountTwd;
      if (line.pool === 'windfall') totals.windfall.deployedTwd += signed;
      else if (line.kind === 'buy') {
        totals.regular.boughtTwd += line.amountTwd;
        totals.regular.buys += 1;
      } else {
        totals.regular.soldTwd += line.amountTwd;
        totals.regular.sells += 1;
      }
    } else if (line.kind === 'windfall') totals.windfall.arrivedTwd += line.amountTwd;
    else if (line.kind === 'dividend') {
      totals.dividendTwd += line.amountTwd;
      totals.dividends += 1;
    } else if (line.kind === 'withdrawal') totals.withdrawnTwd += line.amountTwd;
    else {
      totals.uncounted.twd += line.amountTwd;
      totals.uncounted.lines += 1;
    }
  }
  totals.regular.netTwd = totals.regular.boughtTwd - totals.regular.soldTwd;
  const { arrivedTwd, deployedTwd } = totals.windfall;
  totals.windfall.waitingTwd = Math.max(0, arrivedTwd - deployedTwd);
  totals.windfall.share = arrivedTwd > 0 ? Math.min(1, Math.max(0, deployedTwd / arrivedTwd)) : null;
  return totals;
}

/** The parts of the book a filter shows. */
export const LEDGER_FILTERS = ['all', 'trades', 'dividends', 'windfall'] as const;
export type LedgerFilter = (typeof LEDGER_FILTERS)[number];

export function filterLedger(lines: readonly LedgerLine[], filter: LedgerFilter): LedgerLine[] {
  if (filter === 'all') return [...lines];
  if (filter === 'trades') return lines.filter((line) => line.source === 'trade' && line.pool === 'regular');
  if (filter === 'dividends') return lines.filter((line) => line.kind === 'dividend');
  // The windfall's own story: its arrival and the windfall pool's trades.
  return lines.filter((line) => line.kind === 'windfall' || (line.source === 'trade' && line.pool === 'windfall'));
}
