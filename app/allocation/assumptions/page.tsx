import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { History } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClassSettings, loadAssumptions, loadAuditHistory, orDataError } from '@/lib/data';
import { LABELS } from '@/lib/i18n';

import { AssumptionsForm } from '../assumptions-form';

/** F6: the capital market assumptions, the config row cma, which F2, F5 and F7 read. */
export default async function AssumptionsPage() {
  const { supabase } = await requireSession();
  const loaded = await orDataError(Promise.all([loadAssetClassSettings(supabase), loadAssumptions(supabase), loadAuditHistory(supabase, 'config', 'cma')]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [classes, saved, history] = loaded;

  return (
    <>
      <section className="card form">
        <h1>
          <Bi en="Edit capital market assumptions" zh="修改資本市場假設" />
        </h1>
        <p className="muted">
          <Bi
            en="Your own long-run expectation for each class: the yearly return and how much it swings (volatility, one standard deviation), with where it comes from. The compounding calculator (F2), Monte Carlo (F5) and the efficient frontier (F7) will use them. Leave a class blank to set it later."
            zh="你對各類別的長期預期：每年報酬與波動程度（波動度，一個標準差），並註明來源。複利計算機（F2）、蒙地卡羅（F5）與效率前緣（F7）會使用這些數字。尚未決定的類別可以先留白。"
          />
        </p>
        {saved === undefined ? (
          <p className="banner warn">
            <Bi en="The cma setting is missing from the database: run npx supabase db push first." zh="資料庫中找不到 cma 設定：請先執行 npx supabase db push。" />
          </p>
        ) : (
          <>
            {saved.verifiedOn && (
              <p className="muted small">
                <Bi en={`Last reviewed on ${saved.verifiedOn}.`} zh={`最後檢視日期：${saved.verifiedOn}。`} />
              </p>
            )}
            <AssumptionsForm classes={classes} assumptions={saved.assumptions} />
          </>
        )}
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
