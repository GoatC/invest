import Link from 'next/link';

import { Bi, Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { Info } from '@/components/info';
import { Stat } from '@/components/stat';
import { UnderwaterChart } from '@/components/stress-chart';
import { requireSession } from '@/lib/auth';
import { DataError, loadStressData, type StressData } from '@/lib/data';
import { addMonths, taipeiToday } from '@/lib/dates';
import { percent, signedPercent, twd } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { customReplay, replay, type Replay, type Scenario, type StressSettings } from '@/lib/models/stress';
import type { Tier } from '@/lib/models/windfall';

type Params = Record<string, string | string[] | undefined>;

const CUSTOM = 'custom';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The custom scenario's shocks from the query (percent a class falls or rises in the first month), else the setting's. */
function shocksFrom(params: Params, data: StressData & { settings: StressSettings }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of data.classNames) {
    const typed = first(params[`shock_${entry.id}`]);
    const number = typed === undefined || typed.trim() === '' ? NaN : Number(typed);
    out[entry.id] = Number.isFinite(number) && number > -100 && number <= 900 ? number / 100 : (data.settings.customShocks[entry.id] ?? 0);
  }
  return out;
}

/** F10: what bad stretches from history, or one you make up, would do to what you hold today. */
export default async function StressPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: StressData;
  try {
    data = await loadStressData(supabase);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const { settings } = data;
  const heading = (
    <>
      <h1>
        <Zh {...LABELS.stress} />
      </h1>
      <Info>
        <Bi
          en="What would a bad stretch from history have done to what you hold today? Each scenario applies the months that really happened (2008, 2020, 2022) to your holdings by asset class, as if you had held them through, and shows the deepest fall in % and NT$, how long the climb back took, and which of the windfall planner's acceleration tiers (F3) would have fired. Or make up a shock of your own. A look at how bad it could get, not a forecast; history does not have to repeat."
          zh="歷史上的一段壞行情，會讓你今天的持股怎麼樣？每個情境把真實發生過的月份（2008、2020、2022）依資產類別套用在你的持股上，假設一路持有，顯示最深的跌幅（百分比與台幣）、爬回需要多久，以及大額資金分批（F3）的哪些加速級距會被觸發。也可以自訂一個衝擊。這只是了解最壞可能到哪裡，不是預測；歷史不必重演。"
        />
      </Info>
    </>
  );
  if (!settings) {
    return (
      <section className="card form">
        {heading}
        <p className="banner warn">
          <Bi en="The stress test setting is missing from the database: run npx supabase db push." zh="資料庫中找不到壓力測試設定：請執行 npx supabase db push。" />
        </p>
      </section>
    );
  }
  const total = data.classes.reduce((sum, entry) => sum + entry.valueTwd, 0);
  if (total <= 0) {
    return (
      <section className="card form">
        {heading}
        <p className="muted">
          <Bi en="Nothing is held yet: record a trade first." zh="目前沒有持股：請先登錄交易。" />
        </p>
      </section>
    );
  }

  const tiers: Tier[] = data.acceleration?.tiers ?? [];
  const windowWeeks = data.acceleration?.windowWeeks ?? 52;
  const shocks = shocksFrom({ ...params }, { ...data, settings });
  const customStart = addMonths(today.slice(0, 7), 1);
  const custom = customReplay(customStart, data.classes, shocks, data.expected, settings.customMaxMonths);
  const replays = settings.scenarios.map((scenario) => ({ scenario, replay: replay(scenario, data.classes, settings, tiers, windowWeeks) }));
  const chosen = first(params['s']) ?? replays[0]?.scenario.id ?? CUSTOM;
  const selected = chosen === CUSTOM ? null : (replays.find((entry) => entry.scenario.id === chosen) ?? replays[0]);
  const shown = selected ? selected.replay : custom;
  const shownName: Bilingual = selected ? { en: selected.scenario.nameEn, zh: selected.scenario.nameZh } : { en: 'Your own shock', zh: '自訂衝擊' };
  const names = (id: string): Bilingual => {
    const found = data.classNames.find((entry) => entry.id === id);
    return { en: found?.nameEn ?? id, zh: found?.nameZh ?? id };
  };

  return (
    <>
      <section className="card form">
        {heading}
        <div className="filters">
          <div className="segmented" role="group" aria-label="Scenario 情境">
            <span className="label">
              <Bi en="Scenario" zh="情境" />
            </span>
            {settings.scenarios.map((scenario) => (
              <Link key={scenario.id} href={`/stress?s=${scenario.id}`} aria-current={!selected || scenario.id !== selected.scenario.id ? undefined : 'true'}>
                <Bi en={scenario.nameEn} zh={scenario.nameZh} />
              </Link>
            ))}
            <Link href={`/stress?s=${CUSTOM}`} aria-current={selected ? undefined : 'true'}>
              <Bi en="Your own" zh="自訂" />
            </Link>
          </div>
        </div>
        <Summary rows={replays} custom={custom} total={total} />
      </section>
      <Detail name={shownName} shown={shown} isCustom={!selected} scenario={selected?.scenario} tiers={tiers} total={total} names={names} />
      {!selected && <CustomForm data={data} shocks={shocks} start={customStart} maxMonths={settings.customMaxMonths} />}
      <Mapping settings={settings} names={names} />
      <Method settings={settings} />
    </>
  );
}

