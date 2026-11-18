import { Bi } from '@/components/bi';
import { Facts, type Fact } from '@/components/facts';
import { Info } from '@/components/info';
import type { StockBench } from '@/lib/data';
import { money, signedPercent } from '@/lib/format';
import { feedLabel, type Bilingual } from '@/lib/i18n';
import { metrics } from '@/lib/models/intrinsic';
import { peCheck, type PeCheck, type PeCheckSettings, type Signal, type Verdict } from '@/lib/models/forward-pe';

import { clearEstimates } from './actions';
import { EstimatesForm } from './forms';

const pe = (value: number | undefined) => (value === undefined ? '—' : `${value.toFixed(1)}×`);
const signed = (value: number) => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0');

const VERDICT: Record<Verdict, { label: Bilingual; tone: 'ok' | 'info' | 'warn'; advice: Bilingual }> = {
  attractive: {
    label: { en: 'Leans cheap', zh: '偏便宜' },
    tone: 'ok',
    advice: { en: 'On the analysts’ numbers the price looks low: a buy is worth weighing, once the valuation zone and the red flags agree.', zh: '依分析師預估，股價看來偏低，值得考慮買入；仍須與估值區間與紅旗指標相互印證。' },
  },
  neutral: {
    label: { en: 'Neutral', zh: '中性' },
    tone: 'info',
    advice: { en: 'No clear lean: let the valuation zone decide, or wait for a better price.', zh: '沒有明確傾向：以估值區間為準，或等待更好的價格。' },
  },
  expensive: {
    label: { en: 'Leans expensive', zh: '偏貴' },
    tone: 'warn',
    advice: { en: 'The price already asks a lot of the forecast: not a time to add.', zh: '股價已反映相當樂觀的預期：不宜加碼。' },
  },
};

const CAVEAT: Record<PeCheck['caveats'][number], Bilingual> = {
  no_estimates: { en: 'No consensus yet: the nightly job loads US stocks’ (with ALPHAVANTAGE_API_KEY); type Taiwan’s in below.', zh: '尚無共識預估：每夜排程會載入美股（需 ALPHAVANTAGE_API_KEY）；台股請在下方自行輸入。' },
  loss: { en: 'The analysts expect a loss: a P/E does not apply.', zh: '分析師預估虧損，本益比不適用。' },
  thin: { en: 'Too few analysts for a verdict.', zh: '分析師人數太少，不下結論。' },
  stale: { en: 'The consensus is old: refresh it before deciding.', zh: '共識預估已過時，決定前請先更新。' },
  currency: { en: 'The estimates are in another currency than the price (an ADR?).', zh: '預估的幣別與股價不同（存託憑證？）。' },
};

const MARK: Record<Signal['tone'], { icon: string; className: string }> = { good: { icon: '✓', className: 'ok' }, bad: { icon: '✕', className: 'rebalance' }, neutral: { icon: '–', className: 'idle' } };

