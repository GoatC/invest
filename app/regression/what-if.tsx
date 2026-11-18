import { Bi } from '@/components/bi';
import { percent, signedPercent, twd } from '@/lib/format';
import { DIRECTION, leverageText } from '@/lib/i18n';
import { positionBeta, type Benchmark, type Choice, type RegressionOutcome } from '@/lib/models/regression';
import { queryAmount, queryDirection, queryLeverage, tenths } from '@/lib/what-if';

type Params = Record<string, string | string[] | undefined>;

const STEPS = tenths(1, 10);
/** Index moves to try, −30% to +30% in 5-point steps. */
const MOVES = Array.from({ length: 13 }, (_, index) => -30 + index * 5);

/**
 * The Regression Lab with a position size and direction: the ticker's β and α held long or short,
 * leveraged, on a given amount of own money, what an index move would do to that money, and the
 * index amount that cancels its β. Analysis only.
 */
export function BetaWhatIf({
  params,
  ticker,
  choice,
  compare,
  against,
  results,
}: {
  params: Params;
  ticker: string;
  choice: Choice;
  compare: readonly string[];
  against: string;
  results: ReadonlyArray<{ benchmark: Benchmark; outcome: RegressionOutcome }>;
}) {
  const direction = queryDirection(params, 'rd');
  const leverage = queryLeverage(params, 'rl', 1, 10, 1);
  const margin = queryAmount(params, 'rm', 100000);
  const move = queryLeverage(params, 'rx', -30, 30, -10) / 100;
  const fits = results.flatMap(({ benchmark, outcome }) => (outcome.ok ? [{ benchmark, result: outcome.result }] : []));
  if (fits.length === 0) return null;
  return (
    <section className="card form" id="beta-what-if">
      <h2>
        <Bi en="What if: hold it long or short, with leverage" zh="假設情境：做多或做空，加上槓桿" />
      </h2>
      <p className="muted small">
        <Bi
          en="β above is for one dollar held long. A short turns it negative, leverage multiplies it, and both apply to α too. Pick a size to see what an index move would do to your own money, and how much of the index would cancel the position's market risk."
          zh="上方的 β 是做多 1 元的結果。做空會讓它變成負值，槓桿會把它放大，α 也一樣。選定部位大小，就能看到指數漲跌會讓你的自有資金變動多少，以及要多少指數部位才能抵銷這個部位的市場風險。"
        />
      </p>
      <form method="get" action="/regression#beta-what-if" className="form-grid">
        <input type="hidden" name="t" value={ticker} />
        <input type="hidden" name="f" value={choice.freq} />
        <input type="hidden" name="y" value={choice.years} />
        <input type="hidden" name="c" value={choice.basis} />
        <input type="hidden" name="vs" value={compare.join(',')} />
        <input type="hidden" name="b" value={against} />
        <label className="field">
          <Bi en="Direction" zh="多空方向" />
          <select name="rd" defaultValue={direction}>
            <option value="long">{`${DIRECTION.long.en} ${DIRECTION.long.zh}`}</option>
            <option value="short">{`${DIRECTION.short.en} ${DIRECTION.short.zh}`}</option>
          </select>
        </label>
        <label className="field">
          <Bi en="Leverage (0.1× steps)" zh="槓桿（0.1 倍級距）" />
          <select name="rl" defaultValue={leverage.toFixed(1)}>
            {STEPS.map((step) => (
              <option key={step} value={step.toFixed(1)}>
                {leverageText(step)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <Bi en="Own money (TWD)" zh="自有資金（台幣）" />
          <input name="rm" inputMode="decimal" defaultValue={String(margin)} />
        </label>
        <label className="field">
          <Bi en="Index move (excess return)" zh="指數漲跌（超額報酬）" />
          <select name="rx" defaultValue={String(Math.round(move * 100))}>
            {MOVES.map((value) => (
              <option key={value} value={String(value)}>
                {`${value > 0 ? '+' : ''}${value}%`}
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
                <Bi en="Against" zh="對照指數" />
              </th>
              <th className="num">
                <Bi en={`β, ${DIRECTION[direction].en.split(' ')[0]?.toLowerCase()} ${leverageText(leverage)}`} zh={`β（${DIRECTION[direction].zh.slice(0, 2)} ${leverageText(leverage)}）`} />
              </th>
              <th className="num">
                <Bi en="α a year on own money" zh="自有資金年化 α" />
              </th>
              <th className="num">
                <Bi en={`Own money if the index moves ${signedPercent(move)}`} zh={`指數 ${signedPercent(move)} 時自有資金`} />
              </th>
              <th className="num">
                <Bi en="Index to cancel β" zh="抵銷 β 所需指數部位" />
              </th>
            </tr>
          </thead>
          <tbody>
            {fits.map(({ benchmark, result }) => {
              const figures = positionBeta(result, direction, leverage, margin, move);
              return (
                <tr key={benchmark.id}>
                  <td>
                    <Bi en={benchmark.nameEn} zh={benchmark.nameZh} />
                  </td>
                  <td className="num">{figures.beta.toFixed(2)}</td>
                  <td className="num">{signedPercent(figures.alphaAnnual)}</td>
                  <td className="num">
                    {signedPercent(figures.ownMove)}
                    <div className="muted small">{twd(margin * figures.ownMove)}</div>
                  </td>
                  <td className="num">
                    {figures.hedgeTwd >= 0 ? (
                      <Bi en={`short ${twd(figures.hedgeTwd)}`} zh={`做空 ${twd(figures.hedgeTwd)}`} />
                    ) : (
                      <Bi en={`buy ${twd(-figures.hedgeTwd)}`} zh={`買進 ${twd(-figures.hedgeTwd)}`} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        <Bi
          en={`Only the market part of the move: the ${percent(1 - (fits[0]?.result.r2 ?? 0), 0)} of variance β does not explain is leveraged too, and α is before borrowing cost, borrow fees and the dividends a short pays. β is a past estimate with the interval shown above.`}
          zh={`這只是漲跌中的市場部分：β 無法解釋的 ${percent(1 - (fits[0]?.result.r2 ?? 0), 0)} 變異同樣會被放大；α 也尚未扣除融資利息、借券費與做空須支付的股利。β 是以過去資料估計的值，信賴區間見上方。`}
        />
      </p>
    </section>
  );
}
