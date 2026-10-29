import Link from 'next/link';

import { Bi, Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { BetaRanges, RollingBeta, ScatterFit, type Line, type Range } from '@/components/regression-charts';
import { requireSession } from '@/lib/auth';
import { DataError, loadRegressionData, loadRegressionSetup, loadSavedBetas, type RegressionData, type SecurityRecord } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { percent, signedPercent } from '@/lib/format';
import { bi, LABELS, type Bilingual } from '@/lib/i18n';
import { FREQUENCIES, loadFrom, regressTicker, type Benchmark, type Choice, type CurrencyBasis, type Frequency, type Regression, type RegressionOutcome, type RegressionSettings } from '@/lib/models/regression';

import { RegressionSettingsForm, type SettingsField } from './forms';

type Params = Record<string, string | string[] | undefined>;

const FREQ: Record<Frequency, Bilingual> = {
  daily: { en: 'Daily', zh: '日' },
  weekly: { en: 'Weekly', zh: '週' },
  monthly: { en: 'Monthly', zh: '月' },
};
const BASIS: Record<CurrencyBasis, Bilingual> = {
  local: { en: 'Local currency', zh: '當地幣別' },
  TWD: { en: 'TWD', zh: '台幣' },
};
const PROBLEM: Record<'fx' | 'observations' | 'collinear', (n: number) => Bilingual> = {
  fx: () => ({ en: 'No exchange rate to put it in TWD.', zh: '沒有匯率可換算台幣。' }),
  observations: (n) => ({ en: `Only ${n} periods with both prices: too few.`, zh: `兩者都有價格的期間只有 ${n} 期，太少。` }),
  collinear: () => ({ en: 'The market did not move in this window.', zh: '這段期間大盤沒有變動。' }),
};

function one(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

const beta = (value: number) => value.toFixed(2);
const name = (benchmark: Benchmark): Bilingual => ({ en: benchmark.nameEn, zh: benchmark.nameZh });

/** N1 Regression Lab (PRD Module C): a ticker's β against the S&P 500 and TAIEX, side by side. */
export default async function RegressionPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: RegressionData;
  let saved: Awaited<ReturnType<typeof loadSavedBetas>>;
  let settings: RegressionSettings;
  let choice: Choice;
  let ticker: string;
  let compare: string[];
  let against: Benchmark;
  try {
    const setup = await loadRegressionSetup(supabase);
    if (!setup.settings) return <DataProblem table="config" detail="regression is missing or malformed" />;
    settings = setup.settings;
    saved = await loadSavedBetas(supabase);
    const priced = setup.securities.filter((security) => setup.priced.has(security.ticker));
    const pricedTickers = new Set(priced.map((security) => security.ticker));
    const freq = FREQUENCIES.find((option) => option === one(params, 'f')) ?? settings.defaults.freq;
    const years = settings.windows.find((option) => String(option) === one(params, 'y')) ?? settings.defaults.years;
    const basis: CurrencyBasis = one(params, 'c') === 'TWD' ? 'TWD' : one(params, 'c') === 'local' ? 'local' : settings.defaults.currency;
    choice = { freq, years, basis };
    const requested = one(params, 't')?.toUpperCase();
    ticker = requested && pricedTickers.has(requested) ? requested : pricedTickers.has('VT') ? 'VT' : (priced[0]?.ticker ?? '');
    const fromSaved = [...new Set(saved.map((row) => row.ticker))];
    // The compare form sends one vs per box ticked; a link carries them as one comma list.
    const raw = params['vs'];
    const listed = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((value) => value.split(',')).map((value) => value.trim().toUpperCase()))].filter((value) => pricedTickers.has(value));
    compare = (listed.length > 0 ? listed : fromSaved.length > 0 ? fromSaved : [ticker]).filter((value) => pricedTickers.has(value)).slice(0, settings.compareMax);
    against = settings.benchmarks.find((benchmark) => benchmark.id === one(params, 'b')) ?? (settings.benchmarks[0] as Benchmark);
    data = await loadRegressionData(supabase, [ticker, ...compare], loadFrom(today, years, settings.rollingWeeks), setup);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const securities = new Map(data.securities.map((security) => [security.ticker, security]));
  const security = securities.get(ticker);
  const results = security ? settings.benchmarks.map((benchmark) => ({ benchmark, outcome: regressTicker(data, security, benchmark, choice, settings) })) : [];
  const href = (next: Partial<Record<'t' | 'f' | 'y' | 'c' | 'vs' | 'b', string>>, anchor = '') => {
    const query = new URLSearchParams({ t: ticker, f: choice.freq, y: String(choice.years), c: choice.basis, vs: compare.join(','), b: against.id, ...next });
    return `/regression?${query.toString()}${anchor}`;
  };
  const saveMessage = one(params, 'saved') === 'settings' ? { en: 'Settings saved.', zh: '已儲存設定。' } : undefined;

  return (
    <>
      <section className="card form">
        <div className="row spread">
          <h1>
            <Zh {...LABELS.regression} />
          </h1>
          <Link href="/regression/factors">
            <Bi en="Five-factor mode" zh="五因子模式" />
          </Link>
        </div>
        <p className="equation">
          R<sub>i</sub> − R<sub>f</sub> = α + β (R<sub>m</sub> − R<sub>f</sub>) + ε
        </p>
        <form method="get" action="/regression" className="row wrap">
          <label className="field">
            <Bi {...LABELS.ticker} />
            <select name="t" defaultValue={ticker}>
              {data.securities
                .filter((option) => data.priced.has(option.ticker))
                .map((option) => (
                  <option key={option.ticker} value={option.ticker}>
                    {option.ticker} · {option.name}
                  </option>
                ))}
            </select>
          </label>
          <input type="hidden" name="f" value={choice.freq} />
          <input type="hidden" name="y" value={choice.years} />
          <input type="hidden" name="c" value={choice.basis} />
          <input type="hidden" name="vs" value={compare.join(',')} />
          <input type="hidden" name="b" value={against.id} />
          <button type="submit" className="button">
            <Bi en="Show" zh="顯示" />
          </button>
        </form>
        <div className="filters">
          <Segmented label={{ en: 'Returns', zh: '報酬' }} options={FREQUENCIES.map((option) => ({ key: option, label: FREQ[option], href: href({ f: option }) }))} current={choice.freq} />
          <Segmented
            label={{ en: 'Window', zh: '期間' }}
            options={settings.windows.map((option) => ({ key: String(option), label: { en: `${option}y`, zh: `${option} 年` }, href: href({ y: String(option) }) }))}
            current={String(choice.years)}
          />
          <Segmented label={{ en: 'Currency', zh: '幣別' }} options={(['local', 'TWD'] as const).map((option) => ({ key: option, label: BASIS[option], href: href({ c: option }) }))} current={choice.basis} />
        </div>
      </section>

      <div className="grid-two">
        {results.map(({ benchmark, outcome }, index) => (
          <Panel key={benchmark.id} ticker={ticker} benchmark={benchmark} outcome={outcome} colorIndex={index} />
        ))}
      </div>

      {results.some(({ outcome }) => outcome.ok && outcome.result.rolling.length > 1) && (
        <section className="card form" id="rolling">
          <h2>
            <Bi en={`${ticker}: β over a rolling ${settings.rollingWeeks} weeks`} zh={`${ticker}：滾動 ${settings.rollingWeeks} 週 β`} />
          </h2>
          <RollingBeta
            lines={results.flatMap(({ benchmark, outcome }): Line[] => (outcome.ok ? [{ label: { en: `vs ${benchmark.nameEn}`, zh: `對${benchmark.nameZh}` }, points: outcome.result.rolling }] : []))}
            label={{ en: `${ticker}'s rolling β`, zh: `${ticker} 的滾動 β` }}
          />
        </section>
      )}

      <Compare data={data} settings={settings} ticker={ticker} choice={choice} compare={compare} against={against} securities={securities} />

      {saved.length > 0 && <Saved saved={saved} settings={settings} />}

      <section className="card form" id="settings">
        <details>
          <summary>
            <Bi en="Settings and method" zh="設定與計算方式" />
          </summary>
          {saveMessage && (
            <p className="banner ok" role="status">
              <Bi {...saveMessage} />
            </p>
          )}
          <Method settings={settings} data={data} />
          <RegressionSettingsForm
            fields={settingsFields(settings)}
            initial={{
              freq: settings.defaults.freq,
              windowYears: String(settings.defaults.years),
              currency: settings.defaults.currency,
              blumeWeight: String(settings.blume.weight),
              rfTWD: String(Number(((settings.riskFree['TWD'] ?? 0) * 100).toFixed(4))),
              rfUSD: String(Number(((settings.riskFree['USD'] ?? 0) * 100).toFixed(4))),
            }}
            windows={settings.windows}
            today={today}
            checkedOn={settings.riskFreeChecked}
          />
        </details>
      </section>
    </>
  );
}

