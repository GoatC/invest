import type { HoldingsData } from '@/lib/data';
import { rateHistory, suggestedRate } from '@/lib/models/fx';
import type { FxQuote } from '@/lib/models/types';
import { latestFx } from '@/lib/models/valuation';
import { parseNumber } from '@/lib/validation';

import type { TradeValues } from './trade-form';

/** What a link can fill in on the new-trade form, e.g. from "Add security". */
export interface TradeParams {
  ticker?: string | undefined;
  side?: string | undefined;
  qty?: string | undefined;
  pool?: string | undefined;
}

/**
 * The new-trade form's starting values. Arriving from "Add security" pre-fills that ticker with its
 * currency and today's FX rate; a link may give the side, quantity and pool too.
 */
export function tradeInitial(data: HoldingsData, rates: readonly FxQuote[], today: string, params: TradeParams): { initial: TradeValues } {
  const { ticker: requested, side, qty, pool } = params;
  const security = data.securities.find((candidate) => candidate.ticker === requested?.toUpperCase());
  const rate = security ? suggestedRate(security.currency, today, rateHistory(rates), data.fxMaxAgeDays, latestFx(data.fx, data.trades)) : undefined;
  const shares = parseNumber(qty);
  return {
    initial: {
      tradeDate: today,
      ticker: security?.ticker ?? '',
      side: side === 'sell' ? 'sell' : 'buy',
      qty: shares !== undefined && shares > 0 ? String(shares) : '',
      price: '',
      currency: security?.currency ?? '',
      fee: '',
      tax: '',
      fxRate: rate === undefined ? '' : String(rate),
      pool: pool === 'windfall' ? 'windfall' : 'regular',
      direction: 'long',
      leverage: '1.0',
      note: '',
    },
  };
}
