import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { CumulativeChart, MonthlyChart } from '@/components/performance-charts';
import { Stat } from '@/components/stat';
import { requireSession } from '@/lib/auth';
import { DataError, loadPerformanceInput } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { points, signedPercent, twd } from '@/lib/format';
import { LABELS, POOL, RETURN_SERIES as SERIES, type Bilingual } from '@/lib/i18n';
import {
  asReported,
  buildSeries,
  cumulativeReturns,
  holdingSplits,
  monthEnds,
  monthlyReturns,
  periodReturn,
  periodStart,
  periodTable,
  SCOPES,
  type CumulativePoint,
  type DayPoint,
  type HoldingSplit,
  type MonthReturn,
  type PerformanceInput,
  type Period,
  type PeriodReturn,
  type Scope,
} from '@/lib/models/performance';

type Params = Record<string, string | string[] | undefined>;

const SCOPE: Record<Scope, Bilingual> = {
  all: { en: 'Both pools', zh: '兩個資金池' },
  regular: POOL.regular,
  windfall: POOL.windfall,
};

/** The periods the charts can show; the table lists them all. */
const RANGES: readonly Period[] = ['all', 'ytd', '1y', '3y'];

const PERIOD: Record<Period, Bilingual> = {
  '1m': { en: '1 month', zh: '近 1 個月' },
  '3m': { en: '3 months', zh: '近 3 個月' },
  ytd: { en: 'Year to date', zh: '今年以來' },
  '1y': { en: '1 year', zh: '近 1 年' },
  '3y': { en: '3 years', zh: '近 3 年' },
  '5y': { en: '5 years', zh: '近 5 年' },
  all: { en: 'Since the start', zh: '開始至今' },
};

const PER_YEAR: Bilingual = { en: 'per year', zh: '年化' };

const NEW_TODAY: Record<Scope, Bilingual> = {
  all: { en: 'Everything was added today; the first return comes after the next close.', zh: '所有持有都是今天才加入，下一次收盤後才會有第一筆報酬。' },
  regular: { en: 'The regular pool’s holdings were added today; the first return comes after the next close.', zh: '一般投入資金池的持有今天才加入，下一次收盤後才會有第一筆報酬。' },
  windfall: { en: 'The windfall pool’s holdings were added today; the first return comes after the next close.', zh: '大額資金池的持有今天才加入，下一次收盤後才會有第一筆報酬。' },
};

const HELD_NOTHING: Record<Scope, Bilingual> = {
  all: { en: 'Nothing was held in this period, so there is no return to show.', zh: '這段期間沒有任何持有，因此沒有報酬可顯示。' },
  regular: { en: 'The regular pool held nothing in this period, so there is no return to show.', zh: '一般投入資金池在這段期間沒有任何持有，因此沒有報酬可顯示。' },
  windfall: { en: 'The windfall pool held nothing in this period, so there is no return to show.', zh: '大額資金池在這段期間沒有任何持有，因此沒有報酬可顯示。' },
};

