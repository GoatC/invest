import type { CashFlow, FlowType } from './types';

/** TWD totals per type of cash flow; each amount at its own day's rate, as the database computes amount_twd. */
export function flowTotals(flows: readonly CashFlow[]): Record<FlowType, number> {
  const totals: Record<FlowType, number> = { contribution: 0, windfall: 0, dividend: 0, withdrawal: 0 };
  for (const flow of flows) totals[flow.type] += flow.amount * flow.fxRate;
  return totals;
}
