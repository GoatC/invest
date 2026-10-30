import Link from 'next/link';

import { Bi, Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { History, HistorySection } from '@/components/history';
import { Info } from '@/components/info';
import { FanChart, SpreadChart, type Basis } from '@/components/monte-carlo-charts';
import { Stat } from '@/components/stat';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadAuditHistory, loadLastRun, loadMonteCarloInput, type AuditEntry } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { percent, twd } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { runMonteCarlo, valueBins, type McRun } from '@/lib/models/monte-carlo';
import type { AssetClass } from '@/lib/models/types';

import { MonteCarloForm } from './forms';

type Params = Record<string, string | string[] | undefined>;
type Ok = Extract<McRun, { ok: true }>;

/** F5: the spread of where the plan could end up, drawn from the history of each class's benchmark. */
export default async function MonteCarloPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  const basis: Basis = params['basis'] === 'nominal' ? 'nominal' : 'real';
  let data: Awaited<ReturnType<typeof loadMonteCarloInput>>;
  let names: AssetClass[];
  let history: AuditEntry[];
  let lastRun: Awaited<ReturnType<typeof loadLastRun>>;
  try {
    [data, names, history, lastRun] = await Promise.all([
      loadMonteCarloInput(supabase, today),
      loadAssetClasses(supabase),
      loadAuditHistory(supabase, 'config', 'monte_carlo'),
      loadLastRun(supabase, 'monte_carlo'),
    ]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const run = runMonteCarlo(data, today);

  return (
    <>
      <section className="card form">
        <h1>
          <Zh {...LABELS.monteCarlo} />
        </h1>
        <Info>
          <Bi
            en="F2 projects the plan at one steady return; real returns swing. This draws 10,000 possible futures from the way each asset class actually moved month to month, and shows where the regular pool (and the windfall) could end up: the middle outcome, a range around it, and the chance of reaching your goal. A picture of the spread, not a forecast."
            zh="F2 以固定報酬預測計畫，但實際報酬會起伏。這裡依各資產類別過去每月的實際漲跌，抽樣出 10,000 種可能的未來，顯示一般投入資金池（與大額資金）可能的結果：中間值、周圍的區間，以及達成目標的機率。呈現的是分布範圍，不是預言。"
          />
        </Info>
        {params['saved'] === 'settings' && (
          <p className="banner ok" role="status">
            <Bi en="Saved; the figures below use it." zh="已儲存；下方數字已採用。" />
          </p>
        )}
        {run.ok ? <Toggle basis={basis} /> : <Problem run={run} />}
      </section>
      {run.ok && <Report run={run} basis={basis} names={names} lastRun={lastRun} />}
      {run.ok && <WindfallCard run={run} basis={basis} names={names} capePercentile={data.cape?.percentile ?? null} />}
      {data.settings && (
        <section id="settings" className="card form">
          <h2>
            <Bi en="Goal and expected windfall" zh="目標與預期大額資金" />
          </h2>
          <MonteCarloForm settings={data.settings} />
        </section>
      )}
      <Method />
      <HistorySection title={{ en: 'Edit history of the settings', zh: '設定的修改紀錄' }} count={history.length}>
        <History entries={history} />
      </HistorySection>
    </>
  );
}

function Toggle({ basis }: { basis: Basis }) {
  const options: Array<{ value: Basis; label: Bilingual; href: string }> = [
    { value: 'real', label: { en: 'Today’s money', zh: '今天幣值' }, href: '/monte-carlo' },
    { value: 'nominal', label: { en: 'Nominal TWD', zh: '名目台幣' }, href: '/monte-carlo?basis=nominal' },
  ];
  return (
    <div className="filters">
      <div className="segmented" role="group" aria-label="Values 數值">
        <span className="label">
          <Bi en="Values" zh="數值" />
        </span>
        {options.map((option) => (
          <Link key={option.value} href={option.href} aria-current={option.value === basis ? 'true' : undefined}>
            <Bi {...option.label} />
          </Link>
        ))}
      </div>
    </div>
  );
}

function Problem({ run }: { run: Extract<McRun, { ok: false }> }) {
  const { problem } = run;
  const message: Bilingual =
    problem === 'settings'
      ? { en: 'The Monte Carlo setting is missing from the database: run npx supabase db push.', zh: '資料庫中找不到蒙地卡羅設定：請執行 npx supabase db push。' }
      : problem === 'plan'
        ? { en: 'Save a plan on the Calculator first: the simulation runs the same plan (start, contribution, step-up, inflation and years) with a return drawn for every month.', zh: '請先在複利計算機儲存計畫：模擬使用同一份計畫（起始、每月投入、調升、通膨與年數），並為每個月抽樣報酬。' }
        : problem === 'assumptions'
          ? { en: 'Enter the capital market assumptions first: each class is centred on its expected return and scaled to its volatility.', zh: '請先輸入資本市場假設：每個類別以其預期報酬為中心、波動縮放到其波動度。' }
          : problem === 'classes'
            ? { en: 'No class with a target has both an assumption and a benchmark ETF with prices yet.', zh: '尚無任何有目標的類別同時具備資本市場假設與有價格的基準 ETF。' }
            : {
                en: `Only ${problem.history} months of history are common to every simulated class; a run needs ${problem.need}. The nightly job loads more as it runs.`,
                zh: `所有模擬類別共同的歷史只有 ${problem.history} 個月，需要 ${problem.need} 個月。每夜排程會陸續載入更多。`,
              };
  return (
    <p className="banner warn">
      <Bi {...message} />{' '}
      {(run.problem === 'plan' || run.problem === 'assumptions') && (
        <Link href={run.problem === 'plan' ? '/plan' : '/allocation/assumptions'}>
          <Bi {...(run.problem === 'plan' ? LABELS.calculator : { en: 'Capital market assumptions', zh: '資本市場假設' })} />
        </Link>
      )}
    </p>
  );
}

function Report({ run, basis, names, lastRun }: { run: Ok; basis: Basis; names: readonly AssetClass[]; lastRun: Awaited<ReturnType<typeof loadLastRun>> }) {
  const { result, calibration, settings, plan } = run;
  const real = basis === 'real';
  const pick = (point: (typeof result.fan)[number]) => (real ? { low: point.realLow, median: point.realMedian, high: point.realHigh } : { low: point.low, median: point.median, high: point.high });
  const last = result.fan[result.fan.length - 1];
  if (!last) return null;
  const factor = (1 + plan.inflation) ** result.years;
  const finalEdge = pick(last);
  const bins = valueBins(result.finals, real ? factor : 1);
  const goal = settings.targetTwd === null ? null : real ? settings.targetTwd : settings.targetTwd * factor;
  const bandText = `${Math.round(settings.band[0] * 100)}–${Math.round(settings.band[1] * 100)}%`;
  const label = (id: string) => names.find((entry) => entry.id === id);
  const stats: Array<{ label: Bilingual; value: string; note?: Bilingual }> = [
    { label: { en: `Median in year ${result.years}`, zh: `第 ${result.years} 年中位數` }, value: twd(finalEdge.median), note: { en: real ? 'In today’s money' : 'Nominal TWD', zh: real ? '以今天幣值計' : '名目台幣' } },
    { label: { en: `Low end (${Math.round(settings.band[0] * 100)}th percentile)`, zh: `低端（第 ${Math.round(settings.band[0] * 100)} 百分位）` }, value: twd(finalEdge.low), note: { en: `Of ${result.paths.toLocaleString('en-US')} paths`, zh: `${result.paths.toLocaleString('en-US')} 條路徑` } },
    { label: { en: `High end (${Math.round(settings.band[1] * 100)}th percentile)`, zh: `高端（第 ${Math.round(settings.band[1] * 100)} 百分位）` }, value: twd(finalEdge.high), note: { en: `Of ${result.paths.toLocaleString('en-US')} paths`, zh: `${result.paths.toLocaleString('en-US')} 條路徑` } },
    {
      label: { en: 'Chance of reaching the goal', zh: '達成目標的機率' },
      value: last.reaching === null ? '—' : percent(last.reaching, 1),
      note: settings.targetTwd === null ? { en: 'Set a goal below', zh: '請在下方設定目標' } : { en: `${twd(settings.targetTwd)} in today’s money`, zh: `${twd(settings.targetTwd)}（今天幣值）` },
    },
    { label: { en: 'Money put in', zh: '投入金額' }, value: twd(real ? last.putIn / factor : last.putIn), note: { en: `Chance of ending below it: ${percent(result.belowPutIn, 1)}`, zh: `最後低於投入金額的機率：${percent(result.belowPutIn, 1)}` } },
  ];
  const fanLabel: Bilingual = {
    en: `The plan's value each year, median with a ${bandText} band, ${real ? 'in today’s money' : 'nominal'}: year ${result.years} median ${twd(finalEdge.median)}. The table below lists the marks.`,
    zh: `計畫每年的資產，中位數與 ${bandText} 區間（${real ? '今天幣值' : '名目'}）：第 ${result.years} 年中位數 ${twd(finalEdge.median)}。下方表格列出各年數。`,
  };
  const spreadLabel: Bilingual = {
    en: `How the year-${result.years} value spreads across ${result.paths.toLocaleString('en-US')} paths.`,
    zh: `第 ${result.years} 年資產在 ${result.paths.toLocaleString('en-US')} 條路徑上的分布。`,
  };
  const windfallNote: Bilingual =
    run.windfall.source === 'plan'
      ? { en: 'The windfall follows the saved F3 plan’s remaining tranches.', zh: '大額資金依已儲存 F3 計畫的剩餘各批。' }
      : run.windfall.source === 'expected'
        ? { en: `An expected windfall is included, in ${run.windfall.tranches?.count ?? '—'} tranches.`, zh: `已納入預期的大額資金，分 ${run.windfall.tranches?.count ?? '—'} 批。` }
        : { en: 'No windfall is included (no F3 plan, no expected windfall).', zh: '未納入大額資金（沒有 F3 計畫，也沒有預期大額資金）。' };
  return (
    <>
      <section className="card form">
        <p className="muted small">
          <Bi
            en={`The plan from ${plan.start}, ${plan.years} years, ${twd(plan.pmt)} a month; months drawn from ${calibration.from} to ${calibration.to} (${calibration.months} months), ${settings.blockMonths} at a time. ${windfallNote.en}`}
            zh={`${plan.start} 起的計畫，${plan.years} 年，每月 ${twd(plan.pmt)}；抽樣自 ${calibration.from} 至 ${calibration.to}（${calibration.months} 個月），每次連續抽 ${settings.blockMonths} 個月。${windfallNote.zh}`}
          />
        </p>
        <div className="grid-cards">
          {stats.map((stat) => (
            <Stat key={stat.label.en} {...stat} />
          ))}
        </div>
        {calibration.leftShare > 0 && (
          <p className="banner warn">
            <Bi
              en={`${percent(calibration.leftShare, 0)} of the targets are left out (${calibration.left.map((entry) => `${label(entry.id)?.nameEn ?? entry.id}: no ${entry.reason}`).join('; ')}); the rest are re-weighted to 100%, as in the calculator.`}
              zh={`有 ${percent(calibration.leftShare, 0)} 的目標未納入（${calibration.left.map((entry) => `${label(entry.id)?.nameZh ?? entry.id}：沒有${entry.reason === 'assumption' ? '資本市場假設' : '歷史價格'}`).join('；')}）；其餘重新加權為 100%，與計算機相同。`}
            />
          </p>
        )}
        <FanChart fan={result.fan} basis={basis} band={settings.band} inflation={plan.inflation} label={fanLabel} bandText={bandText} />
        <Marks run={run} basis={basis} />
      </section>
      <section className="card form">
        <h2>
          <Bi en={`Where year ${result.years} could land`} zh={`第 ${result.years} 年可能落在哪裡`} />
        </h2>
        <SpreadChart bins={bins.bins} goal={goal} total={result.paths} label={spreadLabel} />
        {lastRun && (
          <p className="muted small">
            <Bi
              en={`Last monthly re-run (${lastRun.runDate}): median in year ${lastRun.marks[lastRun.marks.length - 1]?.year ?? '—'} was ${twd(lastRun.marks[lastRun.marks.length - 1]?.realMedian)} in today’s money.`}
              zh={`上次每月重跑（${lastRun.runDate}）：第 ${lastRun.marks[lastRun.marks.length - 1]?.year ?? '—'} 年中位數為 ${twd(lastRun.marks[lastRun.marks.length - 1]?.realMedian)}（今天幣值）。`}
            />
          </p>
        )}
      </section>
      <Inputs run={run} names={names} />
    </>
  );
}

function Marks({ run, basis }: { run: Ok; basis: Basis }) {
  const { result, settings } = run;
  const real = basis === 'real';
  const rows = result.marks.length > 0 ? result.marks : result.fan.slice(-1);
  return (
    <details>
      <summary>
        <Bi en="The marks, as a table" zh="各年數，以表格顯示" />
      </summary>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>
                <Bi en="Year" zh="年" />
              </th>
              <th className="num">{Math.round(settings.band[0] * 100)}%</th>
              <th className="num">
                <Bi en="Median" zh="中位數" />
              </th>
              <th className="num">{Math.round(settings.band[1] * 100)}%</th>
              <th className="num">
                <Bi en="Mean path (F2)" zh="平均路徑（F2）" />
              </th>
              <th className="num">
                <Bi en="Put in" zh="投入" />
              </th>
              <th className="num">
                <Bi en="Reach goal" zh="達成目標" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((point) => {
              const f = real ? (1 + run.plan.inflation) ** point.year : 1;
              return (
                <tr key={point.year}>
                  <td>{point.year}</td>
                  <td className="num">{twd(real ? point.realLow : point.low)}</td>
                  <td className="num">{twd(real ? point.realMedian : point.median)}</td>
                  <td className="num">{twd(real ? point.realHigh : point.high)}</td>
                  <td className="num">{twd(point.expected / f)}</td>
                  <td className="num">{twd(point.putIn / f)}</td>
                  <td className="num">{point.reaching === null ? '—' : percent(point.reaching, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Inputs({ run, names }: { run: Ok; names: readonly AssetClass[] }) {
  const { calibration, settings } = run;
  return (
    <section className="card">
      <details>
        <summary>
          <Bi en="What the months are drawn from" zh="抽樣的月報酬來源" />
        </summary>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi {...LABELS.assetClass} />
                </th>
                <th className="num">
                  <Bi en="Weight" zh="權重" />
                </th>
                <th className="num">
                  <Bi en="History a year" zh="歷史年報酬" />
                </th>
                <th className="num">
                  <Bi en="History volatility" zh="歷史波動度" />
                </th>
                <th className="num">
                  <Bi en="Used a year" zh="採用年報酬" />
                </th>
                <th className="num">
                  <Bi en="Used volatility" zh="採用波動度" />
                </th>
              </tr>
            </thead>
            <tbody>
              {calibration.classes.map((entry) => {
                const name = names.find((candidate) => candidate.id === entry.id);
                return (
                  <tr key={entry.id}>
                    <td>
                      <Bi en={name?.nameEn ?? entry.id} zh={name?.nameZh ?? entry.id} />
                    </td>
                    <td className="num">{percent(entry.weight, 1)}</td>
                    <td className="num">{percent(entry.historyMean * 12, 1)}</td>
                    <td className="num">{percent(entry.historyVol * Math.sqrt(12), 1)}</td>
                    <td className="num">{percent(entry.mean * 12, 1)}</td>
                    <td className="num">{percent(entry.vol * Math.sqrt(12), 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          <Bi
            en={`${settings.scaleToCma ? 'Swings are scaled to each class’s CMA volatility.' : 'Swings are the history’s own.'} History: ${calibration.months} months, ${calibration.from} to ${calibration.to}.`}
            zh={`${settings.scaleToCma ? '波動已縮放到各類別資本市場假設的波動度。' : '波動採用歷史實際值。'}歷史：${calibration.months} 個月，${calibration.from} 至 ${calibration.to}。`}
          />{' '}
          <Link href="/allocation/assumptions">
            <Bi en="Edit the capital market assumptions" zh="修改資本市場假設" />
          </Link>
        </p>
      </details>
    </section>
  );
}

function Method() {
  const notes: Bilingual[] = [
    {
      en: 'History: each class’s benchmark ETF (the same proxies as the VaR) as monthly returns in TWD. Only months every simulated class has are used, so a month is a whole row of the market and the classes keep their correlation.',
      zh: '歷史：各類別的基準 ETF（與風險值相同的代理指標）以台幣計的月報酬。只使用所有模擬類別都有資料的月份，因此一個月是市場的完整一列，類別之間的相關性得以保留。',
    },
    {
      en: 'Bootstrap: each path draws blocks of consecutive historical months at random, with replacement, until it has every month of the plan. Real months keep the fat tails and the crashes that a bell curve would smooth away.',
      zh: '自助抽樣：每條路徑隨機（可重複）抽取連續的歷史月份區塊，直到湊滿計畫的每個月。真實月份保留了鐘形曲線會抹平的肥尾與崩跌。',
    },
    {
      en: 'Calibration: a few years of history say little about the next thirty, so each class is re-centred on its expected return ÷ 12 from the capital market assumptions (the same monthly return the calculator uses) and, by default, its swings are scaled to its assumed volatility. The history supplies only the shape of the swings and how classes move together.',
      zh: '校準：幾年的歷史無法代表未來三十年，所以每個類別以資本市場假設的預期報酬 ÷ 12（與計算機相同的月報酬）為中心，並預設把波動縮放到假設的波動度。歷史只提供波動的形狀與類別之間的連動。',
    },
    {
      en: 'The portfolio holds the target weights every month; classes without an assumption are left out and the rest re-weighted, as in the calculator. The money runs on the calculator’s own loop: the month’s return, then the month’s contribution at the month end.',
      zh: '投資組合每月維持目標權重；沒有假設的類別不計入，其餘重新加權，與計算機相同。資金使用計算機同一個迴圈：先計當月報酬，月底再加入當月投入。',
    },
    {
      en: 'The windfall waits in cash and moves into the core classes only (never the satellite) as its tranches fall due, from the saved F3 plan, else the expected windfall below, paced as F3 would pace it today (6, 12 or 24 tranches by the CAPE percentile) unless you set a count. The last tranche takes whatever cash is left, interest included.',
      zh: '大額資金先以現金等待，每批到期時才轉入核心類別（不含衛星），依已儲存的 F3 計畫，否則依下方的預期大額資金；除非自行設定批數，否則依 F3 今天的節奏（依 CAPE 百分位分 6、12 或 24 批）。最後一批投入剩下的全部現金（含利息）。',
    },
    {
      en: 'F3’s acceleration runs on every path: the global equity class stands for ACWI, and its fall from the highest month end of the last twelve fires the tiers on the cash still waiting (15%: the next tranche now; 25%: half; 35%: all of it), each once per drawdown, as the rules engine does live. Month ends are smoother than days, so the tiers fire a little less often than they would live; the stress test replays them on real crashes.',
      zh: 'F3 的加速投入在每條路徑上執行：以全球股票類別代表 ACWI，當它自近 12 個月底最高點回落時，對仍在等待的現金觸發級距（15%：下一批提前；25%：一半；35%：全部），同一波下跌每個級距只觸發一次，與規則引擎實際運作相同。月底資料比每日平滑，因此觸發次數會比實際略少；壓力測試會以真實崩盤回放。',
    },
    {
      en: 'The mean path is the plan with every month at its expected return, on the same engine. The median sits below it because losses weigh more than equal gains: the volatility drag. The numbers change when the month, the plan or an assumption changes, and are re-run monthly by the nightly job.',
      zh: '平均路徑是同一個引擎下每個月都取預期報酬的計畫。中位數低於它，因為同幅度的損失比獲利傷害更大（波動拖累）。數字在月份、計畫或假設改變時才會變動，並由每夜排程每月重跑。',
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

function WindfallCard({ run, basis, names, capePercentile }: { run: Ok; basis: Basis; names: readonly AssetClass[]; capePercentile: number | null }) {
  const { result, settings, plan, windfall } = run;
  const real = basis === 'real';
  if (!windfall.money) {
    return (
      <section className="card form" id="windfall">
        <h2>
          <Bi en="The windfall in it" zh="大額資金的影響" />
        </h2>
        <p className="banner warn">
          <Bi
            en="No windfall is in the simulation yet: set the expected windfall below (amount and month), or start a plan on the Windfall page once it arrives."
            zh="模擬中尚未納入大額資金：請在下方設定預期大額資金（金額與入帳月份），或在入帳後到「大額資金」頁建立計畫。"
          />{' '}
          <Link href="#settings">
            <Bi en="Set it" zh="前往設定" />
          </Link>
        </p>
      </section>
    );
  }
  const money = windfall.money;
  const arrival = money.arrivals[0];
  const tranchesLeft = money.deployments.length;
  const pace: Bilingual | null = windfall.tranches
    ? windfall.tranches.from === 'cape'
      ? {
          en: `${windfall.tranches.count} monthly tranches: F3’s pace at today’s CAPE percentile (${capePercentile === null ? '—' : capePercentile.toFixed(0)}).`,
          zh: `分 ${windfall.tranches.count} 個月：F3 依今天 CAPE 百分位（${capePercentile === null ? '—' : capePercentile.toFixed(0)}）的節奏。`,
        }
      : windfall.tranches.from === 'setting'
        ? { en: `${windfall.tranches.count} monthly tranches, as set below.`, zh: `分 ${windfall.tranches.count} 個月（下方設定）。` }
        : { en: `${windfall.tranches.count} monthly tranches: F3’s middle pace, as no CAPE is loaded yet.`, zh: `分 ${windfall.tranches.count} 個月：尚未載入 CAPE，採 F3 的中間節奏。` }
    : null;
  const gauge = names.find((entry) => entry.id === windfall.gaugeClass);
  const off: Bilingual | null =
    windfall.accelerationOff === 'rule'
      ? { en: 'Acceleration is off: rule WINDFALL_ACCELERATION is disabled, so tranches keep their schedule.', zh: '未加速：WINDFALL_ACCELERATION 規則已停用，各批依原排程投入。' }
      : windfall.accelerationOff === 'gauge'
        ? { en: 'Acceleration is off: no class is set to stand for ACWI.', zh: '未加速：尚未設定代表 ACWI 的類別。' }
        : windfall.accelerationOff === 'gauge_class'
          ? { en: 'Acceleration is off: the class standing for ACWI is not simulated (no assumption or no history).', zh: '未加速：代表 ACWI 的類別未納入模擬（沒有假設或沒有歷史）。' }
          : null;
  const rows = (result.marks.length > 0 ? result.marks : result.fan.slice(-1)).filter((point) => point.split);
  return (
    <section className="card form" id="windfall">
      <h2>
        <Bi en="The windfall in it" zh="大額資金的影響" />
      </h2>
      <p className="muted small">
        {windfall.source === 'plan' ? (
          <Bi
            en={`The saved F3 plan: ${twd(money.waiting)} still waiting for ${tranchesLeft} tranches, ${twd(money.deployed)} of the windfall pool already in the core mix.`}
            zh={`已儲存的 F3 計畫：${twd(money.waiting)} 仍在等待 ${tranchesLeft} 批投入，大額資金池已有 ${twd(money.deployed)} 投入核心配置。`}
          />
        ) : (
          <Bi
            en={`The expected windfall: ${twd(arrival?.amount)}, arriving at the end of ${run.settings.windfall.month ?? '—'} (month ${arrival?.month ?? '—'} of the plan), into the core classes only${money.deployed > 0 ? `; the ${twd(money.deployed)} in the windfall pool today stays in the core mix` : ''}.`}
            zh={`預期大額資金：${twd(arrival?.amount)}，於 ${run.settings.windfall.month ?? '—'} 月底（計畫第 ${arrival?.month ?? '—'} 個月）入帳，只投入核心類別${money.deployed > 0 ? `；大額資金池目前的 ${twd(money.deployed)} 維持在核心配置` : ''}。`}
          />
        )}{' '}
        {pace && <Bi {...pace} />}
      </p>
      {off ? (
        <p className="banner warn">
          <Bi {...off} />
        </p>
      ) : (
        result.tiers && (
          <div className="grid-cards">
            {result.tiers.map((tier) => (
              <Stat
                key={tier.drawdown}
                label={{ en: `Paths where the ${percent(tier.drawdown, 0)} tier fired`, zh: `觸發 ${percent(tier.drawdown, 0)} 級距的路徑` }}
                value={percent(tier.share, 1)}
                note={{ en: `${gauge?.nameEn ?? windfall.gaugeClass} standing for ACWI`, zh: `以${gauge?.nameZh ?? windfall.gaugeClass}代表 ACWI` }}
              />
            ))}
          </div>
        )
      )}
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>
                <Bi en="Year" zh="年" />
              </th>
              <th className="num">
                <Bi en="Median, all" zh="中位數（合計）" />
              </th>
              <th className="num">
                <Bi en="Regular pool" zh="一般投入資金池" />
              </th>
              <th className="num">
                <Bi en="Windfall" zh="大額資金" />
              </th>
              <th className="num">
                <Bi en="Reach goal" zh="達成目標" />
              </th>
              <th className="num">
                <Bi en="Without the windfall" zh="不含大額資金" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((point) => {
              const f = real ? (1 + plan.inflation) ** point.year : 1;
              const split = point.split as NonNullable<typeof point.split>;
              return (
                <tr key={point.year}>
                  <td>{point.year}</td>
                  <td className="num">{twd(point.median / f)}</td>
                  <td className="num">{twd(split.regularMedian / f)}</td>
                  <td className="num">{twd(split.windfallMedian / f)}</td>
                  <td className="num">{point.reaching === null ? '—' : percent(point.reaching, 1)}</td>
                  <td className="num">{split.reachingWithout === null ? '—' : percent(split.reachingWithout, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        <Bi
          en={`Each part’s median is taken on its own, so the two need not add up to the median of the whole. ${settings.targetTwd === null ? 'Set a goal below to see what the windfall adds to its chance.' : 'The last two columns are the goal’s chance with and without the windfall.'} ${real ? 'In today’s money.' : 'Nominal TWD.'}`}
          zh={`各部分的中位數分別計算，因此兩者相加不一定等於合計的中位數。${settings.targetTwd === null ? '在下方設定目標，即可看到大額資金對達成機率的影響。' : '最後兩欄為含與不含大額資金時達成目標的機率。'}${real ? '以今天幣值計。' : '名目台幣。'}`}
        />
      </p>
    </section>
  );
}
