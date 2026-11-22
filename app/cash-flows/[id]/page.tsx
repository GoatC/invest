import { notFound } from 'next/navigation';

import { Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { EditFoot } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { loadAuditHistory } from '@/lib/data/audit';
import { DataError, orDataError } from '@/lib/data/core';
import { loadCashFlow, loadFxHistory, loadHoldingsData } from '@/lib/data/holdings';
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
          <Zh {...LABELS.editCashFlow} />
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
      <EditFoot id={id} action={deleteCashFlow} confirm={{ en: 'Delete this cash flow?', zh: '確定要刪除這筆現金流嗎？' }} history={history} />
    </>
  );
}
