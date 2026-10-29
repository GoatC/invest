import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { Facts, type Fact } from '@/components/facts';
import { Info } from '@/components/info';
import { ValueRanges, type ValueRange } from '@/components/valuation-charts';
import { requireSession } from '@/lib/auth';
import { DataError, loadRedFlagData, loadWorkbench, orDataError, type StockBench, type WorkbenchData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { money, percent, signedPercent } from '@/lib/format';
import { feedLabel, LABELS, type Bilingual } from '@/lib/i18n';
import { MULTIPLES, SCENARIOS, marginOfSafety, metrics, zoneOf, type DcfResult, type ModelId, type MultipleId, type MultiplesResult, type Scenario, type Used, type ValuationSettings } from '@/lib/models/intrinsic';
import { savedFor } from '@/lib/models/workbench';
import type { Assessment } from '@/lib/models/red-flags';
import { LIGHT_ICON, lightText } from '@/lib/red-flag-text';

import { unwatchStock, watchStock } from './actions';
import { AssumptionsForm, ValuationSettingsForm } from './forms';

type Params = Record<string, string | string[] | undefined>;

const MODEL: Record<ModelId, Bilingual> = {
  dcf: { en: 'DCF (FCFF)', zh: '現金流折現' },
  ddm: { en: 'Gordon DDM', zh: '股利折現' },
  multiples: { en: 'Multiples', zh: '倍數法' },
};
const SLOT: Record<ModelId, number> = { dcf: 0, ddm: 1, multiples: 2 };
/** Short names for the chart's axis, which a phone leaves little room for. */
const MODEL_SHORT: Record<ModelId, Bilingual> = { dcf: { en: 'DCF', zh: '現金流' }, ddm: { en: 'DDM', zh: '股利' }, multiples: { en: 'Multiples', zh: '倍數' } };
const SCENARIO: Record<Scenario, Bilingual> = { bear: { en: 'Bear', zh: '悲觀' }, base: { en: 'Base', zh: '基本' }, bull: { en: 'Bull', zh: '樂觀' } };
const MULTIPLE: Record<MultipleId, string> = { pe: 'P/E', pb: 'P/B', evEbitda: 'EV/EBITDA' };
const ZONE: Record<'buy' | 'trim' | 'between', { label: Bilingual; tone: Fact['tone'] }> = {
  buy: { label: { en: 'Buy zone', zh: '買入區' }, tone: 'watch' },
  trim: { label: { en: 'Trim zone', zh: '減碼區' }, tone: 'alert' },
  between: { label: { en: 'Between zones', zh: '區間內' }, tone: 'ok' },
};
const INPUT_PROBLEM: Record<string, Bilingual> = {
  price: { en: 'No close yet: the nightly job loads it.', zh: '尚無收盤價：每夜排程會載入。' },
  filings: { en: 'No filings yet: the nightly job loads them (US stocks need SEC_USER_AGENT); or type FCFF and shares below.', zh: '尚無財報：每夜排程會載入（美股需要 SEC_USER_AGENT）；或在下方輸入 FCFF 與股數。' },
  currency: { en: 'The filings are in another currency than the price (an ADR?).', zh: '財報幣別與股價不同（存託憑證？）。' },
};
const MODEL_PROBLEM: Record<string, Bilingual> = {
  cost_of_equity: { en: 'No cost of equity yet (see Cost of equity).', zh: '尚無權益成本（見「權益成本」頁）。' },
  figures: { en: 'The filings miss EBIT, D&A, CapEx or the share count.', zh: '財報缺少 EBIT、折舊攤銷、資本支出或股數。' },
  fcff: { en: 'FCFF is not positive: type a starting FCFF, or use another model.', zh: 'FCFF 不為正：請輸入起始 FCFF，或改用其他模型。' },
  growth: { en: 'A terminal growth is not below the discount rate.', zh: '永續成長率不低於折現率。' },
  dividend: { en: 'No dividend in the last twelve months.', zh: '近十二個月沒有股利。' },
  none: { en: 'Nothing to compare: add peers, or wait for enough quarter ends.', zh: '沒有可比較的倍數：請加入同業，或等待足夠的季數。' },
};
const FROM: Record<Used['from'], Bilingual> = { filings: { en: 'filings', zh: '財報' }, typed: { en: 'typed', zh: '自訂' }, default: { en: 'default', zh: '預設' } };

const millions = (value: number | undefined, currency: string) => (value === undefined ? '—' : `${(value / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })} M ${currency}`);
const rate = (value: number) => percent(value, 2);
const multiple = (value: number | undefined) => (value === undefined ? '—' : `${value.toFixed(1)}×`);

/** The model a stock's alerts use, its newest saved values, and the multiples that set its zones. */
function alertBasis(bench: StockBench, rules: WorkbenchData['rules']) {
  const saved = savedFor(bench.saved, bench.security.ticker, bench.assumed.model)[0];
  const buy = bench.watch?.buy ?? rules.buy;
  const trim = bench.watch?.trim ?? rules.trim;
  const price = bench.input?.price ?? bench.series.closes[bench.series.closes.length - 1];
  const zone = saved && price && buy !== null && trim !== null ? zoneOf(price.close, saved.base, { buy, trim }) : undefined;
  return { saved, buy, trim, price, zone, margin: saved && price ? marginOfSafety(saved.base, price.close) : undefined };
}

/** F12 (PRD Module C): the watchlist, and each stock's valuation workbench. */
export default async function ValuationPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: WorkbenchData;
  try {
    data = await loadWorkbench(supabase, today);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  if (!data.settings) return <DataProblem table="config" detail="valuation is missing or malformed" />;
  const ticker = typeof params['t'] === 'string' ? params['t'] : undefined;
  const bench = ticker ? data.stocks.find((stock) => stock.security.ticker === ticker) : undefined;
  if (bench) return <Workbench bench={bench} data={data} settings={data.settings} saved={params['saved'] === 'assumptions'} />;
  const flags = await orDataError(loadRedFlagData(supabase, today));
  const lights = new Map(flags instanceof DataError ? [] : flags.companies.map((company) => [company.security.ticker, company.assessment]));
  return <Watchlist data={data} settings={data.settings} today={today} saved={params['saved'] === 'settings'} error={typeof params['error'] === 'string' ? params['error'] : undefined} missing={ticker} lights={lights} />;
}

function Watchlist({ data, settings, today, saved, error, missing, lights }: { data: WorkbenchData; settings: ValuationSettings; today: string; saved: boolean; error?: string; missing?: string; lights: ReadonlyMap<string, Assessment> }) {
  const addable = [...data.others, ...data.stocks.filter((stock) => !stock.watch).map((stock) => stock.security)].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.valuation} />
        </h1>
        <p className="equation">
          <Bi en="Margin of safety = (value − price) ÷ value" zh="安全邊際 ＝（內在價值 − 股價）÷ 內在價值" />
        </p>
        {(error || missing) && (
          <p className="banner danger" role="alert">
            <Bi en={missing ? `${missing} is not a watched or held single stock.` : `Could not save: ${error}`} zh={missing ? `${missing} 不是觀察中或持有的個股。` : `無法儲存：${error}`} />
          </p>
        )}
        {data.stocks.length === 0 ? (
          <p className="muted">
            <Bi en="No single stock watched or held yet." zh="尚無觀察中或持有的個股。" />
          </p>
        ) : (
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>
                    <Bi {...LABELS.ticker} />
                  </th>
                  <th className="num">
                    <Bi en="Price" zh="股價" />
                  </th>
                  <th className="num">
                    <Bi en="Value, base" zh="內在價值（基本）" />
                  </th>
                  <th className="num">
                    <Bi en="Margin of safety" zh="安全邊際" />
                  </th>
                  <th>
                    <Bi en="Zone" zh="區間" />
                  </th>
                  <th className="num">
                    <Bi en="To buy / trim" zh="距買入／減碼" />
                  </th>
                  <th>
                    <Bi {...LABELS.redFlags} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.stocks.map((bench) => {
                  const basis = alertBasis(bench, data.rules);
                  const zone = basis.zone ? ZONE[basis.zone.zone] : undefined;
                  return (
                    <tr key={bench.security.ticker}>
                      <td>
                        <Link href={`/valuation?t=${encodeURIComponent(bench.security.ticker)}`}>{bench.security.ticker}</Link>
                        {bench.held && (
                          <span className="badge">
                            <Bi en="held" zh="持有" />
                          </span>
                        )}
                        {bench.watch && !bench.watch.active && (
                          <span className="badge warn">
                            <Bi en="alerts off" zh="警報關閉" />
                          </span>
                        )}
                        <div className="muted small">{bench.security.name}</div>
                      </td>
                      <td className="num">{basis.price ? money(basis.price.close, bench.security.currency) : '—'}</td>
                      <td className="num">
                        {basis.saved ? money(basis.saved.base, bench.security.currency) : '—'}
                        <div className="muted small">
                          {basis.saved ? <Bi en={`${MODEL[basis.saved.model].en} · ${basis.saved.date}`} zh={`${MODEL[basis.saved.model].zh} · ${basis.saved.date}`} /> : <Bi en="not saved" zh="尚未儲存" />}
                        </div>
                      </td>
                      <td className="num">{basis.margin === undefined ? '—' : signedPercent(basis.margin)}</td>
                      <td className="nowrap">
                        {zone ? (
                          <>
                            <span className={`status-icon ${zone.tone === 'alert' ? 'rebalance' : zone.tone}`} aria-hidden="true">
                              {zone.tone === 'ok' ? '✓' : zone.tone === 'watch' ? '!' : '✕'}
                            </span>{' '}
                            <Bi {...zone.label} />
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num nowrap">{basis.zone ? `−${percent(basis.zone.toBuy)} / +${percent(basis.zone.toTrim)}` : '—'}</td>
                      <td className="nowrap">
                        {(() => {
                          const flag = lights.get(bench.security.ticker);
                          if (!flag) return '—';
                          const icon = LIGHT_ICON[flag.light ?? 'none'];
                          return (
                            <Link href={`/red-flags?t=${encodeURIComponent(bench.security.ticker)}`}>
                              <span className={`status-icon ${icon.className}`} aria-hidden="true">
                                {icon.icon}
                              </span>
                              <Bi {...lightText(flag.light)} />
                              <div className="muted small">{percent(flag.coverage / 100, 0)}</div>
                            </Link>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Info>
          <Bi
            en="Each stock is valued a share, bear / base / bull, by a two-stage DCF of its free cash flow to the firm at WACC, Gordon's dividend model and its P/E, P/B and EV/EBITDA against its peers and its own five years. The alerts read the base value of the model chosen for the stock, as last saved; the nightly job saves it again after each new quarter's filing."
            zh="每檔個股以三種方法估算每股內在價值（悲觀／基本／樂觀）：以 WACC 折現的兩階段公司自由現金流 DCF、Gordon 股利折現，以及相對同業與自身五年的本益比、股價淨值比、EV/EBITDA。警報採用該股所選模型最後儲存的基本情境數值；每夜排程在新一季財報公布後重新儲存。"
          />
        </Info>
        {addable.length > 0 && (
          <form action={watchStock} className="row">
            <select name="ticker" aria-label="Stock 個股" defaultValue={addable[0]?.ticker}>
              {addable.map((security) => (
                <option key={security.ticker} value={security.ticker}>
                  {security.ticker} {security.name}
                </option>
              ))}
            </select>
            <button type="submit" className="button">
              <Bi en="Watch" zh="加入觀察清單" />
            </button>
          </form>
        )}
        <p className="muted small">
          <Bi en="A stock not listed: add it on the Securities page as a single stock." zh="清單中沒有的個股：請先在「證券」頁以個股新增。" />
        </p>
      </section>

      <section className="card form" id="settings">
        <details open={saved}>
          <summary>
            <Bi en="Defaults" zh="預設值" />
          </summary>
          {saved && (
            <p className="banner ok" role="status">
              <Bi en="Defaults saved." zh="已儲存預設值。" />
            </p>
          )}
          <ValuationSettingsForm
            markets={Object.keys(settings.taxRate)}
            initial={{
              model: settings.model,
              years: String(settings.years),
              ...scenarioFields('growth', settings.growth),
              ...scenarioFields('terminal', settings.terminal),
              debtSpread: percentField(settings.debtSpread),
              ...Object.fromEntries(Object.entries(settings.taxRate).map(([market, value]) => [`tax_${market}`, percentField(value)])),
              historyYears: String(settings.historyYears),
              minQuarters: String(settings.minQuarters),
            }}
            today={today}
            checkedOn={settings.checked}
          />
        </details>
      </section>
    </>
  );
}

const percentField = (value: number) => String(Number((value * 100).toFixed(4)));
const scenarioFields = (prefix: string, values: Record<Scenario, number>) => Object.fromEntries(SCENARIOS.map((scenario) => [`${prefix}_${scenario}`, percentField(values[scenario])]));
const millionsField = (value: number | undefined) => (value === undefined ? '' : String(Number((value / 1e6).toFixed(3))));

function Workbench({ bench, data, settings, saved }: { bench: StockBench; data: WorkbenchData; settings: ValuationSettings; saved: boolean }) {
  const { security, valuation, input } = bench;
  const currency = security.currency;
  const basis = alertBasis(bench, data.rules);
  const chosen = valuation?.[bench.assumed.model];
  const live = chosen?.ok ? chosen.result.values : undefined;
  const facts: Fact[] = [
    { label: { en: 'Price', zh: '股價' }, value: basis.price ? money(basis.price.close, currency) : '—', ...(basis.price ? { note: { en: basis.price.date, zh: basis.price.date } } : {}) },
    {
      label: { en: `Value, base (${MODEL[bench.assumed.model].en})`, zh: `內在價值（${MODEL[bench.assumed.model].zh}）` },
      value: live ? money(live.base, currency) : '—',
      note: live ? { en: `${money(live.bear, currency)} – ${money(live.bull, currency)}`, zh: `${money(live.bear, currency)} – ${money(live.bull, currency)}` } : { en: 'no value', zh: '無法估值' },
      tone: live ? 'ok' : 'watch',
    },
    {
      label: { en: 'Margin of safety', zh: '安全邊際' },
      value: live && basis.price ? signedPercent(marginOfSafety(live.base, basis.price.close)) : '—',
    },
    basis.zone
      ? { label: { en: 'Alerts: saved value', zh: '警報：已存數值' }, value: money(basis.saved?.base, currency), note: { en: `${ZONE[basis.zone.zone].label.en} · ${basis.saved?.date}`, zh: `${ZONE[basis.zone.zone].label.zh} · ${basis.saved?.date}` }, tone: ZONE[basis.zone.zone].tone }
      : { label: { en: 'Alerts: saved value', zh: '警報：已存數值' }, value: '—', note: { en: 'save the assumptions', zh: '請儲存假設' }, tone: 'watch' },
    {
      label: { en: 'Cost of equity', zh: '權益成本' },
      value: bench.cost?.ok ? rate(bench.cost.result.rate) : '—',
      note: bench.cost?.ok ? { en: `β ${bench.cost.result.beta.toFixed(2)}`, zh: `β ${bench.cost.result.beta.toFixed(2)}` } : { en: 'none yet', zh: '尚無' },
      tone: bench.cost?.ok ? 'ok' : 'watch',
    },
    {
      label: { en: 'Newest quarter', zh: '最新一季' },
      value: input?.quarter.figures.netIncome !== undefined ? input.quarter.periodEnd : '—',
      note: bench.source ? { en: `${feedLabel(bench.source).en}${input?.quarter.filed ? ` · filed ${input.quarter.filed}` : ''}`, zh: `${feedLabel(bench.source).zh}${input?.quarter.filed ? ` · ${input.quarter.filed} 申報` : ''}` } : { en: 'not loaded', zh: '尚未載入' },
      tone: bench.source ? 'ok' : 'watch',
    },
  ];
  const ranges: ValueRange[] = valuation
    ? (['dcf', 'ddm', 'multiples'] as const).flatMap((model) => {
        const outcome = valuation[model];
        return outcome.ok ? [{ label: MODEL_SHORT[model], slot: SLOT[model], ...outcome.result.values }] : [];
      })
    : [];
  const buyPrice = live && basis.buy !== null ? live.base * basis.buy : null;
  const trimPrice = live && basis.trim !== null ? live.base * basis.trim : null;

  return (
    <>
      <section className="card form">
        <p className="muted small">
          <Link href="/valuation">
            <Bi en="← Watchlist" zh="← 觀察清單" />
          </Link>
        </p>
        <h1>
          {security.ticker} <span className="muted">{security.name}</span>
        </h1>
        <Facts facts={facts} />
        {bench.problem && (
          <p className="banner info" role="status">
            <Bi {...(INPUT_PROBLEM[bench.problem] ?? (INPUT_PROBLEM['filings'] as Bilingual))} />
          </p>
        )}
        {ranges.length > 0 && basis.price && (
          <ValueRanges rows={ranges} price={basis.price.close} buy={buyPrice} trim={trimPrice} currency={currency} label={{ en: `${security.ticker}: value a share by model, against the price`, zh: `${security.ticker}：各模型每股內在價值與股價` }} />
        )}
        {valuation && (
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>
                    <Bi en="Model" zh="模型" />
                  </th>
                  {SCENARIOS.map((scenario) => (
                    <th key={scenario} className="num">
                      <Bi {...SCENARIO[scenario]} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['dcf', 'ddm', 'multiples'] as const).map((model) => {
                  const outcome = valuation[model];
                  return (
                    <tr key={model}>
                      <td>
                        <Bi {...MODEL[model]} />
                        {model === bench.assumed.model && (
                          <span className="badge">
                            <Bi en="alerts" zh="警報" />
                          </span>
                        )}
                      </td>
                      {outcome.ok ? (
                        SCENARIOS.map((scenario) => (
                          <td key={scenario} className="num">
                            {money(outcome.result.values[scenario], currency)}
                          </td>
                        ))
                      ) : (
                        <td colSpan={3} className="muted">
                          <Bi {...(MODEL_PROBLEM[outcome.problem] ?? (MODEL_PROBLEM['none'] as Bilingual))} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {valuation?.dcf.ok && <DcfCard result={valuation.dcf.result} currency={currency} costOfEquity={bench.cost?.ok ? bench.cost.result.rate : undefined} />}
      {valuation?.ddm.ok && (
        <section className="card form">
          <h2>
            <Bi en="Gordon dividend model" zh="Gordon 股利折現" />
          </h2>
          <p className="equation">P = D₀ (1 + g) ÷ (R_e − g)</p>
          <ul className="formula">
            {SCENARIOS.map((scenario) => (
              <li key={scenario}>
                <Bi {...SCENARIO[scenario]} />
                {`: ${money(valuation.ddm.ok ? valuation.ddm.result.dividend.value : 0, currency)} × (1 + ${rate(bench.assumed.terminal[scenario])}) ÷ (${rate(bench.cost?.ok ? bench.cost.result.rate : 0)} − ${rate(bench.assumed.terminal[scenario])}) = ${money(valuation.ddm.ok ? valuation.ddm.result.values[scenario] : 0, currency)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {valuation?.multiples.ok && <MultiplesCard result={valuation.multiples.result} currency={currency} />}
      {input && input.quarter.figures.netIncome !== undefined && <FilingsCard bench={bench} />}

      <section className="card form" id="assumptions">
        <h2>
          <Bi en="Assumptions" zh="假設" />
        </h2>
        {saved && (
          <p className="banner ok" role="status">
            <Bi en="Assumptions saved, and the valuation with them: the alerts use it." zh="已儲存假設與估值，警報以此為準。" />
          </p>
        )}
        <AssumptionsForm
          ticker={security.ticker}
          stocks={[...data.stocks.map((stock) => stock.security.ticker), ...data.others.map((other) => other.ticker)]}
          currency={bench.series.reportCurrency ?? currency}
          ruleMultiples={{ buy: data.rules.buy, trim: data.rules.trim }}
          initial={{
            model: bench.assumed.model,
            years: String(bench.assumed.years),
            ...scenarioFields('growth', bench.assumed.growth),
            ...scenarioFields('terminal', bench.assumed.terminal),
            fcff: millionsField(bench.assumed.overrides.fcff),
            netDebt: millionsField(bench.assumed.overrides.netDebt),
            shares: millionsField(bench.assumed.overrides.shares),
            taxRate: bench.assumed.overrides.taxRate === undefined ? '' : percentField(bench.assumed.overrides.taxRate),
            costOfDebt: bench.assumed.overrides.costOfDebt === undefined ? '' : percentField(bench.assumed.overrides.costOfDebt),
            peers: bench.assumed.peers.join(', '),
            buy: bench.watch?.buy === null || bench.watch?.buy === undefined ? '' : String(bench.watch.buy),
            trim: bench.watch?.trim === null || bench.watch?.trim === undefined ? '' : String(bench.watch.trim),
            ...(bench.watch === undefined || bench.watch.active ? { active: 'on' } : {}),
          }}
        />
        <Info label={{ en: 'Defaults and the rules', zh: '預設值與規則' }}>
          <Bi
            en={`Blank fields take the filings, and the defaults: ${settings.years} years, FCFF growth ${rate(settings.growth.base)} base, terminal ${rate(settings.terminal.base)}. In the buy zone the month's contribution share goes to the stock within R1 and R2; in the trim zone a share of the holding is sold (Rules page).`}
            zh={`留白的欄位使用財報與預設值：${settings.years} 年、基本情境 FCFF 成長 ${rate(settings.growth.base)}、永續成長 ${rate(settings.terminal.base)}。進入買入區時，當月投入的衛星比例在 R1／R2 限制內投入該股；進入減碼區時賣出部分持股（見「規則」頁）。`}
          />
        </Info>
        {bench.watch && (
          <form action={unwatchStock} className="row">
            <input type="hidden" name="ticker" value={security.ticker} />
            <button type="submit" className="button">
              <Bi en="Take off the watchlist" zh="移出觀察清單" />
            </button>
          </form>
        )}
      </section>

      {bench.saved.length > 0 && (
        <section className="card form">
          <details>
            <summary>
              <Bi en={`Saved values (${bench.saved.length})`} zh={`已儲存的估值（${bench.saved.length}）`} />
            </summary>
            <div className="table-wrap">
              <table className="compact">
                <thead>
                  <tr>
                    <th>
                      <Bi en="Date" zh="日期" />
                    </th>
                    <th>
                      <Bi en="Model" zh="模型" />
                    </th>
                    <th className="num">
                      <Bi en="Bear / base / bull" zh="悲觀／基本／樂觀" />
                    </th>
                    <th>
                      <Bi en="Saved by" zh="來源" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bench.saved.map((row) => (
                    <tr key={`${row.date}|${row.model}`}>
                      <td className="nowrap">{row.date}</td>
                      <td>
                        <Bi {...MODEL[row.model]} />
                      </td>
                      <td className="num nowrap">{`${row.bear.toFixed(2)} / ${row.base.toFixed(2)} / ${row.bull.toFixed(2)}`}</td>
                      <td>
                        <Bi {...(row.trigger === 'filing' ? { en: `filing ${row.periodEnd ?? ''}`, zh: `財報 ${row.periodEnd ?? ''}` } : { en: 'your edit', zh: '你的修改' })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}
    </>
  );
}

function DcfCard({ result, currency, costOfEquity }: { result: DcfResult; currency: string; costOfEquity: number | undefined }) {
  const base = result.scenarios.base;
  const debtShare = result.debt / (result.equity + result.debt);
  return (
    <section className="card form">
      <h2>
        <Bi en="DCF (FCFF)" zh="現金流折現（FCFF）" />
      </h2>
      <p className="equation">FCFF = EBIT (1 − t) + D&amp;A − CapEx − ΔNWC · TV = FCFF_n+1 ÷ (WACC − g)</p>
      <ul className="facts">
        <li className="fact">
          <span className="fact-label">FCFF</span>
          <strong className="fact-value">{millions(result.fcff.value, currency)}</strong>
          <span className="fact-note">
            <Bi {...FROM[result.fcff.from]} />
          </span>
        </li>
        <li className="fact">
          <span className="fact-label">WACC</span>
          <strong className="fact-value">{rate(result.wacc)}</strong>
        </li>
        <li className="fact">
          <span className="fact-label">
            <Bi en="Net debt" zh="淨負債" />
          </span>
          <strong className="fact-value">{millions(result.netDebt.value, currency)}</strong>
          <span className="fact-note">
            <Bi {...FROM[result.netDebt.from]} />
          </span>
        </li>
      </ul>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>
                <Bi en="Year (base)" zh="年（基本情境）" />
              </th>
              <th className="num">FCFF</th>
              <th className="num">
                <Bi en="Discount factor" zh="折現因子" />
              </th>
              <th className="num">
                <Bi en="Present value" zh="現值" />
              </th>
            </tr>
          </thead>
          <tbody>
            {base.flows.map((row) => (
              <tr key={row.year}>
                <td>{row.year}</td>
                <td className="num">{millions(row.fcff, currency)}</td>
                <td className="num">{row.factor.toFixed(4)}</td>
                <td className="num">{millions(row.pv, currency)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <Bi en="Terminal value" zh="終值" />
              </td>
              <td className="num">{millions(base.terminal.value, currency)}</td>
              <td className="num">{base.flows[base.flows.length - 1]?.factor.toFixed(4)}</td>
              <td className="num">{millions(base.terminal.pv, currency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Info label={{ en: 'Each figure worked out', zh: '各數字的計算' }}>
        <ul className="formula">
          {result.parts && (
            <li>{`FCFF = ${millions(result.parts.ebit, currency)} × (1 − ${rate(result.taxRate.value)}) + ${millions(result.parts.da, currency)} − ${millions(result.parts.capex, currency)} ${result.parts.deltaNwc >= 0 ? '−' : '+'} ${millions(Math.abs(result.parts.deltaNwc), currency)} = ${millions(result.fcff.value, currency)}`}</li>
          )}
          <li>{`WACC = ${percent(1 - debtShare)} × ${rate(costOfEquity ?? 0)} + ${percent(debtShare)} × ${rate(result.costOfDebt.value)} × (1 − ${rate(result.taxRate.value)}) = ${rate(result.wacc)}`}</li>
          {SCENARIOS.map((scenario) => {
            const run = result.scenarios[scenario];
            return (
              <li key={scenario}>
                <Bi {...SCENARIO[scenario]} />
                {`: EV ${millions(run.enterprise, currency)} − ${millions(result.netDebt.value, currency)} = ${millions(run.enterprise - result.netDebt.value, currency)} ÷ ${(result.shares.value / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })} M = ${money(result.values[scenario], currency)}`}
              </li>
            );
          })}
          <li>
            <Bi
              en={`Tax rate from the ${FROM[result.taxRate.from].en}; R_d from the ${FROM[result.costOfDebt.from].en} (interest ÷ debt, else R_f + the spread); E at today's price × shares.`}
              zh={`稅率來自${FROM[result.taxRate.from].zh}；R_d 來自${FROM[result.costOfDebt.from].zh}（利息 ÷ 負債，否則 R_f ＋ 利差）；E 為今日股價 × 股數。`}
            />
          </li>
        </ul>
      </Info>
    </section>
  );
}

function MultiplesCard({ result, currency }: { result: MultiplesResult; currency: string }) {
  return (
    <section className="card form">
      <h2>
        <Bi en="Multiples" zh="倍數法" />
      </h2>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th />
              <th className="num">
                <Bi en="Now" zh="目前" />
              </th>
              <th className="num">
                <Bi en="Own 5 years: low · median · high" zh="自身五年：低・中位・高" />
              </th>
              <th className="num">
                <Bi en={`Peers' median (${result.peerCount})`} zh={`同業中位數（${result.peerCount}）`} />
              </th>
              <th className="num">
                <Bi en="Price at own · peers" zh="對應股價：自身・同業" />
              </th>
            </tr>
          </thead>
          <tbody>
            {MULTIPLES.map((id) => {
              const own = result.own[id];
              return (
                <tr key={id}>
                  <td>{MULTIPLE[id]}</td>
                  <td className="num">{multiple(result.current[id])}</td>
                  <td className="num nowrap">{own ? `${multiple(own.low)} · ${multiple(own.median)} · ${multiple(own.high)}` : '—'}</td>
                  <td className="num">{multiple(result.peers[id])}</td>
                  <td className="num nowrap">{`${result.implied.own[id] === undefined ? '—' : money(result.implied.own[id], currency)} · ${result.implied.peers[id] === undefined ? '—' : money(result.implied.peers[id], currency)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Info>
        <Bi
          en="Each multiple times the company's own figure gives a price: its own five-year median and its peers' median today. The lowest price is the bear value, the median the base, the highest the bull."
          zh="每個倍數乘以公司自己的數字得到一個股價：自身五年中位數與同業目前中位數各一個。最低者為悲觀情境，中位數為基本情境，最高者為樂觀情境。"
        />
      </Info>
    </section>
  );
}

function FilingsCard({ bench }: { bench: StockBench }) {
  const figures = bench.input?.quarter.figures ?? {};
  const currency = bench.series.reportCurrency ?? bench.security.currency;
  const m = metrics(figures);
  const rows: Array<[Bilingual, string]> = [
    [{ en: 'Revenue', zh: '營收' }, millions(figures.revenue, currency)],
    [{ en: 'EBIT', zh: '營業利益' }, millions(figures.ebit, currency)],
    [{ en: 'Net income', zh: '淨利' }, millions(figures.netIncome, currency)],
    [{ en: 'D&A', zh: '折舊攤銷' }, millions(figures.da, currency)],
    [{ en: 'CapEx', zh: '資本支出' }, millions(figures.capex, currency)],
    [{ en: 'Operating cash flow', zh: '營業現金流' }, millions(figures.ocf, currency)],
    [{ en: 'Dividend a share', zh: '每股股利' }, figures.dps === undefined ? '—' : money(figures.dps, currency)],
    [{ en: 'Cash · debt', zh: '現金・負債' }, `${millions(figures.cash, currency)} · ${millions(figures.debt, currency)}`],
    [{ en: 'Equity', zh: '股東權益' }, millions(figures.equity, currency)],
    [{ en: 'Diluted shares', zh: '稀釋後股數' }, figures.shares === undefined ? '—' : `${(figures.shares / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })} M`],
    [{ en: 'EPS', zh: '每股盈餘' }, m.eps === undefined ? '—' : money(m.eps, currency)],
  ];
  return (
    <section className="card form">
      <details>
        <summary>
          <Bi en={`Filings: twelve months to ${bench.input?.quarter.periodEnd}`} zh={`財報：截至 ${bench.input?.quarter.periodEnd} 的近十二個月`} />
        </summary>
        <div className="table-wrap">
          <table className="compact">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label.en}>
                  <td>
                    <Bi {...label} />
                  </td>
                  <td className="num">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          <Bi
            en={`Flows over the last four quarters, balances at the quarter end; ${bench.series.quarters.length} quarter ends loaded from ${bench.source ? feedLabel(bench.source).en : '—'}.`}
            zh={`流量為近四季合計，餘額為季末數字；已從 ${bench.source ? feedLabel(bench.source).zh : '—'} 載入 ${bench.series.quarters.length} 個季末。`}
          />
        </p>
      </details>
    </section>
  );
}
