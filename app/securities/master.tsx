import Link from 'next/link';

import { Bi } from '@/components/bi';
import { Info } from '@/components/info';
import type { HoldingsData } from '@/lib/data';
import { LABELS, MARKET, PRODUCT, SLEEVE, type Bilingual } from '@/lib/i18n';

const SAVED: Record<string, Bilingual> = {
  updated: { en: 'Security updated.', zh: '已更新證券。' },
  deleted: { en: 'Security deleted; the edit history keeps a copy.', zh: '已刪除證券，修改紀錄中保留一份副本。' },
};

/**
 * Every ticker the app knows, folded at the foot of the holdings page (it had a page of its own):
 * its product type, asset class, market and domicile decide how it counts, and the analyses read
 * new tickers from here. Each opens its edit page with its splits. `saved` is what an edit just did.
 */
export function SecuritiesMaster({ data, saved }: { data: HoldingsData; saved: string | undefined }) {
  const classes = new Map(data.assetClasses.map((assetClass) => [assetClass.id, assetClass]));
  const tradeCounts = new Map<string, number>();
  for (const trade of data.trades) tradeCounts.set(trade.ticker, (tradeCounts.get(trade.ticker) ?? 0) + 1);
  const securities = [...data.securities].sort(
    (a, b) => (classes.get(a.assetClassId)?.sortOrder ?? 0) - (classes.get(b.assetClassId)?.sortOrder ?? 0) || a.ticker.localeCompare(b.ticker),
  );
  const message = saved ? SAVED[saved] : undefined;

  return (
    <section className="card form" id="securities">
      <details className="history-section" open={message !== undefined}>
        <summary>
          <h2>
            <Bi en={`Securities (${securities.length})`} zh={`證券主檔（${securities.length}）`} />
          </h2>
        </summary>
        <div className="form">
          {message && (
            <p className="banner ok" role="status">
              <Bi {...message} />
              {saved === 'deleted' && (
                <>
                  {' '}
                  <Link href="/history">
                    <Bi en="See the edit history" zh="查看修改紀錄" />
                  </Link>
                </>
              )}
            </p>
          )}
          <div className="row spread">
            <Info>
              <Bi
                en="The product type and asset class decide how a security counts: R1 checks individual stocks only, and the asset class sets its sleeve and target weight. The analyses pick up a new ticker once the nightly job has loaded its prices."
                zh="產品類別與資產類別決定證券如何計算：R1 只檢查個股，資產類別決定所屬部位與目標權重。新代號在每夜排程載入價格後，各分析頁才會列入。"
              />
            </Info>
            <Link href="/securities/new" className="button primary">
              <Bi {...LABELS.addSecurity} />
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <Bi {...LABELS.ticker} />
                  </th>
                  <th>
                    <Bi {...LABELS.productType} />
                  </th>
                  <th>
                    <Bi {...LABELS.assetClass} />
                  </th>
                  <th>
                    <Bi {...LABELS.market} />
                  </th>
                  <th>
                    <Bi {...LABELS.currency} />
                  </th>
                  <th>
                    <Bi en="Domicile" zh="註冊地" />
                  </th>
                  <th className="num">
                    <Bi en="Trades" zh="交易筆數" />
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {securities.map((security) => {
                  const assetClass = classes.get(security.assetClassId);
                  return (
                    <tr key={security.ticker}>
                      <td className="name">
                        <strong>{security.ticker}</strong>
                        <div className="muted small">{security.name}</div>
                      </td>
                      <td>
                        <Bi {...PRODUCT[security.productType]} />
                      </td>
                      <td>
                        {assetClass ? <Bi en={assetClass.nameEn} zh={assetClass.nameZh} /> : security.assetClassId}
                        <div className="muted small">
                          <Bi {...SLEEVE[security.sleeve]} />
                        </div>
                      </td>
                      <td className="nowrap">
                        <Bi {...MARKET[security.market]} />
                      </td>
                      <td>{security.currency}</td>
                      <td>{security.domicile}</td>
                      <td className="num">{tradeCounts.get(security.ticker) ?? 0}</td>
                      <td className="nowrap">
                        <Link href={`/securities/${encodeURIComponent(security.ticker)}`}>
                          <Bi {...LABELS.edit} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </section>
  );
}
