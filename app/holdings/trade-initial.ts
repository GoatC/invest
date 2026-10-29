import type { HoldingsData } from '@/lib/data';
import { parseId } from '@/lib/forms';
import { rateHistory, suggestedRate } from '@/lib/models/fx';
import { restateTrades } from '@/lib/models/splits';
import type { FxQuote } from '@/lib/models/types';
import { latestFx, latestPrices } from '@/lib/models/valuation';
import { parseNumber } from '@/lib/validation';

import type { TradeValues } from './trade-form';

/** What a link can fill in on the new-trade form: from "Add security", or an approved proposal's checklist. */
export interface TradeParams {
  ticker?: string | undefined;
  side?: string | undefined;
  qty?: string | undefined;
  pool?: string | undefined;
  proposal?: string | undefined;
  fee?: string | undefined;
  tax?: string | undefined;
}

/**
 * The new-trade form's starting values. Arriving from "Add security" pre-fills that ticker with its
 * currency and today's FX rate; from an approved proposal's checklist, its side, quantity and pool
 * too, with the latest close as the price and the estimated fee and tax (F15).
 */
export function tradeInitial(data: HoldingsData, rates: readonly FxQuote[], today: string, params: TradeParams): { initial: TradeValues; proposal: number | undefined } {
  const { ticker: requested, side, qty, pool, proposal, fee, tax } = params;
  const security = data.securities.find((candidate) => candidate.ticker === requested?.toUpperCase());
  const rate = security ? suggestedRate(security.currency, today, rateHistory(rates), data.fxMaxAgeDays, latestFx(data.fx, data.trades)) : undefined;
  const shares = parseNumber(qty);
  const close = security ? latestPrices(data.prices, restateTrades(data.trades, data.splits)).get(security.ticker) : undefined;
  const fromProposal = parseId(proposal);
  const estimate = (value: string | undefined) => {
    const amount = fromProposal !== undefined ? parseNumber(value) : undefined;
    return amount !== undefined && amount >= 0 ? String(amount) : '';
  };
  return {
    proposal: fromProposal,
    initial: {
      tradeDate: today,
      ticker: security?.ticker ?? '',
      side: side === 'sell' ? 'sell' : 'buy',
      qty: shares !== undefined && shares > 0 ? String(shares) : '',
      price: fromProposal !== undefined && close ? String(close.value) : '',
      currency: security?.currency ?? '',
      fee: estimate(fee),
      tax: estimate(tax),
      fxRate: rate === undefined ? '' : String(rate),
      pool: pool === 'windfall' ? 'windfall' : 'regular',
      note: fromProposal !== undefined ? `Proposal #${fromProposal} 提案 #${fromProposal}` : '',
    },
  };
}
