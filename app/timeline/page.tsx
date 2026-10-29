import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { History, HistorySection } from '@/components/history';
import { Info } from '@/components/info';
import { Stat } from '@/components/stat';
import { TimelineChart, type TimelinePhase, type TimelinePoint } from '@/components/timeline-chart';
import { requireSession } from '@/lib/auth';
import { DataError, loadAuditHistory, loadMonteCarloInput, loadPlanData, loadTimelineSettings, type AuditEntry, type PlanData } from '@/lib/data';
import { addMonths, lastDayOf, monthsBetween, taipeiToday } from '@/lib/dates';
import { percent, signedTwd, twd } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { runMonteCarlo, type McRun } from '@/lib/models/monte-carlo';
import { buildSeries } from '@/lib/models/performance';
import { monthEnds, project, type SavedPlan } from '@/lib/models/projection';
import { actuals, chanceAt, phases as planPhases, projectedAt, yearEnd, yearsBetween, type TimelineSettings } from '@/lib/models/timeline';

import { GoalsForm } from './forms';

type Params = Record<string, string | string[] | undefined>;

const PHASE: Record<'accumulation' | 'windfall', Bilingual> = {
  accumulation: { en: 'Accumulation', zh: '累積期' },
  windfall: { en: 'Windfall deployment', zh: '大額資金部署' },
};

/** F1: the whole plan on one chart: phases, the plan and its Monte Carlo band, the actuals and the later goals. */
export default async function TimelinePage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let mc: Awaited<ReturnType<typeof loadMonteCarloInput>>;
  let planData: PlanData;
  let settings: TimelineSettings | undefined;
  let history: AuditEntry[];
  try {
    [mc, planData, settings, history] = await Promise.all([loadMonteCarloInput(supabase, today), loadPlanData(supabase, today), loadTimelineSettings(supabase), loadAuditHistory(supabase, 'config', 'timeline')]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const plan = mc.plan;
  const run = runMonteCarlo(mc, today);

  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.timeline} />
        </h1>
        <Info>
          <Bi
            en="The whole plan on one chart: the years of building up the regular pool, the windfall's deployment, and the goals you mark further out. The dashed line is the calculator's plan (F2), the band the Monte Carlo's range around its median (F5), and the line in colour what you actually hold, month end by month end. Where it runs inside the band it is within what the market could ordinarily do; the chart says how things stand, not what to do."
            zh="整份計畫在一張圖上：累積一般投入資金池的年月、大額資金的部署，以及你標在更遠處的目標。虛線是計算機的計畫（F2），區間是蒙地卡羅中位數周圍的範圍（F5），彩色線是你實際持有的價值（逐月底）。落在區間內，代表仍在市場通常會有的範圍；圖只說明現況，不告訴你該怎麼做。"
          />
        </Info>
        {params['saved'] === 'goals' && (
          <p className="banner ok" role="status">
            <Bi en="Goals saved." zh="已儲存目標。" />
          </p>
        )}
        {!plan && (
          <p className="banner warn">
            <Bi en="Save a plan on the Calculator first: the timeline is drawn from it." zh="請先在複利計算機儲存計畫：時間軸依據該計畫繪製。" />{' '}
            <Link href="/plan">
              <Bi {...LABELS.calculator} />
            </Link>
          </p>
        )}
        {plan && !run.ok && (
          <p className="banner warn">
            <Bi en="The Monte Carlo band is missing, so only the plan and your actuals are drawn; the Monte Carlo page says what it needs." zh="缺少蒙地卡羅區間，因此只畫出計畫與實際值；蒙地卡羅頁會說明還需要什麼。" />{' '}
            <Link href="/monte-carlo">
              <Bi {...LABELS.monteCarlo} />
            </Link>
          </p>
        )}
      </section>
      {plan && <Report plan={plan} run={run} mc={mc} planData={planData} settings={settings} today={today} />}
      {settings && (
        <section id="goals" className="card form">
          <h2>
            <Bi en="Set the later goals" zh="設定後續目標" />
          </h2>
          <GoalsForm settings={settings} />
        </section>
      )}
      <Method />
      <HistorySection title={{ en: 'Edit history of the goals', zh: '目標的修改紀錄' }} count={history.length}>
        <History entries={history} />
      </HistorySection>
    </>
  );
}

