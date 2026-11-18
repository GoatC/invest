import Link from 'next/link';

import { AlertTiles } from '@/components/alert-tiles';
import { Bi, Zh } from '@/components/bi';
import { Info } from '@/components/info';
import { DataProblem } from '@/components/data-problem';
import { History, HistorySection } from '@/components/history';
import { Stat } from '@/components/stat';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClassSettings, loadAssumptions, loadAuditHistory, orDataError, type AssetClassSettings, type SavedAssumptions } from '@/lib/data';
import { percent } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import type { SavedEstimate } from '@/lib/models/auto-cma';

import { AssumptionsForm } from '../assumptions-form';
import { AutoCmaForm, RescoreForm } from '../auto-cma-form';

type Params = Record<string, string | string[] | undefined>;

const SAVED: Record<string, Bilingual> = {
  auto: { en: 'Saved; the satellite classes were scored again.', zh: '已儲存，並已重新評分衛星類別。' },
  scored: { en: 'Scored from today’s holdings.', zh: '已依今天的持股重新評分。' },
};

/** F6: the capital market assumptions, the config row cma, which F2, F5 and F7 read; blank satellite classes are scored from their holdings. */
export default async function AssumptionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const loaded = await orDataError(
    Promise.all([loadAssetClassSettings(supabase), loadAssumptions(supabase), loadAuditHistory(supabase, 'config', 'cma'), loadAuditHistory(supabase, 'config', 'cma_auto')]),
  );
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [classes, saved, history, autoHistory] = loaded;
  const entries = [...history, ...autoHistory].sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const savedNote = typeof params['saved'] === 'string' ? SAVED[params['saved']] : undefined;

  return (
    <>
      <section className="card form">
        <h1>
          <Zh en="Edit capital market assumptions" zh="修改資本市場假設" />
        </h1>
        <Info>
          <Bi
            en="Your own long-run expectation for each class: the yearly return and how much it swings (volatility, one standard deviation), with where it comes from. The compounding calculator (F2), Monte Carlo (F5) and the efficient frontier (F7) read them. Leave a class blank to set it later; a satellite class left blank is scored from its holdings below."
            zh="你對各類別的長期預期：每年報酬與波動程度（波動度，一個標準差），並註明來源。複利計算機（F2）、蒙地卡羅（F5）與效率前緣（F7）都會使用。尚未決定的類別可以先留白；留白的衛星類別會依下方持股自動評分。"
          />
        </Info>
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
            <AssumptionsForm
              classes={classes}
              assumptions={saved.manual}
              scored={Object.fromEntries((saved.auto?.enabled ? saved.estimates : []).map((estimate) => [estimate.classId, { expectedReturn: estimate.expectedReturn, volatility: estimate.volatility }]))}
            />
          </>
        )}
      </section>
      {saved && <AutoScores classes={classes} saved={saved} note={savedNote} />}
      <HistorySection count={entries.length}>
        <History entries={entries} />
      </HistorySection>
    </>
  );
}

const LEFT: Record<SavedEstimate['left'][number]['reason'], string> = { history: '歷史不足', beta: '無 β' };

