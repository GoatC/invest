import Link from 'next/link';

import { AllocationDonut, DriftChart, type DriftRow } from '@/components/allocation-charts';
import { Bi } from '@/components/bi';
import { DataHealthBanner } from '@/components/data-status';
import { DataProblem } from '@/components/data-problem';
import { Facts } from '@/components/facts';
import { AgainstPlanChart } from '@/components/plan-charts';
import { RiskCard } from '@/components/risk-card';
import { requireSession } from '@/lib/auth';
import {
  DataError,
  loadAllocationData,
  loadJobRuns,
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
import { taipeiToday } from '@/lib/dates';
import { money, percent, points, signedPercent, signedTwd, twd } from '@/lib/format';
import { DRIFT_ICON, DRIFT_STATUS, LABELS, PLAN_SERIES, type Bilingual } from '@/lib/i18n';
import { allocation, classDrifts, sleeveTargets } from '@/lib/models/allocation';
import { dataHealth } from '@/lib/models/data-health';
import { orderTotals } from '@/lib/models/engine';
import { comingWeek, readWeeklyReview, summaryLines, weeklySummary } from '@/lib/models/notify';
import { buildSeries } from '@/lib/models/performance';
import { buildPortfolio, type Portfolio } from '@/lib/models/portfolio';
import { againstPlan, gap, monthEnds, savedPlan } from '@/lib/models/projection';
import { riskReport, sparkline } from '@/lib/models/risk';
import { marginOfSafety, zoneOf } from '@/lib/models/intrinsic';
import { nextFiling, savedFor } from '@/lib/models/workbench';
import { proposalTitle } from '@/lib/proposal-text';
import { LIGHT_ICON, lightText } from '@/lib/red-flag-text';

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
  const [risk, proposals, value, plan, jobs, settings, windfall, workbench, flags] = await Promise.all([
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
      {proposals instanceof DataError ? <Unavailable what={{ en: 'proposals', zh: '提案' }} error={proposals} /> : <Proposals list={list} rules={rules} />}
      <Drift data={data} portfolio={portfolio} />
      {risk instanceof DataError ? <Unavailable what={{ en: 'Value at Risk', zh: '風險值' }} error={risk} /> : <Risk risk={risk} portfolio={portfolio} today={today} />}
      <Donut data={data} portfolio={portfolio} />
      <Windfall portfolio={portfolio} plan={windfall} today={today} />
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
      {plan instanceof DataError ? <Unavailable what={{ en: 'the plan', zh: '計畫' }} error={plan} /> : <AgainstPlan plan={plan} />}
    </>
  );
}

/** 6. The watchlist: each watched stock's distance to its buy and trim zones (F12), and its red-flag light (N3). */
function Watchlist({ data, flags }: { data: WorkbenchData; flags: RedFlagData | undefined }) {
  const watched = data.stocks.filter((stock) => stock.watch?.active);
  const lightOf = new Map((flags?.companies ?? []).map((company) => [company.security.ticker, company.assessment]));
  const light = (ticker: string) => {
    const assessment = lightOf.get(ticker);
    if (!assessment) return null;
    const icon = LIGHT_ICON[assessment.light ?? 'none'];
    return (
      <Link href={`/red-flags?t=${encodeURIComponent(ticker)}`} className="nowrap">
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
        <Link href="/valuation">
          <Bi en="Valuation" zh="估值" />
        </Link>
      </div>
      {watched.length === 0 ? (
        <p className="muted">
          <Bi en="No stock watched: add one on the Valuation page." zh="尚無觀察中的個股：請在「估值」頁加入。" />
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

/** 1. Open proposals, with approve and dismiss (a reason can be given on the proposals page). */
function Proposals({ list, rules }: { list: readonly Proposal[]; rules: readonly RuleRecord[] }) {
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
          <Bi en="Nothing to decide." zh="沒有需要決定的事。" />
        </p>
      )}
      {open.map((proposal) => {
        const rule = byId.get(proposal.ruleId) ?? { id: proposal.ruleId, condition: '' };
        const { sold, bought } = orderTotals(proposal.orders);
        return (
          <article key={proposal.id} className="proposal form">
            <h3>
              <Bi {...proposalTitle(rule)} />
            </h3>
            <p className="muted small">
              {proposal.orders.length === 0 ? (
                <Bi en="No orders" zh="無下單" />
              ) : (
                <Bi
                  en={`${proposal.orders.length} order${proposal.orders.length === 1 ? '' : 's'} · out ${twd(sold)} · in ${twd(bought)}`}
                  zh={`${proposal.orders.length} 筆 · 轉出 ${twd(sold)} · 買進 ${twd(bought)}`}
                />
              )}{' '}
              <Link href={`/proposals#proposal-${proposal.id}`}>
                <Bi en="Details" zh="詳細" />
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
