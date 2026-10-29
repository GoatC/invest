import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { CorrelationHeatmap, FrontierChart, WeightsChart, type Curve, type Spot } from '@/components/frontier-charts';
import { History, HistorySection } from '@/components/history';
import { Info } from '@/components/info';
import { Stat } from '@/components/stat';
import { requireSession } from '@/lib/auth';
import { DataError, loadAuditHistory, loadFrontierData, type AuditEntry, type FrontierData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { percent } from '@/lib/format';
import { bi, LABELS, type Bilingual } from '@/lib/i18n';
import { build, expectedReturn, frontier, marketLine, sharpe, tangent, volatility, weightsFor, type Built, type FrontierPoint, type FrontierSettings } from '@/lib/models/frontier';

import { FrontierForm } from './forms';

type Params = Record<string, string | string[] | undefined>;

/** F7: where your mix sits among the portfolios the same assumptions could build. Reference only. */
export default async function FrontierPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: FrontierData;
  let history: AuditEntry[];
  try {
    [data, history] = await Promise.all([loadFrontierData(supabase, today), loadAuditHistory(supabase, 'config', 'frontier')]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const { settings } = data;
  const built = settings
    ? build(
        data.classes.map((entry) => ({ id: entry.id, expected: data.expected[entry.id] ?? null, returns: (entry.benchmarkTicker ? data.history.get(entry.benchmarkTicker) : undefined) ?? [] })),
        settings.bounds,
        settings,
        settings.lookbackYears * 12,
      )
    : null;

  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.frontier} />
        </h1>
        <Info>
          <Bi
            en="Of all the mixes your asset classes could make, which earn the most for the risk? The curve is the efficient frontier: for each level of volatility, the highest expected return, from your capital market assumptions and how the classes actually moved together. The dashed line is the capital market line, through the tangent portfolio with the best return per unit of risk. Your current and target mixes are the points to compare. Reference only: it never changes your targets, and its inputs are guesses."
            zh="你的資產類別能組成的所有配置中，哪些在相同風險下報酬最高？曲線是效率前緣：每個波動度水準下可得的最高預期報酬，依你的資本市場假設與各類別實際的連動計算。虛線是資本市場線，通過每單位風險報酬最高的切線組合。你目前與目標的配置是可供比較的點。僅供參考：不會改變你的目標，輸入值也只是猜測。"
          />
        </Info>
        {params['saved'] === 'settings' && (
          <p className="banner ok" role="status">
            <Bi en="Saved; the figures below use it." zh="已儲存；下方數字已採用。" />
          </p>
        )}
        {!settings && (
          <p className="banner warn">
            <Bi en="The frontier setting is missing from the database: run npx supabase db push." zh="資料庫中找不到效率前緣設定：請執行 npx supabase db push。" />
          </p>
        )}
        {built && !('model' in built) && <Problem problem={built} />}
      </section>
      {settings && built && 'model' in built && <Report built={built} settings={settings} data={data} />}
      {settings && (
        <section id="settings" className="card form">
          <h2>
            <Bi en="Rate, history and bounds" zh="利率、歷史與上下限" />
          </h2>
          <FrontierForm settings={settings} />
        </section>
      )}
      <Method />
      <HistorySection title={{ en: 'Edit history of the settings', zh: '設定的修改紀錄' }} count={history.length}>
        <History entries={history} />
      </HistorySection>
    </>
  );
}

function Problem({ problem }: { problem: Exclude<ReturnType<typeof build>, Built> }) {
  const message: Bilingual =
    problem.problem === 'classes'
      ? { en: 'No class has an expected return, price history and bounds yet.', zh: '尚無任何類別同時具備預期報酬、價格歷史與權重上下限。' }
      : problem.problem === 'bounds'
        ? { en: 'The bounds cannot hold weights that sum to 100%: raise the maximums or lower the minimums.', zh: '上下限無法組成合計 100% 的權重：請調高最大值或調低最小值。' }
        : { en: `Only ${problem.months} months of history are common to every class; a run needs ${problem.need}. The nightly job loads more as it runs.`, zh: `所有類別共同的歷史只有 ${problem.months} 個月，需要 ${problem.need} 個月。每夜排程會陸續載入更多。` };
  return (
    <p className="banner warn">
      <Bi {...message} />{' '}
      {problem.problem === 'classes' && (
        <Link href="/allocation/assumptions">
          <Bi en="Capital market assumptions" zh="資本市場假設" />
        </Link>
      )}
    </p>
  );
}

interface Named {
  key: string;
  name: Bilingual;
  point: FrontierPoint;
  sharpe: number | null;
}

