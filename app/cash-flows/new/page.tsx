import { Bi, Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadDividendEvent, loadDividendView, loadFxHistory, loadHoldingsData, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { parseId } from '@/lib/forms';
import { percent, quantity } from '@/lib/format';
import { LABELS } from '@/lib/i18n';
import { perShareText } from '@/lib/models/dividends';
import { rateHistory, suggestedRate } from '@/lib/models/fx';
import { latestFx } from '@/lib/models/valuation';

import { CashFlowForm, type CashFlowValues } from '../cash-flow-form';

type Params = Record<string, string | string[] | undefined>;

function param(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewCashFlowPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const loaded = await orDataError(Promise.all([loadHoldingsData(supabase), loadFxHistory(supabase)]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [data, rates] = loaded;
  const today = taipeiToday();

  // The form is typed in for what no trade tells; a dividend is the usual one.
  let initial: CashFlowValues = { flowDate: today, type: param(params, 'type') === 'windfall' ? 'windfall' : 'dividend', amount: '', currency: 'TWD', fxRate: '1', pool: param(params, 'type') === 'windfall' ? 'windfall' : 'regular', ticker: '', note: '' };
  let filled: { qty: number; perShare: string; withholding: number; exDate: string } | undefined;

  // Opened from a dividend prompt: the security, the day, the pool and the amount worked out.
  const eventId = parseId(param(params, 'dividend'));
  if (eventId !== undefined) {
    const pool = param(params, 'pool') === 'windfall' ? 'windfall' : 'regular';
    const view = await orDataError(loadDividendView(supabase, today));
    const line = view instanceof DataError ? undefined : [...(view?.due ?? []), ...(view?.upcoming ?? [])].find((candidate) => candidate.event.id === eventId && candidate.pool === pool);
    const event = line?.event ?? (view instanceof DataError || !view ? undefined : await orDataError(loadDividendEvent(supabase, eventId)));
    if (event && !(event instanceof DataError)) {
      const flowDate = line && line.askOn <= today ? line.askOn : today;
      const rate = suggestedRate(event.currency, flowDate, rateHistory(rates), data.fxMaxAgeDays, latestFx(data.fx, data.trades));
      initial = {
        flowDate,
        type: 'dividend',
        amount: line ? String(line.netLocal) : '',
        currency: event.currency,
        fxRate: String(rate ?? ''),
        pool,
        ticker: event.ticker,
        note: `${event.exDate} 除息`,
      };
      if (line) filled = { qty: line.qty, perShare: perShareText(event), withholding: line.withholding, exDate: event.exDate };
    }
  }

  return (
    <section className="card">
      <h1>
        <Zh {...LABELS.addCashFlow} />
      </h1>
      {filled && (
        <p className="muted" id="dividend-filled">
          <Bi
            en={`Filled in from the dividend: ${quantity(filled.qty)} shares × ${filled.perShare}${filled.withholding > 0 ? `, ${percent(filled.withholding, 0)} withheld` : ''}. Change the amount to what your broker paid.`}
            zh={`已依配息資料填入：${quantity(filled.qty)} 股 × ${filled.perShare}${filled.withholding > 0 ? `，預扣 ${percent(filled.withholding, 0)}` : ''}。請把金額改成券商實際入帳的數字。`}
          />
        </p>
      )}
      <CashFlowForm key={JSON.stringify(initial)} data={data} rates={rates} today={today} initial={initial} />
    </section>
  );
}
