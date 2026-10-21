import { notFound } from 'next/navigation';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { DeleteForm } from '@/components/delete-form';
import { History } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadAuditHistory, loadHoldingsData, type AuditEntry, type HoldingsData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { parseId } from '@/lib/forms';
import { LABELS, SOURCE } from '@/lib/i18n';

import { deleteTrade } from '../actions';
import { TradeForm } from '../trade-form';

export default async function EditTradePage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireSession();
  const id = parseId((await params).id);
  if (id === undefined) notFound();
  let data: HoldingsData;
  let history: AuditEntry[];
  try {
    [data, history] = await Promise.all([loadHoldingsData(supabase), loadAuditHistory(supabase, 'transactions', String(id))]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const trade = data.trades.find((candidate) => candidate.id === id);
  if (!trade) notFound();

  return (
    <>
      <section className="card">
        <div className="row spread">
          <h1>
            <Bi {...LABELS.editTrade} />
          </h1>
          <span className="badge">
            <Bi {...SOURCE[trade.source]} />
          </span>
        </div>
        <TradeForm
          data={data}
          today={taipeiToday()}
          id={id}
          initial={{
            tradeDate: trade.tradeDate,
            ticker: trade.ticker,
            side: trade.side,
            qty: String(trade.qty),
            price: String(trade.price),
            currency: trade.currency,
            fee: String(trade.fee),
            tax: String(trade.tax),
            fxRate: String(trade.fxRate),
            pool: trade.pool,
            note: trade.note ?? '',
          }}
        />
      </section>
      <section className="card">
        <h2>
          <Bi {...LABELS.delete} />
        </h2>
        <DeleteForm id={id} action={deleteTrade} confirm={{ en: 'Delete this trade?', zh: '確定要刪除這筆交易嗎？' }} />
      </section>
      <section className="card">
        <h2>
          <Bi {...LABELS.history} />
        </h2>
        <History entries={history} />
      </section>
    </>
  );
}
