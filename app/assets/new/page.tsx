import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadGoldPrice, loadSecurities, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { LABELS } from '@/lib/i18n';

import { AssetForm } from '../asset-form';
import { assetClassDefaults } from '../defaults';

export default async function NewAssetPage() {
  const { supabase } = await requireSession();
  const loaded = await orDataError(Promise.all([loadAssetClasses(supabase), loadSecurities(supabase), loadGoldPrice(supabase)]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [assetClasses, securities, goldPrice] = loaded;
  const defaults = assetClassDefaults(assetClasses, securities);

  return (
    <section className="card">
      <h1>
        <Bi {...LABELS.addAsset} />
      </h1>
      <AssetForm
        assetClasses={assetClasses}
        defaultClass={defaults}
        goldPrice={goldPrice}
        today={taipeiToday()}
        initial={{ name: '', productType: 'gold', assetClassId: defaults.gold, quantity: '', lastValueTwd: '', valuedOn: '', pool: 'regular' }}
      />
    </section>
  );
}
