import { Bi } from '@/components/bi';
import { percent } from '@/lib/format';
import { bi, leverageText, type Bilingual } from '@/lib/i18n';
import { expectedReturn, frontier, grossExposure, levered, sharpe, tangent, volatility, withShorts, type FrontierPoint, type Problem } from '@/lib/models/frontier';
import { queryLeverage, tenths } from '@/lib/what-if';

type Params = Record<string, string | string[] | undefined>;

/** Short cap per class 0–100% and portfolio leverage 0.1×–3.0×, both in 0.1 steps; borrowing spread 0–5% in 0.1 points. */
const SHORT_STEPS = tenths(0, 1);
const LEVERAGE_STEPS = tenths(0.1, 3);
const SPREAD_STEPS = tenths(0, 5);

export interface FrontierWhatIf {
  /** Largest short per class, 0 to 1. */
  shortCap: number;
  /** Own money × this is held in the mix. */
  leverage: number;
  /** Borrowing cost above the risk-free rate, as a fraction. */
  spread: number;
}

export function frontierWhatIf(params: Params): FrontierWhatIf {
  return {
    shortCap: queryLeverage(params, 'fs', 0, 1, 0),
    leverage: queryLeverage(params, 'fl', 0.1, 3, 1),
    spread: queryLeverage(params, 'fb', 0, 5, 1) / 100,
  };
}

interface Line {
  key: string;
  name: Bilingual;
  ret: number;
  vol: number;
  gross: number | null;
}

/**
 * F7 with the two assumptions long-only MVO leaves out: shorting (each class may go below 0%,
 * shorts funding longs) and leverage on the whole mix along the capital allocation line.
 */
