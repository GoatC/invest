import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadCashFlows, loadCsvMappings, loadFxHistory, loadHoldingsData, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { LABELS } from '@/lib/i18n';

import { ImportWizard } from './import-wizard';

export default async function ImportPage() {
  const { supabase } = await requireSession();
  const loaded = await orDataError(Promise.all([loadHoldingsData(supabase), loadFxHistory(supabase), loadCashFlows(supabase), loadCsvMappings(supabase)]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [data, rates, flows, mappings] = loaded;

  return (
    <section className="card form">
      <h1>
        <Bi {...LABELS.importCsv} />
      </h1>
      <p className="muted">
        <Bi
          en="Import a broker statement saved as CSV, such as a 複委託 trade list: its buys and sells become trades, its cash dividends cash flows. Nothing is saved until you press Import, and the column mapping is remembered for each broker."
          zh="匯入存成 CSV 的券商對帳單，例如複委託成交明細：買進與賣出存為交易，現金股利存為現金流。按下「匯入」之前不會儲存任何資料；欄位對應會依券商記住。"
        />
      </p>
      <ImportWizard data={data} rates={rates} flows={flows} mappings={mappings} today={taipeiToday()} />
    </section>
  );
}