/** The satellite classes scored from their holdings: a tile each, what was left out, the detail and the settings folded. */
function AutoScores({ classes, saved, note }: { classes: AssetClassSettings[]; saved: SavedAssumptions; note: Bilingual | undefined }) {
  const settings = saved.auto;
  const satellite = classes.filter((assetClass) => assetClass.sleeve === 'satellite');
  const byClass = new Map(saved.estimates.map((estimate) => [estimate.classId, estimate]));
  const waiting = new Map(saved.unscored.map((entry) => [entry.classId, entry]));
  const name = (id: string): Bilingual => {
    const found = classes.find((assetClass) => assetClass.id === id);
    return { en: found?.nameEn ?? id, zh: found?.nameZh ?? id };
  };
  const estimates = satellite.flatMap((assetClass) => (byClass.get(assetClass.id) ? [byClass.get(assetClass.id) as SavedEstimate] : []));
  return (
    <section className="card form" id="auto">
      <div className="row spread">
        <h2>
          <Bi en="Auto-scored from holdings" zh="依持股自動評分" />
        </h2>
        {settings?.enabled && <RescoreForm />}
      </div>
      {note && (
        <p className="banner ok" role="status">
          <Bi {...note} />
        </p>
      )}
      {!settings ? (
        <p className="banner warn">
          <Bi en="The cma_auto setting is missing from the database: run npx supabase db push." zh="資料庫中找不到 cma_auto 設定：請執行 npx supabase db push。" />
        </p>
      ) : !settings.enabled ? (
        <p className="muted">
          <span className="status-icon idle" aria-hidden="true">
            …
          </span>{' '}
          <Bi en="Off: blank satellite classes stay out of F2, F5 and F7." zh="已關閉：未設定的衛星類別不納入 F2、F5、F7。" />
        </p>
      ) : (
        <>
          <div className="grid-cards">
            {satellite.map((assetClass) => {
              const estimate = byClass.get(assetClass.id);
              const typed = saved.manual[assetClass.id];
              return (
                <Stat
                  key={assetClass.id}
                  label={name(assetClass.id)}
                  value={estimate ? percent(estimate.expectedReturn, 1) : '—'}
                  note={
                    !estimate
                      ? waiting.has(assetClass.id)
                        ? { en: 'Held, not scorable yet.', zh: '持股尚無法評分' }
                        : { en: 'Nothing held to score.', zh: '無可評分的持股' }
                      : typed
                        ? { en: `Volatility ${percent(estimate.volatility, 1)} · yours is used`, zh: `波動 ${percent(estimate.volatility, 1)}・採用你的假設` }
                        : { en: `Volatility ${percent(estimate.volatility, 1)} · ${estimate.lines.length} held · ${estimate.asOf}`, zh: `波動 ${percent(estimate.volatility, 1)}・${estimate.lines.length} 檔・${estimate.asOf}` }
                  }
                />
              );
            })}
          </div>
          <AlertTiles
            heading={{ en: 'Left out of the score', zh: '未納入評分' }}
            tone="watch"
            items={[...estimates, ...satellite.flatMap((assetClass) => (waiting.has(assetClass.id) ? [waiting.get(assetClass.id) as { classId: string; left: SavedEstimate['left'] }] : []))].flatMap((estimate) =>
              estimate.left.map((line) => ({
                key: `${estimate.classId}:${line.ticker}`,
                tone: 'watch' as const,
                title: { en: line.ticker, zh: line.ticker },
                chips: [
                  { label: name(estimate.classId), value: LEFT[line.reason] },
                  ...(line.reason === 'history' ? [{ label: { en: 'Needs', zh: '需' }, value: `${settings.minMonths} 個月` }] : []),
                ],
              })),
            )}
          />
          {estimates.length > 0 && <ScoreDetail estimates={estimates} name={name} />}
        </>
      )}
      <Info>
        <ul>
          <li>
            <Bi
              en="Each stock or ETF: CAPM, E = R_f + β × P. β is F11’s (Blume-adjusted), against the index that explains it best, the higher R² of the S&P 500 and TAIEX, so a Taiwan-listed fund of US stocks reads the S&P 500. R_f is that market’s 10-year yield."
              zh="每檔個股或 ETF：CAPM，E = R_f + β × P。β 取自 F11（Blume 調整），對照最能解釋它的指數（標普 500 與加權指數中 R² 較高者），因此投資美股的台灣 ETF 會對照標普 500。R_f 為該市場的 10 年期殖利率。"
            />
          </li>
          <li>
            <Bi
              en="P, the market premium: your assumption for US / global equity (US) or Taiwan market-cap equity (TW) less R_f, so β 1 expects what you expect of that market; F11’s ERP + country premium when that class is blank or chosen below."
              zh="P（市場溢酬）：你對美股／全球大盤（美國）或台股市值型（台灣）的假設減 R_f，因此 β 為 1 時的預期報酬等於你對該市場的預期；該類別未設定或下方選擇時，改用 F11 的風險溢酬加國家溢酬。"
            />
          </li>
          <li>
            <Bi
              en="The class: each line weighted by exposure; volatility from the weighted mix’s monthly TWD returns, so diversification counts. The efficient frontier reads that mix as the class’s history. A line with too few months or no β is left out."
              zh="類別：各檔依曝險加權；波動度取加權組合的台幣月報酬，因此分散效果會計入。效率前緣也以此組合作為該類別的歷史。月數不足或沒有 β 的持股不納入。"
            />
          </li>
          <li>
            <Bi
              en="Scored after each trade in a satellite class, after you save assumptions, and every night. Your own assumption always wins: type one above to replace the score, clear it to return to the score."
              zh="衛星類別每次交易後、儲存假設後與每夜都會重新評分。你輸入的假設永遠優先：在上方輸入即取代評分，清空即回到評分。"
            />
          </li>
        </ul>
      </Info>
      {settings && (
        <details>
          <summary>
            <Bi en="Settings" zh="設定" />
          </summary>
          <AutoCmaForm settings={settings} />
        </details>
      )}
    </section>
  );
}