export function FrontierWhatIfSection({
  problem,
  points,
  riskFree,
  best,
  current,
  ids,
  names,
  whatIf,
}: {
  problem: Problem;
  points: number;
  riskFree: number;
  best: (FrontierPoint & { sharpe: number }) | null;
  current: FrontierPoint | null;
  ids: readonly string[];
  names: (id: string) => Bilingual;
  whatIf: FrontierWhatIf;
}) {
  const shorted = whatIf.shortCap > 0 ? withShorts(problem, whatIf.shortCap) : null;
  const shortBest = shorted ? tangent(shorted, frontier(shorted, points), riskFree) : null;
  const lines: Line[] = [];
  const add = (key: string, name: Bilingual, point: Pick<FrontierPoint, 'ret' | 'vol' | 'weights'> | null) => {
    if (!point) return;
    const lev = levered(point, riskFree, whatIf.leverage, whatIf.spread);
    lines.push({ key, name, ret: lev.ret, vol: lev.vol, gross: grossExposure(point.weights) * whatIf.leverage });
  };
  add('tangent', { en: 'Tangent, long only', zh: '切線組合（只做多）' }, best);
  add('short', { en: `Tangent, shorts to ${percent(whatIf.shortCap, 0)} a class`, zh: `切線組合（每類最多做空 ${percent(whatIf.shortCap, 0)}）` }, shortBest);
  add('current', { en: 'Current mix', zh: '目前配置' }, current);
  return (
    <section className="card form" id="frontier-what-if">
      <h2>
        <Bi en="What if: shorting and leverage" zh="假設情境：做空與槓桿" />
      </h2>
      <p className="muted small">
        <Bi
          en="The frontier above is long only, every dollar your own. Here each class may be shorted to fund more of the others, and the whole mix can be held at a leverage along the capital allocation line: below 1× the rest earns the risk-free rate, above 1× the extra is borrowed at the risk-free rate plus a spread. Analysis only: your targets and bounds stay as they are."
          zh="上方的效率前緣只做多，每一塊錢都是自有資金。這裡允許做空某些類別來多買其他類別，也可以沿資本配置線用某個槓桿倍數持有整個配置：低於 1 倍時其餘資金賺無風險利率，高於 1 倍時多出的部分以無風險利率加利差借入。僅供分析，不會改變你的目標與上下限。"
        />
      </p>
      <form method="get" action="/frontier#frontier-what-if" className="form-grid">
        <label className="field">
          <Bi en="Largest short per class" zh="每類最多做空" />
          <select name="fs" defaultValue={whatIf.shortCap.toFixed(1)}>
            {SHORT_STEPS.map((step) => (
              <option key={step} value={step.toFixed(1)}>
                {step === 0 ? 'None 不做空' : percent(step, 0)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <Bi en="Leverage on the mix (0.1× steps)" zh="整體槓桿（0.1 倍級距）" />
          <select name="fl" defaultValue={whatIf.leverage.toFixed(1)}>
            {LEVERAGE_STEPS.map((step) => (
              <option key={step} value={step.toFixed(1)}>
                {leverageText(step)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <Bi en="Borrowing spread over the risk-free rate" zh="借款利差（高於無風險利率）" />
          <select name="fb" defaultValue={(whatIf.spread * 100).toFixed(1)}>
            {SPREAD_STEPS.map((step) => (
              <option key={step} value={step.toFixed(1)}>
                {`${step.toFixed(1)}%`}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button type="submit" className="button primary">
            <Bi en="Work it out" zh="計算" />
          </button>
        </div>
      </form>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>
                <Bi en={`Mix at ${leverageText(whatIf.leverage)}`} zh={`配置（${leverageText(whatIf.leverage)}）`} />
              </th>
              <th className="num">
                <Bi en="Expected return" zh="預期報酬" />
              </th>
              <th className="num">
                <Bi en="Volatility" zh="波動度" />
              </th>
              <th className="num">
                <Bi en="Sharpe" zh="夏普" />
              </th>
              <th className="num">
                <Bi en="Gross exposure" zh="總曝險" />
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const ratio = sharpe(line.ret, line.vol, riskFree);
              return (
                <tr key={line.key}>
                  <td>
                    <Bi {...line.name} />
                  </td>
                  <td className="num">{percent(line.ret, 2)}</td>
                  <td className="num">{percent(line.vol, 2)}</td>
                  <td className="num">{ratio === null ? '—' : ratio.toFixed(2)}</td>
                  <td className="num">{line.gross === null ? '—' : percent(line.gross, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shortBest && (
        <>
          <h3>
            <Bi en="The long-short tangent's weights" zh="多空切線組合的權重" />
          </h3>
          <div className="table-wrap">
            <table className="compact">
              <tbody>
                {ids.map((id, i) => (
                  <tr key={id}>
                    <td>
                      <Bi {...names(id)} />
                    </td>
                    <td className="num">{percent(shortBest.weights[i], 1)}</td>
                    <td className="num muted small">{(shortBest.weights[i] ?? 0) < -1e-6 ? bi({ en: 'short', zh: '做空' }) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted small">
        <Bi
          en={`Volatility scales with leverage but the Sharpe ratio only falls by the borrowing spread, which is why the capital allocation line is straight. What a straight line hides: losses beyond 100% of own money end in a margin call, shorts pay borrow fees and the dividends of what they borrowed, and the optimiser leans hardest on the expected returns you typed. ${current ? `Your current mix: ${percent(expectedReturn(current.weights, problem.mu), 2)} at ${percent(volatility(current.weights, problem.sigma), 2)} before leverage.` : ''}`}
          zh={`波動度隨槓桿等比放大，夏普比率卻只會因借款利差而下降，所以資本配置線是直線。直線看不到的是：虧損超過自有資金會被追繳保證金；做空要付借券費，以及所借股票的股利；最適化也最依賴你輸入的預期報酬。${current ? `你目前的配置在未加槓桿時為報酬 ${percent(expectedReturn(current.weights, problem.mu), 2)}、波動度 ${percent(volatility(current.weights, problem.sigma), 2)}。` : ''}`}
        />
      </p>
    </section>
  );
}
