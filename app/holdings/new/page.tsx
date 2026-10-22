import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadFxHistory, loadHoldingsData, type HoldingsData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { LABELS } from '@/lib/i18n';
import { rateHistory, suggestedRate } from '@/lib/models/fx';
import type { FxQuote } from '@/lib/models/types';
import { latestFx, latestPrices } from '@/lib/models/valuation';
import { parseId } from '@/lib/forms';
import { parseNumber } from '@/lib/validation';

import { TradeForm, type TradeValues } from '../trade-form';

type Params = { ticker?: string; side?: string; qty?: string; pool?: string; proposal?: string };

export default async function NewTradePage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const { ticker: requested, side, qty, pool, proposal } = await searchParams;
  let data: HoldingsData;
  let rates: FxQuote[];
  try {
    [data, rates] = await Promise.all([loadHoldingsData(supabase), loadFxHistory(supabase)]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }

  // Arriving from "Add security" pre-fills that ticker with its currency and today's FX rate; from
  // an approved proposal's checklist, its side, quantity and pool too, with the latest close as the price.
  const today = taipeiToday();
  const security = data.securities.find((candidate) => candidate.ticker === requested?.toUpperCase());
  const rate = security ? suggestedRate(security.currency, today, rateHistory(rates), data.fxMaxAgeDays, latestFx(data.fx, data.trades)) : undefined;
  const shares = parseNumber(qty);
  const close = security ? latestPrices(data.prices, data.trades).get(security.ticker) : undefined;
  const fromProposal = parseId(proposal);
  const initial: TradeValues = {
    tradeDate: today,
    ticker: security?.ticker ?? '',
    side: side === 'sell' ? 'sell' : 'buy',
    qty: shares !== undefined && shares > 0 ? String(shares) : '',
    price: fromProposal !== undefined && close ? String(close.value) : '',
    currency: security?.currency ?? '',
    fee: '',
    tax: '',
    fxRate: rate === undefined ? '' : String(rate),
    pool: pool === 'windfall' ? 'windfall' : 'regular',
    note: fromProposal !== undefined ? `Proposal #${fromProposal} 提案 #${fromProposal}` : '',
  };

  return (
    <section className="card">
      <h1>
        <Bi {...LABELS.addTrade} />
      </h1>
      {fromProposal !== undefined && (
        <p className="muted">
          <Bi
            en={`Filled in from proposal #${fromProposal}: change the price, fee and FX rate to what your broker's confirmation says.`}
            zh={`已依提案 #${fromProposal} 填入：請把價格、手續費與匯率改成券商成交單上的數字。`}
          />
        </p>
      )}
      <TradeForm data={data} rates={rates} today={today} initial={initial} proposal={fromProposal} />
    </section>
  );
}
