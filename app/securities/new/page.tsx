import { Bi, Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadSecurities, orDataError } from '@/lib/data';
import { likelyAssetClass } from '@/lib/defaults';
import { LABELS } from '@/lib/i18n';
import { lookupTicker } from '@/lib/ticker-lookup';

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
  const wanted = (ticker ?? '').trim().toUpperCase().slice(0, 12);
  // A ticker not on the list yet is looked up on the web (proposal G05); Hugo checks what came in.
  const found = wanted && !securities.some((security) => security.ticker === wanted) ? await lookupTicker(wanted) : null;

  return (
    <section className="card">
      <h1>
        <Zh {...LABELS.addSecurity} />
      </h1>
      {found && (
        <p className="banner info" role="status">
          <Bi en={`Filled in from the web for ${wanted}: check each field and the class before saving.`} zh={`已從網路帶入 ${wanted} 的資料，請確認各欄與類別後儲存。`} />
        </p>
      )}
      <SecurityForm
        assetClasses={assetClasses}
        securities={securities}
        next={next}
        initial={
          found
            ? {
                ticker: wanted,
                name: found.name,
                market: found.market,
                productType: found.productType,
                assetClassId: likelyAssetClass(securities, found.productType, found.market) ?? '',
                currency: found.currency,
                domicile: found.domicile,
              }
            : {
                ticker: wanted,
                name: '',
                market: 'US',
                productType: 'stock',
                assetClassId: likelyAssetClass(securities, 'stock', 'US') ?? '',
                currency: 'USD',
                domicile: 'US',
              }
        }
      />
    </section>
  );
}
