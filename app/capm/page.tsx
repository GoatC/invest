import Link from 'next/link';

import { Bi, Zh } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { Facts, type Fact } from '@/components/facts';
import { Info } from '@/components/info';
import { requireSession } from '@/lib/auth';
import { DataError, loadCapmData, type CapmData, type StockCost } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { percent } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { CAPM_SERIES, erpQuote, riskFreeQuote, type CapmSettings, type CostOfEquity, type Quote } from '@/lib/models/capm';

import { CapmSettingsForm } from './forms';

type Params = Record<string, string | string[] | undefined>;

const MARKET: Record<string, Bilingual> = {
  US: { en: 'US', zh: '美國' },
  TW: { en: 'Taiwan', zh: '台灣' },
};
const YIELD_SOURCE: Record<string, Bilingual> = {
  [CAPM_SERIES.usTreasury10y]: { en: '10-year, month end', zh: '10 年期月底' },
  [CAPM_SERIES.twGovt10y]: { en: '10-year, month average', zh: '10 年期月平均' },
};
const PROBLEM: Record<string, (n: number) => Bilingual> = {
  market: () => ({ en: 'No inputs for this market.', zh: '此市場沒有設定輸入值。' }),
  beta: () => ({ en: 'No β yet: no closes.', zh: '尚無 β：沒有收盤價。' }),
  settings: () => ({ en: 'No β: the Regression settings are missing.', zh: '沒有 β：找不到回歸分析設定。' }),
  fx: () => ({ en: 'No β: no exchange rate.', zh: '沒有 β：缺少匯率。' }),
  observations: (n) => ({ en: `No β: only ${n} weeks of closes.`, zh: `沒有 β：只有 ${n} 週收盤價。` }),
  collinear: () => ({ en: 'No β: the index did not move.', zh: '沒有 β：指數沒有變動。' }),
};

const problemText = (problem: string, n: number): Bilingual => (PROBLEM[problem] ?? (PROBLEM['beta'] as (n: number) => Bilingual))(n);
const rate = (value: number) => percent(value, 2);
const beta = (value: number) => value.toFixed(2);
const marketName = (market: string): Bilingual => MARKET[market] ?? { en: market, zh: market };

/** What a tile's figure is, and its month once (Bi shows both languages side by side). */
function quoteNote(quote: Quote, series: Bilingual): Bilingual {
  return quote.from === 'series' ? { en: `${series.en} · ${quote.month}`, zh: series.zh } : { en: 'setting: not loaded yet', zh: '設定值：資料尚未載入' };
}

/** The markets in a steady order, the US first (jsonb keeps its keys in its own order). */
function markets(settings: CapmSettings): Array<[string, CapmSettings['markets'][string]]> {
  return Object.entries(settings.markets).sort(([a], [b]) => (a === 'US' ? -1 : b === 'US' ? 1 : a.localeCompare(b)));
}

/** E(R) with the stock's own numbers: R_f + β × (ERP + CRP) = result. */
function workedOut(result: CostOfEquity): string {
  const premium = result.countryPremium > 0 ? `(${rate(result.erp.value)} + ${rate(result.countryPremium)})` : rate(result.erp.value);
  // β to three decimals, so the line multiplies out at the precision shown.
  return `${rate(result.riskFree.value)} + ${result.beta.toFixed(3)} × ${premium} = ${rate(result.rate)}`;
}

