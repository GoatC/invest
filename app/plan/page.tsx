import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { History } from '@/components/history';
import { AgainstPlanChart } from '@/components/plan-charts';
import { Stat } from '@/components/stat';
import { requireSession } from '@/lib/auth';
import { DataError, loadAuditHistory, loadPlanData, type AuditEntry, type PlanData } from '@/lib/data';
import { addMonths, lastDayOf, taipeiToday } from '@/lib/dates';
import { percent, signedPercent, signedTwd, twd } from '@/lib/format';
import { LABELS, PLAN_SERIES, type Bilingual } from '@/lib/i18n';
import { buildSeries } from '@/lib/models/performance';
import { againstPlan, gap, monthEnds, savedPlan, type MonthEnd, type PlanRow, type SavedPlan } from '@/lib/models/projection';
import type { PlanField } from '@/lib/validation';

import { PlanForm, type StartValues } from './plan-form';

type Params = Record<string, string | string[] | undefined>;

/** A fraction as the calculator's percent field shows it: 0.0475 → "4.75". */
function typedPercent(value: number): string {
  return String(Number((value * 100).toFixed(2)));
}

/** F2: the compounding calculator, and the regular pool against the saved plan. */
export default async function PlanPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: PlanData;
  let history: AuditEntry[];
  try {
    [data, history] = await Promise.all([loadPlanData(supabase, today), loadAuditHistory(supabase, 'config', 'projection')]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const ends = monthEnds(buildSeries(data.input), 'regular');
  const plan = data.settings ? savedPlan(data.settings) : null;

  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.calculator} />
        </h1>
        <p className="muted">
          <Bi
            en="Where monthly investing could take the regular pool (F2): the value year by year in nominal TWD and in today's money, what you put in against what it grows, and how the pool is doing against the plan you save. A projection at one steady return, not a forecast: real returns swing, and the Monte Carlo in Phase 3 will show how widely."
            zh="每月定期投入可以讓一般投入資金池成長到多少（F2）：逐年的名目台幣與換算今天幣值的資產、累計投入與累計成長，以及資金池與已儲存計畫的對照。這是以固定報酬計算的預測，不是預言：實際報酬會起伏，第三階段的蒙地卡羅模擬會顯示起伏的範圍。"
          />
        </p>
        {params['saved'] === 'plan' && (
          <p className="banner ok" role="status">
            <Bi en="Plan saved; the comparison below now uses it, and the edit history keeps the old one." zh="已儲存計畫；下方的對照改用此計畫，修改紀錄中保留舊的計畫。" />
          </p>
        )}
        {!data.settings ? (
          <p className="banner warn">
            <Bi en="The projection setting is missing from the database: run npx supabase db push." zh="資料庫中找不到 projection 設定：請執行 npx supabase db push。" />
          </p>
        ) : (
          <PlanForm initial={initialValues(data, plan, ends, today)} starts={startValues(ends, today)} hints={hints(data)} savedStart={plan?.start ?? null} />
        )}
      </section>
      {data.settings && <AgainstPlan plan={plan} ends={ends} />}
      <Method />
      <section className="card">
        <h2>
          <Bi en="Edit history of the plan" zh="計畫的修改紀錄" />
        </h2>
        <History entries={history} />
      </section>
    </>
  );
}

function startValues(ends: readonly MonthEnd[], today: string): StartValues {
  const last = ends[ends.length - 1];
  return {
    months: Object.fromEntries(ends.filter((end) => end.complete).map((end) => [end.month, end.value])),
    first: ends[0]?.month ?? null,
    current: today.slice(0, 7),
    today: last?.value ?? 0,
  };
}

/** The saved plan; without one, next month's start from today's value, config's starting values, dca's amount and the target mix's return. */
function initialValues(data: PlanData, plan: SavedPlan | null, ends: readonly MonthEnd[], today: string): Record<PlanField, string> {
  if (plan) {
    return {
      start: plan.start,
      pv: String(plan.pv),
      pmt: String(plan.pmt),
      stepUp: typedPercent(plan.stepUp),
      expectedReturn: typedPercent(plan.expectedReturn),
      inflation: typedPercent(plan.inflation),
      years: String(plan.years),
    };
  }
  const settings = data.settings;
  const percentOf = (value: number | null | undefined) => (value === null || value === undefined ? '' : typedPercent(value));
  const pmt = settings?.pmt ?? data.dcaAmount;
  return {
    start: settings?.start ?? addMonths(today.slice(0, 7), 1),
    pv: String(Math.round(settings?.pv ?? ends[ends.length - 1]?.value ?? 0)),
    pmt: pmt === null ? '' : String(pmt),
    stepUp: percentOf(settings?.stepUp),
    expectedReturn: percentOf(settings?.expectedReturn ?? data.mix?.expectedReturn),
    inflation: percentOf(settings?.inflation),
    years: settings?.years === null || settings?.years === undefined ? '' : String(settings.years),
  };
}

