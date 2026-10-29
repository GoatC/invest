import { Bi, Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadSecurities, orDataError } from '@/lib/data';
import { likelyAssetClass } from '@/lib/defaults';
import { LABELS } from '@/lib/i18n';

import { SecurityForm } from '../security-form';

type Params = { ticker?: string; next?: string; added?: string };

export default async function NewSecurityPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const { ticker, next, added } = await searchParams;
  if (added) {
    // Opened from the CSV import in its own tab: the import is still waiting in the other tab.
    return (
      <section className="card narrow form">
        <p className="banner ok" role="status">
          <Bi en={`Added ${added}.`} zh={`已新增 ${added}。`} />
        </p>
        <p>
          <Bi en="Close this tab and press “Check again” on the import page." zh="請關閉此分頁，回到匯入頁面按「重新檢查」。" />
        </p>
      </section>
    );
  }
  const loaded = await orDataError(Promise.all([loadAssetClasses(supabase), loadSecurities(supabase)]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [assetClasses, securities] = loaded;

  return (
    <section className="card">
      <h1>
        <Zh {...LABELS.addSecurity} />
      </h1>
      <SecurityForm
        assetClasses={assetClasses}
        securities={securities}
        next={next}
        initial={{
          ticker: (ticker ?? '').trim().toUpperCase().slice(0, 12),
          name: '',
          market: 'US',
          productType: 'stock',
          assetClassId: likelyAssetClass(securities, 'stock', 'US') ?? '',
          currency: 'USD',
          domicile: 'US',
        }}
      />
    </section>
  );
}
