import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { Info } from '@/components/info';
import { BetaRanges, type Range } from '@/components/regression-charts';
import { Stat } from '@/components/stat';
import { requireSession } from '@/lib/auth';
import { DataError, loadFactorData, type FactorData, type FactorRow } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { percent, signedPercent } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { FACTOR_NAMES, FACTORS, type Region } from '@/lib/models/five-factor';

type Params = Record<string, string | string[] | undefined>;

const REGION: Record<Region, Bilingual> = {
  us: { en: 'US factors', zh: '美國因子' },
  developed: { en: 'Developed markets', zh: '已開發市場因子' },
  emerging: { en: 'Emerging markets', zh: '新興市場因子' },
};

function one(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

const loading = (value: number) => value.toFixed(2);

/** N1 five-factor mode: what drives each holding's and the whole portfolio's return beyond the market. */
export default async function FactorPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: FactorData;
  let years = 3;
  try {
    // The window needs the settings first; read the default, then the chosen one from the same row.
    const probe = await loadFactorData(supabase, today, 1);
    if (!probe.settings) {
      data = probe;
    } else {
      const wanted = probe.settings.windows.find((option) => String(option) === one(params, 'y')) ?? probe.settings.defaultWindow;
      years = wanted;
      data = await loadFactorData(supabase, today, wanted);
    }
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const { settings } = data;
  const chosen = data.rows.find((row) => row.key === one(params, 't')) ?? data.rows[0];
  const href = (next: { y?: number; t?: string }) => {
    const query = new URLSearchParams();
    query.set('y', String(next.y ?? years));
    const key = next.t ?? chosen?.key;
    if (key && key !== 'portfolio') query.set('t', key);
    return `/regression/factors?${query.toString()}`;
  };

  return (
    <>
      <section className="card form">
        <div className="row spread">
          <h1>
            <Bi {...LABELS.regression} /> · <Bi en="Five factors" zh="五因子" />
          </h1>
          <Link href="/regression">
            <Bi en="Back to β" zh="回到 β" />
          </Link>
        </div>
        <Info>
          <Bi
            en="Beyond the market, what drives a return? The Fama–French five factors: the market's own move, small companies beating large (size), cheap beating expensive (value), profitable beating unprofitable (profitability) and conservative beating aggressive investors (investment). Each loading says how much of that factor the holding carries, with its t-statistic (beyond about ±2 it is unlikely to be chance) and 95% interval. Alpha is what is left over. Returns are monthly and in US dollars, as the factors are; the factors are Kenneth French's free data."
            zh="除了大盤，還有什麼在驅動報酬？Fama–French 五因子：大盤本身的漲跌、小公司勝過大公司（規模）、便宜勝過昂貴（價值）、獲利佳勝過獲利差（獲利能力）、保守投資勝過積極投資（投資）。每個係數代表該持股帶有多少該因子，附 t 值（絕對值超過約 2 就不太可能是巧合）與 95% 信賴區間。阿爾法是剩下無法解釋的部分。報酬為月報酬、以美元計，與因子相同；因子為 Kenneth French 提供的免費資料。"
          />
        </Info>
        {!settings && (
          <p className="banner warn">
            <Bi en="The factors setting is missing from the database: run npx supabase db push." zh="資料庫中找不到因子設定：請執行 npx supabase db push。" />
          </p>
        )}
        {settings && (
          <div className="filters">
            <div className="segmented" role="group" aria-label="Window 期間">
              <span className="label">
                <Bi en="Window" zh="期間" />
              </span>
              {settings.windows.map((option) => (
                <Link key={option} href={href({ y: option })} aria-current={option === years ? 'true' : undefined}>
                  <Bi en={`${option} years`} zh={`${option} 年`} />
                </Link>
              ))}
            </div>
          </div>
        )}
        {settings && Object.keys(data.loaded).length === 0 && (
          <p className="banner warn">
            <Bi en="No factor data yet: the nightly job loads Kenneth French's monthly factors; run it once from the Actions tab." zh="尚無因子資料：每夜排程會載入 Kenneth French 的月因子；請到 Actions 分頁手動執行一次。" />
          </p>
        )}
      </section>
      {settings && data.rows.length > 0 && Object.keys(data.loaded).length > 0 && (
        <>
          <Summary rows={data.rows} years={years} href={href} chosen={chosen} />
          {chosen && <Detail row={chosen} years={years} />}
          <Notes data={data} />
        </>
      )}
      <Method />
    </>
  );
}

function Summary({ rows, years, href, chosen }: { rows: readonly FactorRow[]; years: number; href: (next: { t?: string }) => string; chosen: FactorRow | undefined }) {
  return (
    <section className="card form">
      <h2>
        <Bi en={`Every holding and the whole portfolio, ${years} years`} zh={`每檔持股與整體投資組合，${years} 年`} />
      </h2>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>
                <Bi en="Holding" zh="持股" />
              </th>
              {FACTORS.map((factor) => (
                <th key={factor} className="num">
                  <Bi {...FACTOR_NAMES[factor]} />
                </th>
              ))}
              <th className="num">
                <Bi en="α a year" zh="年化 α" />
              </th>
              <th className="num">R²</th>
              <th className="num">
                <Bi en="Months" zh="月數" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} aria-current={chosen?.key === row.key ? 'true' : undefined}>
                <td>
                  <Link href={href({ t: row.key })}>{row.key === 'portfolio' ? <Bi en="Whole portfolio" zh="整體投資組合" /> : row.key}</Link>
                  <span className="muted small">
                    {' '}
                    <Bi {...REGION[row.region]} />
                  </span>
                </td>
                {row.fit
                  ? row.fit.loadings.map((one) => (
                      <td key={one.factor} className="num">
                        {Math.abs(one.t) >= 2 ? <strong>{loading(one.beta)}</strong> : loading(one.beta)} <span className="muted small">({one.t.toFixed(1)})</span>
                      </td>
                    ))
                  : FACTORS.map((factor) => (
                      <td key={factor} className="num">
                        —
                      </td>
                    ))}
                <td className="num">{row.fit ? signedPercent(row.fit.alphaAnnual, 1) : '—'}</td>
                <td className="num">{row.fit ? row.fit.r2.toFixed(2) : '—'}</td>
                <td className="num">{row.fit ? row.fit.n : row.months}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        <Bi en="The loading, with its t-statistic in brackets; bold where the t-statistic is beyond ±2." zh="係數後括號內為 t 值；t 值絕對值超過 2 的以粗體標示。" />
      </p>
    </section>
  );
}

