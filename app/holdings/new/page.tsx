import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadFxHistory, loadHoldingsData, type HoldingsData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { LABELS } from '@/lib/i18n';
import { rateHistory, suggestedRate } from '@/lib/models/fx';
import type { FxQuote } from '@/lib/models/types';
import { latestFx } from '@/lib/models/valuation';

import { TradeForm, type TradeValues } from '../trade-form';

export default async function NewTradePage({ searchParams }: { searchParams: Promise<{ ticker?: string }> }) {
  const { supabase } = await requireSession();
  const { ticker: requested } = await searchParams;
  let data: HoldingsData;
  let rates: FxQuote[];
  try {
    [data, rates] = await Promise.all([loadHoldingsData(supabase), loadFxHistory(supabase)]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }

  // Arriving from "Add security" pre-fills that ticker with its currency and today's FX rate.
  const today = taipeiToday();
  const security = data.securities.find((candidate) => candidate.ticker === requested?.toUpperCase());
  const rate = security ? suggestedRate(security.currency, today, rateHistory(rates), data.fxMaxAgeDays, latestFx(data.fx, data.trades)) : undefined;
  const initial: TradeValues = {
    tradeDate: today,
    ticker: security?.ticker ?? '',
    side: 'buy',
    qty: '',
    price: '',
    currency: security?.currency ?? '',
    fee: '',
    tax: '',
    fxRate: rate === undefined ? '' : String(rate),
    pool: 'regular',
    note: '',
  };

  return (
    <section className="card">
      <h1>
        <Bi {...LABELS.addTrade} />
      </h1>
      <TradeForm data={data} rates={rates} today={today} initial={initial} />
    </section>
  );
}
