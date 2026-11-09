import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { Facts, type Fact } from '@/components/facts';
import { Info } from '@/components/info';
import { PriceHistoryChart } from '@/components/price-history-chart';
import { requireSession } from '@/lib/auth';
import { DataError, loadHoldingsData, loadPriceHistory, orDataError } from '@/lib/data';
import { money, percent, quantity, twd } from '@/lib/format';
import { ACTION, leverageText, POOL } from '@/lib/i18n';
import { buildPortfolio } from '@/lib/models/portfolio';

import { tickerLinks } from '../../ticker-links';

/**
 * One listed holding (N5 holdings view): its figures as tiles, its closes over a range and step the
 * reader picks, with every buy and sell marked at its trade date and price, and its trades folded.
 */
export default async function HoldingChartPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { supabase } = await requireSession();
  const ticker = decodeURIComponent((await params).ticker).toUpperCase();
  const loaded = await orDataError(Promise.all([loadHoldingsData(supabase), loadPriceHistory(supabase, ticker)]));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const [data, closes] = loaded;
  const security = data.securities.find((candidate) => candidate.ticker === ticker);
  if (!security) notFound();

  const portfolio = buildPortfolio(data);
  const holdings = portfolio.holdings.filter((holding) => holding.ticker === ticker);
  const longs = portfolio.positions.filter((position) => position.ticker === ticker && position.direction === 'long' && position.qty > 0);
  const longQty = longs.reduce((total, position) => total + position.qty, 0);
  const avgCost = longQty > 0 ? longs.reduce((total, position) => total + position.costLocal, 0) / longQty : null;
  const valued = holdings.filter((holding) => holding.valueTwd !== null && holding.costTwd !== null);
  const valueTwd = valued.reduce((total, holding) => total + (holding.valueTwd ?? 0), 0);
  const costTwd = valued.reduce((total, holding) => total + (holding.costTwd ?? 0), 0);
  const gainTwd = valueTwd - costTwd;
  const last = closes[closes.length - 1];
  const trades = data.trades.filter((trade) => trade.ticker === ticker);
  const qty = holdings.reduce((total, holding) => total + (holding.direction === 'short' ? -holding.qty : holding.qty), 0);

  const facts: Fact[] = [
    { label: { en: 'Quantity held', zh: '持有數量' }, value: quantity(qty) },
    { label: { en: 'Average cost', zh: '平均成本' }, value: money(avgCost, security.currency) },
    { label: { en: 'Last close', zh: '最新收盤' }, value: money(last?.close, security.currency), ...(last ? { note: { en: last.date, zh: last.date } } : {}) },
    { label: { en: 'Market value (TWD)', zh: '市值（台幣）' }, value: valued.length > 0 ? twd(valueTwd) : '—' },
    {
      label: { en: 'Unrealised gain', zh: '未實現損益' },
      value: valued.length > 0 ? twd(gainTwd) : '—',
      ...(valued.length > 0 && costTwd > 0 ? { note: { en: percent(gainTwd / costTwd), zh: percent(gainTwd / costTwd) } } : {}),
      tone: valued.length === 0 ? 'none' : gainTwd >= 0 ? 'ok' : 'alert',
    },
  ];

  return (
    <>
      <section className="card form">
        <div className="row spread">
          <h1>{ticker}</h1>
          <Link href="/holdings" className="small">
            <Bi en="Back to holdings" zh="回持倉" />
          </Link>
        </div>
        <p className="muted small">{`${security.name} · ${security.currency}`}</p>
        <Facts facts={facts} />
      </section>
      <section className="card form">
        <h2>
          <Bi en="Price & trades" zh="走勢與買賣點" />
        </h2>
        <PriceHistoryChart
          ticker={ticker}
          currency={security.currency}
          points={closes}
          trades={trades.map((trade) => ({ ticker: trade.ticker, tradeDate: trade.tradeDate, side: trade.side, direction: trade.direction ?? 'long', qty: trade.qty, price: trade.price }))}
          avgCost={avgCost}
        />
        <Info>
          <p>
            <Bi
              en="Daily closes as quoted, from the nightly job. ▲ marks a buy and ▼ a sell at the price you recorded; the dashed line is the average cost of the long shares now held, fees included. A week, month or year step shows each period's last close."
              zh="每夜排程載入的每日收盤價（未還原）。▲ 為買進、▼ 為賣出，位置是你登錄的成交價；虛線為目前做多持股的平均成本（含手續費）。週、月、年週期顯示每期最後一個收盤價。"
            />
          </p>
        </Info>
      </section>
      {trades.length > 0 && (
        <section className="card form">
          <details>
            <summary>
              <Bi en="Trades" zh="交易紀錄" /> {`(${trades.length})`}
            </summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <Bi en="Date" zh="日期" />
                    </th>
                    <th>
                      <Bi en="Buy / sell" zh="買賣" />
                    </th>
                    <th className="num">
                      <Bi en="Quantity" zh="數量" />
                    </th>
                    <th className="num">
                      <Bi en="Price" zh="價格" />
                    </th>
                    <th>
                      <Bi en="Pool" zh="資金池" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr key={trade.id}>
                      <td className="nowrap">
                        <Link href={`/holdings/${trade.id}`}>{trade.tradeDate}</Link>
                      </td>
                      <td className="nowrap">
                        <span className={`status-icon ${trade.side === 'buy' ? 'ok' : 'rebalance'}`} aria-hidden="true">
                          {trade.side === 'buy' ? '▲' : '▼'}
                        </span>
                        <Bi {...ACTION[trade.direction ?? 'long'][trade.side]} />
                        {(trade.leverage ?? 1) !== 1 && <span className="muted small">{` ${leverageText(trade.leverage ?? 1)}`}</span>}
                      </td>
                      <td className="num">{quantity(trade.qty)}</td>
                      <td className="num">{money(trade.price, trade.currency)}</td>
                      <td className="nowrap">
                        <Bi {...POOL[trade.pool]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}
      <section className="card">
        <div className="row">
          {tickerLinks(ticker, security.productType)
            .slice(1)
            .map((link) => (
              <Link key={link.href} href={link.href} className="chip">
                <Bi {...link.label} />
              </Link>
            ))}
        </div>
      </section>
    </>
  );
}
