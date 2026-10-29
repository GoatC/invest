import Link from 'next/link';

import { AllocationDonut } from '@/components/allocation-charts';
import { Bi } from '@/components/bi';
import { DataHealthBanner } from '@/components/data-status';
import { DataProblem } from '@/components/data-problem';
import { Facts } from '@/components/facts';
import { AgainstPlanChart } from '@/components/plan-charts';
import { ProposalsPanel } from '@/components/proposals-panel';
import { RiskCard } from '@/components/risk-card';
import { RiskDetails } from '@/components/risk-details';
import { requireSession } from '@/lib/auth';
import {
  DataError,
  loadAllocationData,
  loadJobRuns,
  loadLastAttribution,
  loadLastRun,
  loadPlanData,
  loadProposals,
  loadRedFlagData,
  loadRiskData,
  loadRules,
  loadValueWeek,
  loadWindfallPlan,
  loadWorkbench,
  orDataError,
  type AllocationData,
  type PlanData,
  type Proposal,
  type RedFlagData,
  type RiskData,
  type RuleRecord,
  type WindfallPlanRecord,
  type WorkbenchData,
} from '@/lib/data';
import { addDays, taipeiToday } from '@/lib/dates';
import { money, percent, signedPercent, signedTwd, twd } from '@/lib/format';
import { DRIFT_ICON, LABELS, PLAN_SERIES, type Bilingual } from '@/lib/i18n';
import { allocation, classDrifts, sleeveTargets } from '@/lib/models/allocation';
import { dataHealth } from '@/lib/models/data-health';
import { comingWeek, readWeeklyReview, summaryLines, weeklySummary } from '@/lib/models/notify';
import { buildSeries } from '@/lib/models/performance';
import { buildPortfolio, type Portfolio } from '@/lib/models/portfolio';
import { againstPlan, gap, monthEnds, savedPlan } from '@/lib/models/projection';
import { riskReport, sparkline } from '@/lib/models/risk';
import { marginOfSafety, zoneOf } from '@/lib/models/intrinsic';
import { nextFiling, savedFor } from '@/lib/models/workbench';
import { LIGHT_ICON, lightText } from '@/lib/red-flag-text';

type Params = Record<string, string | string[] | undefined>;

/**
 * The weekly dashboard, the home screen (PRD Section 5): the week's three lines with the portfolio's
 * value on a band at the top, then the Value at Risk (its distribution and make-up folded under
 * it), the watchlist, the coming week, the allocation, the windfall and the plan, and the
 * proposals last, with a jump to them from the band whenever one waits. Each part reads its own
 * data, so one that fails to load leaves the others in place.
 */
