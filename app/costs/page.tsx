import Link from 'next/link';

import { Bi, Zh } from '@/components/bi';
import { Facts, type Fact } from '@/components/facts';
import { Info } from '@/components/info';
import { CostBars, type CostBar } from '@/components/cost-charts';
import { DataProblem } from '@/components/data-problem';
import { DeleteForm } from '@/components/delete-form';
import { requireSession } from '@/lib/auth';
import { chosenBroker, DataError, loadCostsData, type CostsData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { money, percent, twd } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import {
  brokerChoices,
  fundChoices,
  planForCosts,
  portfolioCost,
  type Broker,
  type BrokerChoice,
  type FeeSchedule,
  type FundChoice,
  type FundCost,
  type PortfolioCost,
  type TaxSettings,
} from '@/lib/models/costs';
import { maxBuyClasses } from '@/lib/models/engine';
import { buildPortfolio } from '@/lib/models/portfolio';
import type { Plan } from '@/lib/models/projection';
import { regularPool } from '@/lib/models/rules';
import { restateTrades } from '@/lib/models/splits';
import { overseasIncome, supplementaryPremiums, usSitusExposure, type OverseasIncome, type Premiums, type SitusExposure, type TaxSecurity } from '@/lib/models/tax';
import { latestFx } from '@/lib/models/valuation';
import { LSE_CHOICES, TAX_FIELDS, withholdingField } from '@/lib/validation';

import { deleteBroker, deleteFund } from './actions';
import { CostForm, type FieldSpec } from './forms';

type Params = Record<string, string | string[] | undefined>;

/** A rate as a percentage with as many decimals as it has, up to four: 0.001425 → "0.1425%". */
function rate(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${Number((value * 100).toFixed(4))}%`;
}

/** A rate as the number a form field takes, in percent. */
function rateField(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(Number((value * 100).toFixed(4)));
}

function usd(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** "0.08%, at least US$35, at most US$1" or "US$3 an order". */
function scheduleText(schedule: FeeSchedule | null): Bilingual {
  if (!schedule) return { en: 'not known', zh: '未知' };
  if (schedule.flat !== null) return { en: `US$${schedule.flat} an order`, zh: `每筆 ${schedule.flat} 美元` };
  const parts = [rate(schedule.rate)];
  const zh = [rate(schedule.rate)];
  if (schedule.min > 0) {
    parts.push(`at least US$${schedule.min}`);
    zh.push(`最低 ${schedule.min} 美元`);
  }
  if (schedule.max !== null) {
    parts.push(`at most US$${schedule.max}`);
    zh.push(`最高 ${schedule.max} 美元`);
  }
  return { en: parts.join(', '), zh: zh.join('，') };
}

function Checked({ on }: { on: string | null }) {
  return on ? (
    <span className="badge">
      <Bi en={`checked ${on}`} zh={`${on} 已確認`} />
    </span>
  ) : (
    <span className="badge warn">
      <Bi en="not checked yet" zh="尚未確認" />
    </span>
  );
}

function Source({ source }: { source: string }) {
  if (source === '') return null;
  return /^https:\/\//.test(source) ? (
    <a href={source} target="_blank" rel="noreferrer">
      <Bi en="source" zh="來源" />
    </a>
  ) : (
    <span className="muted small">{source}</span>
  );
}

function savedMessage(saved: string | undefined): Bilingual | undefined {
  switch (saved) {
    case 'fees':
      return { en: 'Fee settings saved: the estimates and the comparisons use them now.', zh: '已儲存費用設定：估算與比較已改用新設定。' };
    case 'tax':
      return { en: 'Tax thresholds saved.', zh: '已儲存稅務門檻。' };
    case 'broker':
      return { en: 'Broker saved.', zh: '已儲存券商。' };
    case 'fund':
      return { en: 'Fund costs saved.', zh: '已儲存基金成本。' };
    case 'deleted':
      return { en: 'Deleted; the edit history keeps it.', zh: '已刪除；修改紀錄會保留。' };
    default:
      return undefined;
  }
}

/** F15 (PRD Module D): what holding and trading costs a year, each choice over the plan, and the tax checks. */
export default async function CostsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: CostsData;
  try {
    data = await loadCostsData(supabase);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const { config } = data;
  const portfolio = buildPortfolio(data);
  const usdTwd = latestFx(data.fx, data.trades).get('USD')?.value ?? null;
  const broker = chosenBroker(config);
  const funds = new Map(config.funds.map((fund) => [fund.ticker, fund]));
  const cost = portfolioCost(portfolio.holdings, funds, config.tax, broker);
  const pool = regularPool(portfolio.holdings);
  const planned = planForCosts(data.planSettings, { poolTwd: pool.totalTwd, dcaTwd: data.dcaAmount, mixReturn: data.mix?.expectedReturn ?? null });
  const maxClasses = maxBuyClasses(data.rules);
  const orderTwd = data.dcaAmount !== null && data.dcaAmount > 0 ? data.dcaAmount / (Number.isFinite(maxClasses) ? maxClasses : 1) : null;
  const securities = new Map<string, TaxSecurity>(data.securities.map((security) => [security.ticker, security]));
  const estateRule = data.rules.find((rule) => rule.id === 'US_ESTATE_TAX');
  const limitValue = (estateRule?.threshold as { usd?: unknown } | undefined)?.usd;
  const limitUsd = typeof limitValue === 'number' ? limitValue : null;
  const exposure = usSitusExposure(portfolio.holdings, (ticker) => securities.get(ticker)?.domicile, usdTwd);
  const year = today.slice(0, 4);
  const overseas = config.tax ? overseasIncome(restateTrades(data.trades, data.splits), data.flows, securities, year, config.tax.amt.overseasFloorTwd) : null;
  const premiums = config.tax ? supplementaryPremiums(data.flows, securities, year, config.tax.nhi) : null;
  const held = new Set(portfolio.holdings.filter((holding) => holding.ticker !== null && (holding.valueTwd ?? 0) > 0).map((holding) => holding.ticker as string));
  const core = data.classSettings.filter((assetClass) => assetClass.sleeve === 'core');
  // Classes bought abroad: by the fund held most in the class, else its benchmark ETF.
  const vehicleMarket = (classId: string, benchmark: string | null) => {
    const largest = pool.holdings.filter((holding) => holding.assetClassId === classId && holding.ticker !== null).sort((a, b) => (b.valueTwd ?? 0) - (a.valueTwd ?? 0))[0];
    const ticker = largest?.ticker ?? benchmark;
    return ticker ? securities.get(ticker)?.market : undefined;
  };
  const foreignShare = core.filter((assetClass) => vehicleMarket(assetClass.id, assetClass.benchmarkTicker) !== 'TW').reduce((sum, assetClass) => sum + assetClass.targetWeight, 0);
  const choices = planned && orderTwd
    ? core.map((assetClass) => ({
        assetClass,
        rows: fundChoices(
          config.funds.filter((fund) => fund.assetClassId === assetClass.id),
          { plan: planned.plan, target: assetClass.targetWeight, orderTwd, usdTwd, broker, settings: config.fees, tax: config.tax },
        ),
      }))
    : [];
  const brokers = planned && orderTwd ? brokerChoices(config.brokers, { plan: planned.plan, foreignShare, orderTwd, usdTwd, settings: config.fees, today }) : [];
  const saved = savedMessage(typeof params['saved'] === 'string' ? params['saved'] : undefined);
  const names = new Map(data.classSettings.map((assetClass) => [assetClass.id, { en: assetClass.nameEn, zh: assetClass.nameZh }]));

  return (
    <>
      <section className="card form">
        <h1>
          <Zh {...LABELS.costs} />
        </h1>
        {saved && (
          <p className="banner ok" role="status">
            <Bi {...saved} />
          </p>
        )}
        {!config.applied && (
          <p className="banner warn" role="alert">
            <Bi
              en="The fee and tax settings are not in the database yet: run npx supabase db push (docs/running-the-app.md), then reload."
              zh="資料庫中還沒有費用與稅務設定：請執行 npx supabase db push（見 docs/running-the-app.md），再重新整理。"
            />
          </p>
        )}
        <Summary cost={cost} exposure={exposure} limitUsd={limitUsd} overseas={overseas} premiums={premiums} broker={broker} tax={config.tax} />
      </section>

      <section className="card form" id="fund-choices">
        <h2>
          <Bi en="Each fund over the plan" zh="各基金在計畫期間的成本" />
        </h2>
        {!planned || !orderTwd ? (
          <p className="banner info">
            <Bi
              en="Comparing choices over time needs an expected return and the monthly contribution: save a plan on the calculator page, or set the capital market assumptions on the Allocation page and the DCA amount on the Rules page."
              zh="比較長期成本需要預期報酬與每月投入金額：請在「複利計算機」儲存計畫，或在「資產配置」頁設定資本市場假設、在「規則」頁設定定期定額金額。"
            />
          </p>
        ) : (
          <FundChoices choices={choices} plan={planned.plan} saved={planned.saved} orderTwd={orderTwd} held={held} broker={broker} />
        )}
      </section>

      <HoldingCosts cost={cost} broker={broker} />

      <section className="card form" id="brokers">
        <h2>
          <Bi en="複委託 brokers" zh="複委託券商比較" />
        </h2>
        {planned && orderTwd ? (
          <Brokers choices={brokers} chosen={broker} orderTwd={orderTwd} usdTwd={usdTwd} foreignShare={foreignShare} plan={planned.plan} />
        ) : (
          <p className="muted">
            <Bi en="Needs the plan, as for the funds above." zh="與上方基金比較相同，需要計畫。" />
          </p>
        )}
        <h3 id="fee-settings">
          <Bi en="The broker you use, and the Taiwan commission" zh="你使用的券商與台股手續費" />
        </h3>
        <CostForm
          kind="fees"
          fields={feeFields(config.brokers)}
          initial={{
            broker: config.fees.brokerId ?? '',
            twRate: rateField(config.fees.tw?.rate ?? 0.001425),
            twDiscount: String(Number(((config.fees.tw?.discount ?? 1) * 10).toFixed(3))),
            twMin: String(config.fees.tw?.minTwd ?? 20),
            fxSpread: rateField(config.fees.fxSpread ?? 0),
          }}
          context={{ brokerIds: config.brokers.map((entry) => entry.id) }}
        />
      </section>

      <section className="card form" id="taiwan-tax">
        <h2>
          <Bi en="Taiwan tax checks" zh="台灣稅務檢查" />
        </h2>
        {config.tax && overseas && premiums ? <TaiwanTax overseas={overseas} premiums={premiums} tax={config.tax} /> : <TaxMissing />}
      </section>

      <section className="card form" id="estate-tax">
        <h2>
          <Bi en="US estate tax" zh="美國遺產稅" />
        </h2>
        <EstateTax exposure={exposure} limitUsd={limitUsd} enabled={estateRule?.enabled ?? false} tax={config.tax} funds={config.funds} securities={data.securities} names={names} />
      </section>

      <section className="card form" id="settings">
        <h2>
          <Bi en="Settings" zh="設定" />
        </h2>
        <details id="tax-settings">
          <summary>
            <Bi en={`Tax thresholds and rates (checked ${config.taxVerifiedOn ?? 'never'})`} zh={`稅務門檻與稅率（${config.taxVerifiedOn ? `${config.taxVerifiedOn} 確認` : '尚未確認'}）`} />
          </summary>
          {config.tax ? (
            <CostForm kind="tax" fields={taxFields(config.tax)} initial={taxInitial(config.tax)} context={{ domiciles: Object.keys(config.tax.withholding) }} />
          ) : (
            <TaxMissing />
          )}
        </details>
        <details id="fund-costs">
          <summary>
            <Bi en={`Fund costs (${config.funds.length})`} zh={`基金成本（${config.funds.length}）`} />
          </summary>
          {config.funds.map((fund) => (
            <details key={fund.ticker} id={`fund-${fund.ticker}`} className="nested">
              <summary>
                {fund.ticker} <span className="muted small">{fund.name}</span> <Checked on={fund.checked} />
              </summary>
              <CostForm
                kind="fund"
                fields={fundFields(data.classSettings, false)}
                initial={fundInitial(fund)}
                hidden={{ editing: fund.ticker, checkedOn: fund.checked ?? '' }}
                context={{ taken: config.funds.map((entry) => entry.ticker), editing: fund.ticker, classes: data.classSettings.map((assetClass) => assetClass.id) }}
              />
              <DeleteForm id={fund.ticker} action={deleteFund} confirm={{ en: `Delete the costs of ${fund.ticker}?`, zh: `要刪除 ${fund.ticker} 的成本資料嗎？` }} />
            </details>
          ))}
          <details className="nested">
            <summary>
              <Bi en="Add a fund" zh="新增基金" />
            </summary>
            <CostForm
              kind="fund"
              fields={fundFields(data.classSettings, true)}
              initial={{ ticker: '', name: '', assetClass: core[0]?.id ?? '', domicile: 'IE', market: 'UK', distribution: 'acc', ter: '', yield: '', withholding: '', trackingDifference: '', source: '', noteEn: '', noteZh: '', checked: 'on' }}
              context={{ taken: config.funds.map((entry) => entry.ticker), editing: null, classes: data.classSettings.map((assetClass) => assetClass.id) }}
              submit={{ en: 'Add the fund', zh: '新增基金' }}
            />
          </details>
        </details>
        <details id="broker-settings">
          <summary>
            <Bi en={`Brokers (${config.brokers.length})`} zh={`券商（${config.brokers.length}）`} />
          </summary>
          {config.brokers.map((entry) => (
            <details key={entry.id} id={`broker-${entry.id}`} className="nested">
              <summary>
                <Bi en={entry.nameEn} zh={entry.nameZh} /> <Checked on={entry.checked} />
              </summary>
              <CostForm
                kind="broker"
                fields={brokerFields(false)}
                initial={brokerInitial(entry)}
                hidden={{ editing: entry.id, checkedOn: entry.checked ?? '' }}
                context={{ taken: config.brokers.map((other) => other.id), editing: entry.id }}
              />
              <DeleteForm id={entry.id} action={deleteBroker} confirm={{ en: `Delete ${entry.nameEn}?`, zh: `要刪除${entry.nameZh}嗎？` }} />
            </details>
          ))}
          <details className="nested">
            <summary>
              <Bi en="Add a broker" zh="新增券商" />
            </summary>
            <CostForm
              kind="broker"
              fields={brokerFields(true)}
              initial={{ id: '', nameEn: '', nameZh: '', usRate: '', usMin: '', etfFlat: '', dcaFlat: '', dcaRate: '', dcaMax: '', ukRate: '', ukMin: '', lseEtfs: 'unknown', custody: '0', fxSpread: '', promoUntil: '', source: '', noteEn: '', noteZh: '', checked: 'on' }}
              context={{ taken: config.brokers.map((other) => other.id), editing: null }}
              submit={{ en: 'Add the broker', zh: '新增券商' }}
            />
          </details>
        </details>
        <p className="muted small">
          <Link href="/history">
            <Bi {...LABELS.history} />
          </Link>
        </p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

function Summary({ cost, exposure, limitUsd, overseas, premiums, broker, tax }: { cost: PortfolioCost; exposure: SitusExposure | null; limitUsd: number | null; overseas: OverseasIncome | null; premiums: Premiums | null; broker: Broker | null; tax: TaxSettings | undefined }) {
  const facts: Fact[] = [
    cost.rate === null
      ? { label: { en: 'Holding costs', zh: '持有成本' }, value: '—', note: { en: 'enter fund costs below', zh: '請於下方填入' }, tone: 'watch' }
      : { label: { en: 'Holding costs a year', zh: '每年持有成本' }, value: `${percent(cost.rate, 2)} · ${twd(cost.yearlyTwd)}`, ...(cost.unknownTwd > 0 ? { note: { en: `${twd(cost.unknownTwd)} not costed`, zh: `${twd(cost.unknownTwd)} 未填成本` } } : {}) },
  ];
  if (exposure && limitUsd !== null) {
    facts.push({ label: { en: 'US estate tax', zh: '美國遺產稅' }, value: `${money(exposure.totalUsd, 'USD', 0)} / ${money(limitUsd, 'USD', 0)}`, tone: exposure.totalUsd > limitUsd ? 'alert' : 'ok' });
  }
  if (overseas && tax) {
    facts.push({ label: { en: 'Overseas income (minimum tax)', zh: '海外所得（最低稅負）' }, value: `${twd(overseas.totalTwd)} / ${twd(overseas.floorTwd)}`, tone: overseas.counts ? 'watch' : 'ok' });
  }
  if (premiums && tax) {
    const liable = premiums.rows.filter((row) => row.premiumTwd > 0);
    facts.push({ label: { en: 'Supplementary premium', zh: '二代健保補充保費' }, value: liable.length === 0 ? twd(0) : twd(premiums.totalTwd), tone: liable.length === 0 ? 'ok' : 'watch' });
  }
  facts.push(
    broker
      ? { label: { en: 'Order fees priced with', zh: '下單費用依' }, value: <Bi en={broker.nameEn} zh={broker.nameZh} />, tone: 'ok' }
      : { label: { en: 'Order fees', zh: '下單費用' }, value: '—', note: { en: 'choose your broker below', zh: '請於下方選擇券商' }, tone: 'watch' },
  );
  return <Facts facts={facts} />;
}

// ---------------------------------------------------------------------------
// Funds over the plan
// ---------------------------------------------------------------------------

function planLine(plan: Plan, saved: boolean): Bilingual {
  const which = saved ? { en: 'your saved plan', zh: '你儲存的計畫' } : { en: "the calculator's starting values (no plan saved yet)", zh: '複利計算機的預設值（尚未儲存計畫）' };
  return {
    en: `Over ${which.en}: ${plan.years} years from ${twd(plan.pv)}, ${twd(plan.pmt)} a month${plan.stepUp > 0 ? ` rising ${percent(plan.stepUp)} a year` : ''}, at ${percent(plan.expectedReturn)} a year. Each class takes its target share of the start and of every contribution.`,
    zh: `依${which.zh}：起始 ${twd(plan.pv)}、每月 ${twd(plan.pmt)}${plan.stepUp > 0 ? `（每年調升 ${percent(plan.stepUp)}）` : ''}、年報酬 ${percent(plan.expectedReturn)}，共 ${plan.years} 年。各類別依目標權重分配起始金額與每次投入。`,
  };
}

function FundChoices({ choices, plan, saved, orderTwd, held, broker }: { choices: ReadonlyArray<{ assetClass: { id: string; nameEn: string; nameZh: string; targetWeight: number }; rows: FundChoice[] }>; plan: Plan; saved: boolean; orderTwd: number; held: ReadonlySet<string>; broker: Broker | null }) {
  const bars: CostBar[] = choices.flatMap(({ assetClass, rows }) =>
    rows
      .filter((row) => row.overPlan !== null)
      .map((row) => ({
        label: `${row.fund.ticker} · ${assetClass.nameEn}`,
        cost: row.overPlan?.cost ?? 0,
        current: held.has(row.fund.ticker),
        note: { en: `${rate(row.drag.total)} a year${row.tradeShare !== null ? `, ${rate(row.tradeShare)} an order` : ''}`, zh: `每年 ${rate(row.drag.total)}${row.tradeShare !== null ? `，每筆 ${rate(row.tradeShare)}` : ''}` },
      })),
  );
  const line = planLine(plan, saved);
  return (
    <>
      {bars.length > 0 && <CostBars bars={bars} label={{ en: 'What each fund would cost over the plan', zh: '各基金在計畫期間的成本' }} current={{ en: 'Held now', zh: '目前持有' }} />}
      {choices.map(({ assetClass, rows }) => (
        <div key={assetClass.id} className="form">
          <h3>
            <Bi en={`${assetClass.nameEn} (${percent(assetClass.targetWeight, 0)} target)`} zh={`${assetClass.nameZh}（目標 ${percent(assetClass.targetWeight, 0)}）`} />
          </h3>
          {rows.length === 0 ? (
            <p className="muted">
              <Bi en="No fund costs entered for this class: add one in the settings below." zh="此類別尚未填入基金成本：請在下方設定中新增。" />
            </p>
          ) : (
            <div className="table-wrap">
              <table className="compact">
                <thead>
                  <tr>
                    <th>
                      <Bi en="Fund" zh="基金" />
                    </th>
                    <th>
                      <Bi en="Domicile · listed" zh="註冊地 · 上市地" />
                    </th>
                    <th className="num">TER</th>
                    <th className="num">
                      <Bi en="Withheld" zh="預扣稅" />
                    </th>
                    <th className="num">
                      <Bi en="Yearly drag" zh="每年拖累" />
                    </th>
                    <th className="num">
                      <Bi en="An order" zh="每筆下單" />
                    </th>
                    <th className="num">
                      <Bi en={`Over ${plan.years} years`} zh={`${plan.years} 年成本`} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.fund.ticker}>
                      <td>
                        <strong>{row.fund.ticker}</strong>{' '}
                        {held.has(row.fund.ticker) && (
                          <span className="badge">
                            <Bi en="held" zh="持有中" />
                          </span>
                        )}{' '}
                        <span className="badge">
                          <Bi {...(row.fund.distribution === 'acc' ? { en: 'accumulating', zh: '累積型' } : { en: 'distributing', zh: '配息型' })} />
                        </span>
                      </td>
                      <td className="nowrap">
                        {row.fund.domicile} · {row.fund.market}
                      </td>
                      <td className="num">{rate(row.drag.ter)}</td>
                      <td className="num nowrap">
                        {row.drag.withholdingDrag === null ? '—' : rate(row.drag.withholdingDrag)}
                        {row.drag.yield !== null && row.drag.withholding !== null && row.drag.yield > 0 && row.drag.withholding > 0 && (
                          <span className="muted small">
                            {' '}
                            ({rate(row.drag.yield)} × {rate(row.drag.withholding)})
                          </span>
                        )}
                      </td>
                      <td className="num">
                        <strong>{rate(row.drag.total)}</strong>
                      </td>
                      <td className="num">{row.tradeShare === null ? '—' : rate(row.tradeShare)}</td>
                      <td className="num">{row.overPlan ? twd(row.overPlan.cost) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      <Info>
        <p>
          <Bi {...line} />
        </p>
        <ul>
          <li>
            <Bi
              en="Yearly drag = TER + the yield × the share withheld from it: a US-domiciled fund pays a Taiwan resident with 30% withheld; an Irish fund has about 15% withheld on US dividends inside the fund, and an accumulating one pays nothing out. Tracking difference is not added, as it already holds the TER."
              zh="每年拖累 ＝ 總費用率 ＋ 殖利率 × 預扣比例：美國註冊基金配息給台灣居民時預扣 30%；愛爾蘭註冊基金在基金內對美股股息約預扣 15%，累積型不配息。追蹤差異已含總費用率，因此不另外加上。"
            />
          </li>
          <li>
            <Bi
              en={`An order = the fee and FX spread on a typical order of ${twd(orderTwd)} (the monthly contribution split over the classes one month buys), as a share of it${broker ? `, with the prices of ${broker.nameEn}` : ': choose your broker below to count it'}; London orders count once their prices are entered.`}
              zh={`每筆下單 ＝ 一筆 ${twd(orderTwd)} 典型下單（每月投入平均分到一個月買進的類別數）的手續費加換匯價差占金額的比例${broker ? `，依${broker.nameZh}的費率` : '：請在下方選擇券商才會計入'}；英股在填入費率後才會計入。`}
            />
          </li>
          <li>
            <Bi
              en="Over the plan = the class's final value without the costs minus with them, month by month as the calculator works: the yearly drag and the broker's custody fee come off the expected return, the order cost off every contribution. It leaves out the tax and fees of switching what is already held."
              zh="計畫期間的成本 ＝ 該類別期末價值（無成本）減去（有成本），與複利計算機相同逐月計算：每年拖累與保管費自預期報酬扣除，下單成本自每次投入扣除。不含轉換現有持股所需的稅與手續費。"
            />
          </li>
        </ul>
      </Info>
    </>
  );
}

// ---------------------------------------------------------------------------
// The holdings' yearly cost
// ---------------------------------------------------------------------------

function HoldingCosts({ cost, broker }: { cost: PortfolioCost; broker: Broker | null }) {
  return (
    <section className="card form" id="holding-costs">
      <h2>
        <Bi en="What your holdings cost a year" zh="持股每年的成本" />
      </h2>
      {cost.rows.length === 0 ? (
        <p className="muted">
          <Bi en="Nothing held yet." zh="尚無持股。" />
        </p>
      ) : (
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="Holding" zh="持股" />
                </th>
                <th className="num">
                  <Bi {...LABELS.valueTwd} />
                </th>
                <th className="num">TER</th>
                <th className="num">
                  <Bi en="Withheld" zh="預扣稅" />
                </th>
                <th className="num">
                  <Bi en="Custody" zh="保管費" />
                </th>
                <th className="num">
                  <Bi en="A year" zh="每年" />
                </th>
                <th className="num">
                  <Bi en="NT$ a year" zh="每年台幣" />
                </th>
              </tr>
            </thead>
            <tbody>
              {cost.rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.ticker ? <strong>{row.ticker}</strong> : row.label}</td>
                  <td className="num">{twd(row.valueTwd)}</td>
                  <td className="num">{row.drag ? rate(row.drag.ter) : '—'}</td>
                  <td className="num">{row.drag ? rate(row.drag.withholdingDrag) : '—'}</td>
                  <td className="num">{rate(row.custody)}</td>
                  <td className="num">{rate(row.rate)}</td>
                  <td className="num">{twd(row.yearlyTwd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <Bi en="Total" zh="合計" />
                </td>
                <td className="num">{twd(cost.valueTwd)}</td>
                <td colSpan={3} />
                <td className="num">{rate(cost.rate)}</td>
                <td className="num">{twd(cost.yearlyTwd)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <Info>
        <Bi
          en={`Both pools, at today's values. Gold in grams and TWD balances cost nothing a year; a holding with no fund costs entered shows — and is left out of the total${cost.unknownTwd > 0 ? ` (${twd(cost.unknownTwd)} now)` : ''}. Custody is the fee ${broker ? broker.nameEn : 'the chosen broker'} charges on what is held abroad.`}
          zh={`兩個資金池合計，以今天的市值計算。以克計的黃金與台幣餘額每年沒有成本；未填入基金成本的持股顯示 —，不計入合計${cost.unknownTwd > 0 ? `（目前 ${twd(cost.unknownTwd)}）` : ''}。保管費為${broker ? broker.nameZh : '所選券商'}對海外持股收取的費用。`}
        />
      </Info>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Brokers
// ---------------------------------------------------------------------------

function Brokers({ choices, chosen, orderTwd, usdTwd, foreignShare, plan }: { choices: readonly BrokerChoice[]; chosen: Broker | null; orderTwd: number; usdTwd: number | null; foreignShare: number; plan: Plan }) {
  if (usdTwd === null) {
    return (
      <p className="muted">
        <Bi en="Needs a USD/TWD rate: the nightly job loads one." zh="需要美元匯率：每夜排程會載入。" />
      </p>
    );
  }
  const bars: CostBar[] = choices
    .filter((choice) => choice.overPlan !== null)
    .map((choice) => ({ label: choice.broker.nameEn, cost: choice.overPlan?.cost ?? 0, current: choice.broker.id === chosen?.id, note: { en: `${rate(choice.order?.share)} an order`, zh: `每筆 ${rate(choice.order?.share)}` } }));
  return (
    <>
      <Facts
        facts={[
          { label: { en: 'A typical order', zh: '典型下單' }, value: `${twd(orderTwd)} · ${money(orderTwd / usdTwd, 'USD')}` },
          { label: { en: 'Bought abroad', zh: '海外買進比例' }, value: percent(foreignShare, 0) },
        ]}
      />
      <Info>
        <Bi
          en={`A typical order: ${twd(orderTwd)} (${money(orderTwd / usdTwd, 'USD')} at ${usdTwd}). Bought abroad: ${percent(foreignShare, 0)} of the regular pool's targets, the core classes whose fund lists in the US or London.`}
          zh={`典型下單：${twd(orderTwd)}（以 ${usdTwd} 計約 ${money(orderTwd / usdTwd, 'USD')}）。在海外買進的比例：一般投入資金池目標的 ${percent(foreignShare, 0)}，即基金在美國或倫敦上市的核心類別。`}
        />
        <Bi
          en="Each broker's fee and FX spread on a typical order, and with its custody fee what it would cost over the plan on the share bought abroad. The broker chosen below prices the orders in proposals; the prices are starting values from a public comparison, so check each against the broker's own page."
          zh="每家券商在一筆典型下單上的手續費與換匯價差，加上保管費在計畫期間（以在海外買進的比例計）的成本。下方選定的券商用於估算提案的下單費用；費率是公開比較文章的起始值，請到各券商官網確認。"
        />
        <Bi
          en="On the order: the fee in dollars and, with the FX spread, the share of the order it costs. A minimum fee weighs most on small orders, which is why F8 sends each month's cash to at most two classes. Over the plan counts the single-order fee, as proposals are placed as orders; a broker's DCA plan can cost less."
          zh="這筆下單：美元手續費，以及加上換匯價差後占下單金額的比例。低消對小額下單影響最大，因此 F8 每月最多只投入兩個類別。計畫期間的成本以單筆下單費用計算（提案以單筆下單執行）；券商的定期定額可能更便宜。"
        />
      </Info>
      {bars.length > 0 && <CostBars bars={bars} label={{ en: 'What each broker would cost over the plan', zh: '各券商在計畫期間的成本' }} current={{ en: 'The broker you use', zh: '你使用的券商' }} />}
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>
                <Bi en="Broker" zh="券商" />
              </th>
              <th>
                <Bi en="US ETFs" zh="美股 ETF" />
              </th>
              <th className="num">
                <Bi en="On the order" zh="這筆下單" />
              </th>
              <th className="num">
                <Bi en="DCA" zh="定期定額" />
              </th>
              <th>
                <Bi en="London ETFs" zh="倫敦 ETF" />
              </th>
              <th className="num">
                <Bi en={`Over ${plan.years} years`} zh={`${plan.years} 年成本`} />
              </th>
            </tr>
          </thead>
          <tbody>
            {choices.map((choice) => (
              <tr key={choice.broker.id}>
                <td>
                  <strong>
                    <Bi en={choice.broker.nameEn} zh={choice.broker.nameZh} />
                  </strong>{' '}
                  {choice.broker.id === chosen?.id && (
                    <span className="badge">
                      <Bi en="yours" zh="使用中" />
                    </span>
                  )}{' '}
                  <Checked on={choice.broker.checked} />
                  {choice.broker.promoUntil && (
                    <span className={choice.promoEnded ? 'badge warn' : 'badge'}>
                      <Bi en={choice.promoEnded ? `offer ended ${choice.broker.promoUntil}` : `offer until ${choice.broker.promoUntil}`} zh={choice.promoEnded ? `優惠已於 ${choice.broker.promoUntil} 結束` : `優惠至 ${choice.broker.promoUntil}`} />
                    </span>
                  )}{' '}
                  <Source source={choice.broker.source} />
                  {(choice.broker.noteEn || choice.broker.noteZh) && (
                    <Info label={{ en: 'Note', zh: '備註' }}>
                      <span className="pre-line">
                        <Bi en={choice.broker.noteEn} zh={choice.broker.noteZh} />
                      </span>
                    </Info>
                  )}
                </td>
                <td>
                  <Bi {...scheduleText(choice.broker.usEtf ?? choice.broker.usStock)} />
                  {choice.minimumUpToUsd !== null && (
                    <span className="muted small">
                      <br />
                      <Bi en={`minimum up to US$${Number(choice.minimumUpToUsd.toFixed(0)).toLocaleString('en-US')}`} zh={`低消至 US$${Number(choice.minimumUpToUsd.toFixed(0)).toLocaleString('en-US')}`} />
                    </span>
                  )}
                </td>
                <td className="num nowrap">{choice.order ? `${money(choice.order.feeUsd, 'USD')} · ${rate(choice.order.share)}` : '—'}</td>
                <td className="num nowrap">{choice.dca ? `${money(choice.dca.feeUsd, 'USD')} · ${rate(choice.dca.share)}` : '—'}</td>
                <td>
                  <Bi {...(choice.broker.lseEtfs === true ? { en: 'offered', zh: '有提供' } : choice.broker.lseEtfs === false ? { en: 'not offered', zh: '未提供' } : { en: 'ask the broker', zh: '請洽券商' })} />
                  {choice.broker.uk && (
                    <span className="muted small">
                      <br />
                      <Bi {...scheduleText(choice.broker.uk)} />
                    </span>
                  )}
                </td>
                <td className="num">{choice.overPlan ? twd(choice.overPlan.cost) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Taiwan tax checks
// ---------------------------------------------------------------------------

function TaxMissing() {
  return (
    <p className="banner info">
      <Bi en="The tax thresholds are missing or incomplete: run npx supabase db push, or fill them in under Settings." zh="稅務門檻缺漏或不完整：請執行 npx supabase db push，或在「設定」中填入。" />
    </p>
  );
}

function TaiwanTax({ overseas, premiums, tax }: { overseas: OverseasIncome; premiums: Premiums; tax: TaxSettings }) {
  const share = tax.amt.overseasFloorTwd > 0 ? Math.min(1, overseas.totalTwd / tax.amt.overseasFloorTwd) : 1;
  return (
    <>
      <h3>
        <Bi en={`Overseas income, ${overseas.year} (所得基本稅額)`} zh={`${overseas.year} 年海外所得（所得基本稅額）`} />
      </h3>
      <div className="meter" role="img" aria-label={`${percent(share, 0)} of the floor 門檻的 ${percent(share, 0)}`}>
        <span style={{ width: `${share * 100}%` }} />
      </div>
      <Facts
        facts={[
          { label: { en: 'Overseas income', zh: '海外所得' }, value: `${twd(overseas.totalTwd)} / ${twd(tax.amt.overseasFloorTwd)}`, tone: overseas.counts ? 'watch' : 'ok' },
          { label: { en: 'Gains on sales abroad', zh: '海外賣出獲利' }, value: twd(Math.max(0, overseas.gainsTwd)) },
          { label: { en: 'Dividends from them', zh: '其股利' }, value: twd(overseas.dividendsTwd) },
        ]}
      />
      <Info>
        <Bi
          en={`${twd(overseas.totalTwd)} of the ${twd(tax.amt.overseasFloorTwd)} floor: gains on sales abroad ${twd(Math.max(0, overseas.gainsTwd))}${overseas.gainsTwd < 0 ? ` (a net loss of ${twd(-overseas.gainsTwd)}, counted as 0)` : ''}, dividends from them ${twd(overseas.dividendsTwd)}.`}
          zh={`${twd(overseas.totalTwd)}，門檻 ${twd(tax.amt.overseasFloorTwd)}：海外證券賣出獲利 ${twd(Math.max(0, overseas.gainsTwd))}${overseas.gainsTwd < 0 ? `（淨損失 ${twd(-overseas.gainsTwd)}，以 0 計）` : ''}，其股利 ${twd(overseas.dividendsTwd)}。`}
        />
        <Bi
          en={`A household's overseas income (securities listed abroad, through 複委託) is left out of the basic income while under ${twd(tax.amt.overseasFloorTwd)} a year; from it, all of it counts, and the minimum tax is ${percent(tax.amt.rate, 0)} of the basic income above ${twd(tax.amt.exemptionTwd)}, paid only where it exceeds the regular income tax. A Taiwan-listed fund is domestic income whatever it holds. The household's other income is not known here, and dividends count as recorded.`}
          zh={`申報戶的海外所得（透過複委託投資的海外上市證券）每年未達 ${twd(tax.amt.overseasFloorTwd)} 時不計入基本所得額；達到時全數計入，基本稅額為基本所得額超過 ${twd(tax.amt.exemptionTwd)} 部分的 ${percent(tax.amt.rate, 0)}，且只在高於一般所得稅額時才需補繳。台灣上市的基金不論投資何處都屬國內所得。本頁不知道申報戶的其他所得，股利以登錄金額計算。`}
        />
      </Info>
      <h3>
        <Bi en={`Supplementary health premium on Taiwan dividends, ${overseas.year} (二代健保)`} zh={`${overseas.year} 年台股股利的二代健保補充保費`} />
      </h3>
      {premiums.rows.length === 0 ? (
        <p className="muted">
          <Bi en="No Taiwan dividends this year." zh="今年無台股股利。" />
        </p>
      ) : (
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="Paid" zh="發放日" />
                </th>
                <th>
                  <Bi {...LABELS.ticker} />
                </th>
                <th className="num">
                  <Bi {...LABELS.amount} />
                </th>
                <th className="num">
                  <Bi en="Premium, at most" zh="補充保費（上限）" />
                </th>
              </tr>
            </thead>
            <tbody>
              {premiums.rows.map((row) => (
                <tr key={`${row.date}-${row.ticker}-${row.amountTwd}`}>
                  <td className="nowrap">{row.date}</td>
                  <td>{row.ticker}</td>
                  <td className="num">{twd(row.amountTwd)}</td>
                  <td className="num">{twd(row.premiumTwd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Info>
        <Bi
          en={`A single payment of ${twd(tax.nhi.singlePaymentTwd)} or more pays ${percent(tax.nhi.rate, 2)} of it (up to ${twd(tax.nhi.maxPaymentTwd)} a payment), withheld by the payer. For an ETF only its dividend-income part is liable, so the figure is an upper bound. An accumulating Taiwan fund such as 009816 pays nothing out, and so no premium.`}
          zh={`單筆股利達 ${twd(tax.nhi.singlePaymentTwd)} 時，扣取 ${percent(tax.nhi.rate, 2)}（每筆上限 ${twd(tax.nhi.maxPaymentTwd)}），由發放者代扣。ETF 只有股利所得部分需扣，因此此處為上限。不配息的台股基金（例如 009816）沒有配息，也就沒有補充保費。`}
        />
      </Info>
    </>
  );
}

// ---------------------------------------------------------------------------
// US estate tax
// ---------------------------------------------------------------------------

function EstateTax({ exposure, limitUsd, enabled, tax, funds, securities, names }: { exposure: SitusExposure | null; limitUsd: number | null; enabled: boolean; tax: TaxSettings | undefined; funds: readonly FundCost[]; securities: CostsData['securities']; names: ReadonlyMap<string, Bilingual> }) {
  if (!exposure || limitUsd === null) {
    return (
      <p className="muted">
        <Bi en="Needs a USD/TWD rate and the US_ESTATE_TAX rule's threshold." zh="需要美元匯率與 US_ESTATE_TAX 規則的門檻。" />
      </p>
    );
  }
  const share = Math.min(1, exposure.totalUsd / limitUsd);
  const classesHeld = [...new Set(exposure.rows.map((row) => securities.find((security) => security.ticker === row.ticker)?.assetClassId).filter((id): id is string => id !== undefined))];
  return (
    <>
      <div className={exposure.totalUsd > limitUsd ? 'meter over' : 'meter'} role="img" aria-label={`${percent(exposure.totalUsd / limitUsd, 0)} of the exemption 免稅額的 ${percent(exposure.totalUsd / limitUsd, 0)}`}>
        <span style={{ width: `${share * 100}%` }} />
      </div>
      <Facts
        facts={[
          { label: { en: 'US-situs assets', zh: '美國資產' }, value: `${money(exposure.totalUsd, 'USD', 0)} / ${money(limitUsd, 'USD', 0)}`, note: { en: twd(exposure.totalTwd), zh: twd(exposure.totalTwd) }, tone: exposure.totalUsd > limitUsd ? 'alert' : 'ok' },
        ]}
      />
      <Info>
        <Bi
          en={`US-situs assets: ${money(exposure.totalUsd, 'USD', 0)} (${twd(exposure.totalTwd)}) of the ${money(limitUsd, 'USD', 0)} a non-US resident's estate is exempt to.${tax ? ` Above it, the US taxes the estate at ${percent(tax.usEstate.minRate, 0)} to ${percent(tax.usEstate.maxRate, 0)}.` : ''}`}
          zh={`美國資產：${money(exposure.totalUsd, 'USD', 0)}（${twd(exposure.totalTwd)}），非美國居民的遺產免稅額為 ${money(limitUsd, 'USD', 0)}。${tax ? `超過的部分，美國課徵 ${percent(tax.usEstate.minRate, 0)} 至 ${percent(tax.usEstate.maxRate, 0)} 的遺產稅。` : ''}`}
        />
      </Info>
      {exposure.rows.length > 0 && (
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="US-situs holding" zh="美國資產" />
                </th>
                <th className="num">USD</th>
                <th className="num">TWD</th>
              </tr>
            </thead>
            <tbody>
              {exposure.rows.map((row) => (
                <tr key={row.ticker}>
                  <td>
                    <strong>{row.ticker}</strong>
                  </td>
                  <td className="num">{money(row.valueUsd, 'USD', 0)}</td>
                  <td className="num">{twd(row.valueTwd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {exposure.unpriced.length > 0 && (
        <p className="muted small">
          <Bi en={`Not priced yet, so not counted: ${exposure.unpriced.join(', ')}.`} zh={`尚無價格、未計入：${exposure.unpriced.join('、')}。`} />
        </p>
      )}
      {classesHeld.length > 0 && (
        <>
          <h3>
            <Bi en="Irish-domiciled equivalents" zh="愛爾蘭註冊的同類 ETF" />
          </h3>
          <ul>
            {classesHeld.map((classId) => {
              const name = names.get(classId) ?? { en: classId, zh: classId };
              const irish = funds.filter((fund) => fund.assetClassId === classId && fund.domicile === 'IE');
              return (
                <li key={classId}>
                  <Bi en={`${name.en}:`} zh={`${name.zh}：`} />{' '}
                  {irish.length > 0 ? (
                    irish.map((fund, index) => (
                      <span key={fund.ticker}>
                        {index > 0 && ', '}
                        <abbr title={fund.name}>{fund.ticker}</abbr>
                      </span>
                    ))
                  ) : (
                    <Bi en="none" zh="無" />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Info>
        <Bi
          en={`Every US-domiciled holding counts, both pools, US shares and US ETFs alike, held through 複委託 or not; Irish-domiciled ETFs, Taiwan-listed funds and TWD balances do not. ${enabled ? 'The rule US_ESTATE_TAX checks it after every nightly update and drafts a suggestion when it is over, with no orders: a sale abroad is overseas income, so the swap is your call.' : 'The rule US_ESTATE_TAX is off: turn it on on the Rules page for a suggestion when it is over.'} London-listed funds need a 複委託 broker that offers them and their London fees (see the brokers above).`}
          zh={`所有美國註冊的持股都計入（兩個資金池，美股個股與美國 ETF 皆同，無論是否透過複委託持有）；愛爾蘭註冊 ETF、台灣上市基金與台幣餘額不計入。${enabled ? 'US_ESTATE_TAX 規則每晚資料更新後檢查，超過時產生建議（不含下單清單：在海外賣出屬海外所得，是否轉換由你決定）。' : 'US_ESTATE_TAX 規則目前停用：可在「規則」頁啟用，超過時即產生建議。'}倫敦上市的基金需要有提供的複委託券商與其英股費率（見上方券商比較）。`}
        />{' '}
        <Link href="/rules#rule-US_ESTATE_TAX">
          <Bi {...LABELS.rules} />
        </Link>
      </Info>
    </>
  );
}

// ---------------------------------------------------------------------------
// The settings forms' fields
// ---------------------------------------------------------------------------

function feeFields(brokers: readonly Broker[]): FieldSpec[] {
  return [
    {
      name: 'broker',
      label: { en: 'Your 複委託 broker', zh: '你的複委託券商' },
      kind: 'select',
      options: [{ value: '', label: { en: 'Not chosen yet', zh: '尚未選擇' } }, ...brokers.map((broker) => ({ value: broker.id, label: { en: broker.nameEn, zh: broker.nameZh } }))],
    },
    { name: 'twRate', label: { en: 'Taiwan commission, % of the amount', zh: '台股手續費率（%）' }, numeric: true, hint: { en: 'Listed: 0.1425', zh: '牌告：0.1425' } },
    { name: 'twDiscount', label: { en: 'Discount, in 折 (10 is none)', zh: '折扣（折數，10 為不打折）' }, numeric: true, hint: { en: 'e.g. 2.8', zh: '例如 2.8' } },
    { name: 'twMin', label: { en: 'Least a Taiwan order pays, NT$', zh: '台股每筆最低手續費（台幣）' }, numeric: true, hint: { en: 'Often NT$1 odd lot · NT$20 board lot', zh: '常見零股 1 元 · 整股 20 元' } },
    { name: 'fxSpread', label: { en: 'FX spread when a broker has none, % of the amount', zh: '換匯價差（券商未填時，金額的 %）' }, numeric: true },
  ];
}

const TAX_LABELS: Record<(typeof TAX_FIELDS)[number], Bilingual> = {
  twStock: { en: 'Taiwan transaction tax on shares, %', zh: '台股證交稅：股票（%）' },
  twEtf: { en: 'Taiwan transaction tax on ETFs, %', zh: '台股證交稅：ETF（%）' },
  twBondEtf: { en: 'Taiwan transaction tax on bond ETFs, %', zh: '台股證交稅：債券 ETF（%）' },
  amtFloor: { en: 'Minimum tax: overseas income counts from, NT$ a year', zh: '最低稅負制：海外所得計入門檻（台幣／年）' },
  amtExemption: { en: 'Minimum tax: household exemption, NT$', zh: '最低稅負制：基本所得額免稅額（台幣）' },
  amtRate: { en: 'Minimum tax: rate, %', zh: '最低稅負制：稅率（%）' },
  nhiRate: { en: 'Supplementary premium: rate, %', zh: '二代健保補充保費：費率（%）' },
  nhiSingle: { en: 'Supplementary premium: a single payment from, NT$', zh: '二代健保補充保費：單筆門檻（台幣）' },
  nhiMax: { en: 'Supplementary premium: most of one payment it applies to, NT$', zh: '二代健保補充保費：單筆上限（台幣）' },
  estateMin: { en: 'US estate tax: lowest rate, %', zh: '美國遺產稅：最低稅率（%）' },
  estateMax: { en: 'US estate tax: highest rate, %', zh: '美國遺產稅：最高稅率（%）' },
};

const AMOUNTS: ReadonlySet<string> = new Set(['amtFloor', 'amtExemption', 'nhiSingle', 'nhiMax']);

function taxFields(tax: TaxSettings): FieldSpec[] {
  return [
    ...Object.keys(tax.withholding).map((domicile) => ({
      name: withholdingField(domicile),
      label: { en: `Withheld on distributions of ${domicile}-domiciled funds, %`, zh: `${domicile} 註冊基金配息的預扣稅（%）` },
      numeric: true,
    })),
    ...TAX_FIELDS.map((name) => ({ name, label: TAX_LABELS[name], numeric: true })),
    { name: 'checked', label: { en: 'I checked these against the current law today', zh: '我今天已依現行法規確認' }, kind: 'checkbox' as const },
  ];
}

function taxInitial(tax: TaxSettings): Record<string, string> {
  const values: Record<(typeof TAX_FIELDS)[number], number> = {
    twStock: tax.twTransactionTax.stock,
    twEtf: tax.twTransactionTax.etf,
    twBondEtf: tax.twTransactionTax.bondEtf,
    amtFloor: tax.amt.overseasFloorTwd,
    amtExemption: tax.amt.exemptionTwd,
    amtRate: tax.amt.rate,
    nhiRate: tax.nhi.rate,
    nhiSingle: tax.nhi.singlePaymentTwd,
    nhiMax: tax.nhi.maxPaymentTwd,
    estateMin: tax.usEstate.minRate,
    estateMax: tax.usEstate.maxRate,
  };
  return {
    ...Object.fromEntries(Object.entries(tax.withholding).map(([domicile, value]) => [withholdingField(domicile), rateField(value)])),
    ...Object.fromEntries(TAX_FIELDS.map((name) => [name, AMOUNTS.has(name) ? String(values[name]) : rateField(values[name])])),
    checked: '',
  };
}

function brokerFields(adding: boolean): FieldSpec[] {
  return [
    ...(adding ? [{ name: 'id', label: { en: 'Id (lowercase, kept)', zh: '代號（小寫英數，不可更改）' }, hint: { en: 'e.g. fubon', zh: '例如 fubon' } }] : []),
    { name: 'nameEn', label: { en: 'Name in English', zh: '英文名稱' } },
    { name: 'nameZh', label: { en: 'Name in Chinese', zh: '中文名稱' } },
    { name: 'usRate', label: { en: 'US shares: fee, % of the amount', zh: '美股個股：手續費率（%）' }, numeric: true },
    { name: 'usMin', label: { en: 'US shares: minimum, US$ (blank: none)', zh: '美股個股：低消（美元，留白為無）' }, numeric: true },
    { name: 'etfFlat', label: { en: 'US ETFs: flat fee, US$ (blank: as shares)', zh: '美股 ETF：每筆固定費用（美元，留白則同個股）' }, numeric: true },
    { name: 'dcaFlat', label: { en: 'DCA: flat fee, US$', zh: '定期定額：每筆固定費用（美元）' }, numeric: true },
    { name: 'dcaRate', label: { en: 'DCA: fee, % (when not flat)', zh: '定期定額：費率（%，非固定費用時）' }, numeric: true },
    { name: 'dcaMax', label: { en: 'DCA: most an order pays, US$', zh: '定期定額：每筆上限（美元）' }, numeric: true },
    { name: 'ukRate', label: { en: 'London: fee, % (blank: not known)', zh: '英股：手續費率（%，留白為未知）' }, numeric: true },
    { name: 'ukMin', label: { en: 'London: minimum, US$', zh: '英股：低消（美元）' }, numeric: true },
    {
      name: 'lseEtfs',
      label: { en: 'Offers London-listed (Irish) ETFs', zh: '是否提供倫敦掛牌（愛爾蘭註冊）ETF' },
      kind: 'select',
      options: LSE_CHOICES.map((value) => ({ value, label: value === 'yes' ? { en: 'Yes', zh: '有' } : value === 'no' ? { en: 'No', zh: '沒有' } : { en: 'Not known', zh: '未知' } })),
    },
    { name: 'custody', label: { en: 'Custody fee, % a year', zh: '保管費（每年 %）' }, numeric: true },
    { name: 'fxSpread', label: { en: 'FX spread, % (blank: the default)', zh: '換匯價差（%，留白用預設值）' }, numeric: true },
    { name: 'promoUntil', label: { en: 'Offer ends (YYYY-MM-DD, blank: none)', zh: '優惠截止日（YYYY-MM-DD，留白為無）' } },
    { name: 'source', label: { en: 'Source (a link or where)', zh: '來源（網址或說明）' } },
    { name: 'noteEn', label: { en: 'Note in English', zh: '英文備註' } },
    { name: 'noteZh', label: { en: 'Note in Chinese', zh: '中文備註' } },
    { name: 'checked', label: { en: "I checked these on the broker's page today", zh: '我今天已在券商官網確認' }, kind: 'checkbox' },
  ];
}

function brokerInitial(broker: Broker): Record<string, string> {
  const dca = broker.usDca;
  return {
    nameEn: broker.nameEn,
    nameZh: broker.nameZh,
    usRate: rateField(broker.usStock?.flat === null ? broker.usStock.rate : null),
    usMin: broker.usStock && broker.usStock.min > 0 ? usd(broker.usStock.min) : '',
    etfFlat: usd(broker.usEtf?.flat),
    dcaFlat: usd(dca?.flat),
    dcaRate: dca && dca.flat === null ? rateField(dca.rate) : '',
    dcaMax: usd(dca?.max),
    ukRate: rateField(broker.uk?.rate),
    ukMin: broker.uk && broker.uk.min > 0 ? usd(broker.uk.min) : '',
    lseEtfs: broker.lseEtfs === true ? 'yes' : broker.lseEtfs === false ? 'no' : 'unknown',
    custody: rateField(broker.custodyRate),
    fxSpread: rateField(broker.fxSpread),
    promoUntil: broker.promoUntil ?? '',
    source: broker.source,
    noteEn: broker.noteEn,
    noteZh: broker.noteZh,
    checked: '',
  };
}

function fundFields(classes: CostsData['classSettings'], adding: boolean): FieldSpec[] {
  return [
    ...(adding ? [{ name: 'ticker', label: LABELS.ticker }] : []),
    { name: 'name', label: LABELS.name },
    { name: 'assetClass', label: LABELS.assetClass, kind: 'select', options: classes.map((assetClass) => ({ value: assetClass.id, label: { en: assetClass.nameEn, zh: assetClass.nameZh } })) },
    { name: 'domicile', label: LABELS.domicile, hint: { en: 'IE for Irish-domiciled UCITS funds.', zh: '愛爾蘭註冊的 UCITS 基金填 IE。' } },
    {
      name: 'market',
      label: LABELS.market,
      kind: 'select',
      options: [
        { value: 'US', label: { en: 'US', zh: '美國' } },
        { value: 'UK', label: { en: 'London', zh: '倫敦' } },
        { value: 'TW', label: { en: 'Taiwan', zh: '台灣' } },
      ],
    },
    {
      name: 'distribution',
      label: { en: 'Pays out', zh: '配息方式' },
      kind: 'select',
      options: [
        { value: 'dist', label: { en: 'Distributing', zh: '配息型' } },
        { value: 'acc', label: { en: 'Accumulating', zh: '累積型' } },
      ],
    },
    { name: 'ter', label: { en: 'TER, % a year', zh: '總費用率（每年 %）' }, numeric: true, hint: { en: "From the issuer's page; a Taiwan fund's management plus custody fee.", zh: '依發行商官網；台股基金為經理費加保管費。' } },
    { name: 'yield', label: { en: 'Yield withholding applies to, %', zh: '預扣稅適用的殖利率（%）' }, numeric: true, hint: { en: "Its dividend or interest yield; an accumulating fund's index yield.", zh: '股息或利息殖利率；累積型填其指數的殖利率。' } },
    { name: 'withholding', label: { en: 'Share withheld, % (blank: the domicile’s)', zh: '預扣比例（%，留白依註冊地）' }, numeric: true },
    { name: 'trackingDifference', label: { en: 'Tracking difference, % (shown, not added)', zh: '追蹤差異（%，僅顯示不加總）' }, numeric: true },
    { name: 'source', label: { en: 'Source (a link or where)', zh: '來源（網址或說明）' } },
    { name: 'noteEn', label: { en: 'Note in English', zh: '英文備註' } },
    { name: 'noteZh', label: { en: 'Note in Chinese', zh: '中文備註' } },
    { name: 'checked', label: { en: "I checked these on the issuer's page today", zh: '我今天已在發行商官網確認' }, kind: 'checkbox' },
  ];
}

function fundInitial(fund: FundCost): Record<string, string> {
  return {
    name: fund.name,
    assetClass: fund.assetClassId,
    domicile: fund.domicile,
    market: fund.market,
    distribution: fund.distribution,
    ter: rateField(fund.ter),
    yield: rateField(fund.yield),
    withholding: rateField(fund.withholding),
    trackingDifference: rateField(fund.trackingDifference),
    source: fund.source,
    noteEn: fund.noteEn,
    noteZh: fund.noteZh,
    checked: '',
  };
}