/** Each scored line: its index, β, R², expected return, volatility and weight; folded. */
function ScoreDetail({ estimates, name }: { estimates: SavedEstimate[]; name: (id: string) => Bilingual }) {
  return (
    <details>
      <summary>
        <Bi en="Score detail" zh="評分明細" />
      </summary>
      {estimates.map((estimate) => (
        <div key={estimate.classId} className="table-wrap">
          <table className="compact">
            <caption>
              <Bi {...name(estimate.classId)} />
            </caption>
            <thead>
              <tr>
                <th>
                  <Bi {...LABELS.ticker} />
                </th>
                <th>
                  <Bi en="Index" zh="指數" />
                </th>
                <th className="num">β</th>
                <th className="num">R²</th>
                <th className="num">
                  <Bi en="Return" zh="報酬" />
                </th>
                <th className="num">
                  <Bi en="Volatility" zh="波動" />
                </th>
                <th className="num">
                  <Bi en="Weight" zh="權重" />
                </th>
              </tr>
            </thead>
            <tbody>
              {estimate.lines.map((line) => (
                <tr key={line.ticker}>
                  <td>
                    <Link href={`/regression?t=${encodeURIComponent(line.ticker)}`}>{line.ticker}</Link>
                  </td>
                  <td>{line.benchmark}</td>
                  <td className="num">{line.beta.toFixed(2)}</td>
                  <td className="num">{line.r2 === null ? '—' : line.r2.toFixed(2)}</td>
                  <td className="num">{percent(line.expectedReturn, 1)}</td>
                  <td className="num">{percent(line.volatility, 1)}</td>
                  <td className="num">{percent(line.weight, 0)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4}>
                  <Bi en="Class" zh="類別" />
                </td>
                <td className="num">
                  <strong>{percent(estimate.expectedReturn, 1)}</strong>
                </td>
                <td className="num">
                  <strong>{percent(estimate.volatility, 1)}</strong>
                </td>
                <td className="num">100%</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">
            {estimate.markets.map((line) => (
              <span key={line.market}>
                <Bi
                  en={`${line.market}: R_f ${percent(line.riskFree, 2)}, premium ${percent(line.premium, 2)} (${line.source === 'cma' ? 'your assumption' : 'F11 ERP'}). `}
                  zh={`${line.market}：R_f ${percent(line.riskFree, 2)}，溢酬 ${percent(line.premium, 2)}（${line.source === 'cma' ? '你的假設' : 'F11 風險溢酬'}）。`}
                />{' '}
              </span>
            ))}
            <Bi en={`${estimate.months} months, ${estimate.from} to ${estimate.to}.`} zh={`${estimate.months} 個月，${estimate.from} 至 ${estimate.to}。`} />
          </p>
        </div>
      ))}
    </details>
  );
}
