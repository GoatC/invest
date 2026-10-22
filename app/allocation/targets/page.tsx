import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { LogList } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClassSettings, loadCaps, loadSecurities, loadTableLog, orDataError } from '@/lib/data';
import { LABELS } from '@/lib/i18n';

import { TargetsForm } from '../targets-form';

/** F6: the SAA target per asset class, as a share of the regular pool, and each class's benchmark. */
export default async function TargetsPage() {
  const { supabase } = await requireSession();
  const loaded = await orDataError(Promise.all([loadAssetClassSettings(supabase), loadSecurities(supabase), loadCaps(supabase), loadTableLog(supabase, 'asset_classes')]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [classes, securities, caps, log] = loaded;

  return (
    <>
      <section className="card form">
        <h1>
          <Bi en="Edit targets" zh="修改目標權重" />
        </h1>
        <p className="muted">
          <Bi
            en="Each class's share of the regular-contribution pool, from the Investment Principles. They must add up to 100%. F8 rebalances towards them, and the performance page's benchmark is built from them and the benchmark ETFs."
            zh="各類別占一般投入資金池的比例，來自投資原則，合計必須是 100%。F8 再平衡以此為目標，績效頁的基準也由這些權重與基準 ETF 組成。"
          />
        </p>
        <TargetsForm classes={classes} securities={securities} r2Target={caps.satellite?.targetWeight ?? null} />
      </section>
      <section className="card">
        <h2>
          <Bi {...LABELS.history} />
        </h2>
        <LogList entries={log} />
      </section>
    </>
  );
}
