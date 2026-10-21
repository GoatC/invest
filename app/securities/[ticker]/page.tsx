import { notFound } from 'next/navigation';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { DeleteForm } from '@/components/delete-form';
import { History } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadAuditHistory, loadSecurities, orDataError } from '@/lib/data';
import { LABELS } from '@/lib/i18n';

import { deleteSecurity } from '../actions';
import { SecurityForm } from '../security-form';

export default async function EditSecurityPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { supabase } = await requireSession();
  const ticker = (await params).ticker.toUpperCase();
  const loaded = await orDataError(Promise.all([loadSecurities(supabase), loadAssetClasses(supabase), loadAuditHistory(supabase, 'securities', ticker)]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [securities, assetClasses, history] = loaded;
  const security = securities.find((candidate) => candidate.ticker === ticker);
  if (!security) notFound();

  return (
    <>
      <section className="card">
        <h1>
          <Bi {...LABELS.editSecurity} />
        </h1>
        <SecurityForm
          assetClasses={assetClasses}
          securities={securities}
          editing
          initial={{
            ticker: security.ticker,
            name: security.name,
            market: security.market,
            productType: security.productType,
            assetClassId: security.assetClassId,
            currency: security.currency,
            domicile: security.domicile,
          }}
        />
      </section>
      <section className="card">
        <h2>
          <Bi {...LABELS.delete} />
        </h2>
        <p className="muted small">
          <Bi en="Only a security nothing uses can be deleted: no trades, prices or watchlist entry." zh="只有沒有被使用的證券可以刪除：沒有交易、價格或觀察清單紀錄。" />
        </p>
        <DeleteForm id={security.ticker} action={deleteSecurity} confirm={{ en: `Delete ${security.ticker}?`, zh: `確定要刪除 ${security.ticker} 嗎？` }} />
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