function hints(data: PlanData): Partial<Record<PlanField, Bilingual>> {
  const mix = data.mix;
  const expectedReturn: Bilingual = !mix
    ? { en: 'No capital market assumptions yet: type one, or set them on the Allocation page.', zh: '尚未設定資本市場假設：請直接輸入，或到「資產配置」頁設定。' }
    : mix.share < 1 - 1e-9
      ? {
          en: `The target mix's expected return is ${percent(mix.expectedReturn, 2)}, over the classes with an assumption (${percent(mix.share, 0)} of the targets).`,
          zh: `目標配置的預期報酬為 ${percent(mix.expectedReturn, 2)}（僅計有假設的類別，占目標的 ${percent(mix.share, 0)}）。`,
        }
      : { en: `The target mix's expected return: ${percent(mix.expectedReturn, 2)}.`, zh: `目標配置的預期報酬：${percent(mix.expectedReturn, 2)}。` };
  return {
    start: { en: 'Contributions are paid at the end of each month from this one.', zh: '自這個月起，每月月底投入。' },
    pmt: data.dcaAmount === null ? undefined : { en: `Your monthly DCA: ${twd(data.dcaAmount)}.`, zh: `每月定期定額：${twd(data.dcaAmount)}。` },
    stepUp: { en: 'How much more you put in each year, e.g. with a raise.', zh: '每年多投入的比例，例如隨加薪調升。' },
    expectedReturn,
    inflation: { en: "For the value in today's money.", zh: '用於換算今天的幣值。' },
  };
}

// ---------------------------------------------------------------------------
// Actual vs plan
// ---------------------------------------------------------------------------

function AgainstPlan({ plan, ends }: { plan: SavedPlan | null; ends: readonly MonthEnd[] }) {
  const heading = (
    <h2>
      <Bi en="Actual vs plan" zh="實際與計畫對照" />
    </h2>
  );
  if (!plan) {
    return (
      <section id="actual-vs-plan" className="card form">
        {heading}
        <p className="muted">
          <Bi en="Save a plan above to compare the regular pool with it at each month end." zh="在上方儲存計畫後，每個月底會把一般投入資金池與計畫對照。" />
        </p>
      </section>
    );
  }
  const rows = againstPlan(ends, plan.start, plan);
  const latest = rows[rows.length - 1];
  const summary: Bilingual = {
    en: `The plan from ${plan.start}: ${twd(plan.pv)} to start, ${twd(plan.pmt)} a month stepped up ${percent(plan.stepUp, 2)} a year, at ${percent(plan.expectedReturn, 2)} a year for ${plan.years} years.`,
    zh: `${plan.start} 起的計畫：起始金額 ${twd(plan.pv)}，每月投入 ${twd(plan.pmt)}、每年調升 ${percent(plan.stepUp, 2)}，以年報酬 ${percent(plan.expectedReturn, 2)} 計算 ${plan.years} 年。`,
  };
  const firstEnd = lastDayOf(plan.start);
  return (
    <section id="actual-vs-plan" className="card form">
      {heading}
      <p className="muted small">
        <Bi {...summary} />
      </p>
      {!latest || latest.index === 0 ? (
        <p className="muted">
          <Bi en={`The plan's first month ends on ${firstEnd}; the comparison starts then.`} zh={`計畫的第一個月在 ${firstEnd} 結束，之後開始對照。`} />
        </p>
      ) : (
        <AgainstPlanBody rows={rows} latest={latest} />
      )}
    </section>
  );
}