function Segmented({ label, options, current }: { label: Bilingual; options: ReadonlyArray<{ key: string; label: Bilingual; href: string }>; current: string }) {
  return (
    <div className="segmented" role="group" aria-label={bi(label)}>
      <span className="label">
        <Bi {...label} />
      </span>
      {options.map((option) => (
        <Link key={option.key} href={option.href} aria-current={option.key === current ? 'true' : undefined}>
          <Bi {...option.label} />
        </Link>
      ))}
    </div>
  );
}

/** One benchmark: the scatter with its fit, then the figures. */
function Panel({ ticker, benchmark, outcome, colorIndex }: { ticker: string; benchmark: Benchmark; outcome: RegressionOutcome; colorIndex: number }) {
  return (
    <section className="card form" id={`vs-${benchmark.id}`}>
      <h2>
        <Bi en={`vs ${benchmark.nameEn}`} zh={`對${benchmark.nameZh}`} />
      </h2>
      {outcome.ok ? (
        <>
          <ScatterFit
            points={outcome.result.points}
            alpha={outcome.result.alpha}
            slope={outcome.result.beta}
            axis={{ x: { en: `${benchmark.nameEn} excess`, zh: `${benchmark.nameZh}超額報酬` }, y: { en: `${ticker} excess`, zh: `${ticker} 超額報酬` } }}
            label={{ en: `${ticker} against ${benchmark.nameEn}, each period`, zh: `${ticker} 對${benchmark.nameZh}的每期報酬` }}
            colorIndex={colorIndex}
          />
          <Figures result={outcome.result} />
        </>
      ) : (
        <p className="muted">
          <Bi {...PROBLEM[outcome.problem](outcome.n)} />
        </p>
      )}
    </section>
  );
}

