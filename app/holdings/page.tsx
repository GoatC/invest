import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataHealthBanner } from '@/components/data-status';
import { DataProblem } from '@/components/data-problem';
import { RuleMath } from '@/components/rule-math';
import { Stat } from '@/components/stat';
import { requireSession } from '@/lib/auth';
import { DataError, loadCashFlows, loadHoldingsData, loadJobRuns, orDataError, type CashFlowRecord, type HoldingsData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { money, percent, points, quantity, twd } from '@/lib/format';
import { FLOW_TYPE, LABELS, POOL, SIDE, SLEEVE, SOURCE, type Bilingual } from '@/lib/i18n';
import { flowTotals } from '@/lib/models/cash-flows';
import { dataHealth } from '@/lib/models/data-health';
import { buildPortfolio, poolFigures, type Portfolio } from '@/lib/models/portfolio';
import { positionKey, type Shortfall } from '@/lib/models/positions';
import { capBreaches, satelliteValue, type CapBreach } from '@/lib/models/rules';
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
  'flow-added': { en: 'Cash flow added.', zh: '已新增現金流。' },
  'flow-updated': { en: 'Cash flow updated.', zh: '已更新現金流。' },
  'flow-deleted': { en: 'Cash flow deleted; the edit history keeps a copy.', zh: '已刪除現金流，修改紀錄中保留一份副本。' },
};

function savedMessage(params: Params): Bilingual | undefined {
  const saved = param(params, 'saved');
  if (saved !== 'imported') return saved ? SAVED[saved] : undefined;
  const count = (key: string) => Math.max(0, Number.parseInt(param(params, key) ?? '', 10) || 0);
  const added = count('added');
  const dividends = count('dividends');
  const skipped = count('skipped');
  return {
    en: `Imported ${added} trade${added === 1 ? '' : 's'}${dividends > 0 ? ` and ${dividends} dividend${dividends === 1 ? '' : 's'}` : ''}${skipped > 0 ? `; ${skipped} row${skipped === 1 ? '' : 's'} of the file skipped` : ''}.`,
    zh: `已匯入 ${added} 筆交易${dividends > 0 ? `與 ${dividends} 筆股利` : ''}${skipped > 0 ? `，略過檔案中的 ${skipped} 列` : ''}。`,
  };
}

/** How many trades and cash flows the lists show before "Show all". */
const RECENT_TRADES = 50;
const RECENT_FLOWS = 24;

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
  let flows: CashFlowRecord[];
  // The job status only adds a note, so a failed read of it does not hide the holdings.
  let jobs: Awaited<ReturnType<typeof loadJobRuns>> | DataError;
  try {
    [data, flows, jobs] = await Promise.all([loadHoldingsData(supabase), loadCashFlows(supabase), orDataError(loadJobRuns(supabase))]);
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
          {param(params, 'saved')?.endsWith('deleted') && (
            <>
              {' '}
              <Link href="/history">
                <Bi en="See the edit history" zh="查看修改紀錄" />
              </Link>
            </>
          )}
        </p>
      )}
      {jobs instanceof DataError ? (
        <p className="banner info" role="status">
          <Bi
            en={`Could not read the nightly job status (${jobs.table}: ${jobs.detail}); if the app was just updated, run npx supabase db push.`}
            zh={`無法讀取每夜排程狀態（${jobs.table}：${jobs.detail}）；如果剛更新過程式，請執行 npx supabase db push。`}
          />
        </p>
      ) : (
        <DataHealthBanner health={dataHealth(jobs.runs, jobs.threshold, taipeiToday())} threshold={jobs.threshold} quiet />
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
            <Link href="/cash-flows/new" className="button">
              <Bi {...LABELS.addCashFlow} />
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
      <CashFlows flows={flows} showAll={param(params, 'flows') === 'all'} />
      {!empty && <Footnotes />}
    </>
  );
}

