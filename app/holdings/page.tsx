import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { requireSession } from '@/lib/auth';
import { DataError, loadHoldingsData, type HoldingsData } from '@/lib/data';
import { money, percent, points, quantity, twd } from '@/lib/format';
import { LABELS, POOL, PRODUCT, SIDE, SLEEVE, SOURCE, type Bilingual } from '@/lib/i18n';
import { buildPortfolio, type Portfolio } from '@/lib/models/portfolio';
import { positionKey, type Shortfall } from '@/lib/models/positions';
import { capBreaches, type CapBreach } from '@/lib/models/rules';
import type { Holding } from '@/lib/models/valuation';
import { breachText } from '@/lib/rule-text';

type Params = Record<string, string | string[] | undefined>;

function param(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** The confirmation after a save, keyed by the ?saved= value the actions redirect with. */
const SAVED: Record<string, Bilingual> = {
  added: { en: 'Trade added.', zh: '已新增交易。' },
  updated: { en: 'Trade updated.', zh: '已更新交易。' },
  deleted: { en: 'Trade deleted; the edit history keeps a copy.', zh: '已刪除交易，修改紀錄中保留一份副本。' },
  'asset-added': { en: 'Non-listed asset added.', zh: '已新增非上市資產。' },
  'asset-updated': { en: 'Non-listed asset updated.', zh: '已更新非上市資產。' },
  'asset-deleted': { en: 'Non-listed asset deleted; the edit history keeps a copy.', zh: '已刪除非上市資產，修改紀錄中保留一份副本。' },
};

function savedMessage(params: Params): Bilingual | undefined {
  const saved = param(params, 'saved');
  if (saved !== 'imported') return saved ? SAVED[saved] : undefined;
  const count = (key: string) => Math.max(0, Number.parseInt(param(params, key) ?? '', 10) || 0);
  const added = count('added');
  const skipped = count('skipped');
  return {
    en: `Imported ${added} trade${added === 1 ? '' : 's'}${skipped > 0 ? `; ${skipped} row${skipped === 1 ? '' : 's'} of the file skipped` : ''}.`,
    zh: `已匯入 ${added} 筆交易${skipped > 0 ? `，略過檔案中的 ${skipped} 列` : ''}。`,
  };
}

/** How many trades the list shows before "Show all". */
const RECENT_TRADES = 50;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function shortfallText(shortfall: Shortfall): Bilingual {
  const missing = quantity(shortfall.missingQty);
  return {
    en: `The ${shortfall.ticker} sell on ${shortfall.tradeDate} is ${missing} units larger than the ${POOL[shortfall.pool].en.toLowerCase()} pool held: a buy is missing or a quantity is wrong.`,
    zh: `${shortfall.tradeDate} 賣出的 ${shortfall.ticker} 比${POOL[shortfall.pool].zh}資金池當時持有的多 ${missing} 單位，可能漏記買進或數量有誤。`,
  };
}

export default async function HoldingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  let data: HoldingsData;
  try {
    data = await loadHoldingsData(supabase);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const portfolio = buildPortfolio(data);
  const saved = savedMessage(params);
  const empty = data.trades.length === 0 && data.manualAssets.length === 0;

  return (
    <>
      {saved && (
        <p className="banner ok" role="status">
          <Bi {...saved} />
        </p>
      )}
      {portfolio.shortfalls.length > 0 && (
        <div className="banner danger" role="alert">
          <Bi en="Some sells are larger than the holding; fix these trades so the figures add up:" zh="部分賣出數量超過持有數量，請修正以下交易，數字才會正確：" />
          <ul>
            {portfolio.shortfalls.map((shortfall) => (
              <li key={`${shortfall.pool}:${shortfall.ticker}:${shortfall.tradeDate}`}>
                <Bi {...shortfallText(shortfall)} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="card form">
        <div className="row spread">
          <h1>
            <Bi {...LABELS.holdings} />
          </h1>
          <div className="row">
            <Link href="/holdings/new" className="button primary">
              <Bi {...LABELS.addTrade} />
            </Link>
            <Link href="/import" className="button">
              <Bi {...LABELS.importCsv} />
            </Link>
            <Link href="/assets/new" className="button">
              <Bi {...LABELS.addAsset} />
            </Link>
          </div>
        </div>
        {empty ? (
          <p className="muted">
            <Bi
              en="Nothing recorded yet. Add your first trade, import a broker statement, or add gold or a cash balance."
              zh="尚無任何紀錄。請新增第一筆交易、匯入券商對帳單，或新增黃金與現金餘額。"
            />
          </p>
        ) : (
          <Summary data={data} portfolio={portfolio} />
        )}
      </section>
      {!empty && (
        <>
          <RulesStatus data={data} portfolio={portfolio} />
          <ClassWeights portfolio={portfolio} />
          <ListedHoldings data={data} portfolio={portfolio} />
        </>
      )}
      <ManualAssets data={data} portfolio={portfolio} />
      {data.trades.length > 0 && <Trades data={data} showAll={param(params, 'trades') === 'all'} />}
      {!empty && <Footnotes />}
    </>
  );
}

function Stat({ label, value, note }: { label: Bilingual; value: string; note?: Bilingual }) {
  return (
    <div className="stat">
      <span className="muted small">
        <Bi {...label} />
      </span>
      <span className="value">{value}</span>
      {note && (
        <span className="muted small">
          <Bi {...note} />
        </span>
      )}
    </div>
  );
}

function satelliteValue(holdings: readonly Holding[]): number {
  return sum(holdings.filter((holding) => holding.sleeve === 'satellite').map((holding) => holding.valueTwd ?? 0));
}

function Summary({ data, portfolio }: { data: HoldingsData; portfolio: Portfolio }) {
  const { pool } = portfolio;
  const windfallTwd = sum(portfolio.holdings.filter((holding) => holding.pool === 'windfall').map((holding) => holding.valueTwd ?? 0));
  const satelliteShare = pool.totalTwd > 0 ? satelliteValue(pool.holdings) / pool.totalTwd : null;
  const valued = portfolio.holdings.filter((holding) => holding.costTwd !== null && holding.valueTwd !== null);
  const costTwd = sum(valued.map((holding) => holding.costTwd ?? 0));
  const gainTwd = sum(valued.map((holding) => (holding.valueTwd ?? 0) - (holding.costTwd ?? 0)));
  const trigger = data.caps.satellite?.triggerWeight;
  return (
    <div className="grid-cards">
      <Stat label={{ en: 'Regular pool', zh: '一般投入資金池' }} value={twd(pool.totalTwd)} note={{ en: 'What R1, R2 and the targets measure', zh: 'R1、R2 與目標權重的計算基礎' }} />
      <Stat label={{ en: 'Windfall pool', zh: '大額資金池' }} value={twd(windfallTwd)} note={{ en: 'Left out of R1 and R2', zh: '不計入 R1 與 R2' }} />
      <Stat
        label={{ en: 'Satellite share', zh: '衛星部位占比' }}
        value={percent(satelliteShare)}
        note={trigger === undefined ? { en: 'R2 is turned off', zh: 'R2 未啟用' } : { en: `R2 trigger ${percent(trigger, 0)}`, zh: `R2 觸發點 ${percent(trigger, 0)}` }}
      />
      <Stat
        label={{ en: 'Unrealised gain, listed holdings', zh: '上市持股未實現損益' }}
        value={twd(gainTwd)}
        note={{ en: `${percent(costTwd > 0 ? gainTwd / costTwd : null)} on a cost of ${twd(costTwd)}`, zh: `成本 ${twd(costTwd)}，報酬率 ${percent(costTwd > 0 ? gainTwd / costTwd : null)}` }}
      />
    </div>
  );
}

function rulesOk(data: HoldingsData, portfolio: Portfolio): Bilingual[] {
  const { singleStock, satellite } = data.caps;
  const lines: Bilingual[] = [];
  lines.push(
    singleStock
      ? { en: `R1: no single stock is above ${percent(singleStock.maxWeight, 0)} of the regular pool.`, zh: `R1：沒有任何單一個股超過一般投入資金池的 ${percent(singleStock.maxWeight, 0)}。` }
      : { en: 'R1 is turned off in the rules table.', zh: 'R1 已在規則表中停用。' },
  );
  const share = portfolio.pool.totalTwd > 0 ? satelliteValue(portfolio.pool.holdings) / portfolio.pool.totalTwd : 0;
  lines.push(
    satellite
      ? {
          en: `R2: the satellite is ${percent(share)} of the regular pool, below the ${percent(satellite.triggerWeight, 0)} trigger.`,
          zh: `R2：衛星部位占一般投入資金池的 ${percent(share)}，低於 ${percent(satellite.triggerWeight, 0)} 觸發點。`,
        }
      : { en: 'R2 is turned off in the rules table.', zh: 'R2 已在規則表中停用。' },
  );
  return lines;
}

function RulesStatus({ data, portfolio }: { data: HoldingsData; portfolio: Portfolio }) {
  const breaches: CapBreach[] = capBreaches(portfolio.holdings, data.caps);
  const unpriced = portfolio.pool.unpriced;
  return (
    <section className="card form">
      <h2>
        <Bi en="Rules R1 and R2" zh="規則 R1 與 R2" />
      </h2>
      {breaches.length > 0 ? (
        <div className="banner warn">
          <Bi en="Above a limit:" zh="超過限制：" />
          <ul>
            {breaches.map((breach) => (
              <li key={`${breach.rule}:${breach.subject}`}>
                <Bi {...breachText(breach, data.caps, 'now')} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="banner ok">
          <ul>
            {rulesOk(data, portfolio).map((line) => (
              <li key={line.en}>
                <Bi {...line} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {unpriced.length > 0 && (
        <p className="banner info">
          <Bi
            en={`Not valued yet, so left out of the totals, weights and rules: ${unpriced.map((holding) => holding.ticker ?? holding.label).join(', ')}.`}
            zh={`尚未估值，暫不計入總額、權重與規則：${unpriced.map((holding) => holding.ticker ?? holding.label).join('、')}。`}
          />
        </p>
      )}
    </section>
  );
}

function ClassWeights({ portfolio }: { portfolio: Portfolio }) {
  const totalTarget = sum(portfolio.classes.map((row) => row.assetClass.targetWeight));
  return (
    <section className="card form">
      <h2>
        <Bi en="Actual vs target weight" zh="實際與目標權重" />
      </h2>
      <p className="muted small">
        <Bi en="Shares of the regular pool; windfall money is not counted." zh="以一般投入資金池計算，不含大額資金。" />
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Bi {...LABELS.assetClass} />
              </th>
              <th>
                <Bi {...LABELS.sleeve} />
              </th>
              <th className="num">
                <Bi {...LABELS.valueTwd} />
              </th>
              <th className="num">
                <Bi {...LABELS.target} />
              </th>
              <th className="num">
                <Bi {...LABELS.actual} />
              </th>
              <th className="num">
                <Bi {...LABELS.drift} />
              </th>
            </tr>
          </thead>
          <tbody>
            {portfolio.classes.map((row) => (
              <tr key={row.assetClass.id}>
                <td>
                  <Bi en={row.assetClass.nameEn} zh={row.assetClass.nameZh} />
                </td>
                <td>
                  <Bi {...SLEEVE[row.assetClass.sleeve]} />
                </td>
                <td className="num">{twd(row.valueTwd)}</td>
                <td className="num">{percent(row.assetClass.targetWeight)}</td>
                <td className="num">{percent(row.weight)}</td>
                <td className="num">{portfolio.pool.totalTwd > 0 ? points(row.drift) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>
                  <Bi en="Total" zh="合計" />
                </strong>
              </td>
              <td />
              <td className="num">
                <strong>{twd(portfolio.pool.totalTwd)}</strong>
              </td>
              <td className="num">{percent(totalTarget)}</td>
              <td className="num">{portfolio.pool.totalTwd > 0 ? percent(1) : '—'}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Estimated({ holding }: { holding: Holding }) {
  return holding.estimated && holding.valueTwd !== null ? (
    <span className="estimate" title="Estimated 估計值">
      *
    </span>
  ) : null;
}

function ListedHoldings({ data, portfolio }: { data: HoldingsData; portfolio: Portfolio }) {
  const classes = new Map(data.assetClasses.map((assetClass) => [assetClass.id, assetClass]));
  const positions = new Map(portfolio.positions.map((position) => [positionKey(position.pool, position.ticker), position]));
  const listed = portfolio.holdings
    .filter((holding) => holding.ticker !== null)
    .sort(
      (a, b) =>
        a.pool.localeCompare(b.pool) ||
        (classes.get(a.assetClassId)?.sortOrder ?? 0) - (classes.get(b.assetClassId)?.sortOrder ?? 0) ||
        (b.valueTwd ?? 0) - (a.valueTwd ?? 0),
    );
  if (listed.length === 0) return null;
  const total = portfolio.pool.totalTwd;
  return (
    <section className="card form">
      <h2>
        <Bi en="Listed holdings" zh="上市持股" />
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Bi {...LABELS.ticker} />
              </th>
              <th>
                <Bi {...LABELS.pool} />
              </th>
              <th className="num">
                <Bi {...LABELS.qty} />
              </th>
              <th className="num">
                <Bi {...LABELS.avgCost} />
              </th>
              <th className="num">
                <Bi {...LABELS.costTwd} />
              </th>
              <th className="num">
                <Bi {...LABELS.valueTwd} />
              </th>
              <th className="num">
                <Bi {...LABELS.unrealised} />
              </th>
              <th className="num">
                <Bi {...LABELS.weight} />
              </th>
            </tr>
          </thead>
          <tbody>
            {listed.map((holding) => {
              const position = positions.get(holding.key);
              const assetClass = classes.get(holding.assetClassId);
              const gain = holding.valueTwd !== null && holding.costTwd !== null ? holding.valueTwd - holding.costTwd : null;
              return (
                <tr key={holding.key}>
                  <td>
                    <strong>{holding.ticker}</strong>
                    <div className="muted small">{holding.label}</div>
                    {assetClass && (
                      <div className="muted small">
                        <Bi en={assetClass.nameEn} zh={assetClass.nameZh} /> · <Bi {...PRODUCT[holding.productType]} />
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={holding.pool === 'windfall' ? 'badge warn' : 'badge'}>
                      <Bi {...POOL[holding.pool]} />
                    </span>
                  </td>
                  <td className="num">{quantity(holding.qty)}</td>
                  <td className="num">{position && position.qty > 0 ? money(position.costLocal / position.qty, holding.currency) : '—'}</td>
                  <td className="num">{twd(holding.costTwd)}</td>
                  <td className="num">
                    {twd(holding.valueTwd)}
                    <Estimated holding={holding} />
                  </td>
                  <td className="num">
                    {twd(gain)}
                    {gain !== null && holding.costTwd ? <div className="muted small">{percent(gain / holding.costTwd)}</div> : null}
                  </td>
                  <td className="num">{holding.pool === 'regular' && holding.valueTwd !== null && total > 0 ? percent(holding.valueTwd / total) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ManualAssets({ data, portfolio }: { data: HoldingsData; portfolio: Portfolio }) {
  const classes = new Map(data.assetClasses.map((assetClass) => [assetClass.id, assetClass]));
  const values = new Map(portfolio.holdings.map((holding) => [holding.key, holding]));
  return (
    <section className="card form">
      <div className="row spread">
        <h2>
          <Bi en="Non-listed assets" zh="非上市資產" />
        </h2>
        <Link href="/assets/new" className="button">
          <Bi {...LABELS.addAsset} />
        </Link>
      </div>
      {data.manualAssets.length === 0 ? (
        <p className="muted">
          <Bi en="Physical gold in grams, and savings or money-market balances in TWD." zh="以克數記錄的實體黃金，以及以台幣餘額記錄的活存或貨幣基金。" />
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <Bi {...LABELS.name} />
                </th>
                <th>
                  <Bi {...LABELS.pool} />
                </th>
                <th className="num">
                  <Bi {...LABELS.quantityHeld} />
                </th>
                <th className="num">
                  <Bi {...LABELS.valueTwd} />
                </th>
                <th>
                  <Bi {...LABELS.valuedOn} />
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.manualAssets.map((asset) => {
                const holding = values.get(`manual:${asset.id}`);
                const assetClass = classes.get(asset.assetClassId);
                return (
                  <tr key={asset.id}>
                    <td>
                      {asset.name}
                      {assetClass && (
                        <div className="muted small">
                          <Bi en={assetClass.nameEn} zh={assetClass.nameZh} />
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={asset.pool === 'windfall' ? 'badge warn' : 'badge'}>
                        <Bi {...POOL[asset.pool]} />
                      </span>
                    </td>
                    <td className="num">{asset.unit === 'grams' ? `${quantity(asset.quantity)} g` : twd(asset.quantity)}</td>
                    <td className="num">
                      {holding?.valueTwd === null || holding === undefined ? (
                        <Link href={`/assets/${asset.id}`}>
                          <Bi en="Enter a value" zh="輸入估值" />
                        </Link>
                      ) : (
                        <>
                          {twd(holding.valueTwd)}
                          <Estimated holding={holding} />
                        </>
                      )}
                    </td>
                    <td>{asset.valuedOn ?? '—'}</td>
                    <td>
                      <Link href={`/assets/${asset.id}`}>
                        <Bi {...LABELS.edit} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Trades({ data, showAll }: { data: HoldingsData; showAll: boolean }) {
  // Loaded newest first.
  const shown = showAll ? data.trades : data.trades.slice(0, RECENT_TRADES);
  return (
    <section className="card form">
      <h2>
        <Bi en="Trades" zh="交易紀錄" />
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Bi {...LABELS.tradeDate} />
              </th>
              <th>
                <Bi {...LABELS.ticker} />
              </th>
              <th>
                <Bi {...LABELS.side} />
              </th>
              <th className="num">
                <Bi {...LABELS.qty} />
              </th>
              <th className="num">
                <Bi {...LABELS.price} />
              </th>
              <th className="num">
                <Bi en="Fee + tax" zh="手續費＋稅" />
              </th>
              <th className="num">
                <Bi en="FX rate" zh="匯率" />
              </th>
              <th>
                <Bi {...LABELS.pool} />
              </th>
              <th>
                <Bi {...LABELS.source} />
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((trade) => (
              <tr key={trade.id}>
                <td>{trade.tradeDate}</td>
                <td>
                  <strong>{trade.ticker}</strong>
                </td>
                <td>
                  <Bi {...SIDE[trade.side]} />
                </td>
                <td className="num">{quantity(trade.qty)}</td>
                <td className="num">{`${quantity(trade.price)} ${trade.currency}`}</td>
                <td className="num">{`${quantity(trade.fee + trade.tax)} ${trade.currency}`}</td>
                <td className="num">{trade.currency === 'TWD' ? '—' : trade.fxRate}</td>
                <td>
                  <Bi {...POOL[trade.pool]} />
                </td>
                <td>
                  <Bi {...SOURCE[trade.source]} />
                </td>
                <td>
                  <Link href={`/holdings/${trade.id}`}>
                    <Bi {...LABELS.edit} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showAll && data.trades.length > RECENT_TRADES && (
        <p>
          <Link href="/holdings?trades=all">
            <Bi en={`Show all ${data.trades.length} trades`} zh={`顯示全部 ${data.trades.length} 筆交易`} />
          </Link>
        </p>
      )}
    </section>
  );
}

function Footnotes() {
  return (
    <section className="muted small form">
      <p>
        <Bi
          en="* Estimated: until the nightly price job (Phase 1, step 4) loads a closing price or FX rate, the newest trade price or rate is used. Gold uses the last value you entered."
          zh="＊估計值：每夜價格排程（第一階段第 4 步）載入收盤價或匯率之前，暫以最近一筆交易的價格或匯率計算；黃金以你最後輸入的估值計算。"
        />
      </p>
      <p>
        <Bi
          en="Average cost includes buy fees and taxes. Market value and gains are in TWD at the latest FX rate; cost is in TWD at each buy's own rate."
          zh="平均成本已含買進手續費與稅。市值與損益以最新匯率換算台幣；成本以每筆買進當時的匯率換算台幣。"
        />
      </p>
    </section>
  );
}