function Figures({ result }: { result: Regression }) {
  const rows: Array<[Bilingual, string]> = [
    [{ en: 'β', zh: 'β' }, `${beta(result.beta)} ± ${beta(result.stdErr)}`],
    [{ en: '95% interval', zh: '95% 信賴區間' }, `${beta(result.ci[0])} … ${beta(result.ci[1])}`],
    [{ en: 'Adjusted β (Blume)', zh: '調整後 β（Blume）' }, beta(result.adjusted)],
    [{ en: 'α a year', zh: '年化 α' }, signedPercent(result.alphaAnnual)],
    [{ en: 'R²', zh: 'R²' }, percent(result.r2, 0)],
    [{ en: 'Periods', zh: '期數' }, String(result.n)],
    [{ en: 'From', zh: '期間' }, `${result.from} → ${result.to}`],
  ];
  return (
    <>
      <div className="table-wrap">
        <table className="compact figures">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label.en}>
                <th scope="row">
                  <Bi {...label} />
                </th>
                <td className="num">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.adjacent !== 'none' && (
        <p className="muted small">
          <Bi
            en={`Dimson β: ${beta(result.slopes[0] ?? 0)} same day + ${beta(result.slopes[1] ?? 0)} ${result.adjacent === 'previous' ? 'day before' : 'day after'} (time zones).`}
            zh={`Dimson β：當日 ${beta(result.slopes[0] ?? 0)} ＋ ${result.adjacent === 'previous' ? '前一日' : '後一日'} ${beta(result.slopes[1] ?? 0)}（時差修正）。`}
          />
        </p>
      )}
    </>
  );
}

