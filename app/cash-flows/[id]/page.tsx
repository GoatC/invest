import { notFound } from 'next/navigation';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { DeleteForm } from '@/components/delete-form';
import { History } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadAuditHistory, loadCashFlow, loadFxHistory, loadHoldingsData, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { parseId } from '@/lib/forms';
import { LABELS } from '@/lib/i18n';

import { deleteCashFlow } from '../actions';
import { CashFlowForm } from '../cash-flow-form';

export default async function EditCashFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireSession();
  const id = parseId((await params).id);
  if (id === undefined) notFound();
  const loaded = await orDataError(
    Promise.all([loadCashFlow(supabase, id), loadHoldingsData(supabase), loadFxHistory(supabase), loadAuditHistory(supabase, 'cash_flows', String(id))]),
  );
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [flow, data, rates, history] = loaded;
  if (!flow) notFound();

  return (
    <>
      <section className="card">
        <h1>
          <Bi {...LABELS.editCashFlow} />
        </h1>
        <CashFlowForm
          data={data}
          rates={rates}
          today={taipeiToday()}
          id={id}
          initial={{
            flowDate: flow.flowDate,
            type: flow.type,
            amount: String(flow.amount),
            currency: flow.currency,
            fxRate: String(flow.fxRate),
            pool: flow.pool,
            ticker: flow.ticker ?? '',
            note: flow.note ?? '',
          }}
        />
      </section>
      <section className="card">
        <h2>
          <Bi {...LABELS.delete} />
        </h2>
        <DeleteForm id={id} action={deleteCashFlow} confirm={{ en: 'Delete this cash flow?', zh: '確定要刪除這筆現金流嗎？' }} />
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
