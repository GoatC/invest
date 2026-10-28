import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { DeleteForm } from '@/components/delete-form';
import { BacktestChart, type BacktestPoint } from '@/components/windfall-charts';
import { requireSession } from '@/lib/auth';
import { DataError, loadWindfallData, type WindfallData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { percent, signedPercent, twd } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { buildPortfolio } from '@/lib/models/portfolio';
import { backtest, capePercentile, drawdownOf, readAcceleration, readPace, trancheCount, type Acceleration, type Backtest, type MarketMonth, type Pace, type Spread } from '@/lib/models/windfall';
import { proposalTitle, STATUS } from '@/lib/proposal-text';
import { PACE_FIELDS, vehicleField, type PaceField } from '@/lib/validation';

import { deletePlan } from './actions';
import { PlanForm, WindfallForm, type FieldSpec } from './forms';

type Params = Record<string, string | string[] | undefined>;

const TRANCHE_STATUS: Record<string, Bilingual> = {
  scheduled: { en: 'Scheduled', zh: '排定' },
  accelerated: { en: 'Pulled forward', zh: '已提前投入' },
  done: { en: 'Done', zh: '已完成' },
};

function savedMessage(saved: unknown): Bilingual | undefined {
  switch (saved) {
    case 'plan':
      return { en: 'Plan saved: each tranche is proposed when it falls due.', zh: '已儲存計畫：每一批到期時會產生提案。' };
    case 'deleted':
      return { en: 'Plan deleted; the edit history keeps it.', zh: '已刪除計畫；修改紀錄會保留。' };
    case 'settings':
      return { en: 'Windfall settings saved.', zh: '已儲存大額資金設定。' };
    case 'pace':
      return { en: 'Pace and tiers saved; the rule change is logged.', zh: '已儲存分批節奏與加速級距；規則修改已留下紀錄。' };
    default:
      return undefined;
  }
}

/** The months Shiller's three series share, with CAPE where it has one (from 1881). */
function marketMonths(data: WindfallData): MarketMonth[] {
  const yields = new Map((data.market.series['sp500_yield'] ?? []).map((point) => [point.month, point.value]));
  const capes = new Map((data.market.series['us_cape'] ?? []).map((point) => [point.month, point.value]));
  return (data.market.series['sp500_price'] ?? []).flatMap((point) => {
    const dividendYield = yields.get(point.month);
    return dividendYield === undefined ? [] : [{ month: point.month, price: point.value, yield: dividendYield, cape: capes.get(point.month) ?? null }];
  });
}

/** F3 (PRD Module A): the windfall into the core in tranches paced by valuation, sooner in a fall. */
export default async function WindfallPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: WindfallData;
  try {
    data = await loadWindfallData(supabase, today);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const portfolio = buildPortfolio(data);
  const windfall = portfolio.holdings.filter((holding) => holding.pool === 'windfall' && (holding.valueTwd ?? 0) > 0);
  const waitingTwd = windfall.filter((holding) => holding.ticker === null && holding.productType === 'cash_mmf').reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const poolTwd = windfall.reduce((sum, holding) => sum + (holding.valueTwd ?? 0), 0);
  const capes = data.market.series['us_cape'] ?? [];
  const gauge = capePercentile(capes);
  const pace = readPace(data.pace);
  const rule = data.rules.find((candidate) => candidate.id === 'WINDFALL_ACCELERATION');
  const acceleration = rule ? readAcceleration(rule.threshold) : null;
  const drawdown = acceleration ? drawdownOf(data.gauge, today, acceleration.windowWeeks) : null;
  const plan = data.plan;
  const left = plan?.tranches.filter((tranche) => tranche.status === 'scheduled') ?? [];
  const fired = plan && drawdown ? plan.tiersFired.filter((tier) => tier.peakDate === drawdown.peak.date) : [];
  const nextTier = acceleration && drawdown ? acceleration.tiers.find((tier) => tier.drawdown > Math.max(drawdown.drawdown, ...fired.map((entry) => entry.drawdown))) : undefined;
  const result = pace ? backtest(marketMonths(data), { pace, acceleration, cashReturn: data.settings.cashReturn, horizonMonths: data.settings.horizonMonths, fromYear: data.settings.fromYear }) : null;
  const arrivals = data.flows.filter((flow) => flow.type === 'windfall');
  const arrivedTwd = arrivals.reduce((sum, flow) => sum + flow.amount * flow.fxRate, 0);
  const lastArrival = [...arrivals].sort((a, b) => b.flowDate.localeCompare(a.flowDate))[0]?.flowDate;
  const proposals = data.proposals.filter((proposal) => proposal.ruleId === 'WINDFALL_TRANCHE_DUE' || proposal.ruleId === 'WINDFALL_ACCELERATION');
  const rulesById = new Map(data.rules.map((entry) => [entry.id, entry]));
  const saved = savedMessage(params['saved']);
  const core = data.classSettings.filter((assetClass) => assetClass.sleeve === 'core');

  const lines: Bilingual[] = [];
  if (plan) {
    const done = plan.tranches.filter((tranche) => tranche.status !== 'scheduled').length;
    const next = left[0];
    lines.push({
      en: `Plan: ${twd(plan.totalTwd)} from ${plan.startDate} in ${plan.tranches.length} monthly tranches (CAPE percentile ${plan.capePercentile === null ? '—' : Math.round(plan.capePercentile)} then); ${done} done or pulled forward, ${left.length} to go${next ? `, the next due ${next.dueDate}` : ''}.`,
      zh: `計畫：${twd(plan.totalTwd)} 自 ${plan.startDate} 起分 ${plan.tranches.length} 個月投入（當時 CAPE 第 ${plan.capePercentile === null ? '—' : Math.round(plan.capePercentile)} 百分位）；已完成或提前 ${done} 批，剩 ${left.length} 批${next ? `，下一批 ${next.dueDate} 到期` : ''}。`,
    });
  } else {
    lines.push({
      en: 'No plan yet. When the windfall arrives, record it as a cash flow and as a TWD balance in the windfall pool (a money-market fund or time deposit), then start the plan below.',
      zh: '尚無計畫。大額資金入帳後，請登錄為現金流，並在大額資金池新增一筆台幣餘額（貨幣基金或定存），再在下方建立計畫。',
    });
  }
  lines.push({
    en: `Waiting as cash in the windfall pool: ${twd(waitingTwd)} of ${twd(poolTwd)}.`,
    zh: `大額資金池中等待投入的現金：${twd(poolTwd)} 中的 ${twd(waitingTwd)}。`,
  });
  if (gauge && pace) {
    lines.push({
      en: `Valuation now: CAPE ${gauge.cape.toFixed(1)} in ${gauge.month}, the ${Math.round(gauge.percentile)}th percentile of ${gauge.months.toLocaleString('en-US')} months: a plan started now would take ${trancheCount(gauge.percentile, pace)} monthly tranches.`,
      zh: `目前估值：${gauge.month} 的 CAPE 為 ${gauge.cape.toFixed(1)}，在 ${gauge.months.toLocaleString('en-US')} 個月中位於第 ${Math.round(gauge.percentile)} 百分位：現在建立的計畫會分 ${trancheCount(gauge.percentile, pace)} 個月投入。`,
    });
  }
  if (drawdown) {
    lines.push({
      en: `ACWI is ${percent(drawdown.drawdown)} below its 52-week high (${drawdown.peak.close} on ${drawdown.peak.date})${nextTier ? `; the next tier is at ${percent(nextTier.drawdown, 0)}` : ''}.`,
      zh: `ACWI 自 52 週高點下跌 ${percent(drawdown.drawdown)}（高點為 ${drawdown.peak.date} 的 ${drawdown.peak.close}）${nextTier ? `；下一個級距為 ${percent(nextTier.drawdown, 0)}` : ''}。`,
    });
  } else {
    lines.push({ en: "ACWI's closes are not loaded yet: the nightly job loads them.", zh: 'ACWI 的收盤價尚未載入：每夜排程會載入。' });
  }

  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.windfall} />
        </h1>
        <p className="muted">
          <Bi
            en="The windfall goes into the core classes only, never the satellite, in monthly tranches: fewer when the market is cheap, more when it is dear (by the S&P 500's CAPE against its history), and sooner when the world market (ACWI) falls 15%, 25% or 35% from its 52-week high. Each tranche is a proposal you approve and trade yourself (L2)."
            zh="大額資金只投入核心類別，不投入衛星部位，每月分批：市場便宜時批數少、昂貴時批數多（以 S&P 500 的 CAPE 對照其歷史），全球股市（ACWI）自 52 週高點下跌 15%、25% 或 35% 時提前投入。每一批都是一份提案，由你核准並自行下單（L2）。"
          />
        </p>
        {saved && (
          <p className="banner ok" role="status">
            <Bi {...saved} />
          </p>
        )}
        <ul className="summary-lines">
          {lines.map((line) => (
            <li key={line.en}>
              <Bi {...line} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card form" id="backtest">
        <h2>
          <Bi en="Lump sum vs this rule" zh="一次投入與本規則的比較" />
        </h2>
        {result ? (
          <Results result={result} horizon={data.settings.horizonMonths} acceleration={acceleration} source={data.market.sources['sp500_price']} />
        ) : (
          <p className="muted">
            <Bi en="The backtest needs the S&P 500's monthly prices, dividend yields and CAPE: the nightly job loads them from Shiller's data." zh="回測需要 S&P 500 的每月價格、股息殖利率與 CAPE：每夜排程會從 Shiller 的資料載入。" />
          </p>
        )}
      </section>

      <section className="card form" id="plan">
        <h2>
          <Bi en="The plan" zh="分批計畫" />
        </h2>
        {plan ? <Schedule plan={plan} proposals={proposals} /> : null}
        {proposals.length > 0 && (
          <ul className="compact-list">
            {proposals.map((proposal) => {
              const ruleRecord = rulesById.get(proposal.ruleId) ?? { id: proposal.ruleId, condition: '' };
              return (
                <li key={proposal.id}>
                  <Link href={`/proposals#proposal-${proposal.id}`}>
                    <Bi {...proposalTitle(ruleRecord)} />
                  </Link>{' '}
                  <span className="muted small">
                    #{proposal.id} · <Bi {...STATUS[proposal.status]} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {plan ? (
          <details>
            <summary>
              <Bi en="Replace or delete the plan" zh="取代或刪除計畫" />
            </summary>
            <PlanForm capes={capes} pace={pace} initial={{ totalTwd: String(plan.totalTwd), startDate: plan.startDate }} replacing />
            <DeleteForm id="plan" action={deletePlan} confirm={{ en: 'Delete the plan and its tranches?', zh: '要刪除計畫與其所有分批嗎？' }} />
          </details>
        ) : (
          <PlanForm capes={capes} pace={pace} initial={{ totalTwd: arrivedTwd > 0 ? String(Math.round(arrivedTwd)) : '', startDate: lastArrival ?? today }} replacing={false} />
        )}
      </section>

      <section className="card form" id="settings">
        <h2>
          <Bi en="How the windfall is bought" zh="大額資金的買進方式" />
        </h2>
        <p className="muted">
          <Bi
            en="Each tranche is split by the core targets (the satellite excluded); strategic cash's share stays in the balance it waits in. Pick the fund each class is bought through: an Irish-domiciled one, such as AGGU for bonds, keeps the windfall out of US estate tax (Costs & tax). Blank buys the class's benchmark ETF, or the fund the windfall pool already holds most of."
            zh="每一批依核心目標權重分配（不含衛星）；戰略現金的部分留在等待中的帳戶。可為各類別選擇買進的基金：愛爾蘭註冊的基金（例如債券用 AGGU）可避開美國遺產稅（見「費用與稅務」）。留空則買進類別基準 ETF，或大額資金池已持有最多的那檔。"
          />
        </p>
        <WindfallForm
          kind="settings"
          fields={[
            ...core.map(
              (assetClass): FieldSpec => ({
                name: vehicleField(assetClass.id),
                label: { en: `${assetClass.nameEn}: bought through`, zh: `${assetClass.nameZh}：買進標的` },
                options: [
                  { value: '', label: { en: `Benchmark (${assetClass.benchmarkTicker ?? '—'})`, zh: `基準（${assetClass.benchmarkTicker ?? '—'}）` } },
                  ...data.securities.filter((security) => security.assetClassId === assetClass.id).map((security) => ({ value: security.ticker, label: { en: `${security.ticker} · ${security.domicile}`, zh: `${security.ticker} · ${security.domicile}` } })),
                ],
              }),
            ),
            { name: 'cashReturn', label: { en: 'Backtest: yearly return of the cash waiting, %', zh: '回測：等待資金的年報酬（%）' }, hint: { en: 'A TWD money-market fund or time deposit.', zh: '台幣貨幣基金或定存。' } },
            { name: 'fromYear', label: { en: 'Backtest: first start year', zh: '回測：起始年份' } },
            { name: 'horizonMonths', label: { en: 'Backtest: months compared after each start', zh: '回測：每個起點之後比較的月數' } },
          ]}
          initial={{
            ...Object.fromEntries(core.map((assetClass) => [vehicleField(assetClass.id), data.settings.vehicles[assetClass.id] ?? ''])),
            cashReturn: String(Number((data.settings.cashReturn * 100).toFixed(4))),
            fromYear: String(data.settings.fromYear),
            horizonMonths: String(data.settings.horizonMonths),
          }}
          classes={Object.fromEntries(core.map((assetClass) => [assetClass.id, data.securities.filter((security) => security.assetClassId === assetClass.id).map((security) => security.ticker)]))}
        />
      </section>

      <section className="card form" id="pace">
        <h2>
          <Bi en="Pace and acceleration" zh="分批節奏與加速級距" />
        </h2>
        <p className="muted">
          <Bi
            en="The PRD's defaults, editable: below the 30th CAPE percentile 6 tranches, up to the 70th 12, above it 24; at a 15% fall the next tranche comes forward, at 25% half the cash left goes in, at 35% all of it. Each tier fires once per drawdown. The tiers are an open question (PRD Section 9): the backtest above shows what they did in the past."
            zh="規格書的預設值，可修改：CAPE 低於第 30 百分位分 6 批，到第 70 百分位分 12 批，高於則分 24 批；下跌 15% 下一批提前，25% 投入剩餘資金的一半，35% 全數投入。每個級距在同一波下跌中只觸發一次。加速級距仍是待決問題（規格書第 9 節）：上方回測顯示它們過去的表現。"
          />
        </p>
        {pace && acceleration ? (
          <WindfallForm kind="pace" fields={paceFields()} initial={paceInitial(pace, acceleration)} />
        ) : (
          <p className="banner warn">
            <Bi en="config windfall_pace or the rule WINDFALL_ACCELERATION is malformed: fix it in Supabase's Table Editor." zh="config 的 windfall_pace 或 WINDFALL_ACCELERATION 規則格式錯誤：請在 Supabase 的 Table Editor 修正。" />
          </p>
        )}
      </section>
    </>
  );
}

function Schedule({ plan, proposals }: { plan: NonNullable<WindfallData['plan']>; proposals: WindfallData['proposals'] }) {
  const byTranche = new Map(proposals.flatMap((proposal) => (proposal.detail.trancheId !== undefined ? [[proposal.detail.trancheId, proposal] as const] : [])));
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th>#</th>
            <th>
              <Bi en="Due" zh="到期日" />
            </th>
            <th className="num">
              <Bi en="Planned" zh="規劃金額" />
            </th>
            <th>
              <Bi en="Status" zh="狀態" />
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.tranches.map((tranche, index) => {
            const proposal = byTranche.get(tranche.id);
            return (
              <tr key={tranche.id}>
                <td className="num">{index + 1}</td>
                <td className="nowrap">{tranche.dueDate}</td>
                <td className="num">{twd(tranche.amountTwd)}</td>
                <td>
                  <Bi {...(TRANCHE_STATUS[tranche.status] ?? { en: tranche.status, zh: tranche.status })} />
                  {proposal && (
                    <>
                      {' '}
                      <Link href={`/proposals#proposal-${proposal.id}`} className="small">
                        #{proposal.id}
                      </Link>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        <Bi
          en="Planned amounts are the total over the tranche count. When a tranche falls due, its proposal deploys the cash still waiting over the tranches still to go, so a tranche pulled forward, or one deployed late, evens out."
          zh="規劃金額為總額除以批數。每一批到期時，提案以「仍在等待的現金 ÷ 剩下的批數」投入，因此提前投入或延後投入的批次會自動平衡。"
        />
      </p>
    </div>
  );
}

function SpreadRow({ label, spread }: { label: Bilingual; spread: Spread }) {
  return (
    <tr>
      <td>
        <Bi {...label} />
      </td>
      <td className="num">{percent(spread.wins, 0)}</td>
      <td className="num">{signedPercent(spread.median)}</td>
      <td className="num nowrap">
        {signedPercent(spread.p10)} … {signedPercent(spread.p90)}
      </td>
      <td className="num">{signedPercent(spread.worst)}</td>
      <td className="num">{signedPercent(spread.best)}</td>
    </tr>
  );
}

function Results({ result, horizon, acceleration, source }: { result: Backtest; horizon: number; acceleration: Acceleration | null; source: string | undefined }) {
  const points: BacktestPoint[] = result.rows.map((row) => ({ start: row.start, rule: row.rule / row.lump - 1, pace: row.pace / row.lump - 1, tranches: row.tranches }));
  return (
    <>
      <p className="muted">
        <Bi
          en={`Every start month from ${result.first} to ${result.last} (${result.rows.length.toLocaleString('en-US')} of them), each with ten years of CAPE behind it: what the tranches ended at ${horizon} months later against putting it all in at once, on the S&P 500 with dividends${source ? ` (${source === 'shiller' ? "Shiller's data" : 'multpl.com'})` : ''}.`}
          zh={`從 ${result.first} 到 ${result.last} 的每個起始月（共 ${result.rows.length.toLocaleString('en-US')} 個，每個都有十年的 CAPE 歷史）：分批投入在 ${horizon} 個月後與一次投入相比的結果，以 S&P 500 含股息計算${source ? `（${source === 'shiller' ? 'Shiller 的資料' : 'multpl.com'}）` : ''}。`}
        />
      </p>
      <BacktestChart points={points} label={{ en: 'Tranches against a lump sum, by start month', zh: '分批與一次投入的比較（依起始月）' }} />
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>
                <Bi en="Compared" zh="比較" />
              </th>
              <th className="num">
                <Bi en="Did better" zh="勝出比例" />
              </th>
              <th className="num">
                <Bi en="Median" zh="中位數" />
              </th>
              <th className="num">
                <Bi en="10th … 90th percentile" zh="第 10 … 90 百分位" />
              </th>
              <th className="num">
                <Bi en="Worst" zh="最差" />
              </th>
              <th className="num">
                <Bi en="Best" zh="最好" />
              </th>
            </tr>
          </thead>
          <tbody>
            <SpreadRow label={{ en: 'This rule vs lump sum', zh: '本規則 vs 一次投入' }} spread={result.ruleVsLump} />
            <SpreadRow label={{ en: 'The pace alone vs lump sum', zh: '只依節奏 vs 一次投入' }} spread={result.paceVsLump} />
            <SpreadRow label={{ en: 'This rule vs the pace alone', zh: '本規則 vs 只依節奏' }} spread={result.ruleVsPace} />
          </tbody>
        </table>
      </div>
      <details>
        <summary>
          <Bi en="How the backtest works" zh="回測方式" />
        </summary>
        <ul>
          <li>
            <Bi
              en="Each month the money invested earns the S&P 500's price change plus a twelfth of its dividend yield; the cash waiting earns the yearly return set below. Shiller's prices are monthly averages of daily closes, so falls look shallower than day by day, and tiers fire later and less often than they would live."
              zh="每個月已投入的資金賺取 S&P 500 的價格變動加上十二分之一的股息殖利率；等待中的現金賺取下方設定的年報酬。Shiller 的價格是每日收盤價的月平均，跌幅看起來比逐日計算淺，因此級距觸發得比實際更晚、更少。"
            />
          </li>
          <li>
            <Bi
              en={`The gauge at each start is CAPE's percentile over the months up to it, so no start sees the future. The drawdown is measured on the S&P 500 against its trailing 12-month high, standing in for ACWI, which has no history this long.${acceleration ? '' : ' The acceleration tiers are not readable, so this rule equals the pace alone.'}`}
              zh={`每個起點的估值指標只用到該月為止的 CAPE 百分位，不會用到未來的資料。跌幅以 S&P 500 相對其近 12 個月高點計算，代替沒有這麼長歷史的 ACWI。${acceleration ? '' : '加速級距無法讀取，因此本規則等同只依節奏。'}`}
            />
          </li>
          <li>
            <Bi
              en="A lump sum usually wins in a rising market, as the money is in it sooner; tranches win after a fall. The question the backtest answers is how much the pace costs in good times and saves in bad ones, not which is better every time."
              zh="市場上漲時一次投入通常勝出，因為資金較早進場；下跌之後則是分批勝出。回測要回答的是：這個節奏在好時機付出多少、在壞時機省下多少，而不是哪一種每次都比較好。"
            />
          </li>
        </ul>
      </details>
    </>
  );
}

const PACE_LABELS: Record<PaceField, Bilingual> = {
  cutLow: { en: 'Cheap below this CAPE percentile', zh: '低於此 CAPE 百分位為便宜' },
  cutHigh: { en: 'Dear above this CAPE percentile', zh: '高於此 CAPE 百分位為昂貴' },
  tranchesLow: { en: 'Tranches when cheap', zh: '便宜時的批數' },
  tranchesMid: { en: 'Tranches in between', zh: '中間的批數' },
  tranchesHigh: { en: 'Tranches when dear', zh: '昂貴時的批數' },
  tier1: { en: 'Tier 1: fall from the high, % (next tranche forward)', zh: '級距 1：自高點下跌 %（下一批提前）' },
  tier2: { en: 'Tier 2: fall from the high, %', zh: '級距 2：自高點下跌 %' },
  tier2Share: { en: 'Tier 2: share of the cash left deployed, %', zh: '級距 2：投入剩餘資金的比例 %' },
  tier3: { en: 'Tier 3: fall from the high, %', zh: '級距 3：自高點下跌 %' },
  tier3Share: { en: 'Tier 3: share of the cash left deployed, %', zh: '級距 3：投入剩餘資金的比例 %' },
};

function paceFields(): FieldSpec[] {
  return PACE_FIELDS.map((name) => ({ name, label: PACE_LABELS[name] }));
}

function paceInitial(pace: Pace, acceleration: Acceleration): Record<string, string> {
  const pct = (value: number) => String(Number((value * 100).toFixed(4)));
  const tiers = acceleration.tiers;
  const shareOf = (index: number) => {
    const deploy = tiers[index]?.deploy;
    return deploy?.kind === 'share' ? pct(deploy.share) : '';
  };
  return {
    cutLow: String(pace.cutoffs[0]),
    cutHigh: String(pace.cutoffs[1]),
    tranchesLow: String(pace.tranches[0]),
    tranchesMid: String(pace.tranches[1]),
    tranchesHigh: String(pace.tranches[2]),
    tier1: tiers[0] ? pct(tiers[0].drawdown) : '',
    tier2: tiers[1] ? pct(tiers[1].drawdown) : '',
    tier2Share: shareOf(1),
    tier3: tiers[2] ? pct(tiers[2].drawdown) : '',
    tier3Share: shareOf(2),
  };
}
