/**
 * The volatility alert's shadow log (N8 step 3): how each alert's and hedge's proposed trades did
 * afterwards, traded or not, so the hit rate can be judged before real money follows the alerts.
 *
 * - A proposal's return over a horizon is the amount-weighted return of its trades from the price
 *   it was drafted at to the close `sessions` trading days after the day it was drafted: a buy
 *   gains when the price rises, a sale (the VIX hedge sold in a panic) when it falls.
 * - The funding sales of strategic cash are left out: they only move cash.
 * - Prices in each trade's own currency (the exchange rate is left out), as quoted: the drafted
 *   price is a quoted close, so dividends are left out too. A horizon not reached yet is pending.
 * - The hit rate over a horizon is the share of proposals measured with a return above 0.
 * Pure functions; lib/data loads the proposals and the closes.
 */
import type { DraftOrder, ProposalDetail } from './engine';

export const HORIZONS = [5, 20, 60] as const;
export type Horizon = (typeof HORIZONS)[number];

export interface Close {
  date: string;
  close: number;
}

export interface ShadowProposal {
  id: number;
  ruleId: string;
  /** The Taipei date it was drafted on. */
  date: string;
  status: string;
  orders: readonly DraftOrder[];
  detail: ProposalDetail;
}

export interface ShadowRow {
  proposal: ShadowProposal;
  /** The trades measured: ticker, side and amount. */
  trades: Array<{ ticker: string; side: 'buy' | 'sell'; amountTwd: number }>;
  /** Each horizon's return, or null while pending (or with no trade to measure). */
  returns: Record<Horizon, number | null>;
}

/** The close `sessions` trading days after `date`, from closes sorted oldest first. */
export function closeAfter(closes: readonly Close[], date: string, sessions: number): Close | undefined {
  const after = closes.filter((row) => row.date > date);
  return after[sessions - 1];
}

/** One proposal's amount-weighted return over `sessions`; null when a trade has no close that far yet, or there is nothing to measure. */
export function proposalReturn(proposal: ShadowProposal, closes: ReadonlyMap<string, readonly Close[]>, sessions: number, fundingClass = 'strategic_cash'): number | null {
  let weighted = 0;
  let total = 0;
  for (const order of proposal.orders) {
    if (order.kind !== 'trade' || order.assetClassId === fundingClass || order.price <= 0) continue;
    const later = closeAfter(closes.get(order.ticker) ?? [], proposal.date, sessions);
    if (!later) return null;
    const move = later.close / order.price - 1;
    weighted += (order.side === 'buy' ? move : -move) * order.amountTwd;
    total += order.amountTwd;
  }
  return total > 0 ? weighted / total : null;
}

export function shadowRows(proposals: readonly ShadowProposal[], closes: ReadonlyMap<string, readonly Close[]>, fundingClass = 'strategic_cash'): ShadowRow[] {
  return proposals.map((proposal) => ({
    proposal,
    trades: proposal.orders.flatMap((order) => (order.kind === 'trade' && order.assetClassId !== fundingClass ? [{ ticker: order.ticker, side: order.side, amountTwd: order.amountTwd }] : [])),
    returns: Object.fromEntries(HORIZONS.map((sessions) => [sessions, proposalReturn(proposal, closes, sessions, fundingClass)])) as Record<Horizon, number | null>,
  }));
}

/** Per horizon: proposals measured, the share above 0 (null with none) and the mean return. */
export function hitRates(rows: readonly ShadowRow[]): Record<Horizon, { measured: number; hitRate: number | null; mean: number | null }> {
  return Object.fromEntries(
    HORIZONS.map((sessions) => {
      const values = rows.map((row) => row.returns[sessions]).filter((value): value is number => value !== null);
      const hits = values.filter((value) => value > 0).length;
      return [sessions, { measured: values.length, hitRate: values.length > 0 ? hits / values.length : null, mean: values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null }];
    }),
  ) as Record<Horizon, { measured: number; hitRate: number | null; mean: number | null }>;
}