export default async function Dashboard({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: AllocationData;
  try {
    data = await loadAllocationData(supabase);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const [risk, proposals, value, plan, jobs, settings, windfall, workbench, flags, simulation, attribution] = await Promise.all([
    orDataError(loadRiskData(supabase, today)),
    orDataError(Promise.all([loadProposals(supabase, today), loadRules(supabase)])),
    orDataError(loadValueWeek(supabase, today)),
    orDataError(loadPlanData(supabase, today)),
    orDataError(loadJobRuns(supabase)),
    orDataError(
      (async () => {
        const { data: rows, error } = await supabase.from('config').select('key, value').in('key', ['dca', 'weekly_review']);
        if (error) throw new DataError('config', error.message);
        return (rows ?? []) as Array<{ key: string; value: unknown }>;
      })(),
    ),
    orDataError(loadWindfallPlan(supabase)),
    orDataError(loadWorkbench(supabase, today)),
    orDataError(loadRedFlagData(supabase, today, undefined, data)),
    orDataError(loadLastRun(supabase, 'monte_carlo')),
    orDataError(loadLastAttribution(supabase)),
  ]);
  const portfolio = buildPortfolio(data);
  const [list, rules] = proposals instanceof DataError ? [[], []] : proposals;
  const summary = weeklySummary({
    statuses: list.map((proposal) => proposal.status),
    classes: portfolio.classes,
    poolTwd: portfolio.pool.totalTwd,
    ...(value instanceof DataError ? { valueTwd: null, weekAgoTwd: null } : value),
  });

  const drifts = classDrifts(portfolio.classes, data.bands, portfolio.pool.totalTwd);
  const windfallTwd = portfolio.holdings.filter((holding) => holding.pool === 'windfall').reduce((total, holding) => total + (holding.valueTwd ?? 0), 0);

  return (
    <>
      {!(jobs instanceof DataError) && <DataHealthBanner health={dataHealth(jobs.runs, jobs.threshold, today)} threshold={jobs.threshold} quiet />}
      <Hero
        today={today}
        summary={summary}
        regularTwd={portfolio.pool.totalTwd}
        windfallTwd={windfallTwd}
        driftStatus={drifts.find((row) => summary.largestDrift && row.assetClass.nameEn === summary.largestDrift.name.en)?.status}
      />
      <div className="dash-row">
        <div className="dash-main">
          {risk instanceof DataError ? <Unavailable what={{ en: 'Value at Risk', zh: '風險值' }} error={risk} /> : <Risk risk={risk} portfolio={portfolio} today={today} />}
        </div>
        <div className="dash-side">
          {workbench instanceof DataError ? <Unavailable what={{ en: 'the watchlist', zh: '觀察清單' }} error={workbench} /> : <Watchlist data={workbench} flags={flags instanceof DataError ? undefined : flags} />}
          <ComingWeek
            today={today}
            settings={settings}
            rules={rules}
            tranches={windfall instanceof DataError ? [] : (windfall?.tranches ?? [])}
            filings={workbench instanceof DataError ? [] : workbench.stocks.flatMap((bench) => {
              const due = nextFiling(bench.security.market, bench.series.quarters);
              return due ? [{ ticker: bench.security.ticker, ...due }] : [];
            })}
          />
        </div>
      </div>
      <div className="dash-row">
        <div className="dash-main">
          <Donut data={data} portfolio={portfolio} />
        </div>
        <div className="dash-side">
          <Windfall portfolio={portfolio} plan={windfall} today={today} />
          {plan instanceof DataError ? <Unavailable what={{ en: 'the plan', zh: '計畫' }} error={plan} /> : <AgainstPlan plan={plan} />}
        </div>
      </div>
      {!(simulation instanceof DataError) && simulation && <MonteCarloUpdate run={simulation} today={today} />}
      {!(attribution instanceof DataError) && attribution && <AttributionUpdate last={attribution} today={today} />}
      {proposals instanceof DataError ? (
        <Unavailable what={{ en: 'proposals', zh: '提案' }} error={proposals} />
      ) : (
        <ProposalsPanel supabase={supabase} params={params} proposals={list} rules={rules} names={new Map(data.assetClasses.map((assetClass) => [assetClass.id, { en: assetClass.nameEn, zh: assetClass.nameZh }]))} />
      )}
    </>
  );
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** "2026 年 10 月 29 日 · 週四" for a Taipei date. */
function longDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  return `${year} 年 ${month} 月 ${day} 日 · 週${WEEKDAYS[weekday]}`;
}

/**
 * The band at the top: the portfolio's value (both pools), the weekly review's three lines, each
 * with its status icon, and a jump to the proposals at the foot of the page when one waits.
 */
function Hero({
  today,
  summary,
  regularTwd,
  windfallTwd,
  driftStatus,
}: {
  today: string;
  summary: ReturnType<typeof weeklySummary>;
  regularTwd: number;
  windfallTwd: number;
  driftStatus: string | undefined;
}) {
  const [rulesLine, driftLine, valueLine] = summaryLines(summary);
  const waiting = summary.openProposals + summary.approvedProposals;
  const drift = driftStatus === 'watch' || driftStatus === 'rebalance' ? driftStatus : 'ok';
  const lines: Array<{ line: Bilingual | undefined; icon: string; tone: string; href?: string; link?: Bilingual }> = [
    { line: rulesLine, icon: waiting > 0 ? '!' : '✓', tone: waiting > 0 ? 'watch' : 'ok' },
    { line: driftLine, icon: summary.largestDrift ? DRIFT_ICON[drift] : '…', tone: summary.largestDrift ? drift : 'idle', href: '/allocation', link: LABELS.allocation },
    { line: valueLine, icon: summary.valueTwd === null ? '…' : '✓', tone: summary.valueTwd === null ? 'idle' : 'ok' },
  ];
  return (
    <section className="hero" id="this-week">
      <div className="hero-figure">
        <span className="muted small">{longDate(today)}</span>
        <h1>本週</h1>
        <strong className="hero-value">{twd(regularTwd + windfallTwd)}</strong>
        <span className="muted small">
          <Bi en="Portfolio value, both pools" zh="總市值（兩個資金池）" />
        </span>
        <span className="muted small">
          <Bi en={`Regular ${twd(regularTwd)} · windfall ${twd(windfallTwd)}`} zh={`一般 ${twd(regularTwd)} · 大額 ${twd(windfallTwd)}`} />
        </span>
      </div>
      <div className="hero-lines">
        <ul className="summary-lines">
          {lines.map(({ line, icon, tone, href, link }) =>
            line ? (
              <li key={line.en}>
                <span className={`hero-icon ${tone}`} aria-hidden="true">
                  {icon}
                </span>
                <span>
                  <Bi {...line} />
                  {href && link && (
                    <>
                      {' · '}
                      <Link href={href}>
                        <Bi {...link} />
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ) : null,
          )}
        </ul>
        <div className="row">
          {waiting > 0 && (
            <Link href={`/${summary.openProposals === 0 ? '?p=approved' : ''}#proposals`} className="button primary pill">
              <Bi en={`${waiting} proposal${waiting === 1 ? '' : 's'} waiting`} zh={`${waiting} 份提案待處理`} /> ↓
            </Link>
          )}
          <Link href="/notifications" className="small">
            <Bi en="Notifications" zh="推播設定" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/** 6. The watchlist: each watched stock's distance to its buy and trim zones (F12), and its red-flag light (N3). */
/** F5's monthly re-run, in the week it updates only (PRD Section 5): the median at the last mark and the chance of the goal. */
function MonteCarloUpdate({ run, today }: { run: NonNullable<Awaited<ReturnType<typeof loadLastRun>>>; today: string }) {
  if (run.runDate <= addDays(today, -7)) return null;
  const mark = run.marks[run.marks.length - 1];
  if (!mark) return null;
  return (
    <section className="card form" id="dashboard-monte-carlo">
      <h2>
        <Bi en="Monte Carlo, re-run this month" zh="蒙地卡羅，本月重跑" />
      </h2>
      <p>
        <Bi
          en={`Year ${mark.year} median ${twd(mark.realMedian)} in today's money${mark.reaching === null ? '' : `; ${percent(mark.reaching, 0)} of paths reach the goal`}.`}
          zh={`第 ${mark.year} 年中位數 ${twd(mark.realMedian)}（今天幣值）${mark.reaching === null ? '' : `；${percent(mark.reaching, 0)} 的路徑達成目標`}。`}
        />{' '}
        <Link href="/monte-carlo">
          <Bi {...LABELS.monteCarlo} />
        </Link>
      </p>
    </section>
  );
}

/** N2's monthly run, in the week it updates only (PRD Section 5): the month's effects, level 1. */
function AttributionUpdate({ last, today }: { last: NonNullable<Awaited<ReturnType<typeof loadLastAttribution>>>; today: string }) {
  if (last.savedAt.slice(0, 10) <= addDays(today, -7)) return null;
  return (
    <section className="card form" id="dashboard-attribution">
      <h2>
        <Bi en="Attribution, updated this month" zh="績效歸因，本月更新" />
      </h2>
      <p>
        <Bi
          en={`${last.periodEnd.slice(0, 7)} against the benchmark: allocation ${signedPercent(last.allocation, 2)}, selection ${signedPercent(last.selection, 2)}, interaction ${signedPercent(last.interaction, 2)}, currency ${signedPercent(last.fx, 2)}.`}
          zh={`${last.periodEnd.slice(0, 7)} 相對基準：配置 ${signedPercent(last.allocation, 2)}、選擇 ${signedPercent(last.selection, 2)}、交互 ${signedPercent(last.interaction, 2)}、匯率 ${signedPercent(last.fx, 2)}。`}
        />{' '}
        <Link href="/attribution">
          <Bi {...LABELS.attribution} />
        </Link>
      </p>
    </section>
  );
}

function Watchlist({ data, flags }: { data: WorkbenchData; flags: RedFlagData | undefined }) {
  const watched = data.stocks.filter((stock) => stock.watch?.active);
  const lightOf = new Map((flags?.companies ?? []).map((company) => [company.security.ticker, company.assessment]));
  const light = (ticker: string) => {
    const assessment = lightOf.get(ticker);
    if (!assessment) return null;
    const icon = LIGHT_ICON[assessment.light ?? 'none'];
    return (
      <Link href={`/red-flags?t=${encodeURIComponent(ticker)}`}>
        <span className={`status-icon ${icon.className}`} aria-hidden="true">
          {icon.icon}
        </span>
        <Bi en={`${lightText(assessment.light).en}, ${Math.round(assessment.coverage)}% covered`} zh={`${lightText(assessment.light).zh}，覆蓋 ${Math.round(assessment.coverage)}%`} />
      </Link>
    );
  };
  return (
    <section className="card form" id="dashboard-watchlist">
      <div className="row spread">
        <h2>
          <Bi en="Watchlist" zh="觀察清單" />
        </h2>
        <Link href="/holdings#valuation">
          <Bi en="Valuation" zh="估值" />
        </Link>
      </div>
      {watched.length === 0 ? (
        <p className="muted">
          <Bi en="No stock watched: add one under Holdings → Valuation." zh="尚無觀察中的個股：請在「持倉 → 估值」加入。" />
        </p>
      ) : (
        <ul className="summary-lines">
          {watched.map((bench) => {
            const saved = savedFor(bench.saved, bench.security.ticker, bench.assumed.model)[0];
            const price = bench.series.closes[bench.series.closes.length - 1];
            const buy = bench.watch?.buy ?? data.rules.buy;
            const trim = bench.watch?.trim ?? data.rules.trim;
            if (!saved || !price || buy === null || trim === null) {
              return (
                <li key={bench.security.ticker}>
                  <Bi en={`${bench.security.ticker}: no saved value yet`} zh={`${bench.security.ticker}：尚無已儲存的估值`} /> {light(bench.security.ticker)}
                </li>
              );
            }
            const zone = zoneOf(price.close, saved.base, { buy, trim });
            const where =
              zone.zone === 'buy'
                ? { en: 'in the buy zone', zh: '在買入區' }
                : zone.zone === 'trim'
                  ? { en: 'in the trim zone', zh: '在減碼區' }
                  : { en: `${percent(zone.toBuy)} above the buy zone, ${percent(zone.toTrim)} below the trim zone`, zh: `距買入區 ${percent(zone.toBuy)}、距減碼區 ${percent(zone.toTrim)}` };
            const margin = signedPercent(marginOfSafety(saved.base, price.close));
            return (
              <li key={bench.security.ticker}>
                <Link href={`/valuation?t=${encodeURIComponent(bench.security.ticker)}`}>{bench.security.ticker}</Link>{' '}
                <Bi en={`${money(price.close, bench.security.currency)} vs ${money(saved.base, bench.security.currency)} (${margin}): ${where.en}`} zh={`${money(price.close, bench.security.currency)} 對 ${money(saved.base, bench.security.currency)}（${margin}）：${where.zh}`} />{' '}
                {light(bench.security.ticker)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Unavailable({ what, error }: { what: Bilingual; error: DataError }) {
  return (
    <p className="banner info" role="status">
      <Bi
        en={`Could not read ${what.en} (${error.table}: ${error.detail}); if the app was just updated, run npx supabase db push.`}
        zh={`無法讀取${what.zh}（${error.table}：${error.detail}）；如果剛更新過程式，請執行 npx supabase db push。`}
      />
    </p>
  );
}

/** 3. The VaR card. */
function Risk({ risk, portfolio, today }: { risk: RiskData; portfolio: Portfolio; today: string }) {
  const report = riskReport(portfolio.holdings, risk.input, today);
  const line = sparkline(risk.saved, today, report);
  return (
    <RiskCard report={report} line={line}>
      <RiskDetails report={report} line={line} />
    </RiskCard>
  );
}

/** 4. The allocation donut, regular pool, with its three lenses and the 80/20 target ring. */
function Donut({ data, portfolio }: { data: AllocationData; portfolio: Portfolio }) {
  const split = allocation(portfolio.holdings, 'regular', sleeveTargets(data.assetClasses));
  return (
    <section className="card form">
      <div className="row spread">
        <h2>
          <Bi en="Allocation, regular pool" zh="資產配置（一般資金池）" />
        </h2>
        <Link href="/allocation">
          <Bi en="Other pools and the table" zh="其他資金池與表格" />
        </Link>
      </div>
      {split.totalTwd <= 0 ? (
        <p className="muted">
          <Bi en="This pool holds nothing priced yet." zh="這個資金池目前沒有已計價的持有。" />
        </p>
      ) : (
        <AllocationDonut slices={split.slices} withTarget label={{ en: 'Donut chart of the regular pool’s allocation; the Allocation page lists every slice.', zh: '一般資金池的資產配置圓餅圖；資產配置頁列出每個區塊。' }} />
      )}
    </section>
  );
}

/** 5. The windfall: what is invested, what still waits as cash, and where the tranche plan stands (F3). */
function Windfall({ portfolio, plan, today }: { portfolio: Portfolio; plan: WindfallPlanRecord | undefined | DataError; today: string }) {
  const windfall = portfolio.holdings.filter((holding) => holding.pool === 'windfall' && holding.valueTwd !== null);
  const waiting = windfall.filter((holding) => holding.ticker === null && holding.productType === 'cash_mmf').reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const total = windfall.reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const deployed = total - waiting;
  return (
    <section className="card form">
      <div className="row spread">
        <h2>
          <Bi en="Windfall progress" zh="大額資金進度" />
        </h2>
        <Link href="/windfall">
          <Bi {...LABELS.windfall} />
        </Link>
      </div>
      {total <= 0 ? (
        <p className="muted">
          <Bi en="None yet." zh="尚無。" />
        </p>
      ) : (
        <>
          <div className="meter" role="img" aria-label={`Deployed ${percent(deployed / total)} 已投入 ${percent(deployed / total)}`}>
            <span style={{ width: `${Math.max(0, Math.min(100, (deployed / total) * 100))}%` }} />
          </div>
          <Facts
            facts={[
              { label: { en: 'Deployed', zh: '已投入' }, value: twd(deployed), note: { en: percent(deployed / total), zh: percent(deployed / total) } },
              { label: { en: 'Waiting as cash', zh: '等待中的現金' }, value: twd(waiting) },
            ]}
          />
        </>
      )}
      {plan instanceof DataError ? <Unavailable what={{ en: 'the windfall plan', zh: '大額資金計畫' }} error={plan} /> : <PlanStatus plan={plan} today={today} waiting={waiting} />}
    </section>
  );
}

/** The tranche plan in one line: how far along, on schedule or accelerated, and the next date. */
function PlanStatus({ plan, today, waiting }: { plan: WindfallPlanRecord | undefined; today: string; waiting: number }) {
  if (!plan) {
    return (
      <p className="muted small">
        <Bi en="No tranche plan yet." zh="尚無分批計畫。" />
      </p>
    );
  }
  const left = plan.tranches.filter((tranche) => tranche.status === 'scheduled');
  const pulled = plan.tranches.filter((tranche) => tranche.status === 'accelerated').length;
  const overdue = left.filter((tranche) => tranche.dueDate <= today).length;
  const next = left.find((tranche) => tranche.dueDate > today);
  const pace: Bilingual =
    left.length === 0
      ? { en: 'every tranche is in', zh: '所有批次都已投入' }
      : pulled > 0 || plan.tiersFired.length > 0
        ? { en: `accelerated${pulled > 0 ? ` (${pulled} pulled forward)` : ''}`, zh: `已加速${pulled > 0 ? `（${pulled} 批提前投入）` : ''}` }
        : { en: 'on schedule', zh: '依排程進行' };
  return (
    <p className="small">
      <Bi
        en={`Plan ${plan.tranches.length - left.length}/${plan.tranches.length} · ${pace.en}${overdue > 0 ? ` · ${overdue} due now` : ''}${next ? ` · next ${next.dueDate}` : ''}`}
        zh={`計畫 ${plan.tranches.length - left.length}/${plan.tranches.length} · ${pace.zh}${overdue > 0 ? ` · ${overdue} 批到期` : ''}${next ? ` · 下一批 ${next.dueDate}` : ''}`}
      />
    </p>
  );
}

/** 7. What falls in the coming seven days. */
function ComingWeek({
  today,
  settings,
  rules,
  tranches,
  filings,
}: {
  today: string;
  settings: Array<{ key: string; value: unknown }> | DataError;
  rules: readonly RuleRecord[];
  tranches: ReadonlyArray<{ dueDate: string; status: string }>;
  filings: ReadonlyArray<{ ticker: string; date: string; kind: 'deadline' | 'estimate' }>;
}) {
  const rows = settings instanceof DataError ? [] : settings;
  const dca = rows.find((row) => row.key === 'dca')?.value as Record<string, unknown> | undefined;
  const day = typeof dca?.['day_of_month'] === 'number' ? dca['day_of_month'] : null;
  const annual = rules.find((rule) => rule.condition === 'first_weekend_of_month' && rule.enabled);
  const month = annual ? (annual.threshold as Record<string, unknown> | null)?.['month'] : undefined;
  const events = comingWeek(today, day, readWeeklyReview(rows.find((row) => row.key === 'weekly_review')?.value), typeof month === 'number' ? month : null, tranches, filings);
  return (
    <section className="card form">
      <h2>
        <Bi en="Coming week" zh="下週事件" />
      </h2>
      {events.length === 0 ? (
        <p className="muted">
          <Bi en="Nothing scheduled in the next seven days." zh="未來七天沒有排定的事件。" />
        </p>
      ) : (
        <ul className="compact-list">
          {events.map((event) => (
            <li key={`${event.date}${event.what.en}`}>
              <span className="nowrap">
                {event.date}
                {event.time ? ` ${event.time}` : ''}
              </span>{' '}
              <Bi {...event.what} />
            </li>
          ))}
        </ul>
      )}
      {day === null && (
        <p className="muted small">
          <Bi en="DCA day not set." zh="未設定扣款日。" />{' '}
          <Link href="/rules#settings">
            <Bi {...LABELS.rules} />
          </Link>
        </p>
      )}
    </section>
  );
}

/** 8. Actual vs projected (F2), against the plan saved on the calculator. */
function AgainstPlan({ plan: data }: { plan: PlanData }) {
  const plan = data.settings ? savedPlan(data.settings) : null;
  const rows = plan ? againstPlan(monthEnds(buildSeries(data.input), 'regular'), plan.start, plan) : [];
  const latest = rows[rows.length - 1];
  return (
    <section className="card form">
      <div className="row spread">
        <h2>
          <Bi en="Actual vs plan" zh="實際與計畫對照" />
        </h2>
        <Link href="/plan#actual-vs-plan">
          <Bi {...LABELS.calculator} />
        </Link>
      </div>
      {!plan ? (
        <p className="muted">
          <Bi en="No plan saved yet." zh="尚未儲存計畫。" />
        </p>
      ) : !latest || latest.index === 0 ? (
        <p className="muted">
          <Bi en="Starts after the plan's first month." zh="計畫第一個月結束後開始。" />
        </p>
      ) : (
        <>
          <Facts
            facts={[
              { label: { en: `Actual ${latest.date}`, zh: `實際 ${latest.date}` }, value: twd(latest.actual) },
              { label: { en: 'Plan', zh: '計畫' }, value: twd(latest.planned) },
              {
                label: { en: 'Gap', zh: '差距' },
                value: signedTwd(gap(latest).total),
                note: { en: `put in ${signedTwd(gap(latest).contributed)} · growth ${signedTwd(gap(latest).growth)}`, zh: `投入 ${signedTwd(gap(latest).contributed)} · 成長 ${signedTwd(gap(latest).growth)}` },
                tone: gap(latest).total >= 0 ? 'ok' : 'watch',
              },
            ]}
          />
          <AgainstPlanChart rows={rows} label={{ en: `${PLAN_SERIES.actual.en} and ${PLAN_SERIES.planned.en.toLowerCase()} at each month end; the calculator page lists every month.`, zh: `每個月底的${PLAN_SERIES.actual.zh}與${PLAN_SERIES.planned.zh}；複利計算機頁列出每個月。` }} />
        </>
      )}
    </section>
  );
}
