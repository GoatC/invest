import Link from 'next/link';

import { percent, signedPercent, twd } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { histogram, overWeeks, weeksBeyond, type MeasuredHolding, type RiskReport, type VarPoint } from '@/lib/models/risk';
import { confidenceText, riskHorizons } from '@/lib/risk-text';

import { Bi } from './bi';
import { Facts } from './facts';
import { Info } from './info';
import { ReturnHistogram } from './risk-charts';

/**
 * Everything behind the VaR figure, folded under it on the dashboard (it was the Value at Risk
 * page): where the VaR sits among past weeks, what it is made of, the formula with today's numbers,
 * the 52-week line as a table and how it is all worked out.
 */
export function RiskDetails({ report, line }: { report: RiskReport | undefined; line: readonly VarPoint[] }) {
  const ready = report && report.weekVar !== null && report.sigma !== null && report.measured.exposures.length > 0;
  const beyond = ready ? weeksBeyond(report.mixReturns, report.z * (report.sigma ?? 0)) : null;
  return (
    <details className="risk-details" id="risk-details">
      <summary>
        <Bi en="Distribution and make-up" zh="分布圖與組成" />
        {ready && beyond !== null && (
          <span className="muted">
            {' · '}
            <Bi en={`${beyond} of ${report.mixReturns.length} weeks beyond the VaR`} zh={`${report.mixReturns.length} 週中 ${beyond} 週超過風險值`} />
          </span>
        )}
      </summary>
      <div className="form">
        {ready && report && (
          <>
            <Distribution report={report} />
            <Inputs report={report} />
            <Formula report={report} />
            {line.length > 1 && <WeeklyTable line={line} />}
          </>
        )}
        <Method report={report} />
      </div>
    </details>
  );
}

/** "95% 1-week VaR", whatever the card's own horizon: the histogram is of weekly returns. */
function weekLabel(report: RiskReport): Bilingual {
  const level = confidenceText(report.settings.confidence);
  return { en: `${level} 1-week VaR`, zh: `${level} 一週風險值` };
}

