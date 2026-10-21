import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadFxHistory, loadHoldingsData, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { LABELS } from '@/lib/i18n';

import { CashFlowForm } from '../cash-flow-form';

export default async function NewCashFlowPage() {
  const { supabase } = await requireSession();
  const loaded = await orDataError(Promise.all([loadHoldingsData(supabase), loadFxHistory(supabase)]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [data, rates] = loaded;
  const today = taipeiToday();

  return (
    <section className="card">
      <h1>
        <Bi {...LABELS.addCashFlow} />
      </h1>
      <CashFlowForm
        data={data}
        rates={rates}
        today={today}
        initial={{ flowDate: today, type: 'contribution', amount: '', currency: 'TWD', fxRate: '1', pool: 'regular', ticker: '', note: '' }}
      />
    </section>
  );
}