/** Up to compare_max tickers against one benchmark: β with its interval, and their rolling β. */
function Compare({
  data,
  settings,
  ticker: shown,
  choice,
  compare,
  against,
  securities,
}: {
  data: RegressionData;
  settings: RegressionSettings;
  ticker: string;
  choice: Choice;
  compare: readonly string[];
  against: Benchmark;
  securities: ReadonlyMap<string, SecurityRecord>;
}) {
  const results = compare.flatMap((ticker) => {
    const security = securities.get(ticker);
    if (!security) return [];
    const outcome = regressTicker(data, security, against, choice, settings);
    return outcome.ok ? [{ ticker, result: outcome.result }] : [];
  });
  const ranges: Range[] = results.map(({ ticker, result }) => ({ ticker, beta: result.beta, low: result.ci[0], high: result.ci[1] }));
  return (
    <section className="card form" id="compare">
      <h2>
        <Bi en={`Compare up to ${settings.compareMax}`} zh={`比較（最多 ${settings.compareMax} 檔）`} />
      </h2>
      <form method="get" action="/regression#compare" className="form">
        <input type="hidden" name="t" value={shown} />
        <input type="hidden" name="f" value={choice.freq} />
        <input type="hidden" name="y" value={choice.years} />
        <input type="hidden" name="c" value={choice.basis} />
        <fieldset className="checks">
          {data.securities
            .filter((security) => data.priced.has(security.ticker))
            .map((security) => (
              <label key={security.ticker} className="choice">
                <input type="checkbox" name="vs" value={security.ticker} defaultChecked={compare.includes(security.ticker)} />
                {security.ticker}
              </label>
            ))}
        </fieldset>
        <div className="row wrap">
          <label className="field">
            <Bi en="Against" zh="基準" />
            <select name="b" defaultValue={against.id}>
              {settings.benchmarks.map((benchmark) => (
                <option key={benchmark.id} value={benchmark.id}>
                  {bi(name(benchmark))}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button">
            <Bi en="Compare" zh="比較" />
          </button>
        </div>
      </form>
      {results.length > 0 && (
        <>
          <BetaRanges rows={ranges} label={{ en: `β against ${against.nameEn} with the 95% interval`, zh: `對${against.nameZh}的 β 與 95% 信賴區間` }} />
          {results.some(({ result }) => result.rolling.length > 1) && (
            <RollingBeta lines={results.map(({ ticker, result }) => ({ label: { en: ticker, zh: ticker }, points: result.rolling }))} label={{ en: `Rolling β against ${against.nameEn}`, zh: `對${against.nameZh}的滾動 β` }} />
          )}
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>
                    <Bi {...LABELS.ticker} />
                  </th>
                  <th className="num">β</th>
                  <th className="num">
                    <Bi en="95% interval" zh="95% 區間" />
                  </th>
                  <th className="num">
                    <Bi en="Adjusted" zh="調整後" />
                  </th>
                  <th className="num">R²</th>
                </tr>
              </thead>
              <tbody>
                {results.map(({ ticker, result }) => (
                  <tr key={ticker}>
                    <td>
                      <Link href={`/regression?t=${encodeURIComponent(ticker)}&f=${choice.freq}&y=${choice.years}&c=${choice.basis}`}>{ticker}</Link>
                    </td>
                    <td className="num">{beta(result.beta)}</td>
                    <td className="num nowrap">
                      {beta(result.ci[0])} … {beta(result.ci[1])}
                    </td>
                    <td className="num">{beta(result.adjusted)}</td>
                    <td className="num">{percent(result.r2, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** The holdings' β the nightly job saves each month (for F11, the CAPM cost of equity). */
function Saved({ saved, settings }: { saved: Awaited<ReturnType<typeof loadSavedBetas>>; settings: RegressionSettings }) {
  const tickers = [...new Set(saved.map((row) => row.ticker))].sort();
  const at = (ticker: string, benchmark: string) => saved.find((row) => row.ticker === ticker && row.benchmark === benchmark);
  return (
    <section className="card form" id="saved">
      <h2>
        <Bi en="Holdings' β, saved monthly" zh="持股 β（每月存入）" />
      </h2>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>
                <Bi {...LABELS.ticker} />
              </th>
              {settings.benchmarks.map((benchmark) => (
                <th key={benchmark.id} className="num">
                  <Bi {...name(benchmark)} />
                </th>
              ))}
              <th>
                <Bi en="Saved" zh="存入日" />
              </th>
            </tr>
          </thead>
          <tbody>
            {tickers.map((ticker) => (
              <tr key={ticker}>
                <td>{ticker}</td>
                {settings.benchmarks.map((benchmark) => (
                  <td key={benchmark.id} className="num">
                    {at(ticker, benchmark.id) ? beta((at(ticker, benchmark.id) as { beta: number }).beta) : '—'}
                  </td>
                ))}
                <td className="nowrap">{settings.benchmarks.map((benchmark) => at(ticker, benchmark.id)?.runDate).find(Boolean) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Method({ settings, data }: { settings: RegressionSettings; data: RegressionData }) {
  const bill = [...(data.riskFree.get('USD')?.entries() ?? [])].sort((a, b) => a[0].localeCompare(b[0])).pop();
  return (
    <ul className="formula">
      <li>
        <Bi en="Returns from adjusted closes (dividends in); weekly = Friday to Friday." zh="以還原收盤價（含息）計算；週報酬為週五到週五。" />
      </li>
      <li>
        <Bi
          en={`R_f: US 3-month bill${bill ? ` (${percent(bill[1], 2)} in ${bill[0]})` : ` ${percent(settings.riskFree['USD'] ?? 0, 2)} (setting)`}; TWD ${percent(settings.riskFree['TWD'] ?? 0, 2)} (setting${settings.riskFreeChecked ? `, checked ${settings.riskFreeChecked}` : ', not checked yet'}).`}
          zh={`R_f：美元用美國 3 個月國庫券${bill ? `（${bill[0]} 為 ${percent(bill[1], 2)}）` : ` ${percent(settings.riskFree['USD'] ?? 0, 2)}（設定值）`}；台幣 ${percent(settings.riskFree['TWD'] ?? 0, 2)}（設定值${settings.riskFreeChecked ? `，${settings.riskFreeChecked} 確認` : '，尚未確認'}）。`}
        />
      </li>
      <li>
        <Bi en={`Adjusted β = ${settings.blume.weight} × β + ${Number((1 - settings.blume.weight).toFixed(4))} × ${settings.blume.prior}.`} zh={`調整後 β ＝ ${settings.blume.weight} × β ＋ ${Number((1 - settings.blume.weight).toFixed(4))} × ${settings.blume.prior}。`} />
      </li>
      <li>
        <Bi
          en="Daily, across Taiwan and New York: the market's day before (or after) is added and both slopes summed (Dimson)."
          zh="日報酬跨台美市場時，加入大盤前一日（或後一日）報酬，兩個係數相加（Dimson）。"
        />
      </li>
      <li>
        <Bi en="α a year = α per period × periods a year (252, 52, 12)." zh="年化 α ＝ 每期 α × 每年期數（252、52、12）。" />
      </li>
    </ul>
  );
}

function settingsFields(settings: RegressionSettings): SettingsField[] {
  return [
    { name: 'freq', label: { en: 'Default returns', zh: '預設報酬頻率' }, options: FREQUENCIES.map((option) => ({ value: option, label: FREQ[option] })) },
    { name: 'windowYears', label: { en: 'Default window', zh: '預設期間' }, options: settings.windows.map((option) => ({ value: String(option), label: { en: `${option} years`, zh: `${option} 年` } })) },
    { name: 'currency', label: { en: 'Default currency', zh: '預設幣別' }, options: (['local', 'TWD'] as const).map((option) => ({ value: option, label: BASIS[option] })) },
    { name: 'blumeWeight', label: { en: 'Blume weight on β', zh: 'Blume 權重' } },
    { name: 'rfTWD', label: { en: 'R_f TWD, % a year', zh: '台幣 R_f（年 %）' } },
    { name: 'rfUSD', label: { en: 'R_f USD before the bill rate loads, %', zh: '美元 R_f（國庫券載入前，%）' } },
  ];
}