function Distribution({ report }: { report: RiskReport }) {
  const cutoff = report.z * (report.sigma ?? 0);
  const returns = report.mixReturns;
  const { bins } = histogram(returns, 24, -cutoff);
  const beyond = weeksBeyond(returns, cutoff);
  const expected = Math.round(returns.length * (1 - report.settings.confidence) * 10) / 10;
  return (
    <div className="form risk-part">
      <h3>
        <Bi en={`Where the VaR sits among the last ${returns.length} weeks`} zh={`風險值在過去 ${returns.length} 週報酬中的位置`} />
      </h3>
      <Facts
        facts={[
          { label: { en: 'Weeks beyond the VaR', zh: '損失超過風險值的週數' }, value: `${beyond} / ${returns.length}`, note: { en: `≈ ${expected} expected`, zh: `預期約 ${expected}` }, tone: beyond > expected * 1.5 ? 'watch' : 'ok' },
          { label: weekLabel(report), value: signedPercent(-cutoff) },
        ]}
      />
      <Info>
        <Bi
          en={`Each bar counts the weeks in which today's mix, held through the last ${returns.length} weeks, gained or lost that much in TWD. In ${beyond} of them (${percent(beyond / returns.length)}) it lost more than the 1-week VaR of ${percent(cutoff)}; at ${confidenceText(report.settings.confidence)}, about ${expected} would. The VaR assumes weekly returns follow a normal curve; real ones have fatter tails, so more weeks beyond the line than that is the usual way it errs.`}
          zh={`每根長條是今天的持股組合若在過去 ${returns.length} 週一直持有，各週台幣報酬落在該區間的週數。其中有 ${beyond} 週（${percent(beyond / returns.length)}）損失超過 ${percent(cutoff)} 的一週風險值；在 ${confidenceText(report.settings.confidence)} 信賴水準下，預期約 ${expected} 週。風險值假設週報酬呈常態分布，實際報酬的尾部較厚，因此超過門檻的週數比預期多，是它最常見的誤差。`}
        />
      </Info>
      <ReturnHistogram
        bins={bins}
        cutoff={cutoff}
        cutoffLabel={weekLabel(report)}
        label={{
          en: `Histogram of today's mix's weekly returns over the last ${returns.length} weeks, with the 1-week VaR at ${signedPercent(-cutoff)}; ${beyond} weeks lost more. The table below lists every bar.`,
          zh: `今天持股組合過去 ${returns.length} 週週報酬的分布圖，一週風險值位於 ${signedPercent(-cutoff)}；有 ${beyond} 週損失超過。下方表格列出每根長條。`,
        }}
      />
      <details>
        <summary>
          <Bi en="Show as a table" zh="以表格顯示" />
        </summary>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="Weekly return" zh="週報酬" />
                </th>
                <th className="num">
                  <Bi en="Weeks" zh="週數" />
                </th>
              </tr>
            </thead>
            <tbody>
              {bins.map((bin) => (
                <tr key={bin.from}>
                  <td className="nowrap">
                    {signedPercent(bin.from, 2)} → {signedPercent(bin.to, 2)}
                    {bin.to <= -cutoff + 1e-12 && (
                      <span className="muted small">
                        {' '}
                        <Bi en="beyond the VaR" zh="超過風險值" />
                      </span>
                    )}
                  </td>
                  <td className="num">{bin.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function holdingNames(holdings: readonly MeasuredHolding[]): string {
  return holdings.map((holding) => holding.ticker ?? holding.label).join(', ');
}

function Inputs({ report }: { report: RiskReport }) {
  const { measured } = report;
  const cashWeight = measured.valueTwd > 0 ? measured.cash.valueTwd / measured.valueTwd : 0;
  const standIns = measured.exposures.flatMap((exposure) => exposure.holdings.filter((holding) => holding.standIn).map((holding) => ({ holding, proxy: exposure.proxy })));
  return (
    <div className="form risk-part">
      <h3>
        <Bi en="What the VaR is made of" zh="風險值的組成" />
      </h3>
      <Info>
        <Bi
          en="Weight = what each proxy measures ÷ the portfolio. Share of the VaR = its part of the portfolio's variance, w_i (Σw)_i ÷ wᵀΣw; the shares add up to 100%, and a proxy that moves against the rest can take a negative one."
          zh="權重＝各代理 ETF 衡量的市值 ÷ 投資組合。占風險值比例＝它對組合變異數的貢獻 w_i (Σw)_i ÷ wᵀΣw；各比例合計 100%，與其他資產反向變動的代理 ETF 可能為負值。"
        />
      </Info>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Bi en="Proxy" zh="代理 ETF" />
              </th>
              <th>
                <Bi en="Measures" zh="衡量的持有" />
              </th>
              <th className="num">
                <Bi {...LABELS.weight} />
              </th>
              <th className="num">
                <Bi en="Weekly σ (TWD)" zh="週波動度（台幣）" />
              </th>
              <th className="num">
                <Bi en="Share of the VaR" zh="占風險值比例" />
              </th>
            </tr>
          </thead>
          <tbody>
            {measured.exposures.map((exposure, index) => {
              const figures = report.proxies[index];
              return (
                <tr key={exposure.proxy}>
                  <td>
                    <strong>{exposure.proxy}</strong>
                  </td>
                  <td className="small">{holdingNames(exposure.holdings)}</td>
                  <td className="num">{percent(figures?.weight)}</td>
                  <td className="num">{percent(figures?.weeklySigma, 2)}</td>
                  <td className="num">{percent(figures?.share)}</td>
                </tr>
              );
            })}
            {measured.cash.valueTwd > 0 && (
              <tr>
                <td>
                  <Bi en="TWD balances" zh="台幣餘額" />
                </td>
                <td className="small">{holdingNames(measured.cash.holdings)}</td>
                <td className="num">{percent(cashWeight)}</td>
                <td className="num">{percent(0, 2)}</td>
                <td className="num">{percent(0)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>
                  <Bi en="Portfolio" zh="投資組合" />
                </strong>
              </td>
              <td className="small">{twd(measured.valueTwd)}</td>
              <td className="num">{percent(1)}</td>
              <td className="num">
                <strong>{percent(report.sigma, 2)}</strong>
              </td>
              <td className="num">{percent(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {standIns.length > 0 && (
        <p className="muted small">
          <Bi
            en={`Standing in until a theme ETF has ${report.window.weeks} weeks of its own closes: ${standIns.map(({ holding, proxy }) => `${proxy} for ${holding.ticker ?? holding.label}`).join(', ')}.`}
            zh={`主題 ETF 自身的收盤價未滿 ${report.window.weeks} 週前，暫以代理 ETF 衡量：${standIns.map(({ holding, proxy }) => `${holding.ticker ?? holding.label} 以 ${proxy} 代替`).join('、')}。`}
          />
        </p>
      )}
      <details>
        <summary>
          <Bi en="Correlations of the proxies' weekly returns" zh="代理 ETF 週報酬的相關係數" />
        </summary>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th />
                {report.proxies.map((proxy) => (
                  <th key={proxy.proxy} className="num">
                    {proxy.proxy}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.proxies.map((proxy, i) => (
                <tr key={proxy.proxy}>
                  <th>{proxy.proxy}</th>
                  {report.correlations[i]?.map((value, j) => (
                    <td key={j} className="num">
                      {value === null ? '—' : value.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Formula({ report }: { report: RiskReport }) {
  const [week, month] = riskHorizons(report.settings);
  const sigma = percent(report.sigma, 2);
  const value = twd(report.measured.valueTwd);
  const weekVar = report.weekVar ?? 0;
  const lines: Bilingual[] = [
    {
      en: `σ_p = √(wᵀΣw) = ${sigma} a week: the weights above against the covariance Σ of the proxies' ${report.window.weeks} weekly returns.`,
      zh: `σ_p = √(wᵀΣw) = 每週 ${sigma}：上表權重搭配代理 ETF ${report.window.weeks} 週週報酬的共變異數矩陣 Σ。`,
    },
    ...(week
      ? [
          {
            en: `${week.label.en} = z × σ_p × √h × V = ${report.z} × ${sigma} × √${week.weeks} × ${value} = ${twd(overWeeks(weekVar, week.weeks))}.`,
            zh: `${week.label.zh} = z × σ_p × √h × V = ${report.z} × ${sigma} × √${week.weeks} × ${value} = ${twd(overWeeks(weekVar, week.weeks))}。`,
          },
        ]
      : []),
    ...(month
      ? [
          {
            en: `${month.label.en}: the 1-week figure × √${month.weeks} (weeks in a month) = ${twd(overWeeks(weekVar, month.weeks))}.`,
            zh: `${month.label.zh}：一週風險值 × √${month.weeks}（一個月的週數）= ${twd(overWeeks(weekVar, month.weeks))}。`,
          },
        ]
      : []),
    {
      en: `z = ${report.z}: the standard normal quantile for ${confidenceText(report.settings.confidence)}, to three decimals as a z-table quotes it.`,
      zh: `z = ${report.z}：${confidenceText(report.settings.confidence)} 單尾的標準常態分位數，依 z 表取到小數第三位。`,
    },
  ];
  return (
    <div className="form risk-part" id="formula">
      <Info label={{ en: "The formula with today's numbers", zh: '公式與今天的數值' }}>
        <ul className="formula">
          {lines.map((line) => (
            <li key={line.en}>
              <Bi {...line} />
            </li>
          ))}
        </ul>
      </Info>
    </div>
  );
}

function WeeklyTable({ line }: { line: readonly VarPoint[] }) {
  return (
    <div className="risk-part">
      <details>
        <summary>
          <Bi en="The 52-week line as a table" zh="以表格顯示近 52 週" />
        </summary>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi {...LABELS.flowDate} />
                </th>
                <th className="num">
                  <Bi en="1-week VaR" zh="一週風險值" />
                </th>
                <th className="num">
                  <Bi en="Share of the portfolio" zh="占投資組合" />
                </th>
              </tr>
            </thead>
            <tbody>
              {[...line].reverse().map((point) => (
                <tr key={point.date}>
                  <td className="nowrap">{point.date}</td>
                  <td className="num">{twd(point.valueAtRisk)}</td>
                  <td className="num">{percent(point.totalTwd > 0 ? point.valueAtRisk / point.totalTwd : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Method({ report }: { report: RiskReport | undefined }) {
  const weeks = report?.window.weeks ?? 156;
  const notes: Bilingual[] = [
    {
      en: 'Parametric (variance–covariance) VaR: weekly returns are taken to follow a normal curve, so the loss exceeded in 1 week in 20 is 1.645 standard deviations. The confidence, horizon, weeks in a month and years of history live in config var, not in code.',
      zh: '參數法（變異數–共變異數法）風險值：假設週報酬呈常態分布，因此每 20 週約有 1 週會超過的損失為 1.645 個標準差。信賴水準、期間、一個月的週數與歷史年數存在 config 表的 var，不寫在程式中。',
    },
    {
      en: `Σ is the sample covariance of the last ${weeks} weekly returns of each proxy: Friday close to Friday close (a holiday Friday takes the close before it), dividends reinvested, in TWD at each Friday's Bank of Taiwan rate, so currency moves count.`,
      zh: `Σ 為各代理 ETF 最近 ${weeks} 週週報酬的樣本共變異數：以週五收盤價計算（週五休市則取前一個收盤價），股利再投入，並以每個週五的臺灣銀行匯率換算台幣，因此匯率變動也計入。`,
    },
    {
      en: 'Each holding is measured by its asset class’s proxy, the benchmark ETF on Allocation → Edit targets: VT, 0050, BNDW, GLDM (the gold price), BIL, VOO. A theme ETF uses its own prices once it has the whole window of them, VT until then. A single stock’s own risk is left out by design, so a concentrated satellite reads lower than it is.',
      zh: '每檔持股以所屬資產類別的代理 ETF 衡量，即「資產配置 → 修改目標權重」中的基準 ETF：VT、0050、BNDW、GLDM（金價）、BIL、VOO。主題 ETF 有完整期間的自身價格後改用自身價格，在此之前用 VT。刻意不計個別股票自身的風險，因此集中的衛星部位看起來會比實際低。',
    },
    {
      en: 'A TWD balance (savings, or a money-market fund entered as a balance) has no price to move in TWD: it counts in the portfolio’s value but adds no risk. Strategic cash held as a listed ETF, such as BIL, is measured by its prices in TWD, the dollar’s moves included.',
      zh: '台幣餘額（活存，或以餘額登錄的貨幣基金）以台幣計價不會波動：計入投資組合市值，但不增加風險。以上市 ETF 持有的戰略現金（例如 BIL）則以其台幣價格衡量，包含美元匯率的變動。',
    },
    {
      en: 'The portfolio is both pools, valued as on the holdings page; holdings still waiting for a price are left out. A month is 4.33 weeks, and risk grows with the square root of time.',
      zh: '投資組合包含兩個資金池，估值方式與持倉頁相同；尚未計價的持有暫不列入。一個月以 4.33 週計，風險隨時間的平方根增加。',
    },
    {
      en: 'Today’s figure is worked out when the page opens, so a new trade shows at once. The nightly job saves each day’s 1-week VaR with its NAV snapshot; the 52-week line is drawn from those, one point a week.',
      zh: '今天的數值在開啟頁面時直接計算，新增交易後立即反映。每夜排程會把每一天的一週風險值與淨值快照一起存下；近 52 週的線取自這些紀錄，每週一點。',
    },
    {
      en: 'It is a display, not a promise: a bad week can lose more than the VaR, and about 1 week in 20 will. The histogram counts how often today’s mix would have.',
      zh: '這只是參考指標，不是保證：不利的一週損失可能超過風險值，平均每 20 週約有 1 週如此。分布圖顯示今天的持股組合過去發生的次數。',
    },
  ];
  return (
    <div className="risk-part">
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
        <Link href="/allocation/targets">
          <Bi en="Proxies: benchmark ETFs" zh="代理 ETF：基準 ETF" />
        </Link>
      </p>
    </div>
  );
}
