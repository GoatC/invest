import Link from 'next/link';

import { AllocationDonut, DriftChart, type DriftRow } from '@/components/allocation-charts';
import { Bi } from '@/components/bi';
import { DataHealthBanner } from '@/components/data-status';
import { DataProblem } from '@/components/data-problem';
import { AgainstPlanChart } from '@/components/plan-charts';
import { RiskCard } from '@/components/risk-card';
import { requireSession } from '@/lib/auth';
import {
  DataError,
  loadAllocationData,
  loadJobRuns,
  loadPlanData,
  loadProposals,
  loadRiskData,
  loadRules,
  loadValueWeek,
  orDataError,
  type AllocationData,
  type PlanData,
  type Proposal,
  type RiskData,
  type RuleRecord,
} from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { percent, points, signedTwd, twd } from '@/lib/format';
import { DRIFT_ICON, DRIFT_STATUS, LABELS, PLAN_SERIES, type Bilingual } from '@/lib/i18n';
import { allocation, classDrifts, sleeveTargets } from '@/lib/models/allocation';
import { dataHealth } from '@/lib/models/data-health';
import { orderTotals } from '@/lib/models/engine';
import { comingWeek, readWeeklyReview, summaryLines, weeklySummary } from '@/lib/models/notify';
import { buildSeries } from '@/lib/models/performance';
import { buildPortfolio, type Portfolio } from '@/lib/models/portfolio';
import { againstPlan, gap, monthEnds, savedPlan } from '@/lib/models/projection';
import { riskReport, sparkline } from '@/lib/models/risk';
import { proposalTitle, whyLines } from '@/lib/proposal-text';

import { approveProposal, dismissProposal } from './proposals/actions';

/**
 * The weekly dashboard, the home screen (PRD Section 5, Phase 1 step 10): the weekly review's three
 * lines, then rule status before profit and loss, top to bottom as the spec orders it. Each part
 * reads its own data, so one that fails to load leaves the others in place.
 */