function one(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function pick<T extends string>(value: string | undefined, choices: readonly T[], fallback: T): T {
  return choices.find((choice) => choice === value) ?? fallback;
}

export default async function PerformancePage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const scope = pick(one(params, 'scope'), SCOPES, 'all');
  const range = pick(one(params, 'range'), RANGES, 'all');
  const end = taipeiToday();
  let input: PerformanceInput;
  try {
    input = await loadPerformanceInput(supabase, end);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const days = buildSeries(input);

  return (
    <>
      <Header scope={scope} range={range} />
      {days.length === 0 ? <Empty /> : <Report input={input} days={days} scope={scope} range={range} end={end} />}
      <Method input={input} />
    </>
  );
}

function Header({ scope, range }: { scope: Scope; range: Period }) {
  const href = (next: { scope?: Scope; range?: Period }) => {
    const query = new URLSearchParams();
    const [nextScope, nextRange] = [next.scope ?? scope, next.range ?? range];
    if (nextScope !== 'all') query.set('scope', nextScope);
    if (nextRange !== 'all') query.set('range', nextRange);
    const text = query.toString();
    return text ? `/performance?${text}` : '/performance';
  };
  return (
    <section className="card form">
      <h1>
        <Bi {...LABELS.performance} />
      </h1>
      <p className="muted">
        <Bi
          en="Two measures, both in TWD. The time-weighted return (TWR) is how the holdings did, whenever money went in or out, and is set against the SAA benchmark. The money-weighted return (XIRR) is what your own timing earned."
          zh="兩種衡量方式，皆以台幣計算。時間加權報酬（TWR）衡量持股本身的表現，不受資金進出時點影響，並與 SAA 基準比較；資金加權報酬（XIRR）則反映你自己投入時點的實際成果。"
        />
      </p>
      <div className="filters">
        <div className="segmented" role="group" aria-label="Pool 資金池">
          <span className="label">
            <Bi {...LABELS.pool} />
          </span>
          {SCOPES.map((option) => (
            <Link key={option} href={href({ scope: option })} aria-current={option === scope ? 'true' : undefined}>
              <Bi {...SCOPE[option]} />
            </Link>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Period 期間">
          <span className="label">
            <Bi en="Period" zh="期間" />
          </span>
          {RANGES.map((option) => (
            <Link key={option} href={href({ range: option })} aria-current={option === range ? 'true' : undefined}>
              <Bi {...PERIOD[option]} />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Empty() {
  return (
    <section className="card">
      <p>
        <Bi en="Nothing to measure yet: performance starts with the first trade or non-listed asset." zh="尚無可計算的資料：績效從第一筆交易或非上市資產開始。" />{' '}
        <Link href="/holdings/new">
          <Bi {...LABELS.addTrade} />
        </Link>
      </p>
    </section>
  );
}

function Report({ input, days, scope, range, end }: { input: PerformanceInput; days: DayPoint[]; scope: Scope; range: Period; end: string }) {
  const first = days[0]?.date ?? end;
  const from = periodStart(range, end, first);
  const result = periodReturn(days, scope, from, end);
  if (result.twr === null) {
    return (
      <section className="card">
        <p>
          <Bi {...(result.endValue > 0 ? NEW_TODAY : HELD_NOTHING)[scope]} />
        </p>
      </section>
    );
  }
  const cumulative = cumulativeReturns(days, scope, from);
  const months = monthlyReturns(
    days.filter((day) => day.date > from),
    scope,
  );
  const trades = scope === 'all' ? input.trades : input.trades.filter((trade) => trade.pool === scope);
  return (
    <>
      <Headline result={result} from={from} />
      <section className="card form">
        <h2>
          <Bi en="Cumulative return against the SAA benchmark" zh="累積報酬與 SAA 基準" />
        </h2>
        <CumulativeChart
          points={cumulative}
          label={{
            en: `Line chart of the cumulative time-weighted return from ${result.from} to ${end}, against the SAA benchmark; the table below lists it month by month.`,
            zh: `${result.from} 至 ${end} 累積時間加權報酬與 SAA 基準的折線圖；下方表格逐月列出。`,
          }}
        />
        <details>
          <summary>
            <Bi en="Show as a table" zh="以表格顯示" />
          </summary>
          <CumulativeTable points={monthEnds(cumulative)} />
        </details>
      </section>
      {months.length > 0 && (
        <section className="card form">
          <h2>
            <Bi en="Each month’s return: local currency, currency and cross term" zh="每月報酬：當地幣別、匯率與交叉項" />
          </h2>
          <p className="muted small">
            <Bi
              en="Bars show where each month’s TWD return came from: the holdings in their own currency, the currencies against TWD, and the small cross term between them. The dot is the month’s TWD return."
              zh="長條顯示每月台幣報酬的來源：持股以其本身幣別計算的報酬、外幣對台幣的匯率變動，以及兩者之間很小的交叉項。圓點為當月台幣報酬。"
            />
          </p>
          <MonthlyChart
            months={months}
            label={{
              en: 'Stacked bar chart of each month’s return split into local-currency, currency and cross terms, with the TWD return as a dot; the table below lists the values.',
              zh: '每月報酬拆解為當地幣別、匯率與交叉項的堆疊長條圖，圓點為台幣報酬；下方表格列出數值。',
            }}
          />
          <details>
            <summary>
              <Bi en="Show as a table" zh="以表格顯示" />
            </summary>
            <MonthlyTable months={months} />
          </details>
        </section>
      )}
      <Periods days={days} scope={scope} end={end} />
      <Splits splits={holdingSplits({ ...input, trades }, from, end)} />
    </>
  );
}

function Headline({ result, from }: { result: PeriodReturn; from: string }) {
  const shown = asReported(result);
  const sinceFirstBuy = result.from > from;
  const difference = shown.twr !== null && shown.benchmark !== null ? shown.twr - shown.benchmark : null;
  return (
    <section className="card form">
      <p className="muted small">
        <Bi
          en={`From the close of ${result.from}${sinceFirstBuy ? ' (the first purchase)' : ''} to ${result.to}: ${result.days} days.`}
          zh={`自 ${result.from}${sinceFirstBuy ? '（第一筆買進）' : ''}收盤起至 ${result.to}，共 ${result.days} 天。`}
        />
      </p>
      <div className="grid-cards">
        <Stat
          label={{ en: 'Time-weighted return (TWR)', zh: '時間加權報酬（TWR）' }}
          value={signedPercent(shown.twr)}
          note={shown.perYear ? { en: `per year; ${signedPercent(result.twr)} in all`, zh: `年化；累計 ${signedPercent(result.twr)}` } : { en: 'over the period', zh: '期間報酬' }}
        />
        <Stat
          label={SERIES.benchmark}
          value={signedPercent(shown.benchmark)}
          note={
            difference === null
              ? { en: 'A benchmark ETF has no price for part of the period', zh: '部分期間缺少基準 ETF 的價格' }
              : { en: `Portfolio minus benchmark: ${points(difference)}`, zh: `組合減基準：${points(difference)}` }
          }
        />
        <Stat
          label={{ en: 'Money-weighted return (XIRR)', zh: '資金加權報酬（XIRR）' }}
          value={signedPercent(shown.moneyWeighted)}
          note={shown.perYear ? PER_YEAR : { en: 'over the period, not per year', zh: '期間報酬，未年化' }}
        />
        <Stat
          label={{ en: 'Gain, after money in and out', zh: '損益（扣除資金進出）' }}
          value={twd(result.gain)}
          note={{ en: `Worth ${twd(result.endValue)} at the close of ${result.to}`, zh: `${result.to} 收盤市值 ${twd(result.endValue)}` }}
        />
      </div>
      {result.estimated && (
        <p className="banner info">
          <Bi
            en="Part of this period is valued at a trade price or a hand-entered value, as the nightly job had no close or gold price for it yet."
            zh="這段期間部分數值以交易價格或手動估值計算，因為每夜排程當時尚無收盤價或金價。"
          />
        </p>
      )}
    </section>
  );
}

function CumulativeTable({ points: rows }: { points: readonly CumulativePoint[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>
              <Bi {...LABELS.flowDate} />
            </th>
            <th className="num">
              <Bi {...SERIES.portfolio} />
            </th>
            <th className="num">
              <Bi {...SERIES.benchmark} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((point) => (
            <tr key={point.date}>
              <td className="nowrap">{point.date}</td>
              <td className="num">{signedPercent(point.twr)}</td>
              <td className="num">{signedPercent(point.benchmark)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthlyTable({ months }: { months: readonly MonthReturn[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>
              <Bi en="Month" zh="月份" />
            </th>
            {[SERIES.total, SERIES.local, SERIES.currency, SERIES.cross, SERIES.benchmark].map((label) => (
              <th key={label.en} className="num">
                <Bi {...label} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.month}>
              <td className="nowrap">{month.month}</td>
              {[month.twr, month.local, month.currency, month.cross, month.benchmark].map((value, index) => (
                <td key={index} className="num">
                  {signedPercent(value, 2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Periods({ days, scope, end }: { days: readonly DayPoint[]; scope: Scope; end: string }) {
  const rows = periodTable(days, scope, end);
  return (
    <section className="card form">
      <h2>
        <Bi en="Returns by period" zh="各期間報酬" />
      </h2>
      <p className="muted small">
        <Bi en="A period of a year or more is shown per year; a shorter one as it was." zh="一年以上的期間以年化表示，未滿一年則為期間報酬。" />
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Bi en="Period" zh="期間" />
              </th>
              <th className="num">
                <Bi en="TWR" zh="時間加權" />
              </th>
              <th className="num">
                <Bi {...SERIES.benchmark} />
              </th>
              <th className="num">
                <Bi en="Difference" zh="差距" />
              </th>
              <th className="num">
                <Bi en="XIRR" zh="資金加權" />
              </th>
              <th className="num">
                <Bi en="Gain" zh="損益" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ period, result }) => {
              const shown = asReported(result);
              return (
                <tr key={period}>
                  <td className="nowrap">
                    <Bi {...PERIOD[period]} />
                    <div className="muted small">
                      {result.from} → {result.to}
                      {shown.perYear && (
                        <>
                          {' · '}
                          <Bi {...PER_YEAR} />
                        </>
                      )}
                    </div>
                  </td>
                  <td className="num">{signedPercent(shown.twr)}</td>
                  <td className="num">{signedPercent(shown.benchmark)}</td>
                  <td className="num">{shown.twr !== null && shown.benchmark !== null ? points(shown.twr - shown.benchmark) : '—'}</td>
                  <td className="num">{signedPercent(shown.moneyWeighted)}</td>
                  <td className="num">{twd(result.gain)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Splits({ splits }: { splits: readonly HoldingSplit[] }) {
  return (
    <section className="card form">
      <h2>
        <Bi en="FX split per foreign holding" zh="外幣持股的匯率拆解" />
      </h2>
      <p className="muted small">
        <Bi
          en="Each foreign security’s own return from the close shown under it (the period’s start, or its first purchase if later): TWD return = local-currency return + currency return + cross term."
          zh="各外幣證券自代號下方日期收盤起（期間起點，或較晚的第一筆買進日）本身的報酬：台幣報酬＝當地幣別報酬＋匯率報酬＋交叉項。"
        />
      </p>
      {splits.length === 0 ? (
        <p className="muted">
          <Bi en="No foreign security is held in this pool." zh="這個資金池沒有持有外幣證券。" />
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <Bi {...LABELS.ticker} />
                </th>
                {[SERIES.total, SERIES.local, SERIES.currency, SERIES.cross].map((label) => (
                  <th key={label.en} className="num">
                    <Bi {...label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {splits.map((split) => (
                <tr key={split.ticker}>
                  <td className="nowrap">
                    <strong>{split.ticker}</strong> <span className="muted small">{split.currency}</span>
                    <div className="muted small">
                      {split.from} → {split.to}
                    </div>
                  </td>
                  <td className="num">{signedPercent(split.twd, 2)}</td>
                  <td className="num">{signedPercent(split.split.local, 2)}</td>
                  <td className="num">{signedPercent(split.split.currency, 2)}</td>
                  <td className="num">{signedPercent(split.split.cross, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Method({ input }: { input: PerformanceInput }) {
  const composition = input.benchmark.map((proxy) => `${Math.round(proxy.weight * 100)}% ${proxy.ticker}`).join(', ');
  const notes: Bilingual[] = [
    {
      en: 'Time-weighted return: each day, every holding’s return in TWD with dividends reinvested, weighted by what it was worth at the previous close; the days are then chained. Money moving in or out does not change it.',
      zh: '時間加權報酬：每天以前一日收盤市值為權重，計算各持股含息再投入的台幣報酬，再把每天的報酬連乘。資金進出不會改變它。',
    },
    {
      en: 'A trade counts at that day’s close: the gap between the trade price and the close, and the fees and tax, show in the money-weighted return and the gain, not in the TWR.',
      zh: '交易以當日收盤價計入：成交價與收盤價的差距，以及手續費與稅，反映在資金加權報酬與損益中，而不在時間加權報酬。',
    },
    {
      en: 'Money-weighted return (XIRR): the yearly rate at which the money put in (buys, with fees and tax) and taken out (sales and recorded dividends) grows into today’s value, as a spreadsheet’s XIRR works it out.',
      zh: '資金加權報酬（XIRR）：讓投入的資金（買進，含手續費與稅）與取回的資金（賣出與已記錄的股利）成長為目前市值的年化報酬率，算法與試算表的 XIRR 相同。',
    },
    {
      en: 'Contributions and withdrawals recorded as cash flows are left out: money counts from the day it buys something or is entered as a non-listed asset, such as a savings balance.',
      zh: '記錄為現金流的投入與提領不計入：資金從買進持股、或登錄為非上市資產（例如存款餘額）的那天起才計入。',
    },
    {
      en: `SAA benchmark: the target weights, rebalanced daily, each class at its proxy ETF’s TWD return with dividends${composition ? `: ${composition}` : ''}.`,
      zh: `SAA 基準：目標權重每日再平衡，各類別以其代表 ETF 含息的台幣報酬計算${composition ? `：${composition}` : ''}。`,
    },
    {
      en: 'FX split: (1 + TWD return) = (1 + local-currency return) × (1 + currency return), so the cross term is the two multiplied. Physical gold is priced in US dollars, so the dollar’s move counts as currency.',
      zh: '匯率拆解：(1＋台幣報酬)＝(1＋當地幣別報酬)×(1＋匯率報酬)，交叉項即兩者相乘。實體黃金以美元計價，美元的變動計入匯率報酬。',
    },
    {
      en: 'Non-listed assets: gold at each day’s gold price (before the nightly job saved one, moved back by GLDM in TWD). A savings balance earns 0% here: its interest arrives as an edit to the balance, which counts as money put in. Past quantities come from the edit history.',
      zh: '非上市資產：黃金以每日金價計算（每夜排程開始存金價之前，以 GLDM 的台幣報酬回推）。存款在此報酬為 0%：利息以修改餘額記入，視為投入資金。過去的數量取自修改紀錄。',
    },
    {
      en: 'The nightly job also saves each day’s value as a NAV snapshot for later features. This page works from the trades directly, so an edit shows at once.',
      zh: '每夜排程也會把每天的市值存為淨值快照，供之後的功能使用。本頁直接由交易計算，修改後立即反映。',
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