function AgainstPlanBody({ rows, latest }: { rows: readonly PlanRow[]; latest: PlanRow }) {
  const split = gap(latest);
  const ahead = split.total >= 0;
  const share = latest.planned > 0 ? split.total / latest.planned : null;
  const stats: Array<{ label: Bilingual; value: string; note?: Bilingual }> = [
    { label: PLAN_SERIES.actual, value: twd(latest.actual), note: { en: `Regular pool on ${latest.date}`, zh: `一般投入資金池，${latest.date}` } },
    { label: PLAN_SERIES.planned, value: twd(latest.planned), note: { en: `Month ${latest.index} of the plan`, zh: `計畫第 ${latest.index} 個月` } },
    {
      label: { en: ahead ? 'Ahead of the plan' : 'Behind the plan', zh: ahead ? '超前計畫' : '落後計畫' },
      value: signedTwd(split.total),
      note: { en: `${signedPercent(share)} of the plan`, zh: `占計畫的 ${signedPercent(share)}` },
    },
    { label: { en: 'Of which money put in', zh: '其中：投入金額' }, value: signedTwd(split.contributed), note: { en: `${twd(latest.actualContributed)} vs ${twd(latest.plannedContributed)} planned`, zh: `實際 ${twd(latest.actualContributed)}，計畫 ${twd(latest.plannedContributed)}` } },
    { label: { en: 'Of which growth', zh: '其中：成長' }, value: signedTwd(split.growth), note: { en: 'Returns above or below the plan’s', zh: '報酬高於或低於計畫的部分' } },
  ];
  const label: Bilingual = {
    en: `The regular pool at each month end against the plan, ${rows[0]?.date} to ${latest.date}: ${twd(latest.actual)} against ${twd(latest.planned)}. The table below lists every month.`,
    zh: `一般投入資金池每個月底的市值與計畫對照，${rows[0]?.date} 至 ${latest.date}：實際 ${twd(latest.actual)}，計畫 ${twd(latest.planned)}。下方表格列出每個月。`,
  };
  return (
    <>
      <div className="grid-cards">
        {stats.map((stat) => (
          <Stat key={stat.label.en} {...stat} />
        ))}
      </div>
      <AgainstPlanChart rows={rows} label={label} />
      <details>
        <summary>
          <Bi en="Show as a table" zh="以表格顯示" />
        </summary>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="Month end" zh="月底" />
                </th>
                <th className="num">
                  <Bi {...PLAN_SERIES.actual} />
                </th>
                <th className="num">
                  <Bi {...PLAN_SERIES.planned} />
                </th>
                <th className="num">
                  <Bi en="Gap" zh="差距" />
                </th>
                <th className="num">
                  <Bi en="Money put in" zh="投入金額" />
                </th>
                <th className="num">
                  <Bi en="Growth" zh="成長" />
                </th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((row) => {
                const parts = gap(row);
                return (
                  <tr key={row.month}>
                    <td className="nowrap">{row.date}</td>
                    <td className="num">{twd(row.actual)}</td>
                    <td className="num">{twd(row.planned)}</td>
                    <td className="num">{signedTwd(parts.total)}</td>
                    <td className="num">{signedTwd(parts.contributed)}</td>
                    <td className="num">{signedTwd(parts.growth)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function Method() {
  const notes: Bilingual[] = [
    {
      en: 'Monthly compounding: each month the value earns the expected yearly return ÷ 12, then that month’s contribution is added at the month end. The contribution grows a little each month, (1 + step-up)^(1/12) − 1, so after twelve months it is the step-up higher.',
      zh: '每月複利：每個月資產先賺取「預期年報酬 ÷ 12」，月底再加入當月投入。投入金額每月小幅成長 (1 + 調升比例)^(1/12) − 1，因此十二個月後剛好高出調升比例。',
    },
    {
      en: 'FV = PV(1+r)^n + PMT·((1+r)^n − (1+g)^n) ÷ (r − g), with r the monthly return, g the contribution’s monthly growth and n the months; where r = g it becomes PMT·n·(1+r)^(n−1). The page draws the month-by-month path, which ends at the same value.',
      zh: 'FV = PV(1+r)^n + PMT·((1+r)^n − (1+g)^n) ÷ (r − g)，r 為月報酬、g 為投入金額的月成長率、n 為月數；r = g 時為 PMT·n·(1+r)^(n−1)。頁面畫出逐月計算的路徑，終值與公式相同。',
    },
    {
      en: 'Value in today’s money = the value ÷ (1 + inflation)^years. Real return = (1 + return) ÷ (1 + inflation) − 1.',
      zh: '換算今天的幣值＝資產 ÷ (1 + 通膨率)^年數。實質報酬＝(1 + 報酬) ÷ (1 + 通膨率) − 1。',
    },
    {
      en: 'The expected return starts at the target mix’s from your capital market assumptions: each class’s expected return weighted by its target. Classes without an assumption are left out and the rest re-weighted to 100%, so until the satellite has one the mix is the core’s.',
      zh: '預期報酬預設為依資本市場假設計算的目標配置報酬：各類別預期報酬乘以目標權重。沒有假設的類別不計入，其餘類別重新加權為 100%，因此衛星類別設定假設前，等於核心類別的配置報酬。',
    },
    {
      en: 'Actual vs plan follows the regular pool, where the monthly contributions go; the windfall has its own plan (F3). Money put in is counted from the trades, as for the money-weighted return: buys in, sales and recorded dividends out, changes to non-listed assets in or out. So money counts once it is invested, as the value does, and a contribution still waiting in the bank is not yet behind the plan.',
      zh: '實際與計畫對照以一般投入資金池為準（每月投入的資金池）；大額資金依 F3 自己的計畫。投入金額依交易計算（與資金加權報酬相同）：買進為投入、賣出與已記錄的股利為取回，非上市資產的變動為投入或取回。因此資金在投入市場後才計入，與市值一致；還在銀行等待投入的資金不會被算成落後。',
    },
    {
      en: 'The gap at each month end splits into money (actual minus planned contributions, the starting value included) and growth (the rest). The starting value is the pool’s value at the end of the month before the plan starts; a different PV in the plan shows as money.',
      zh: '每個月底的差距拆成投入金額（實際減計畫的累計投入，含起始金額）與成長（其餘部分）。實際的起始金額為計畫起始月前一個月底的資金池市值；計畫中的 PV 若不同，差額計入投入金額。',
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
      <p className="muted small">
        <Link href="/allocation/assumptions">
          <Bi en="Edit the capital market assumptions" zh="修改資本市場假設" />
        </Link>
      </p>
    </section>
  );
}