function signalText(signal: Signal, check: PeCheck, settings: PeCheckSettings, currency: string): Bilingual {
  switch (signal.id) {
    case 'history':
    case 'peers': {
      const where = signal.id === 'history' ? { en: 'its own five-year median', zh: '自身五年中位數' } : { en: 'its peers’ median', zh: '同業中位數' };
      return {
        en: `Forward P/E ${pe(check.forwardPe)} is ${signedPercent(signal.value)} against ${where.en} ${pe(check.reference?.pe)} (cheap below −${Math.round(settings.cheapDiscount * 100)}%, rich above +${Math.round(settings.richPremium * 100)}%); at that P/E the price would be ${money(check.fairPrice, currency)}.`,
        zh: `預估本益比 ${pe(check.forwardPe)}，相對${where.zh} ${pe(check.reference?.pe)} 為 ${signedPercent(signal.value)}（低於 −${Math.round(settings.cheapDiscount * 100)}% 偏便宜、高於 +${Math.round(settings.richPremium * 100)}% 偏貴）；以該本益比計算股價應為 ${money(check.fairPrice, currency)}。`,
      };
    }
    case 'peg':
      return Number.isFinite(signal.value)
        ? {
            en: `PEG ${signal.value.toFixed(2)}: the forward P/E for ${signedPercent(check.growth ?? 0)} EPS growth over the trailing year (cheap at or below ${settings.pegCheap}, rich at or above ${settings.pegRich}).`,
            zh: `PEG ${signal.value.toFixed(2)}：以近四季 EPS 計算的預估成長 ${signedPercent(check.growth ?? 0)} 下的本益比（≤ ${settings.pegCheap} 偏便宜，≥ ${settings.pegRich} 偏貴）。`,
          }
        : { en: `The analysts expect EPS to fall (${signedPercent(check.growth ?? 0)}): any P/E is rich for that.`, zh: `分析師預估 EPS 將下滑（${signedPercent(check.growth ?? 0)}），任何本益比都偏貴。` };
    case 'revisions':
      return {
        en: `The consensus moved ${signedPercent(signal.value)} in 30 days (${check.blend?.up30 ?? 0} up, ${check.blend?.down30 ?? 0} down): ${signal.tone === 'good' ? 'raised' : signal.tone === 'bad' ? 'cut' : 'flat'}.`,
        zh: `共識預估 30 天內變動 ${signedPercent(signal.value)}（上修 ${check.blend?.up30 ?? 0}、下修 ${check.blend?.down30 ?? 0} 位）：${signal.tone === 'good' ? '上修' : signal.tone === 'bad' ? '下修' : '持平'}。`,
      };
    case 'target':
      return {
        en: `The mean target price is ${signedPercent(signal.value)} from today’s price; for reference only, as it is the same analysts’ view.`,
        zh: `平均目標價距今日股價 ${signedPercent(signal.value)}；同一批分析師的看法，僅供參考、不計分。`,
      };
  }
}

/**
 * F12's forward P/E check on a stock's Valuation page: today's trailing P/E against the forward
 * P/E on the analysts' consensus, the own five-year median and the PEG, each a signal, and the
 * verdict they lean to. Display only: the buy and trim zones stay the alerts.
 */