function Summary({ data, portfolio }: { data: HoldingsData; portfolio: Portfolio }) {
  const { pool } = portfolio;
  const windfallTwd = sum(portfolio.holdings.filter((holding) => holding.pool === 'windfall').map((holding) => holding.valueTwd ?? 0));
  const satelliteShare = pool.totalTwd > 0 ? satelliteValue(pool) / pool.totalTwd : null;
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
  const share = portfolio.pool.totalTwd > 0 ? satelliteValue(portfolio.pool) / portfolio.pool.totalTwd : 0;
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
      <RuleMath caps={data.caps} pool={poolFigures(portfolio.pool)} />
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
        <Bi
          en="Actual = class value ÷ regular pool (windfall money is not counted); drift = actual − target, in percentage points (pp)."
          zh="實際權重 = 類別市值 ÷ 一般投入資金池（不含大額資金）；偏離 = 實際 − 目標，單位為百分點（pp）。"
        />{' '}
        <Link href="/allocation">
          <Bi en="Drift status, targets and allocation donuts" zh="偏離狀態、目標權重與配置圓餅圖" />
        </Link>
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
              const gain = holding.valueTwd !== null && holding.costTwd !== null ? holding.valueTwd - holding.costTwd : null;
              return (
                <tr key={holding.key}>
                  <td className="name">
                    <strong>{holding.ticker}</strong>
                    <div className="muted small">{holding.label}</div>
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
                    {holding.priceDate && <div className="muted small">{holding.priceDate}</div>}
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
                    <td className="nowrap">{holding?.priceDate ?? '—'}</td>
                    <td className="nowrap">
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
    <section className="card form" id="trades">
      <div className="row spread">
        <h2>
          <Bi en="Trades" zh="交易紀錄" />
        </h2>
        <Link href="/history">
          <Bi en="Edit history, deleted entries included" zh="修改紀錄（含已刪除）" />
        </Link>
      </div>
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
                <td className="nowrap">{trade.tradeDate}</td>
                <td>
                  <strong>{trade.ticker}</strong>
                </td>
                <td className="nowrap">
                  <Bi {...SIDE[trade.side]} />
                </td>
                <td className="num">{quantity(trade.qty)}</td>
                <td className="num">{`${quantity(trade.price)} ${trade.currency}`}</td>
                <td className="num">{`${quantity(trade.fee + trade.tax)} ${trade.currency}`}</td>
                <td className="num">{trade.currency === 'TWD' ? '—' : trade.fxRate}</td>
                <td className="nowrap">
                  <Bi {...POOL[trade.pool]} />
                </td>
                <td className="nowrap">
                  <Bi {...SOURCE[trade.source]} />
                </td>
                <td className="nowrap">
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

function CashFlows({ flows, showAll }: { flows: CashFlowRecord[]; showAll: boolean }) {
  // Loaded newest first.
  const shown = showAll ? flows : flows.slice(0, RECENT_FLOWS);
  const totals = flowTotals(flows);
  return (
    <section className="card form" id="cash-flows">
      <div className="row spread">
        <h2>
          <Bi {...LABELS.cashFlows} />
        </h2>
        <Link href="/cash-flows/new" className="button">
          <Bi {...LABELS.addCashFlow} />
        </Link>
      </div>
      {flows.length === 0 ? (
        <p className="muted">
          <Bi
            en="Money in and out: monthly contributions, the windfall arriving, dividends and withdrawals. True performance (Phase 1, step 5) is worked out from them."
            zh="資金進出：每月投入、大額資金入帳、股利與提領。真實績效（第一階段第 5 步）會用它們計算。"
          />
        </p>
      ) : (
        <>
          <p className="muted small">
            <Bi
              en={`All recorded, in TWD at each day's rate: contributions ${twd(totals.contribution)}, windfall ${twd(totals.windfall)}, dividends ${twd(totals.dividend)}, withdrawals ${twd(totals.withdrawal)}.`}
              zh={`全部紀錄，以各筆當日匯率換算台幣：投入資金 ${twd(totals.contribution)}、大額資金入帳 ${twd(totals.windfall)}、股利 ${twd(totals.dividend)}、提領 ${twd(totals.withdrawal)}。`}
            />
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <Bi {...LABELS.flowDate} />
                  </th>
                  <th>
                    <Bi {...LABELS.flowType} />
                  </th>
                  <th>
                    <Bi {...LABELS.ticker} />
                  </th>
                  <th className="num">
                    <Bi {...LABELS.amount} />
                  </th>
                  <th className="num">
                    <Bi en="FX rate" zh="匯率" />
                  </th>
                  <th className="num">
                    <Bi {...LABELS.amountTwd} />
                  </th>
                  <th>
                    <Bi {...LABELS.pool} />
                  </th>
                  <th>
                    <Bi {...LABELS.note} />
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((flow) => (
                  <tr key={flow.id}>
                    <td className="nowrap">{flow.flowDate}</td>
                    <td className="nowrap">
                      <Bi {...FLOW_TYPE[flow.type]} />
                    </td>
                    <td>{flow.ticker ? <strong>{flow.ticker}</strong> : '—'}</td>
                    <td className="num">{`${quantity(flow.amount)} ${flow.currency}`}</td>
                    <td className="num">{flow.currency === 'TWD' ? '—' : flow.fxRate}</td>
                    <td className="num">{twd(flow.amountTwd)}</td>
                    <td className="nowrap">
                      <Bi {...POOL[flow.pool]} />
                    </td>
                    <td className="small">{flow.note ?? ''}</td>
                    <td className="nowrap">
                      <Link href={`/cash-flows/${flow.id}`}>
                        <Bi {...LABELS.edit} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!showAll && flows.length > RECENT_FLOWS && (
            <p>
              <Link href="/holdings?flows=all#cash-flows">
                <Bi en={`Show all ${flows.length} cash flows`} zh={`顯示全部 ${flows.length} 筆現金流`} />
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Footnotes() {
  return (
    <section className="muted small form">
      <p>
        <Bi
          en="Market value = quantity × the newest close × the newest FX rate, both loaded every night (the date under a value is its close's); see Data status. * Estimated: a security or currency the nightly job has not loaded yet uses its newest trade price or rate, and gold the last value you entered."
          zh="市值 = 數量 × 最新收盤價 × 最新匯率，兩者每夜載入（數值下方的日期為收盤日），詳見資料狀態。＊估計值：每夜排程尚未載入的證券或幣別，暫以最近一筆交易的價格或匯率計算；黃金則以你最後輸入的估值計算。"
        />
      </p>
      <p>
        <Bi
          en="Gold = grams × the international gold price in TWD per troy ounce (the US dollar price × the Bank of Taiwan USD rate) ÷ 31.1035 grams per ounce; the bank's own buy-back price is usually a little lower."
          zh="黃金 = 克數 × 每盎司台幣金價（美元國際金價 × 臺灣銀行美元匯率）÷ 每盎司 31.1035 克；銀行實際回收價通常略低。"
        />
      </p>
      <p>
        <Bi
          en="Average cost = remaining cost ÷ quantity, buy fees and taxes included; a sell takes cost out at the average. Unrealised gain = market value − cost, both in TWD: market value uses the latest price and FX rate, cost each buy's own rate, so the gain includes currency moves. Weight = market value ÷ regular pool; windfall holdings show —."
          zh="平均成本 = 剩餘成本 ÷ 數量（含買進手續費與稅；賣出時按平均成本扣除）。未實現損益 = 市值 − 成本，皆以台幣計：市值用最新價格與匯率，成本用每筆買進當時的匯率，因此損益包含匯率變動。權重 = 市值 ÷ 一般投入資金池；大額資金持股顯示 —。"
        />
      </p>
    </section>
  );
}