function Detail({ row, years }: { row: FactorRow; years: number }) {
  const name: Bilingual = row.key === 'portfolio' ? { en: 'Whole portfolio', zh: '整體投資組合' } : { en: `${row.key} ${row.name}`, zh: `${row.key} ${row.name}` };
  if (!row.fit) {
    return (
      <section className="card form" id="factor-detail">
        <h2>
          <Bi {...name} />
        </h2>
        <p className="muted">
          <Bi en={`Too few months with both a return and the factors (${row.months}); a fit needs more.`} zh={`同時有報酬與因子的月數太少（${row.months}），需要更多才能回歸。`} />
        </p>
      </section>
    );
  }
  const fit = row.fit;
  const ranges: Range[] = fit.loadings.map((one) => ({ ticker: `${FACTOR_NAMES[one.factor].en} ${FACTOR_NAMES[one.factor].zh}`, beta: one.beta, low: one.ci[0], high: one.ci[1] }));
  const label: Bilingual = {
    en: `${name.en}: loadings on the five factors with their 95% intervals over ${fit.n} months, ${fit.from} to ${fit.to}; the market loading ${loading(fit.loadings[0]?.beta ?? 0)}.`,
    zh: `${name.zh}：五個因子的係數與 95% 信賴區間，${fit.n} 個月（${fit.from} 至 ${fit.to}）；市場係數 ${loading(fit.loadings[0]?.beta ?? 0)}。`,
  };
  return (
    <section className="card form" id="factor-detail">
      <h2>
        <Bi {...name} />
      </h2>
      <div className="grid-cards">
        <Stat label={{ en: 'R²', zh: 'R²' }} value={fit.r2.toFixed(2)} note={{ en: `Adjusted ${fit.adjR2.toFixed(2)}, ${fit.n} months`, zh: `調整後 ${fit.adjR2.toFixed(2)}，${fit.n} 個月` }} />
        <Stat label={{ en: 'Alpha a year', zh: '年化阿爾法' }} value={signedPercent(fit.alphaAnnual, 1)} note={{ en: `t = ${fit.alphaT.toFixed(1)}`, zh: `t = ${fit.alphaT.toFixed(1)}` }} />
        <Stat label={{ en: 'Market loading', zh: '市場係數' }} value={loading(fit.loadings[0]?.beta ?? 0)} note={{ en: `${years}-year window`, zh: `${years} 年期間` }} />
      </div>
      <BetaRanges rows={ranges} label={label} />
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>
                <Bi en="Factor" zh="因子" />
              </th>
              <th className="num">
                <Bi en="Loading" zh="係數" />
              </th>
              <th className="num">
                <Bi en="Std. error" zh="標準誤" />
              </th>
              <th className="num">t</th>
              <th className="num">
                <Bi en="95% interval" zh="95% 信賴區間" />
              </th>
            </tr>
          </thead>
          <tbody>
            {fit.loadings.map((one) => (
              <tr key={one.factor}>
                <td>
                  <Bi {...FACTOR_NAMES[one.factor]} />
                </td>
                <td className="num">{loading(one.beta)}</td>
                <td className="num">{one.stdErr.toFixed(3)}</td>
                <td className="num">{Math.abs(one.t) >= 2 ? <strong>{one.t.toFixed(2)}</strong> : one.t.toFixed(2)}</td>
                <td className="num nowrap">
                  {loading(one.ci[0])} – {loading(one.ci[1])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        <Bi en={`The ${row.region === 'us' ? 'US' : row.region === 'emerging' ? 'emerging markets’' : 'developed markets’'} factors, ${fit.n} months from ${fit.from} to ${fit.to}; alpha ${signedPercent(fit.alphaAnnual, 2)} a year is the monthly ${signedPercent(fit.alpha, 2)} × 12.`} zh={`${row.region === 'us' ? '美國' : row.region === 'emerging' ? '新興市場' : '已開發市場'}因子，${fit.from} 至 ${fit.to} 共 ${fit.n} 個月；年化阿爾法 ${signedPercent(fit.alphaAnnual, 2)} 為月阿爾法 ${signedPercent(fit.alpha, 2)} × 12。`} />
      </p>
    </section>
  );
}

function Notes({ data }: { data: FactorData }) {
  const loaded = Object.entries(data.loaded) as Array<[Region, string]>;
  return (
    <section className="card">
      <p className="muted small">
        <Bi
          en={`Factors loaded through: ${loaded.map(([region, month]) => `${REGION[region].en} ${month}`).join('; ')}. ${data.noTicker > 0 ? `${data.noTicker} holdings with no ticker (gold, balances) are not in the portfolio fit. ` : ''}${data.left.length > 0 ? `No dollar return for ${data.left.join(', ')}.` : ''}`}
          zh={`因子資料至：${loaded.map(([region, month]) => `${REGION[region].zh} ${month}`).join('；')}。${data.noTicker > 0 ? `${data.noTicker} 筆沒有代號的持有（黃金、餘額）未納入整體投資組合的回歸。` : ''}${data.left.length > 0 ? `${data.left.join('、')} 沒有可用的美元報酬。` : ''}`}
        />
      </p>
    </section>
  );
}

function Method() {
  const notes: Bilingual[] = [
    {
      en: 'R_i − R_f = α + β_mkt (R_m − R_f) + s·SMB + h·HML + r·RMW + c·CMA + ε, by ordinary least squares on monthly returns. Each loading’s t-statistic is the loading over its standard error, and its interval is the loading ± t(0.975, n − 6) standard errors. R² is the share of the return’s variation the five factors explain; the adjusted R² takes the number of factors into account.',
      zh: 'R_i − R_f = α + β_mkt (R_m − R_f) + s·SMB + h·HML + r·RMW + c·CMA + ε，以月報酬做最小平方法。各係數的 t 值為係數除以標準誤，信賴區間為係數 ± t(0.975, n − 6) 個標準誤。R² 為五個因子能解釋的報酬變異比例；調整後 R² 已考慮因子數量。',
    },
    {
      en: 'Returns are total returns (dividends reinvested) in US dollars, as the factors are: a Taiwan return is converted with each month’s USD/TWD move. A US-listed holding is on the US factors, a Taiwan one on the emerging markets’, a London-listed one on the developed markets’; the whole portfolio holds today’s holdings through the window at today’s weights and is on the developed markets’ (the library’s global file stops in 2019). Months where the library has no value for a factor are left out.',
      zh: '報酬為含息的總報酬，以美元計，與因子相同：台股報酬以每月美元／台幣的變動換算。美國上市持股用美國因子，台股用新興市場因子，倫敦上市用已開發市場因子；整體投資組合以今天的持股與權重持有整個期間，使用已開發市場因子（資料庫的全球檔案只到 2019 年）。資料庫缺值的月份不納入。',
    },
    {
      en: 'Bonds, gold and cash are in the portfolio too, so a mixed portfolio fits the equity factors loosely: a low R² there is the answer, not an error. Gold and savings balances (no ticker) are left out. The factors are loaded monthly by the nightly job from Kenneth French’s data library.',
      zh: '債券、黃金與現金也在投資組合內，因此混合型投資組合與股票因子的擬合度較低：R² 偏低就是答案，不是錯誤。黃金與活存餘額（沒有代號）未納入。因子由每夜排程每月從 Kenneth French 資料庫載入。',
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
