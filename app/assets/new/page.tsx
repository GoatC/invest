import { Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadGoldPrice, loadSecurities, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { LABELS } from '@/lib/i18n';

import { AssetForm } from '../asset-form';
import { assetClassDefaults } from '../defaults';

export default async function NewAssetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireSession();
  const loaded = await orDataError(Promise.all([loadAssetClasses(supabase), loadSecurities(supabase), loadGoldPrice(supabase)]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [assetClasses, securities, goldPrice] = loaded;
  const defaults = assetClassDefaults(assetClasses, securities);
  // Opened from the banner after the windfall arrived: a TWD balance in the windfall pool.
  const windfall = (await searchParams)['pool'] === 'windfall';

  return (
    <section className="card">
      <h1>
        <Zh {...LABELS.addAsset} />
      </h1>
      <AssetForm
        assetClasses={assetClasses}
        defaultClass={defaults}
        goldPrice={goldPrice}
        today={taipeiToday()}
        initial={{ name: '', productType: windfall ? 'cash_mmf' : 'gold', assetClassId: windfall ? defaults.cash_mmf : defaults.gold, quantity: '', lastValueTwd: '', valuedOn: '', pool: windfall ? 'windfall' : 'regular' }}
      />
    </section>
  );
}