function Report({
  plan,
  run,
  mc,
  planData,
  settings,
  today,
}: {
  plan: SavedPlan;
  run: McRun;
  mc: Awaited<ReturnType<typeof loadMonteCarloInput>>;
  planData: PlanData;
  settings: TimelineSettings | undefined;
  today: string;
}) {
  const ok = run.ok ? run : null;
  const windfallIncluded = ok?.windfall.source != null;
  const ends = monthEnds(buildSeries(planData.input), windfallIncluded ? 'all' : 'regular');
  const actual = actuals(ends);
  const goals = settings?.goals ?? [];
  const inflation = plan.inflation;

  // The projection at each year end: F5's band and mean path, else F2's path alone.
  const deterministic = project(plan);
  const points: TimelinePoint[] = ok
    ? ok.result.fan.map((year) => ({ date: yearEnd(plan.start, year.year), low: year.low, median: year.median, high: year.high, expected: year.expected }))
    : deterministic.years.map((year) => ({ date: yearEnd(plan.start, year.year), low: year.value, median: year.value, high: year.value, expected: year.value }));
  const fan = ok?.result.fan ?? deterministic.years.map((year) => ({ year: year.year, low: year.value, median: year.value, high: year.value, expected: year.value }));

  // The windfall's tranches: the saved plan's, else the expected windfall's.
  const tranches = mc.windfallPlan
    ? mc.windfallPlan.tranches.map((tranche) => ({ dueDate: tranche.dueDate }))
    : ok?.windfall.source === 'expected' && ok.windfall.money
      ? ok.windfall.money.deployments.map((deployment) => ({ dueDate: `${addMonths(plan.start, deployment.month - 1)}-15` }))
      : [];
  const phases = planPhases(plan.start, plan.years, tranches);
  const stripes: TimelinePhase[] = phases.map((phase, index) => ({ label: PHASE[phase.kind], from: phase.from, to: phase.to, tone: index === 0 ? 0 : 1 }));
  const goalLines = goals.filter((goal) => lastDayOf(goal.month) <= yearEnd(plan.start, plan.years)).map((goal) => ({ date: lastDayOf(goal.month), label: goal.name }));

  const thisMonth = today.slice(0, 7);
  const now = projectedAt(fan, plan.start, thisMonth);
  const latest = actual[actual.length - 1];
  const bandText = ok ? `${Math.round(ok.settings.band[0] * 100)}–${Math.round(ok.settings.band[1] * 100)}%` : '—';
  const chartLabel: Bilingual = {
    en: `The plan's value from ${plan.start} over ${plan.years} years: the plan, ${ok ? `the Monte Carlo median and ${bandText} band, ` : ''}and the actual value${latest ? ` (${twd(latest.value)} on ${latest.date})` : ''}. The tables below list the figures.`,
    zh: `${plan.start} 起 ${plan.years} 年的計畫資產：計畫、${ok ? `蒙地卡羅中位數與 ${bandText} 區間、` : ''}以及實際值${latest ? `（${latest.date} 為 ${twd(latest.value)}）` : ''}。下方表格列出各項數字。`,
  };

  const stats: Array<{ label: Bilingual; value: string; note?: Bilingual }> = [];
  if (latest) stats.push({ label: { en: 'Actual now', zh: '目前實際' }, value: twd(latest.value), note: { en: `${windfallIncluded ? 'Both pools' : 'Regular pool'}, ${latest.date}`, zh: `${windfallIncluded ? '兩個資金池' : '一般投入資金池'}，${latest.date}` } });
  if (now) {
    stats.push({ label: { en: 'Plan this month (F2)', zh: '本月計畫（F2）' }, value: twd(now.expected), note: { en: `Month ${monthsBetween(plan.start, thisMonth) + 1} of the plan`, zh: `計畫第 ${monthsBetween(plan.start, thisMonth) + 1} 個月` } });
    if (latest) stats.push({ label: { en: latest.value >= now.expected ? 'Ahead of the plan' : 'Behind the plan', zh: latest.value >= now.expected ? '超前計畫' : '落後計畫' }, value: signedTwd(latest.value - now.expected) });
    if (ok) stats.push({ label: { en: `Band this month (${bandText})`, zh: `本月區間（${bandText}）` }, value: `${twd(now.low)} – ${twd(now.high)}`, note: latest ? { en: latest.value < now.low ? 'You are below it' : latest.value > now.high ? 'You are above it' : 'You are inside it', zh: latest.value < now.low ? '目前低於區間' : latest.value > now.high ? '目前高於區間' : '目前在區間內' } : undefined });
  }

  return (
    <>
      <section className="card form">
        {stats.length > 0 && (
          <div className="grid-cards">
            {stats.map((stat) => (
              <Stat key={stat.label.en} {...stat} />
            ))}
          </div>
        )}
        {actual.length === 0 && (
          <p className="muted small">
            <Bi en="No actual values yet: the line starts with your first trade." zh="尚無實際值：第一筆交易後開始畫線。" />
          </p>
        )}
        <TimelineChart points={points} actual={actual} phases={stripes} goals={goalLines} bandText={bandText} label={chartLabel} />
      </section>
      <section className="card form">
        <h2>
          <Bi en="Phases" zh="階段" />
        </h2>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="Phase" zh="階段" />
                </th>
                <th>
                  <Bi en="From" zh="起" />
                </th>
                <th>
                  <Bi en="To" zh="迄" />
                </th>
                <th className="num">
                  <Bi en="Years" zh="年數" />
                </th>
                <th>
                  <Bi en="What happens" zh="內容" />
                </th>
              </tr>
            </thead>
            <tbody>
              {phases.map((phase) => (
                <tr key={phase.kind}>
                  <td>
                    <Bi {...PHASE[phase.kind]} />
                  </td>
                  <td className="nowrap">{phase.from.slice(0, 7)}</td>
                  <td className="nowrap">{phase.to.slice(0, 7)}</td>
                  <td className="num">{yearsBetween(phase.from, phase.to)}</td>
                  <td>
                    {phase.kind === 'accumulation' ? (
                      <Bi en={`${twd(plan.pmt)} a month into the regular pool, ${percent(plan.stepUp, 1)} step-up a year`} zh={`每月 ${twd(plan.pmt)} 投入一般投入資金池，每年調升 ${percent(plan.stepUp, 1)}`} />
                    ) : (
                      <Bi en={`${tranches.length} monthly tranches into the core classes only (F3)`} zh={`${tranches.length} 個月分批，只投入核心類別（F3）`} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <GoalTable plan={plan} run={ok} fan={fan} goals={goals} inflation={inflation} today={today} />
    </>
  );
}

function GoalTable({ plan, run, fan, goals, inflation, today }: { plan: SavedPlan; run: Extract<McRun, { ok: true }> | null; fan: ReadonlyArray<{ year: number; low: number; median: number; high: number; expected: number }>; goals: TimelineSettings['goals']; inflation: number; today: string }) {
  if (goals.length === 0) {
    return (
      <section className="card form">
        <h2>
          <Bi en="Goals against the plan" zh="目標與計畫對照" />
        </h2>
        <p className="muted">
          <Bi en="No goals yet: add one below to see the plan's value and the chance of reaching it on that month." zh="尚未設定目標：在下方新增後，會顯示該月計畫的資產與達成的機率。" />
        </p>
      </section>
    );
  }
  return (
    <section className="card form">
      <h2>
        <Bi en="Goals against the plan" zh="目標與計畫對照" />
      </h2>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>
                <Bi en="Month" zh="月份" />
              </th>
              <th>
                <Bi en="Goal" zh="目標" />
              </th>
              <th className="num">
                <Bi en="Amount" zh="金額" />
              </th>
              <th className="num">
                <Bi en="Plan then" zh="屆時計畫" />
              </th>
              <th className="num">
                <Bi en="Median then" zh="屆時中位數" />
              </th>
              <th className="num">
                <Bi en="Chance" zh="機率" />
              </th>
            </tr>
          </thead>
          <tbody>
            {goals.map((goal) => {
              const at = projectedAt(fan, plan.start, goal.month);
              const factor = (1 + inflation) ** ((monthsBetween(plan.start, goal.month) + 1) / 12);
              const chance = run && goal.amountTwd !== null ? chanceAt(run.result, plan.start, goal.month, goal.amountTwd, inflation) : null;
              const past = goal.month < today.slice(0, 7);
              return (
                <tr key={`${goal.month}|${goal.name}`}>
                  <td className="nowrap">{goal.month}</td>
                  <td>
                    {goal.name}
                    {past && (
                      <span className="muted small">
                        {' '}
                        <Bi en="(past)" zh="（已過）" />
                      </span>
                    )}
                  </td>
                  <td className="num">{goal.amountTwd === null ? '—' : twd(goal.amountTwd)}</td>
                  <td className="num">{at ? twd(at.expected / factor) : <Bi en="beyond the plan" zh="超出計畫" />}</td>
                  <td className="num">{at && run ? twd(at.median / factor) : '—'}</td>
                  <td className="num">{chance === null ? '—' : percent(chance, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        <Bi en="Amounts, the plan and the median are in today's money. The chance is the share of Monte Carlo paths at or above the amount at the year end nearest that month." zh="金額、計畫與中位數皆以今天幣值計。機率為蒙地卡羅路徑中，在最接近該月的年底達到或超過該金額的比例。" />
      </p>
    </section>
  );
}

function Method() {
  const notes: Bilingual[] = [
    {
      en: 'The plan is the calculator’s saved plan on F2’s engine; when a windfall is included (the saved F3 plan, else the expected one on the Monte Carlo page) the plan’s line and the Monte Carlo band both carry it, and the actual line then counts both pools.',
      zh: '計畫為計算機儲存的計畫，使用 F2 引擎；納入大額資金時（已儲存的 F3 計畫，否則為蒙地卡羅頁的預期大額資金），計畫線與蒙地卡羅區間都包含它，實際線也改為合計兩個資金池。',
    },
    {
      en: 'The band and the median are the Monte Carlo’s at each year end of the plan, joined by straight lines; the plan’s year 1 ends twelve months after its first month. The same run as the Monte Carlo page: it holds all month, and the nightly job saves it monthly.',
      zh: '區間與中位數取自蒙地卡羅在計畫每個年底的數值，以直線相連；計畫第 1 年於第一個月起滿十二個月時結束。與蒙地卡羅頁是同一次模擬：整個月不變，每夜排程每月存檔。',
    },
    {
      en: 'Actual values are the pools’ value at each month end that has passed, and the latest value as the last point; they update as the weeks go by. A goal’s figures are read at its month, between the two year ends around it.',
      zh: '實際值為每個已過月底的資金池市值，最後一點為最新市值，隨每週更新。目標的數字取自該月，在前後兩個年底之間內插。',
    },
    {
      en: 'Phases: accumulation runs from the plan’s start to its end; the windfall’s deployment from its first tranche’s month to its last. Goals further out are yours to set; nothing here proposes a trade.',
      zh: '階段：累積期從計畫起始到結束；大額資金部署從第一批所在月份到最後一批。更遠的目標由你設定；此頁不會提出任何交易建議。',
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