/** F11 (PRD Module C): each single stock's CAPM cost of equity, the discount rate F12 will use. */
export default async function CapmPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let data: CapmData;
  try {
    data = await loadCapmData(supabase, today);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const { settings } = data;
  if (!settings) return <DataProblem table="config" detail="capm is missing or malformed" />;
  const saved = params['saved'] === 'settings';
  const erp = erpQuote(settings, data.series);

  const facts: Fact[] = markets(settings).map(([market, inputs]) => {
    const quote = riskFreeQuote(inputs, data.series);
    const name = marketName(market);
    return {
      label: { en: `R_f ${name.en}`, zh: `R_f ${name.zh}` },
      value: rate(quote.value),
      note: quoteNote(quote, YIELD_SOURCE[inputs.riskFreeSeries] ?? { en: inputs.riskFreeSeries, zh: inputs.riskFreeSeries }),
      tone: quote.from === 'series' ? 'ok' : 'watch',
    };
  });
  facts.push({
    label: { en: 'ERP', zh: '股票風險溢酬' },
    value: rate(erp.value),
    note:
      settings.erp.source === 'manual'
        ? { en: 'typed', zh: '自訂值' }
        : quoteNote(erp, { en: 'Damodaran', zh: '隱含溢酬' }),
    tone: erp.from === 'series' || settings.erp.source === 'manual' ? 'ok' : 'watch',
  });
  for (const [market, inputs] of markets(settings)) {
    if (inputs.countryPremium <= 0) continue;
    const name = marketName(market);
    facts.push({ label: { en: `CRP ${name.en}`, zh: `國家風險溢酬 ${name.zh}` }, value: rate(inputs.countryPremium), note: { en: 'added to the ERP', zh: '加在風險溢酬上' } });
  }

  return (
    <>
      <section className="card form">
        <h1>
          <Zh {...LABELS.costOfEquity} />
        </h1>
        <p className="equation">
          E(R<sub>i</sub>) = R<sub>f</sub> + β<sub>i</sub> (ERP + CRP)
        </p>
        <Facts facts={facts} />
        <Info>
          <Bi
            en="The return a stock's holders should ask for the market risk it carries (CAPM): the 10-year government yield of its market, plus its β times the equity risk premium. For single stocks only; asset classes take their returns from the capital market assumptions. F12's valuations will discount at it."
            zh="持有一檔個股時，承擔其市場風險應要求的報酬（CAPM）：該市場的 10 年期公債殖利率，加上 β 乘以股票風險溢酬。只用於個股；資產類別的預期報酬取自資本市場假設。F12 估值將以此折現。"
          />
        </Info>
      </section>

      <section className="card form" id="stocks">
        <h2>
          <Bi en="Single stocks" zh="個股" />
        </h2>
        {data.stocks.length === 0 ? (
          <p className="muted">
            <Bi en="No single stocks yet: add one on the Securities page." zh="尚無個股：請在「證券」頁新增。" />
          </p>
        ) : (
          <StockTable stocks={data.stocks} settings={settings} />
        )}
        <Info label={{ en: 'Each figure worked out', zh: '各數字的計算' }}>
          <ul className="formula">
            {data.stocks.flatMap(({ security, outcome }) =>
              outcome.ok ? [<li key={security.ticker}>{`${security.ticker}: ${workedOut(outcome.result)}`}</li>] : [],
            )}
            <li>
              <Bi
                en={`β: ${settings.beta === 'adjusted' ? "Blume's adjusted β" : 'the raw slope'} against the market's index, weekly over 2 years in local currency (the Regression Lab's defaults), saved once a month; a stock not held is worked out when the page opens.`}
                zh={`β：${settings.beta === 'adjusted' ? 'Blume 調整後 β' : '原始 β'}，對該市場指數、以當地幣別 2 年週報酬計算（回歸分析的預設），每月存入；未持有的個股在開啟頁面時計算。`}
              />
            </li>
            <li>
              <Bi
                en="ERP: Damodaran's implied premium for the S&P 500 at the start of the month (trailing 12-month cash yield). CRP: Damodaran's country risk premium, added for a market outside the US."
                zh="ERP：Damodaran 每月初公布的 S&P 500 隱含風險溢酬（近 12 個月現金殖利率法）。CRP：Damodaran 的國家風險溢酬，美國以外的市場加上。"
              />
            </li>
          </ul>
        </Info>
      </section>

      <section className="card form" id="settings">
        <details open={saved}>
          <summary>
            <Bi en="Settings" zh="設定" />
          </summary>
          {saved && (
            <p className="banner ok" role="status">
              <Bi en="Settings saved." zh="已儲存設定。" />
            </p>
          )}
          <CapmSettingsForm
            markets={markets(settings).map(([market]) => ({ market, name: marketName(market) }))}
            initial={{
              beta: settings.beta,
              erpSource: settings.erp.source,
              erpManual: percentField(settings.erp.manual),
              ...Object.fromEntries(Object.entries(settings.markets).flatMap(([market, inputs]) => [[`rf_${market}`, percentField(inputs.riskFree)], [`crp_${market}`, percentField(inputs.countryPremium)]])),
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

function StockTable({ stocks, settings }: { stocks: readonly StockCost[]; settings: CapmSettings }) {
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th>
              <Bi {...LABELS.ticker} />
            </th>
            <th>
              <Bi en="Market" zh="市場" />
            </th>
            <th className="num">
              <Bi en={settings.beta === 'adjusted' ? 'β (adjusted)' : 'β (raw)'} zh={settings.beta === 'adjusted' ? 'β（調整後）' : 'β（原始）'} />
            </th>
            <th className="num">
              R<sub>f</sub>
            </th>
            <th className="num">ERP + CRP</th>
            <th className="num">
              <Bi en="Cost of equity" zh="權益成本" />
            </th>
          </tr>
        </thead>
        <tbody>
          {stocks.map(({ security, held, outcome, betaProblem }) => (
            <tr key={security.ticker}>
              <td>
                <Link href={`/regression?t=${encodeURIComponent(security.ticker)}`}>{security.ticker}</Link>
                {held && (
                  <span className="badge">
                    <Bi en="held" zh="持有" />
                  </span>
                )}
                <div className="muted small">{security.name}</div>
              </td>
              <td className="nowrap">
                <Bi {...marketName(security.market)} />
              </td>
              {outcome.ok ? (
                <>
                  <td className="num nowrap">
                    {beta(outcome.result.beta)}
                    <div className="muted small">
                      <Bi
                        en={`vs ${outcome.result.benchmark} · ${outcome.result.betaInput.runDate ? `saved ${outcome.result.betaInput.runDate}` : 'live'}`}
                        zh={`對 ${outcome.result.benchmark} · ${outcome.result.betaInput.runDate ? `${outcome.result.betaInput.runDate} 存入` : '即時計算'}`}
                      />
                    </div>
                  </td>
                  <td className="num">{rate(outcome.result.riskFree.value)}</td>
                  <td className="num">{rate(outcome.result.premium)}</td>
                  <td className="num">
                    <strong>{rate(outcome.result.rate)}</strong>
                  </td>
                </>
              ) : (
                <td colSpan={4} className="muted">
                  <Bi {...problemText(betaProblem?.problem ?? outcome.problem, betaProblem?.n ?? 0)} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