function recovery(result: Replay): Bilingual {
  if (result.maxDrawdown === 0) return { en: 'no fall', zh: '沒有下跌' };
  if (result.recoveryMonths === null) return { en: 'not within the scenario', zh: '情境結束前未回本' };
  return { en: `${result.recoveryMonths} months`, zh: `${result.recoveryMonths} 個月` };
}

function Summary({ rows, custom, total }: { rows: Array<{ scenario: Scenario; replay: Replay }>; custom: Replay; total: number }) {
  const line = (key: string, name: Bilingual, result: Replay, href: string) => (
    <tr key={key}>
      <td>
        <Link href={href}>
          <Bi {...name} />
        </Link>
      </td>
      <td className="num">{signedPercent(-result.maxDrawdown, 1)}</td>
      <td className="num">{twd(-result.maxDrawdownTwd)}</td>
      <td className="nowrap">{result.troughMonth ?? '—'}</td>
      <td>
        <Bi {...recovery(result)} />
      </td>
      <td>{result.tiers.length === 0 ? '—' : result.tiers.map((fired) => `${Math.round(fired.tier * 100)}%`).join(', ')}</td>
    </tr>
  );
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th>
              <Bi en="Scenario" zh="情境" />
            </th>
            <th className="num">
              <Bi en="Deepest fall" zh="最大回撤" />
            </th>
            <th className="num">
              <Bi en={`of ${twd(total)}`} zh={`（${twd(total)} 的）`} />
            </th>
            <th>
              <Bi en="Trough" zh="谷底" />
            </th>
            <th>
              <Bi en="To recover" zh="回本" />
            </th>
            <th>
              <Bi en="F3 tiers fired" zh="觸發的 F3 級距" />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => line(row.scenario.id, { en: row.scenario.nameEn, zh: row.scenario.nameZh }, row.replay, `/stress?s=${row.scenario.id}`))}
          {line(CUSTOM, { en: 'Your own shock', zh: '自訂衝擊' }, custom, `/stress?s=${CUSTOM}`)}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ name, shown, isCustom, scenario, tiers, total, names }: { name: Bilingual; shown: Replay; isCustom: boolean; scenario: Scenario | undefined; tiers: readonly Tier[]; total: number; names: (id: string) => Bilingual }) {
  const stats: Array<{ label: Bilingual; value: string; note?: Bilingual }> = [
    { label: { en: 'Deepest fall', zh: '最大回撤' }, value: signedPercent(-shown.maxDrawdown, 1), note: { en: `Trough ${shown.troughMonth ?? '—'}`, zh: `谷底 ${shown.troughMonth ?? '—'}` } },
    { label: { en: 'In NT$', zh: '台幣金額' }, value: twd(-shown.maxDrawdownTwd), note: { en: `Of ${twd(total)} held today`, zh: `今天持有 ${twd(total)}` } },
    { label: { en: 'Months to recover', zh: '回本所需月數' }, value: shown.maxDrawdown === 0 ? '—' : shown.recoveryMonths === null ? '—' : String(shown.recoveryMonths), note: recovery(shown) },
    { label: { en: 'Value at the end', zh: '期末價值' }, value: twd(shown.endValue), note: { en: `${shown.months.length - 1} months`, zh: `${shown.months.length - 1} 個月` } },
  ];
  const points = shown.months.map((month) => ({ month: month.month, drawdown: month.drawdown, gauge: month.gaugeDrawdown }));
  const label: Bilingual = {
    en: `How far below its peak the portfolio is each month of ${name.en}: deepest ${signedPercent(-shown.maxDrawdown, 1)}${shown.troughMonth ? ` in ${shown.troughMonth}` : ''}. The table below lists the months.`,
    zh: `${name.zh}每個月投資組合低於高點的幅度：最深 ${signedPercent(-shown.maxDrawdown, 1)}${shown.troughMonth ? `（${shown.troughMonth}）` : ''}。下方表格列出各月。`,
  };
  return (
    <section className="card form" id="stress-detail">
      <h2>
        <Bi {...name} />
      </h2>
      {scenario && (
        <p className="muted small">
          <Bi en={`The months ${scenario.from} to ${addMonths(scenario.from, (scenario.returns[Object.keys(scenario.returns)[0] ?? '']?.length ?? 1) - 1)}, applied to today's holdings, held through with no trades.`} zh={`${scenario.from} 至 ${addMonths(scenario.from, (scenario.returns[Object.keys(scenario.returns)[0] ?? '']?.length ?? 1) - 1)} 的月份，套用在今天的持股上，一路持有、不交易。`} />
        </p>
      )}
      <div className="grid-cards">
        {stats.map((stat) => (
          <Stat key={stat.label.en} {...stat} />
        ))}
      </div>
      <UnderwaterChart points={points} tiers={isCustom ? [] : tiers.map((tier) => tier.drawdown)} label={label} />
      {shown.unmapped.length > 0 && (
        <p className="banner warn">
          <Bi en={`Held flat, as no scenario series is mapped to them: ${shown.unmapped.map((id) => names(id).en).join(', ')}.`} zh={`以下類別沒有對應的情境資料，視為持平：${shown.unmapped.map((id) => names(id).zh).join('、')}。`} />
        </p>
      )}
      {!isCustom && (
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="F3 tier" zh="F3 級距" />
                </th>
                <th>
                  <Bi en="Fires" zh="觸發" />
                </th>
                <th className="num">
                  <Bi en="Gauge fall then" zh="當時指標跌幅" />
                </th>
                <th>
                  <Bi en="Deploys" zh="投入" />
                </th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => {
                const fired = shown.tiers.find((entry) => Math.abs(entry.tier - tier.drawdown) < 1e-9);
                return (
                  <tr key={tier.drawdown}>
                    <td>{percent(tier.drawdown, 0)}</td>
                    <td className="nowrap">{fired ? fired.month : <Bi en="not reached" zh="未達到" />}</td>
                    <td className="num">{fired ? percent(fired.reached, 1) : '—'}</td>
                    <td>{tier.deploy.kind === 'share' ? <Bi en={`${percent(tier.deploy.share, 0)} of the remaining cash`} zh={`剩餘資金的 ${percent(tier.deploy.share, 0)}`} /> : <Bi en="The next tranche, merged into this one" zh="下一批提前併入本批" />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary>
          <Bi en="By asset class, and every month, as tables" zh="依資產類別與每個月，以表格顯示" />
        </summary>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi {...LABELS.assetClass} />
                </th>
                <th className="num">
                  <Bi en="Today" zh="今天" />
                </th>
                <th className="num">
                  <Bi en="At the end" zh="期末" />
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.byClass
                .filter((entry) => entry.start > 0)
                .map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <Bi {...names(entry.id)} />
                    </td>
                    <td className="num">{twd(entry.start)}</td>
                    <td className="num">{twd(entry.end)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="Month" zh="月份" />
                </th>
                <th className="num">
                  <Bi en="Value" zh="價值" />
                </th>
                <th className="num">
                  <Bi en="Below its peak" zh="低於高點" />
                </th>
                {!isCustom && (
                  <th className="num">
                    <Bi en="Gauge below its high" zh="指標低於高點" />
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.months.map((month) => (
                <tr key={month.month}>
                  <td className="nowrap">{month.month}</td>
                  <td className="num">{twd(month.value)}</td>
                  <td className="num">{signedPercent(-month.drawdown, 1)}</td>
                  {!isCustom && <td className="num">{percent(month.gaugeDrawdown === null ? null : -month.gaugeDrawdown, 1)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function CustomForm({ data, shocks, start, maxMonths }: { data: StressData; shocks: Record<string, number>; start: string; maxMonths: number }) {
  return (
    <section className="card form" id="custom">
      <h2>
        <Bi en="Make up a shock" zh="自訂衝擊" />
      </h2>
      <form method="get" action="/stress" className="form">
        <input type="hidden" name="s" value={CUSTOM} />
        <p className="muted small">
          <Bi
            en={`Each class's return in ${start}, in percent (−30 falls 30%). After that every class earns its expected return from your capital market assumptions until the portfolio is back where it started, up to ${maxMonths} months.`}
            zh={`各類別在 ${start} 的報酬，以百分比輸入（−30 代表下跌 30%）。之後各類別依你的資本市場假設的預期報酬成長，直到投資組合回到起點，最長 ${maxMonths} 個月。`}
          />
        </p>
        {data.classNames
          .filter((entry) => data.classes.some((held) => held.id === entry.id && held.valueTwd > 0))
          .map((entry) => (
            <label key={entry.id} className="field">
              <Bi en={entry.nameEn} zh={entry.nameZh} />
              <input name={`shock_${entry.id}`} inputMode="decimal" defaultValue={String(Number(((shocks[entry.id] ?? 0) * 100).toFixed(2)))} />
            </label>
          ))}
        <div className="row">
          <button type="submit" className="button primary">
            <Bi en="Replay" zh="重新計算" />
          </button>
        </div>
      </form>
    </section>
  );
}

function Mapping({ settings, names }: { settings: StressSettings; names: (id: string) => Bilingual }) {
  return (
    <section className="card">
      <details>
        <summary>
          <Bi en="What each class is replayed with" zh="各類別使用的情境資料" />
        </summary>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi {...LABELS.assetClass} />
                </th>
                <th>
                  <Bi en="Scenario series" zh="情境資料" />
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(settings.map).map(([classId, seriesId]) => {
                const series = settings.series.find((entry) => entry.id === seriesId);
                return (
                  <tr key={classId}>
                    <td>
                      <Bi {...names(classId)} />
                    </td>
                    <td>
                      <Bi en={series?.nameEn ?? seriesId} zh={series?.nameZh ?? seriesId} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          <Bi en={`Source: ${settings.source}. Change the mapping in Supabase's Table Editor (config stress).`} zh={`來源：${settings.source}。對應可在 Supabase 的 Table Editor 修改（config 的 stress）。`} />
        </p>
      </details>
    </section>
  );
}

function Method({ settings }: { settings: StressSettings }) {
  const notes: Bilingual[] = [
    {
      en: 'A scenario is a run of real months, each asset class moving with a long-history fund or index of its kind, in TWD (so the dollar’s move is in it). Your class’s own fund may not have existed then: US stocks are SPY, Taiwan stocks the TAIEX total return, bonds AGG, gold GLD and cash BIL.',
      zh: '情境是一段真實的月份，各資產類別依同類且歷史較長的基金或指數變動，以台幣計算（含美元匯率變動）。你持有的基金當時可能還不存在：美股用 SPY、台股用加權報酬指數、債券用 AGG、黃金用 GLD、現金用 BIL。',
    },
    {
      en: 'The replay holds today’s holdings through the months with no trades (buy-and-hold), so the mix drifts as it would have. A class with no series stays flat. The deepest fall is from the portfolio’s running peak, the start included; months to recover count from the trough until it is back at that peak, and are blank when the scenario ends first.',
      zh: '回放假設今天的持股一路持有、不交易（買進持有），所以比例會隨之偏離。沒有對應資料的類別視為持平。最大回撤以投資組合的歷史高點（含起點）起算；回本月數從谷底算到回到該高點，情境結束前未回本則留白。',
    },
    {
      en: `F3’s tiers are read on the ${settings.series.find((entry) => entry.id === settings.gauge)?.nameEn ?? 'gauge'} month-end closes, as ACWI’s history starts only in 2008: the fall from the high of the rule’s window fires each tier once, a deeper one counting the ones above it, and they reset at a new high. Which tranches that would have moved depends on a plan you did not have then, so only the tiers are shown.`,
      zh: `F3 級距以「${settings.series.find((entry) => entry.id === settings.gauge)?.nameZh ?? '指標'}」的月底收盤判斷（ACWI 的歷史只從 2008 年開始）：自規則期間高點的跌幅觸發各級距，每級距只觸發一次，較深的級距視為同時觸發較淺者，創新高後重置。實際會提前哪幾批取決於當時並不存在的計畫，因此只顯示級距。`,
    },
    {
      en: 'Your own shock is one month of returns you type, then each class earns its expected return ÷ 12 from the capital market assumptions until the portfolio regains its starting value. Nothing is saved.',
      zh: '自訂衝擊是你輸入的一個月報酬，之後各類別依資本市場假設的預期報酬 ÷ 12 成長，直到投資組合回到起始價值。不會儲存任何內容。',
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