export default async function Dashboard() {
  const { supabase } = await requireSession();
  const today = taipeiToday();
  let data: AllocationData;
  try {
    data = await loadAllocationData(supabase);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const [risk, proposals, value, plan, jobs, settings] = await Promise.all([
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
  ]);
  const portfolio = buildPortfolio(data);
  const [list, rules] = proposals instanceof DataError ? [[], []] : proposals;
  const summary = weeklySummary({
    statuses: list.map((proposal) => proposal.status),
    classes: portfolio.classes,
    poolTwd: portfolio.pool.totalTwd,
    ...(value instanceof DataError ? { valueTwd: null, weekAgoTwd: null } : value),
  });

  return (
    <>
      {!(jobs instanceof DataError) && <DataHealthBanner health={dataHealth(jobs.runs, jobs.threshold, today)} threshold={jobs.threshold} quiet />}
      <section className="card form" id="this-week">
        <div className="row spread">
          <h1>
            <Bi en="This week" zh="本週" />
          </h1>
          <Link href="/notifications">
            <Bi en="Notifications" zh="推播設定" />
          </Link>
        </div>
        <ul className="summary-lines">
          {summaryLines(summary).map((line) => (
            <li key={line.en}>
              <Bi {...line} />
            </li>
          ))}
        </ul>
      </section>
      {proposals instanceof DataError ? <Unavailable what={{ en: 'proposals', zh: '提案' }} error={proposals} /> : <Proposals list={list} rules={rules} names={names(data)} />}
      <Drift data={data} portfolio={portfolio} />
      {risk instanceof DataError ? <Unavailable what={{ en: 'Value at Risk', zh: '風險值' }} error={risk} /> : <Risk risk={risk} portfolio={portfolio} today={today} />}
      <Donut data={data} portfolio={portfolio} />
      <Windfall portfolio={portfolio} />
      <section className="card form">
        <h2>
          <Bi en="Watchlist" zh="觀察清單" />
        </h2>
        <p className="muted">
          <Bi
            en="Distance to the buy and trim zones and each company's red-flag light arrive with security analysis in Phase 2 (F12, N3)."
            zh="距離買入區與減碼區的幅度，以及各公司的紅旗燈號，將在第二階段的證券分析（F12、N3）加入。"
          />
        </p>
      </section>
      <ComingWeek today={today} settings={settings} rules={rules} />
      {plan instanceof DataError ? <Unavailable what={{ en: 'the plan', zh: '計畫' }} error={plan} /> : <AgainstPlan plan={plan} />}
    </>
  );
}

function names(data: AllocationData): Map<string, Bilingual> {
  return new Map(data.assetClasses.map((assetClass) => [assetClass.id, { en: assetClass.nameEn, zh: assetClass.nameZh }]));
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

/** 1. Open proposals, with approve and dismiss (a reason can be given on the proposals page). */
function Proposals({ list, rules, names }: { list: readonly Proposal[]; rules: readonly RuleRecord[]; names: ReadonlyMap<string, Bilingual> }) {
  const open = list.filter((proposal) => proposal.status === 'open');
  const approved = list.filter((proposal) => proposal.status === 'approved');
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  return (
    <section className="card form" id="dashboard-proposals">
      <div className="row spread">
        <h2>
          <Bi en={`Open proposals (${open.length})`} zh={`待處理提案（${open.length}）`} />
        </h2>
        <Link href="/proposals">
          <Bi en="All proposals" zh="所有提案" />
        </Link>
      </div>
      {open.length === 0 && (
        <p className="muted">
          <Bi en="Nothing to decide: every rule is on track." zh="沒有需要決定的事：所有規則都正常。" />
        </p>
      )}
      {open.map((proposal) => {
        const rule = byId.get(proposal.ruleId) ?? { id: proposal.ruleId, condition: '' };
        const [first] = whyLines(rule, proposal.detail, names);
        const { sold, bought } = orderTotals(proposal.orders);
        return (
          <article key={proposal.id} className="proposal form">
            <h3>
              <Bi {...proposalTitle(rule)} />
            </h3>
            {first && (
              <p className="small">
                <Bi {...first} />
              </p>
            )}
            <p className="muted small">
              <Bi
                en={`${proposal.orders.length} order${proposal.orders.length === 1 ? '' : 's'}: ${twd(sold)} out, ${twd(bought)} in.`}
                zh={`${proposal.orders.length} 筆下單：賣出／轉出 ${twd(sold)}，買進／存入 ${twd(bought)}。`}
              />{' '}
              <Link href={`/proposals#proposal-${proposal.id}`}>
                <Bi en="Details and edit" zh="詳細內容與修改" />
              </Link>
            </p>
            <div className="row">
              <form action={approveProposal}>
                <input type="hidden" name="id" value={proposal.id} />
                <button type="submit" className="button primary">
                  <Bi en="Approve" zh="核准" />
                </button>
              </form>
              <form action={dismissProposal}>
                <input type="hidden" name="id" value={proposal.id} />
                <button type="submit" className="button">
                  <Bi en="Dismiss" zh="略過" />
                </button>
              </form>
            </div>
          </article>
        );
      })}
      {approved.length > 0 && (
        <p className="banner info">
          <Bi en={`${approved.length} approved, waiting for your trades.`} zh={`${approved.length} 份已核准，等待你下單。`} />{' '}
          <Link href="/proposals">
            <Bi en="Execution checklist" zh="執行清單" />
          </Link>
        </p>
      )}
    </section>
  );
}

/** 2. SAA drift bars, coloured by the 5/25 rule, each status also with its icon and words. */
function Drift({ data, portfolio }: { data: AllocationData; portfolio: Portfolio }) {
  const drifts = classDrifts(portfolio.classes, data.bands, portfolio.pool.totalTwd);
  const rows: DriftRow[] = drifts.map((row) => ({
    id: row.assetClass.id,
    label: { en: row.assetClass.nameEn, zh: row.assetClass.nameZh },
    target: row.assetClass.targetWeight,
    weight: row.weight,
    drift: row.drift,
    band: row.band,
    status: row.status,
  }));
  const flagged = drifts.filter((row) => row.status === 'watch' || row.status === 'rebalance');
  return (
    <section className="card form">
      <div className="row spread">
        <h2>
          <Bi en="Drift from the targets" zh="與目標權重的偏離" />
        </h2>
        <Link href="/allocation">
          <Bi en="Allocation, with the table" zh="資產配置（含表格）" />
        </Link>
      </div>
      {portfolio.pool.totalTwd <= 0 ? (
        <p className="muted">
          <Bi en="The regular pool holds nothing priced yet." zh="一般資金池目前沒有已計價的持有。" />
        </p>
      ) : (
        <>
          <DriftChart rows={rows} label={{ en: 'Each asset class’s drift from its target, coloured by status; the list below and the Allocation page give the values.', zh: '各資產類別與目標權重的偏離，依狀態上色；下方清單與資產配置頁列出數值。' }} />
          <ul className="compact-list">
            {flagged.length === 0 ? (
              <li>
                <span className="status-icon ok" aria-hidden="true">
                  {DRIFT_ICON.ok}
                </span>{' '}
                <Bi en="Every core class is within its band." zh="所有核心類別都在門檻內。" />
              </li>
            ) : (
              flagged.map((row) => (
                <li key={row.assetClass.id}>
                  <span className={`status-icon ${row.status}`} aria-hidden="true">
                    {DRIFT_ICON[row.status]}
                  </span>{' '}
                  <Bi en={`${row.assetClass.nameEn} ${points(row.drift)}`} zh={`${row.assetClass.nameZh} ${points(row.drift)}`} /> · <Bi {...DRIFT_STATUS[row.status]} />
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </section>
  );
}

/** 3. The VaR card. */
function Risk({ risk, portfolio, today }: { risk: RiskData; portfolio: Portfolio; today: string }) {
  const report = riskReport(portfolio.holdings, risk.input, today);
  return <RiskCard report={report} line={sparkline(risk.saved, today, report)} details />;
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

/** 5. The windfall: what is invested and what still waits as cash; the tranche plan (F3) comes in Phase 2. */
function Windfall({ portfolio }: { portfolio: Portfolio }) {
  const windfall = portfolio.holdings.filter((holding) => holding.pool === 'windfall' && holding.valueTwd !== null);
  const waiting = windfall.filter((holding) => holding.ticker === null && holding.productType === 'cash_mmf').reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const total = windfall.reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const deployed = total - waiting;
  return (
    <section className="card form">
      <h2>
        <Bi en="Windfall progress" zh="大額資金進度" />
      </h2>
      {total <= 0 ? (
        <p className="muted">
          <Bi en="No windfall money yet." zh="尚無大額資金。" />
        </p>
      ) : (
        <>
          <div className="meter" role="img" aria-label={`Deployed ${percent(deployed / total)} 已投入 ${percent(deployed / total)}`}>
            <span style={{ width: `${Math.max(0, Math.min(100, (deployed / total) * 100))}%` }} />
          </div>
          <p>
            <Bi
              en={`Deployed ${twd(deployed)} (${percent(deployed / total)}); waiting as cash ${twd(waiting)}.`}
              zh={`已投入 ${twd(deployed)}（${percent(deployed / total)}）；以現金等待中 ${twd(waiting)}。`}
            />
          </p>
        </>
      )}
      <p className="muted small">
        <Bi en="The tranche schedule and its acceleration (F3) arrive in Phase 2." zh="分批排程與加速投入（F3）將在第二階段加入。" />
      </p>
    </section>
  );
}

/** 7. What falls in the coming seven days. */
function ComingWeek({ today, settings, rules }: { today: string; settings: Array<{ key: string; value: unknown }> | DataError; rules: readonly RuleRecord[] }) {
  const rows = settings instanceof DataError ? [] : settings;
  const dca = rows.find((row) => row.key === 'dca')?.value as Record<string, unknown> | undefined;
  const day = typeof dca?.['day_of_month'] === 'number' ? dca['day_of_month'] : null;
  const annual = rules.find((rule) => rule.condition === 'first_weekend_of_month' && rule.enabled);
  const month = annual ? (annual.threshold as Record<string, unknown> | null)?.['month'] : undefined;
  const events = comingWeek(today, day, readWeeklyReview(rows.find((row) => row.key === 'weekly_review')?.value), typeof month === 'number' ? month : null);
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
          <Bi en="Set the DCA debit day on the Rules page to see it here." zh="在「規則」頁設定定期定額扣款日後，會顯示在這裡。" />{' '}
          <Link href="/rules#settings">
            <Bi {...LABELS.rules} />
          </Link>
        </p>
      )}
      <p className="muted small">
        <Bi en="Tranche dates (F3) and the holdings' earnings dates arrive in Phase 2." zh="分批日期（F3）與持股財報日將在第二階段加入。" />
      </p>
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
          <Bi en="Save a plan on the calculator to follow the regular pool against it." zh="在複利計算機儲存計畫後，即可對照一般資金池與計畫。" />
        </p>
      ) : !latest || latest.index === 0 ? (
        <p className="muted">
          <Bi en="The comparison starts once the plan's first month has ended." zh="計畫的第一個月結束後開始對照。" />
        </p>
      ) : (
        <>
          <p>
            <Bi
              en={`${latest.date}: ${twd(latest.actual)} against ${twd(latest.planned)} planned, ${signedTwd(gap(latest).total)} (money put in ${signedTwd(gap(latest).contributed)}, growth ${signedTwd(gap(latest).growth)}).`}
              zh={`${latest.date}：實際 ${twd(latest.actual)}，計畫 ${twd(latest.planned)}，差距 ${signedTwd(gap(latest).total)}（投入金額 ${signedTwd(gap(latest).contributed)}，成長 ${signedTwd(gap(latest).growth)}）。`}
            />
          </p>
          <AgainstPlanChart rows={rows} label={{ en: `${PLAN_SERIES.actual.en} and ${PLAN_SERIES.planned.en.toLowerCase()} at each month end; the calculator page lists every month.`, zh: `每個月底的${PLAN_SERIES.actual.zh}與${PLAN_SERIES.planned.zh}；複利計算機頁列出每個月。` }} />
        </>
      )}
    </section>
  );
}
