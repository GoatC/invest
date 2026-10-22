import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataHealthBanner, RunStatusBadge } from '@/components/data-status';
import { DataProblem } from '@/components/data-problem';
import { TaipeiTime } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadDataStatus, type DataStatus, type LatestQuote } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { quantity, twd } from '@/lib/format';
import { feedLabel, LABELS, type Bilingual } from '@/lib/i18n';
import { dataHealth, RISK_ERROR, RULES_ERROR, SNAPSHOT_ERROR, type JobRun } from '@/lib/models/data-health';
import { GOLD } from '@/lib/models/fx';
import { GRAMS_PER_TROY_OUNCE } from '@/lib/models/valuation';

/** Rate pairs the nightly job stores that are not plain currencies. */
const PAIR_NAMES: Record<string, Bilingual> = {
  [`${GOLD}/USD`]: { en: 'Gold, USD per troy ounce', zh: '黃金，每盎司美元' },
  [`${GOLD}/TWD`]: { en: 'Gold, TWD per troy ounce', zh: '黃金，每盎司台幣' },
};

function pairName(pair: string): Bilingual {
  const [base, quote] = pair.split('/');
  return PAIR_NAMES[pair] ?? { en: `TWD per 1 ${base ?? pair}`, zh: `每 1 ${base ?? pair} 兌${quote === 'TWD' ? '台幣' : (quote ?? '')}` };
}

export default async function DataStatusPage() {
  const { supabase } = await requireSession();
  let status: DataStatus;
  try {
    status = await loadDataStatus(supabase);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const health = dataHealth(status.runs, status.threshold, taipeiToday());

  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.dataStatus} />
        </h1>
        <p className="muted">
          <Bi
            en="Every night at about 22:23 Taipei time, a GitHub Actions job loads daily closes, Bank of Taiwan exchange rates and the gold price, then saves each day's NAV snapshot. Each feed has one fallback; when a night fails, the app keeps the last prices it has."
            zh="每晚台北時間約 22:23，GitHub Actions 排程會載入每日收盤價、臺灣銀行匯率與金價，再存入每一天的淨值快照。每種資料各有一個備援來源；某晚失敗時，App 會沿用最後一次載入的價格。"
          />
        </p>
        <DataHealthBanner health={health} threshold={status.threshold} />
      </section>
      {health.latest && <LatestRun run={health.latest} />}
      <Prices status={status} />
      <Rates rates={status.rates} />
      {status.runs.length > 0 && <Runs runs={status.runs} />}
    </>
  );
}

/** How many of the snapshot days carry their 1-week VaR (N4). */
function snapshotRisk(withVar: number, days: number): Bilingual {
  if (withVar === days) return { en: 'Each carries its 1-week VaR.', zh: '每一天都附有一週風險值。' };
  return {
    en: `${withVar} of them carry a 1-week VaR: a day needs three years of weekly closes for every proxy before it.`,
    zh: `其中 ${withVar} 天附有一週風險值：每一天都需要之前三年各代理 ETF 的週收盤價。`,
  };
}

