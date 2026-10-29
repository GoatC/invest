import Link from 'next/link';

import { Bi, Zh } from '@/components/bi';
import { CumulativeChart, QuadrantChart, WaterfallChart, type QuadrantPoint, type WaterfallStep } from '@/components/attribution-charts';
import { DataProblem } from '@/components/data-problem';
import { Info } from '@/components/info';
import { Stat } from '@/components/stat';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadAttributionData, type AttributionData } from '@/lib/data';
import { addMonths, taipeiToday } from '@/lib/dates';
import { percent, signedPercent } from '@/lib/format';
import { EFFECT, LABELS, type Bilingual } from '@/lib/i18n';
import { SECTOR } from '@/lib/look-through-text';
import { brinson, cumulative, link, monthInputs, sectorInputs, waterfall, type Effects, type MonthInput } from '@/lib/models/attribution';
import { MarketHistory } from '@/lib/models/market';
import { buildSeries } from '@/lib/models/performance';

type Params = Record<string, string | string[] | undefined>;

const RANGES = ['all', '12m', 'ytd', '3m'] as const;
type Range = (typeof RANGES)[number];
const RANGE: Record<Range, Bilingual> = {
  all: { en: 'Since the start', zh: '自開始' },
  '12m': { en: 'Last 12 months', zh: '近 12 個月' },
  ytd: { en: 'Year to date', zh: '今年以來' },
  '3m': { en: 'Last 3 months', zh: '近 3 個月' },
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The first month of a range, given the newest complete month. */
function rangeStart(range: Range, newest: string): string {
  if (range === 'ytd') return `${newest.slice(0, 4)}-01`;
  if (range === '12m') return addMonths(newest, -11);
  if (range === '3m') return addMonths(newest, -2);
  return '0000-00';
}

/** N2: why the regular pool's return differed from the SAA benchmark's, by asset class and, for the satellite, by sector. */
export default async function AttributionPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  const range = (RANGES as readonly string[]).includes(first(params['range']) ?? '') ? (first(params['range']) as Range) : 'all';
  const level = first(params['level']) === '2' ? 2 : 1;
  let data: AttributionData;
  let names: Awaited<ReturnType<typeof loadAssetClasses>>;
  try {
    [data, names] = await Promise.all([loadAttributionData(supabase, today), loadAssetClasses(supabase)]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const days = buildSeries(data.input);
  const market = new MarketHistory([...data.input.prices, ...data.sectorPrices], data.input.rates);
  const all = monthInputs(days, market, data.classes).filter((month) => month.complete);
  const newest = all[all.length - 1]?.month ?? '';
  const chosen = all.filter((month) => month.month >= rangeStart(range, newest));
  const level2 = sectorInputs(chosen, days, market, data.stocks, data.sectorBenchmark);
  const months: MonthInput[] = level === 1 ? chosen : level2;
  const label = (id: string): Bilingual => {
    if (level === 2) return SECTOR[id as keyof typeof SECTOR] ?? { en: id, zh: id };
    const found = names.find((entry) => entry.id === id);
    return { en: found?.nameEn ?? id, zh: found?.nameZh ?? id };
  };

  return (
    <>
      <section className="card form">
        <h1>
          <Zh {...LABELS.attribution} />
        </h1>
        <Info>
          <Bi
            en="Why did the portfolio earn more or less than the benchmark set by your targets? Allocation: did holding more or less of a class than the target help? Selection: did the funds you chose beat the class's benchmark ETF? Interaction: the two together. Currency: the part due to the dollar's move against TWD. They add up to the portfolio's return less the benchmark's, month by month and linked over the period. Level 2 looks inside the satellite: its stocks by sector against the sector weights of the core global-equity ETF."
            zh="投資組合為什麼比你的目標所訂的基準賺得更多或更少？配置效果：持有比目標更多或更少的某類別是否有幫助？選擇效果：你選的基金是否勝過該類別的基準 ETF？交互效果：兩者合併的影響。匯率效果：因美元對台幣變動而來的部分。它們加起來等於投資組合報酬減去基準報酬，逐月計算並連結整個期間。第二層看衛星部位內部：個股依產業，對照核心全球股票 ETF 的產業權重。"
          />
        </Info>
        <div className="filters">
          <div className="segmented" role="group" aria-label="Level 層級">
            <span className="label">
              <Bi en="Level" zh="層級" />
            </span>
            <Link href={`/attribution?range=${range}`} aria-current={level === 1 ? 'true' : undefined}>
              <Bi en="1 · Asset classes" zh="1・資產類別" />
            </Link>
            <Link href={`/attribution?range=${range}&level=2`} aria-current={level === 2 ? 'true' : undefined}>
              <Bi en="2 · Satellite by sector" zh="2・衛星依產業" />
            </Link>
          </div>
          <div className="segmented" role="group" aria-label="Period 期間">
            <span className="label">
              <Bi en="Period" zh="期間" />
            </span>
            {RANGES.map((option) => (
              <Link key={option} href={`/attribution?range=${option}${level === 2 ? '&level=2' : ''}`} aria-current={option === range ? 'true' : undefined}>
                <Bi {...RANGE[option]} />
              </Link>
            ))}
          </div>
        </div>
        {all.length === 0 && (
          <p className="muted">
            <Bi en="No complete month with holdings yet: the first month is a baseline, and the attribution starts with the second." zh="尚無持有部位的完整月份：第一個月是基準，歸因從第二個月開始。" />
          </p>
        )}
        {all.length > 0 && level === 2 && <Level2Note data={data} />}
      </section>
      {months.length > 0 && <Report months={months} label={label} level={level} />}
      {all.length > 0 && level === 1 && <Reconcile months={months} />}
      <Method />
    </>
  );
}

function Level2Note({ data }: { data: AttributionData }) {
  if (data.sectorBenchmark.length === 0) {
    return (
      <p className="banner warn">
        <Bi
          en="Level 2 needs the core equity fund's holdings file (the look-through's, read monthly by the nightly job) and the sector funds' closes (the Sectors tab's)."
          zh="第二層需要核心股票基金的成分股檔（合併透視的，由每夜排程每月讀取）與產業基金的收盤價（產業熱圖分頁的）。"
        />
      </p>
    );
  }
  if (data.stocks.length === 0) {
    return (
      <p className="muted">
        <Bi en="No satellite single stock is held yet." zh="尚未持有衛星個股。" />
      </p>
    );
  }
  return (
    <p className="muted small">
      <Bi
        en={`Benchmark: the sector weights of ${data.coreFund?.ticker ?? 'the core equity fund'} (file of ${data.coreFund?.asOf ?? '—'}), each sector priced by its Select Sector SPDR fund (price return, in TWD); the stocks are held through each month as they stood at its start.`}
        zh={`基準：${data.coreFund?.ticker ?? '核心股票基金'} 的產業權重（${data.coreFund?.asOf ?? '—'} 的檔案），各產業以對應的 Select Sector SPDR 基金（價格報酬，台幣計）衡量；個股以月初的持有狀態持有整個月。`}
      />
    </p>
  );
}

function Report({ months, label, level }: { months: MonthInput[]; label: (id: string) => Bilingual; level: 1 | 2 }) {
  const results = months.map((month) => ({ month: month.month, ...brinson(month.segments) }));
  const linked = link(results);
  if (!linked) return null;
  const total = linked.total;
  const active = linked.rp - linked.rb;
  const effects = ['allocation', 'selection', 'interaction', 'currency'] as const;
  const steps: WaterfallStep[] = waterfall(linked).map((step) => ({
    label: step.step === 'benchmark' ? { en: 'Benchmark', zh: '基準' } : step.step === 'portfolio' ? { en: level === 2 ? 'Satellite' : 'Portfolio', zh: level === 2 ? '衛星' : '投資組合' } : EFFECT[step.step],
    value: step.value,
    level: step.level,
    kind: step.step === 'benchmark' || step.step === 'portfolio' ? 'total' : 'effect',
  }));
  const bySegment = linked.segments.map((row) => ({ ...row, sum: row.allocation + row.selection + row.interaction + row.currency }));

  // The quadrant: average active weight and the class's benchmark return less the benchmark's, over the period.
  const ids = bySegment.map((row) => row.id);
  const quadrant: QuadrantPoint[] = ids.map((id) => {
    const compounded = months.reduce((acc, month) => acc * (1 + (month.segments.find((segment) => segment.id === id)?.rbTwd ?? 0)), 1) - 1;
    return {
      name: `${label(id).en} ${label(id).zh}`,
      active: results.reduce((sum, result) => sum + (result.segments.find((segment) => segment.id === id)?.active ?? 0), 0) / results.length,
      relative: compounded - linked.rb,
      effect: bySegment.find((row) => row.id === id)?.sum ?? 0,
    };
  });
  const cumulativeRows = cumulative(results);
  const first = months[0];
  const last = months[months.length - 1];
  const waterLabel: Bilingual = {
    en: `From the benchmark's ${percent(linked.rb, 2)} to the ${level === 2 ? 'satellite' : 'portfolio'}'s ${percent(linked.rp, 2)}: allocation ${signedPercent(total.allocation, 2)}, selection ${signedPercent(total.selection, 2)}, interaction ${signedPercent(total.interaction, 2)}, currency ${signedPercent(total.currency, 2)}.`,
    zh: `從基準的 ${percent(linked.rb, 2)} 到${level === 2 ? '衛星' : '投資組合'}的 ${percent(linked.rp, 2)}：配置 ${signedPercent(total.allocation, 2)}、選擇 ${signedPercent(total.selection, 2)}、交互 ${signedPercent(total.interaction, 2)}、匯率 ${signedPercent(total.currency, 2)}。`,
  };
  const stats: Array<{ label: Bilingual; value: string; note?: Bilingual }> = [
    { label: { en: level === 2 ? 'Satellite return' : 'Portfolio return', zh: level === 2 ? '衛星報酬' : '投資組合報酬' }, value: percent(linked.rp, 2), note: { en: `${first?.from} to ${last?.to}, ${months.length} months, in TWD`, zh: `${first?.from} 至 ${last?.to}，${months.length} 個月，台幣計` } },
    { label: { en: 'Benchmark return', zh: '基準報酬' }, value: percent(linked.rb, 2), note: level === 2 ? { en: 'Core equity fund’s sector weights', zh: '核心股票基金的產業權重' } : { en: 'Your targets, each class by its benchmark ETF', zh: '你的目標權重，各類別以其基準 ETF 計算' } },
    { label: { en: active >= 0 ? 'Ahead of the benchmark' : 'Behind the benchmark', zh: active >= 0 ? '超越基準' : '落後基準' }, value: signedPercent(active, 2), note: { en: 'Linked over the months (Carino)', zh: '逐月以 Carino 法連結' } },
    ...effects.map((key) => ({ label: EFFECT[key], value: signedPercent(total[key], 2) })),
  ];
  return (
    <>
      <section className="card form">
        <div className="grid-cards">
          {stats.map((stat) => (
            <Stat key={stat.label.en} {...stat} />
          ))}
        </div>
        <WaterfallChart steps={steps} label={waterLabel} />
      </section>
      <section className="card form">
        <h2>
          <Bi en={level === 2 ? 'By sector' : 'By asset class'} zh={level === 2 ? '依產業' : '依資產類別'} />
        </h2>
        <EffectTable rows={bySegment} label={label} total={total} />
        <h3>
          <Bi en="Was the weight worth it?" zh="加減碼值得嗎？" />
        </h3>
        <QuadrantChart points={quadrant} label={{ en: 'Each segment: its average active weight across, how its benchmark did against the whole benchmark up.', zh: '各區塊：橫軸為平均主動權重，縱軸為其基準相對整體基準的報酬。' }} />
        <h3>
          <Bi en="Which effect drives the result" zh="哪個效果主導績效" />
        </h3>
        <CumulativeChart rows={cumulativeRows} label={{ en: 'Each effect, linked from the first month to each month.', zh: '各效果自第一個月到每個月的連結累計。' }} />
        <details>
          <summary>
            <Bi en="Month by month, as a table" zh="逐月，以表格顯示" />
          </summary>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>
                    <Bi en="Month" zh="月份" />
                  </th>
                  <th className="num">
                    <Bi en="Return" zh="報酬" />
                  </th>
                  <th className="num">
                    <Bi en="Benchmark" zh="基準" />
                  </th>
                  {effects.map((key) => (
                    <th key={key} className="num">
                      <Bi {...EFFECT[key]} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.month}>
                    <td className="nowrap">{result.month}</td>
                    <td className="num">{percent(result.rp, 2)}</td>
                    <td className="num">{percent(result.rb, 2)}</td>
                    {effects.map((key) => (
                      <td key={key} className="num">
                        {signedPercent(result.total[key], 2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  );
}

function EffectTable({ rows, label, total }: { rows: ReadonlyArray<Effects & { id: string; sum: number }>; label: (id: string) => Bilingual; total: Effects }) {
  const effects = ['allocation', 'selection', 'interaction', 'currency'] as const;
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th>
              <Bi en="Segment" zh="區塊" />
            </th>
            {effects.map((key) => (
              <th key={key} className="num">
                <Bi {...EFFECT[key]} />
              </th>
            ))}
            <th className="num">
              <Bi en="Total" zh="合計" />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Bi {...label(row.id)} />
              </td>
              {effects.map((key) => (
                <td key={key} className="num">
                  {signedPercent(row[key], 2)}
                </td>
              ))}
              <td className="num">{signedPercent(row.sum, 2)}</td>
            </tr>
          ))}
          <tr>
            <td>
              <strong>
                <Bi en="All" zh="全部" />
              </strong>
            </td>
            {effects.map((key) => (
              <td key={key} className="num">
                <strong>{signedPercent(total[key], 2)}</strong>
              </td>
            ))}
            <td className="num">
              <strong>{signedPercent(total.allocation + total.selection + total.interaction + total.currency, 2)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** The attribution's portfolio return against the performance page's: they differ by what happened inside each month. */
function Reconcile({ months }: { months: MonthInput[] }) {
  const rows = months.map((month) => ({ month: month.month, brinson: brinson(month.segments).rp, twr: month.twr }));
  const linkedBrinson = rows.reduce((acc, row) => acc * (1 + row.brinson), 1) - 1;
  const linkedTwr = rows.every((row) => row.twr !== null) ? rows.reduce((acc, row) => acc * (1 + (row.twr as number)), 1) - 1 : null;
  if (rows.length === 0) return null;
  return (
    <section className="card">
      <p className="muted small">
        <Bi
          en={`Against the Performance page: this period's return from the start-of-month weights is ${percent(linkedBrinson, 2)}; the regular pool's time-weighted return is ${percent(linkedTwr, 2)}. The difference is what happened inside the months: weights drifting, contributions and trades.`}
          zh={`與績效頁對照：依月初權重計算的期間報酬為 ${percent(linkedBrinson, 2)}；一般投入資金池的時間加權報酬為 ${percent(linkedTwr, 2)}。差異來自月內的變化：權重漂移、投入與交易。`}
        />
      </p>
    </section>
  );
}

function Method() {
  const notes: Bilingual[] = [
    {
      en: 'Brinson–Fachler, per class and month, with the weights at the start of the month: allocation = (wp − wb) × (the class benchmark’s return − the whole benchmark’s); selection = wb × (your return in the class − its benchmark’s); interaction = (wp − wb) × (your return − its benchmark’s). The benchmark is your SAA target weights, each class measured by its benchmark ETF (the same proxies as the VaR and the performance page).',
      zh: 'Brinson–Fachler 法，逐類別逐月，採月初權重：配置效果 = (wp − wb) ×（類別基準報酬 − 整體基準報酬）；選擇效果 = wb ×（你在該類別的報酬 − 其基準報酬）；交互效果 = (wp − wb) ×（你的報酬 − 其基準報酬）。基準為你的 SAA 目標權重，各類別以其基準 ETF 衡量（與風險值、績效頁相同的代理指標）。',
    },
    {
      en: 'Currency is shown on its own: the three effects are worked out on returns in each holding’s own currency, and currency is what is left to the return in TWD (your foreign holdings’ currency move less the benchmark’s). All four add up to the portfolio’s return less the benchmark’s, in TWD. A class you hold nothing of has no selection, only its underweight.',
      zh: '匯率效果另列：前三項以各持股自己幣別的報酬計算，匯率效果是台幣報酬扣除後所剩的部分（你的外幣持股的匯率變動減去基準的）。四項加總為台幣計的投資組合報酬減基準報酬。完全沒持有的類別沒有選擇效果，只有低配。',
    },
    {
      en: 'Several months are linked with Carino’s smoothing so the monthly effects add up to the period’s total. The first month of the series is the baseline; only complete months count. The regular pool only: the windfall has no benchmark of its own.',
      zh: '多個月份以 Carino 平滑法連結，使各月效果加總等於期間總效果。資料的第一個月為基準月；只計算完整月份。僅一般投入資金池：大額資金沒有自己的基準。',
    },
    {
      en: 'Level 2 treats the satellite’s single stocks as the portfolio and the sector weights of the core global-equity ETF as the benchmark, each sector priced by its Select Sector SPDR fund (a price return), so the benchmark still comes from the SAA itself. The stocks are held through each month as they stood at its start. The sector funds’ closes cover about a year.',
      zh: '第二層以衛星的個股為投資組合、核心全球股票 ETF 的產業權重為基準，各產業以對應的 Select Sector SPDR 基金（價格報酬）衡量，使基準仍來自 SAA 本身。個股以月初的持有狀態持有整個月。產業基金的收盤價約涵蓋一年。',
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
