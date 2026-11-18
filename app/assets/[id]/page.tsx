import { notFound } from 'next/navigation';

import { Bi, Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { DeleteForm } from '@/components/delete-form';
import { History } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadAuditHistory, loadGoldPrice, loadManualAsset, loadSecurities, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { parseId } from '@/lib/forms';
import { LABELS } from '@/lib/i18n';

import { deleteAsset } from '../actions';
import { AssetForm } from '../asset-form';
import { assetClassDefaults } from '../defaults';

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireSession();
  const id = parseId((await params).id);
  if (id === undefined) notFound();
  const loaded = await orDataError(
    Promise.all([
      loadManualAsset(supabase, id),
      loadAssetClasses(supabase),
      loadSecurities(supabase),
      loadGoldPrice(supabase),
      loadAuditHistory(supabase, 'manual_assets', String(id)),
    ]),
  );
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [asset, assetClasses, securities, goldPrice, history] = loaded;
  if (!asset) notFound();

  return (
    <>
      <section className="card">
        <h1>
          <Zh {...LABELS.editAsset} />
        </h1>
        <AssetForm
          assetClasses={assetClasses}
          defaultClass={assetClassDefaults(assetClasses, securities)}
          goldPrice={goldPrice}
          today={taipeiToday()}
          id={id}
          initial={{
            name: asset.name,
            productType: asset.productType,
            assetClassId: asset.assetClassId,
            quantity: String(asset.quantity),
            lastValueTwd: asset.lastValueTwd === null ? '' : String(asset.lastValueTwd),
            valuedOn: asset.valuedOn ?? '',
            pool: asset.pool,
          }}
        />
      </section>
      <section className="card">
        <h2>
          <Bi {...LABELS.delete} />
        </h2>
        <DeleteForm id={id} action={deleteAsset} confirm={{ en: 'Delete this asset?', zh: '確定要刪除這項資產嗎？' }} />
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