function LatestRun({ run }: { run: JobRun }) {
  const { detail } = run;
  const isSnapshotError = (line: string) => [SNAPSHOT_ERROR, RISK_ERROR].some((label) => line.startsWith(`${label}:`));
  const isRulesError = (line: string) => line.startsWith(`${RULES_ERROR}:`);
  const notLoaded = detail.errors.filter((line) => !isSnapshotError(line) && !isRulesError(line));
  const snapshotErrors = detail.errors.filter(isSnapshotError);
  const rulesErrors = detail.errors.filter(isRulesError);
  return (
    <section className="card form">
      <div className="row spread">
        <h2>
          <Bi en="Last run" zh="最近一次執行" />
        </h2>
        <RunStatusBadge status={run.status} />
      </div>
      <p>
        <TaipeiTime at={run.finishedAt} />
        {detail.window && (
          <span className="muted small">
            {' · '}
            <Bi en={`Loaded closes from ${detail.window.start} to ${detail.window.end}`} zh={`載入 ${detail.window.start} 至 ${detail.window.end} 的收盤價`} />
          </span>
        )}
      </p>
      {detail.snapshots && (
        <p className="muted small">
          <Bi
            en={`Saved the daily NAV snapshot for each day from ${detail.snapshots.from} to ${detail.snapshots.to} (${detail.snapshots.days} days).`}
            zh={`已存入 ${detail.snapshots.from} 至 ${detail.snapshots.to} 每一天的淨值快照（共 ${detail.snapshots.days} 天）。`}
          />{' '}
          {detail.snapshots.valueAtRisk !== null && <Bi {...snapshotRisk(detail.snapshots.valueAtRisk, detail.snapshots.days)} />}
        </p>
      )}
      {detail.rules && (
        <p className="muted small">
          <Bi
            en={`Checked the rules: ${detail.rules.created} new proposal${detail.rules.created === 1 ? '' : 's'}, ${detail.rules.closed} closed.`}
            zh={`已檢查規則：新增 ${detail.rules.created} 份提案，關閉 ${detail.rules.closed} 份。`}
          />{' '}
          <Link href="/proposals">
            <Bi en="Proposals" zh="提案" />
          </Link>
        </p>
      )}
      {rulesErrors.length > 0 && (
        <div className="banner warn">
          <Bi en="The rules could not be checked; use Check the rules now on the proposals page:" zh="無法檢查規則；請到提案頁按「立即檢查規則」：" />
          <ul>
            {rulesErrors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {notLoaded.length > 0 && (
        <div className="banner warn">
          <Bi en="Not loaded; these keep their previous price:" zh="未能載入，以下項目沿用先前的價格：" />
          <ul>
            {notLoaded.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {snapshotErrors.length > 0 && (
        <div className="banner warn">
          <Bi
            en="The NAV snapshots or their VaR were not saved; the performance and risk pages work from the trades, so they are still up to date:"
            zh="淨值快照或其風險值未能存入；績效頁與風險值頁直接由交易計算，仍是最新的："
          />
          <ul>
            {snapshotErrors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {detail.warnings.length > 0 && (
        <div className="banner info">
          <Bi en="Loaded from the fallback feed, as the main one failed:" zh="主要來源失敗，改由備援來源載入：" />
          <ul>
            {detail.warnings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Prices({ status }: { status: DataStatus }) {
  const latest = new Map(status.prices.map((quote) => [quote.key, quote]));
  const lastRun = status.runs[0]?.detail.prices ?? {};
  return (
    <section className="card form">
      <h2>
        <Bi en="Newest close per security" zh="各證券最新收盤價" />
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Bi {...LABELS.ticker} />
              </th>
              <th>
                <Bi en="Close date" zh="收盤日" />
              </th>
              <th className="num">
                <Bi en="Close" zh="收盤價" />
              </th>
              <th>
                <Bi {...LABELS.source} />
              </th>
              <th className="num">
                <Bi en="Days loaded last run" zh="上次載入天數" />
              </th>
            </tr>
          </thead>
          <tbody>
            {status.securities.map((security) => {
              const quote = latest.get(security.ticker);
              return (
                <tr key={security.ticker}>
                  <td className="name">
                    <strong>{security.ticker}</strong>
                    <div className="muted small">{security.name}</div>
                  </td>
                  <td className="nowrap">{quote?.date ?? <Bi en="Not loaded yet" zh="尚未載入" />}</td>
                  <td className="num">{quote ? `${quantity(quote.value)} ${security.currency}` : '—'}</td>
                  <td className="nowrap">{quote ? <Bi {...feedLabel(quote.source)} /> : '—'}</td>
                  <td className="num">{lastRun[security.ticker]?.rows ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Rates({ rates }: { rates: LatestQuote[] }) {
  const gold = rates.find((rate) => rate.key === `${GOLD}/TWD`);
  return (
    <section className="card form">
      <h2>
        <Bi en="Exchange rates and gold" zh="匯率與金價" />
      </h2>
      {rates.length === 0 ? (
        <p className="muted">
          <Bi en="No rate loaded yet." zh="尚未載入任何匯率。" />
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <Bi en="Rate" zh="項目" />
                </th>
                <th>
                  <Bi en="Date" zh="日期" />
                </th>
                <th className="num">
                  <Bi en="Value" zh="數值" />
                </th>
                <th>
                  <Bi {...LABELS.source} />
                </th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.key}>
                  <td>
                    <strong>{rate.key}</strong>
                    <div className="muted small">
                      <Bi {...pairName(rate.key)} />
                    </div>
                  </td>
                  <td className="nowrap">{rate.date}</td>
                  <td className="num">{quantity(rate.value)}</td>
                  <td className="nowrap">
                    <Bi {...feedLabel(rate.source)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gold && (
        <p className="muted small">
          <Bi
            en={`Gold per gram: ${twd(gold.value / GRAMS_PER_TROY_OUNCE)} = TWD per troy ounce ÷ ${GRAMS_PER_TROY_OUNCE} grams. TWD per ounce = the international USD price × the Bank of Taiwan USD rate of the day; the bank's own buy-back price is usually a little lower.`}
            zh={`每克金價：${twd(gold.value / GRAMS_PER_TROY_OUNCE)} = 每盎司台幣價格 ÷ ${GRAMS_PER_TROY_OUNCE} 克。每盎司台幣價格 = 國際美元金價 × 當日臺灣銀行美元匯率；銀行實際回收價通常略低。`}
          />
        </p>
      )}
    </section>
  );
}

function Runs({ runs }: { runs: JobRun[] }) {
  return (
    <section className="card form">
      <h2>
        <Bi en="Recent runs" zh="最近執行紀錄" />
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Bi en="Finished" zh="完成時間" />
              </th>
              <th>
                <Bi en="Status" zh="狀態" />
              </th>
              <th className="num">
                <Bi en="Securities" zh="證券" />
              </th>
              <th className="num">
                <Bi en="Rates" zh="匯率" />
              </th>
              <th className="num">
                <Bi en="Fallbacks" zh="備援" />
              </th>
              <th className="num">
                <Bi en="Errors" zh="錯誤" />
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td className="nowrap">
                  <TaipeiTime at={run.finishedAt} />
                </td>
                <td>
                  <RunStatusBadge status={run.status} />
                </td>
                <td className="num">{Object.keys(run.detail.prices).length}</td>
                <td className="num">{Object.keys(run.detail.rates).length}</td>
                <td className="num">{run.detail.warnings.length}</td>
                <td className="num">{run.detail.errors.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