export function PeCheckCard({ bench, settings, today, saved }: { bench: StockBench; settings: PeCheckSettings; today: string; saved: string | undefined }) {
  const { security, input, valuation, estimates } = bench;
  const currency = security.currency;
  const price = input?.price.close;
  const sameCurrency = (bench.series.reportCurrency ?? currency) === currency;
  const ttmEps = input && sameCurrency ? metrics(input.quarter.figures).eps : undefined;
  const multiples = valuation?.multiples.ok ? valuation.multiples.result : undefined;
  const check =
    price === undefined
      ? undefined
      : peCheck({ price, priceCurrency: currency, ttmEps, ownMedianPe: multiples?.own.pe?.median, peersPe: multiples?.peers.pe, ...(estimates ? { estimates } : {}), today }, settings);
  const verdict = check ? VERDICT[check.verdict] : undefined;
  const ratings = estimates?.ratings;
  const rated = ratings ? ratings.strongBuy + ratings.buy + ratings.hold + ratings.sell + ratings.strongSell : 0;
  const facts: Fact[] = check
    ? [
        { label: { en: 'Trailing P/E', zh: '目前本益比' }, value: pe(check.trailingPe), note: { en: 'price ÷ last 4 quarters’ EPS', zh: '股價 ÷ 近四季 EPS' } },
        {
          label: { en: 'Forward P/E', zh: '預估本益比' },
          value: pe(check.forwardPe),
          ...(check.forwardRange ? { note: { en: `${pe(check.forwardRange.low)} – ${pe(check.forwardRange.high)} across analysts`, zh: `分析師區間 ${pe(check.forwardRange.low)} – ${pe(check.forwardRange.high)}` } } : {}),
          tone: check.discount === undefined ? 'none' : check.discount <= -settings.cheapDiscount ? 'ok' : check.discount >= settings.richPremium ? 'alert' : 'watch',
        },
        {
          label: check.reference?.from === 'peers' ? { en: 'Peers’ median P/E', zh: '同業本益比中位數' } : { en: 'Own 5-year median P/E', zh: '自身五年本益比中位數' },
          value: pe(check.reference?.pe),
          ...(multiples?.own.pe ? { note: { en: `${pe(multiples.own.pe.low)} – ${pe(multiples.own.pe.high)}`, zh: `${pe(multiples.own.pe.low)} – ${pe(multiples.own.pe.high)}` } } : {}),
        },
        { label: { en: 'Next 12 months’ EPS', zh: '未來 12 個月 EPS' }, value: check.blend ? money(check.blend.eps, currency) : '—', ...(check.growth !== undefined ? { note: { en: `${signedPercent(check.growth)} on the trailing year`, zh: `較近四季 ${signedPercent(check.growth)}` } } : {}) },
        { label: { en: 'PEG', zh: 'PEG' }, value: check.peg === undefined ? '—' : check.peg.toFixed(2) },
        {
          label: { en: 'Analysts', zh: '分析師' },
          value: check.blend?.analysts ?? '—',
          ...(rated > 0 && ratings ? { note: { en: `${ratings.strongBuy + ratings.buy} buy · ${ratings.hold} hold · ${ratings.sell + ratings.strongSell} sell`, zh: `買進 ${ratings.strongBuy + ratings.buy}・持有 ${ratings.hold}・賣出 ${ratings.sell + ratings.strongSell}` } } : {}),
        },
        ...(estimates?.targetPrice !== undefined ? [{ label: { en: 'Mean target price', zh: '平均目標價' }, value: money(estimates.targetPrice, currency), ...(check.targetUpside !== undefined ? { note: { en: signedPercent(check.targetUpside), zh: signedPercent(check.targetUpside) } } : {}) }] : []),
      ]
    : [];
  const fy1 = estimates?.years.find((year) => year.periodEnd > today);
  const fy2 = estimates?.years.find((year) => fy1 && year.periodEnd > fy1.periodEnd);
  const typed = estimates?.source === 'typed';
  const field = (value: number | undefined) => (value === undefined ? '' : String(value));

  return (
    <section className="card form" id="pe-check" aria-labelledby="pe-check-title">
      <h2 id="pe-check-title">
        <Bi en="Forward P/E check" zh="本益比診斷" />
      </h2>
      {saved === 'estimates' && (
        <p className="banner ok" role="status">
          <Bi en="Consensus saved." zh="已儲存共識預估。" />
        </p>
      )}
      {saved === 'estimates-cleared' && (
        <p className="banner ok" role="status">
          <Bi en="Consensus removed." zh="已移除共識預估。" />
        </p>
      )}
      {!check ? (
        <p className="muted">
          <Bi en="No close yet: the nightly job loads it." zh="尚無收盤價：每夜排程會載入。" />
        </p>
      ) : (
        <>
          {verdict && !check.caveats.includes('no_estimates') && (
            <div className={`banner ${verdict.tone} pe-verdict`} role="status">
              <strong>
                <Bi {...verdict.label} />
              </strong>{' '}
              <span className="muted small">
                <Bi en={`score ${signed(check.score)}`} zh={`分數 ${signed(check.score)}`} />
              </span>
              <div>
                <Bi {...verdict.advice} />
              </div>
            </div>
          )}
          {check.caveats.length > 0 && (
            <ul className="banner info caveats">
              {check.caveats.map((caveat) => (
                <li key={caveat}>
                  <Bi {...CAVEAT[caveat]} />
                </li>
              ))}
            </ul>
          )}
          <Facts facts={facts} />
          {check.signals.length > 0 && (
            <ul className="pe-signals">
              {check.signals.map((signal) => (
                <li key={signal.id}>
                  <span className={`status-icon ${MARK[signal.tone].className}`} aria-hidden="true">
                    {MARK[signal.tone].icon}
                  </span>
                  <Bi {...signalText(signal, check, settings, currency)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {estimates && (
        <p className="muted small">
          <Bi
            en={`Consensus as of ${estimates.asOf}, ${typed ? 'typed in' : feedLabel(estimates.source).en}${check?.blend ? `; next 12 months = ${Math.round(check.blend.weight * 100)}% FY${check.blend.fy1.periodEnd.slice(0, 4)} + ${100 - Math.round(check.blend.weight * 100)}% FY${check.blend.fy2?.periodEnd.slice(0, 4) ?? ''}` : ''}.`}
            zh={`共識預估日期 ${estimates.asOf}，來源：${typed ? '自行輸入' : feedLabel(estimates.source).zh}${check?.blend ? `；未來 12 個月 ＝ ${Math.round(check.blend.weight * 100)}% ${check.blend.fy1.periodEnd.slice(0, 4)} 年度 ＋ ${100 - Math.round(check.blend.weight * 100)}% ${check.blend.fy2?.periodEnd.slice(0, 4) ?? ''} 年度` : ''}。`}
          />
        </p>
      )}
      <Info label={{ en: 'How it reads', zh: '判讀方式' }}>
        <ul className="formula">
          <li>
            <Bi
              en="Next 12 months’ EPS = w × FY1 + (1 − w) × FY2, w = days left in FY1 ÷ 365; forward P/E = price ÷ that EPS; PEG = forward P/E ÷ (growth × 100)."
              zh="未來 12 個月 EPS ＝ w × 第一年度 ＋（1 − w）× 第二年度，w ＝ 第一年度剩餘天數 ÷ 365；預估本益比 ＝ 股價 ÷ 該 EPS；PEG ＝ 預估本益比 ÷（成長率 × 100）。"
            />
          </li>
          <li>
            <Bi
              en={`Each of the own-median, PEG and revisions signals scores +1 or −1; ±${settings.score} leans the verdict. Below ${settings.minAnalysts} analysts, or a consensus over ${settings.staleDays} days old, it stays neutral. The thresholds are in config pe_check.`}
              zh={`自身中位數、PEG 與預估修正三個訊號各記 +1 或 −1；合計達 ±${settings.score} 才有傾向。分析師少於 ${settings.minAnalysts} 位或預估超過 ${settings.staleDays} 天，結論維持中性。門檻設定在 config pe_check。`}
            />
          </li>
          <li>
            <Bi
              en="Free feeds give the consensus of all covering analysts (mean, highest and lowest), not a ranking of the best ones: the highest and lowest EPS stand for the most bullish and bearish of them. US stocks load from Alpha Vantage once a week; for Taiwan, type the consensus from a broker’s or news site’s page."
              zh="免費資料來源提供的是所有追蹤分析師的共識（平均、最高、最低），而非「頂尖分析師」排名；最高與最低 EPS 即代表最樂觀與最悲觀的分析師。美股每週自 Alpha Vantage 載入；台股請自行輸入券商或財經網站上的共識預估。"
            />
          </li>
        </ul>
      </Info>
      <details className="more-fields" open={!estimates && security.market !== 'US'}>
        <summary>
          <Bi en={typed ? 'Edit the consensus typed in' : 'Type the consensus in'} zh={typed ? '修改自行輸入的共識預估' : '自行輸入共識預估'} />
        </summary>
        <EstimatesForm
          ticker={security.ticker}
          currency={currency}
          initial={{
            fy1_end: fy1?.periodEnd ?? '',
            fy1_eps: field(fy1?.mean),
            fy1_high: field(fy1?.high),
            fy1_low: field(fy1?.low),
            analysts: field(fy1?.analysts),
            target: field(estimates?.targetPrice),
            fy2_end: fy2?.periodEnd ?? '',
            fy2_eps: field(fy2?.mean),
          }}
        />
        {estimates && (
          <form action={clearEstimates} className="row">
            <input type="hidden" name="ticker" value={security.ticker} />
            <button type="submit" className="button">
              <Bi en="Remove the consensus" zh="移除共識預估" />
            </button>
          </form>
        )}
      </details>
    </section>
  );
}
