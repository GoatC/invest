import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadHoldingsData, type HoldingsData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { LABELS } from '@/lib/i18n';
import { latestFx } from '@/lib/models/valuation';

import { TradeForm, type TradeValues } from '../trade-form';

export default async function NewTradePage({ searchParams }: { searchParams: Promise<{ ticker?: string }> }) {
  const { supabase } = await requireSession();
  const { ticker: requested } = await searchParams;
  let data: HoldingsData;
  try {
    data = await loadHoldingsData(supabase);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }

  // Arriving from "Add security" pre-fills that ticker with its currency and the newest FX rate.
  const security = data.securities.find((candidate) => candidate.ticker === requested?.toUpperCase());
  const rate = security && security.currency !== 'TWD' ? latestFx(data.fx, data.trades).get(security.currency)?.value : undefined;
  const today = taipeiToday();
  const initial: TradeValues = {
    tradeDate: today,
    ticker: security?.ticker ?? '',
    side: 'buy',
    qty: '',
    price: '',
    currency: security?.currency ?? '',
    fee: '',
    tax: '',
    fxRate: security?.currency === 'TWD' ? '1' : rate === undefined ? '' : String(rate),
    pool: 'regular',
    note: '',
  };

  return (
    <section className="card">
      <h1>
        <Bi {...LABELS.addTrade} />
      </h1>
      <TradeForm data={data} today={today} initial={initial} />
    </section>
  );
}