function Report({ built, settings, data }: { built: Built; settings: FrontierSettings; data: FrontierData }) {
  const { model: problem, ids } = built;
  const curve = frontier(problem, settings.points);
  const best = tangent(problem, curve, settings.riskFree);
  const names = (id: string): Bilingual => {
    const found = data.classes.find((entry) => entry.id === id);
    return { en: found?.nameEn ?? id, zh: found?.nameZh ?? id };
  };
  const portfolio = (weights: number[] | null): FrontierPoint | null => (weights ? { weights, ret: expectedReturn(weights, problem.mu), vol: volatility(weights, problem.sigma) } : null);
  const current = portfolio(weightsFor(ids, data.current));
  const target = portfolio(weightsFor(ids, Object.fromEntries(data.classes.map((entry) => [entry.id, entry.targetWeight]))));
  const minVar = curve[0];
  const rows: Named[] = [
    ...(minVar ? [{ key: 'min', name: { en: 'Minimum variance', zh: '最小變異數' }, point: minVar, sharpe: sharpe(minVar.ret, minVar.vol, settings.riskFree) }] : []),
    ...(best ? [{ key: 'tangent', name: { en: 'Tangent (best Sharpe)', zh: '切線組合（最佳夏普）' }, point: best, sharpe: best.sharpe }] : []),
    ...(current ? [{ key: 'current', name: { en: 'Current mix', zh: '目前配置' }, point: current, sharpe: sharpe(current.ret, current.vol, settings.riskFree) }] : []),
    ...(target ? [{ key: 'target', name: { en: 'Target mix', zh: '目標配置' }, point: target, sharpe: sharpe(target.ret, target.vol, settings.riskFree) }] : []),
  ];
  const spot = (name: string, point: { vol: number; ret: number }): Spot => ({ name, vol: point.vol, ret: point.ret });
  const classSpots: Spot[] = ids.map((id, i) => spot(bi(names(id)), { vol: Math.sqrt((problem.sigma[i] as readonly number[])[i] as number), ret: problem.mu[i] as number }));
  const maxVol = Math.max(...curve.map((point) => point.vol), ...classSpots.map((entry) => entry.vol), current?.vol ?? 0, target?.vol ?? 0) * 1.08;
  const lineEnd = best ? marketLine(best, settings.riskFree, maxVol) : null;
  const cml: Curve[] = best && lineEnd !== null ? [{ vol: 0, ret: settings.riskFree }, { vol: maxVol, ret: lineEnd }] : [];
  const curvePoints: Curve[] = curve.map((point) => ({ vol: point.vol, ret: point.ret }));
  const chartLabel: Bilingual = {
    en: `The efficient frontier from ${percent(minVar?.vol, 1)} to ${percent(curve[curve.length - 1]?.vol, 1)} volatility, with the capital market line and your current and target mixes. The tables below list the figures.`,
    zh: `波動度 ${percent(minVar?.vol, 1)} 至 ${percent(curve[curve.length - 1]?.vol, 1)} 的效率前緣，附資本市場線與你目前與目標的配置。下方表格列出各項數字。`,
  };
  const stats = rows.map((row) => ({
    label: row.name,
    value: row.sharpe === null ? '—' : row.sharpe.toFixed(2),
    note: { en: `Sharpe · return ${percent(row.point.ret, 1)}, volatility ${percent(row.point.vol, 1)}`, zh: `夏普比率・報酬 ${percent(row.point.ret, 1)}，波動度 ${percent(row.point.vol, 1)}` } as Bilingual,
  }));
  const weightRows = curve.map((point) => ({ vol: point.vol, weights: point.weights }));
  const classNames = ids.map((id) => bi(names(id)));
  return (
    <>
      <section className="card form">
        <p className="muted small">
          <Bi
            en={`${ids.length} classes, ${built.months} months of returns (${built.from} to ${built.to}), expected returns from your assumptions, risk-free rate ${percent(settings.riskFree, 2)}.`}
            zh={`${ids.length} 個類別、${built.months} 個月報酬（${built.from} 至 ${built.to}），預期報酬取自你的假設，無風險利率 ${percent(settings.riskFree, 2)}。`}
          />
        </p>
        <div className="grid-cards">
          {stats.map((stat) => (
            <Stat key={stat.label.en} {...stat} />
          ))}
        </div>
        {built.left.length > 0 && (
          <p className="banner warn">
            <Bi
              en={`Left out: ${built.left.map((entry) => `${names(entry.id).en} (no ${entry.reason})`).join('; ')}. The current and target mixes are re-weighted to the classes used.`}
              zh={`未納入：${built.left.map((entry) => `${names(entry.id).zh}（沒有${entry.reason === 'assumption' ? '資本市場假設' : entry.reason === 'history' ? '歷史價格' : '上下限'}）`).join('；')}。目前與目標配置已重新加權為所用類別的 100%。`}
            />
          </p>
        )}
        <FrontierChart curve={curvePoints} line={cml} classes={classSpots} current={current ? spot(bi({ en: 'Current', zh: '目前' }), current) : null} target={target ? spot(bi({ en: 'Target', zh: '目標' }), target) : null} best={best ? spot(bi({ en: 'Tangent', zh: '切線' }), best) : null} riskFree={settings.riskFree} label={chartLabel} />
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="Portfolio" zh="投資組合" />
                </th>
                <th className="num">
                  <Bi en="Expected return" zh="預期報酬" />
                </th>
                <th className="num">
                  <Bi en="Volatility" zh="波動度" />
                </th>
                <th className="num">
                  <Bi en="Sharpe" zh="夏普" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <Bi {...row.name} />
                  </td>
                  <td className="num">{percent(row.point.ret, 2)}</td>
                  <td className="num">{percent(row.point.vol, 2)}</td>
                  <td className="num">{row.sharpe === null ? '—' : row.sharpe.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card form" id="frontier-weights">
        <h2>
          <Bi en="The weights, class by class" zh="各類別的權重" />
        </h2>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi {...LABELS.assetClass} />
                </th>
                {rows.map((row) => (
                  <th key={row.key} className="num">
                    <Bi {...row.name} />
                  </th>
                ))}
                <th className="num">
                  <Bi en="Bounds" zh="上下限" />
                </th>
              </tr>
            </thead>
            <tbody>
              {ids.map((id, i) => (
                <tr key={id}>
                  <td>
                    <Bi {...names(id)} />
                  </td>
                  {rows.map((row) => (
                    <td key={row.key} className="num">
                      {percent(row.point.weights[i], 1)}
                    </td>
                  ))}
                  <td className="num nowrap">
                    {percent(problem.lo[i], 0)} – {percent(problem.hi[i], 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>
          <Bi en="How the weights shift along the frontier" zh="沿效率前緣的權重變化" />
        </h3>
        <WeightsChart rows={weightRows} names={classNames} label={{ en: 'Each class’s weight at each point of the frontier, from minimum variance on the left to the highest return on the right.', zh: '前緣上每個點各類別的權重，左為最小變異數，右為最高報酬。' }} />
      </section>
      <section className="card form" id="frontier-correlation">
        <h2>
          <Bi en="How the classes move together" zh="各類別的連動" />
        </h2>
        <CorrelationHeatmap names={classNames} matrix={built.correlation} label={{ en: 'The correlation of each pair of asset classes’ monthly returns in TWD.', zh: '各對資產類別以台幣計的月報酬相關係數。' }} />
      </section>
    </>
  );
}

function Method() {
  const notes: Bilingual[] = [
    {
      en: 'Long-only mean–variance: each mix is found by minimising ½ wᵀΣw − λ μᵀw with the weights summing to 100% and each class within its bounds (λ = 0 is the minimum-variance mix; a larger λ buys more return). The frontier steps λ up so the expected return rises evenly to the highest the bounds allow.',
      zh: '只做多的均值–變異數：以權重合計 100%、各類別在上下限內，最小化 ½ wᵀΣw − λ μᵀw 求得每個配置（λ = 0 為最小變異數配置，λ 越大報酬越高）。前緣逐步增加 λ，使預期報酬平均上升到上下限允許的最高值。',
    },
    {
      en: 'μ is the capital market assumptions’ expected return of each class. Σ is the sample covariance of each class’s monthly returns in TWD (the benchmark ETF’s, the same proxies as the VaR), × 12, over the years of history set below; only months every class has are used. Both are estimates: μ is yours, Σ is the past, and the frontier is very sensitive to them.',
      zh: 'μ 為各類別資本市場假設的預期報酬。Σ 為各類別以台幣計的月報酬（基準 ETF，與風險值相同的代理指標）的樣本共變異數 × 12，期間為下方設定的歷史年數；只使用所有類別都有資料的月份。兩者都是估計：μ 是你的假設，Σ 是過去，前緣對它們非常敏感。',
    },
    {
      en: 'Sharpe = (E[Rp] − Rf) ÷ σp. The tangent portfolio has the highest Sharpe ratio on the frontier; the capital market line runs from the risk-free rate through it. Your current mix is the regular pool’s actual class weights, the target mix the F6 targets, both re-weighted to the classes used.',
      zh: '夏普比率 = (E[Rp] − Rf) ÷ σp。切線組合是前緣上夏普比率最高的配置；資本市場線從無風險利率出發通過它。目前配置為一般投入資金池的實際類別權重，目標配置為 F6 的目標，兩者都重新加權為所用類別的 100%。',
    },
    {
      en: 'Reference only: nothing here writes to your targets, and an optimiser that is told a class earns more will put more in it. Use it to see how far your mix is from efficient, not as the mix to hold.',
      zh: '僅供參考：此頁不會改寫你的目標；你若設定某類別報酬較高，最適化就會多配它。用它看你的配置離效率有多遠，而不是當作該持有的配置。',
    },
  ];
  return (
    <section className="card">
      <details>
        <summary>
          <Bi en="How these are worked out" zh="計算方式" />
        </summary>
        <ul>
          {notes.map((note) => (
            <li key={note.en}>
              <Bi {...note} />
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
