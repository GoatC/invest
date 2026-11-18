import { notFound } from 'next/navigation';

import { Bi, Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { DeleteForm } from '@/components/delete-form';
import { History } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadAuditHistory, loadSecurities, loadSplits, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { quantity } from '@/lib/format';
import { LABELS } from '@/lib/i18n';

import { deleteSecurity, deleteSplit } from '../actions';
import { SecurityForm } from '../security-form';
import { SplitForm } from '../split-form';

export default async function EditSecurityPage({ params, searchParams }: { params: Promise<{ ticker: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireSession();
  const ticker = (await params).ticker.toUpperCase();
  const saved = (await searchParams)['saved'];
  const loaded = await orDataError(Promise.all([loadSecurities(supabase), loadAssetClasses(supabase), loadAuditHistory(supabase, 'securities', ticker), loadSplits(supabase)]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [securities, assetClasses, history, allSplits] = loaded;
  const security = securities.find((candidate) => candidate.ticker === ticker);
  if (!security) notFound();
  const splits = allSplits.filter((split) => split.ticker === ticker);

  return (
    <>
      <section className="card">
        <h1>
          <Zh {...LABELS.editSecurity} />
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
      <section className="card form" id="splits">
        <h2>
          <Bi en="Stock splits" zh="股票分割" />
        </h2>
        {saved === 'split' && (
          <p className="banner ok" role="status">
            <Bi en="Split saved: trades before it now count in the new shares." zh="已儲存分割：之前的交易改以新股數計算。" />
          </p>
        )}
        {saved === 'split-deleted' && (
          <p className="banner ok" role="status">
            <Bi en="Split deleted." zh="已刪除分割。" />
          </p>
        )}
        <p className="muted small">
          <Bi
            en="Trades stay as you traded them; from the ex-date on, each share bought before it counts as the new number of shares, so the quantity, average cost a share, value and R1 / R2 stay right. Returns already use adjusted closes."
            zh="交易維持原本的成交紀錄；自分割生效日起，之前買進的每一股改以新股數計算，因此持有數量、每股平均成本、市值與 R1／R2 都正確。報酬原本就以還原收盤價計算。"
          />
        </p>
        {splits.length === 0 ? (
          <p className="muted">
            <Bi en="None recorded." zh="尚無紀錄。" />
          </p>
        ) : (
          <ul className="compact-list">
            {splits.map((split) => (
              <li key={split.id}>
                <strong>{split.exDate}</strong>{' '}
                <Bi en={`each share became ${quantity(split.ratio)}`} zh={`每 1 股變為 ${quantity(split.ratio)} 股`} /> {split.note && <span className="muted">· {split.note}</span>}
                <DeleteForm id={split.id} action={deleteSplit} confirm={{ en: `Delete the ${split.exDate} split?`, zh: `確定刪除 ${split.exDate} 的分割？` }} />
              </li>
            ))}
          </ul>
        )}
        <SplitForm ticker={security.ticker} today={taipeiToday()} />
      </section>
      <section className="card">
        <h2>
          <Bi {...LABELS.delete} />
        </h2>
        <p className="muted small">
          <Bi en="Only a security nothing uses can be deleted: no trades, prices, splits or watchlist entry." zh="只有沒有被使用的證券可以刪除：沒有交易、價格、分割或觀察清單紀錄。" />
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
