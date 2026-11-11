import Link from 'next/link';

import { AlertTiles } from '@/components/alert-tiles';
import { Bi } from '@/components/bi';
import { Facts, type Fact } from '@/components/facts';
import { Info } from '@/components/info';
import { DataProblem } from '@/components/data-problem';
import { PhoneTabs } from '@/components/phone-tabs';
import { RuleMath } from '@/components/rule-math';
import { Stat } from '@/components/stat';
import { requireSession } from '@/lib/auth';
import type { AlertItem } from '@/lib/alerts';
import { DataError, loadAllocationData, loadAssumptions, loadCashFlows, loadFxHistory, loadProposals, loadRules, orDataError, type AllocationData, type CashFlowRecord, type HoldingsData, type Proposal, type RuleRecord } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { money, percent, quantity, twd } from '@/lib/format';
import { ACTION, DIRECTION, FLOW_TYPE, LABELS, leverageText, POOL, SOURCE, type Bilingual } from '@/lib/i18n';
import { flowTotals } from '@/lib/models/cash-flows';
import { buildPortfolio, poolFigures, type Portfolio } from '@/lib/models/portfolio';
import { positionKey } from '@/lib/models/positions';
import { capBreaches, satelliteValue, type CapBreach } from '@/lib/models/rules';
import { shortfallAlert } from '@/lib/forms';
import type { AssetClass, FxQuote } from '@/lib/models/types';
import type { Assumption } from '@/lib/models/cma';
import type { LeftReason } from '@/lib/models/auto-cma';
import type { Holding } from '@/lib/models/valuation';
import { proposalAlert } from '@/lib/proposal-text';
import { breachAlert } from '@/lib/rule-text';

import { SecuritiesMaster } from '../securities/master';
import { ValuationOverview } from '../valuation/overview';
import { HoldingsOverview, VIEWS } from './overview';
import { tickerLinks } from './ticker-links';
import { TradeForm } from './trade-form';
import { tradeInitial } from './trade-initial';

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

export default async function HoldingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  let data: AllocationData;
  let flows: CashFlowRecord[];
  let rates: FxQuote[];
  // The proposals only add to the page, so a failed read of them does not hide the holdings.
  let proposals: [Proposal[], RuleRecord[]] | DataError;
  const today = taipeiToday();
  try {
    [data, flows, rates, proposals] = await Promise.all([
      loadAllocationData(supabase),
      loadCashFlows(supabase),
      loadFxHistory(supabase),
      orDataError(Promise.all([loadProposals(supabase, today), loadRules(supabase)])),
    ]);
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const portfolio = buildPortfolio(data);
  const view = VIEWS.find((option) => option === param(params, 'view')) ?? 'cards';
  const saved = savedMessage(params);
  const empty = data.trades.length === 0 && data.manualAssets.length === 0;
  const priced = new Set(data.prices.map((price) => price.ticker));
  const savedTicker = param(params, 'saved') === 'added' || param(params, 'saved') === 'updated' ? data.securities.find((security) => security.ticker === param(params, 't')) : undefined;
  // A trade in a satellite class was just scored into its class's assumption (F6 auto): show the figure.
  const savedClass = savedTicker?.sleeve === 'satellite' ? data.assetClasses.find((assetClass) => assetClass.id === savedTicker.assetClassId) : undefined;
  const assumptions = savedClass ? await orDataError(loadAssumptions(supabase)) : undefined;
  const score =
    savedClass && savedTicker && assumptions && !(assumptions instanceof DataError)
      ? {
          assetClass: savedClass,
          assumption: assumptions.assumptions[savedClass.id],
          on: assumptions.auto?.enabled === true,
          included: assumptions.estimates.some((estimate) => estimate.classId === savedClass.id && estimate.lines.some((line) => line.ticker === savedTicker.ticker)),
          left: [...assumptions.estimates, ...assumptions.unscored].flatMap((entry) => (entry.classId === savedClass.id ? entry.left : [])).find((line) => line.ticker === savedTicker.ticker)?.reason,
          minMonths: assumptions.auto?.minMonths ?? 0,
          // Only a long line is scored; a sold-out or short one has nothing to count.
          held: portfolio.holdings.some((holding) => holding.ticker === savedTicker.ticker && holding.qty > 0 && holding.direction === 'long'),
        }
      : undefined;
  const { initial, proposal } = tradeInitial(data, rates, today, {
    ticker: param(params, 'ticker'),
    side: param(params, 'side'),
    qty: param(params, 'qty'),
    pool: param(params, 'pool'),
    proposal: param(params, 'proposal'),
    fee: param(params, 'fee'),
    tax: param(params, 'tax'),
  });

  return (
    <>
      {saved && (
        <div className="banner ok" role="status">
          <Bi {...saved} />
          {param(params, 'saved')?.endsWith('deleted') && (
            <>
              {' '}
              <Link href="/history">
                <Bi en="See the edit history" zh="查看修改紀錄" />
              </Link>
            </>
          )}
          {savedTicker && <NextSteps ticker={savedTicker.ticker} productType={savedTicker.productType} waiting={!priced.has(savedTicker.ticker)} {...(score ? { score } : {})} />}
        </div>
      )}
      {!(proposals instanceof DataError) && <OpenProposals proposals={proposals[0]} rules={proposals[1]} />}
      <AlertTiles heading={{ en: 'Sells larger than the holding: fix these trades', zh: '賣出超過持有：請修正這些交易' }} tone="alert" items={portfolio.shortfalls.map(shortfallAlert)} />
      <section className="card page-head">
        <div className="row spread">
          <h1>持倉</h1>
          <div className="row small">
            <Link href="/import">
              <Bi {...LABELS.importCsv} />
            </Link>
            <Link href="/assets/new">
              <Bi {...LABELS.addAsset} />
            </Link>
            <Link href="/cash-flows/new">
              <Bi {...LABELS.addCashFlow} />
            </Link>
          </div>
        </div>
      </section>
      <PhoneTabs
        label="Holdings 持倉"
        initial={empty ? 'trades' : 'overview'}
        tabs={TABS}
        parts={[
          {
            tab: 'trades',
            content: (
              <section className="card form" id="add-trade">
                <h2>
                  <Bi {...LABELS.addTrade} />
                </h2>
                {proposal !== undefined && (
                  <p className="muted">
                    <Bi
                      en={`Filled in from proposal #${proposal}: change the price, fee and FX rate to what your broker's confirmation says.`}
                      zh={`已依提案 #${proposal} 填入：請把價格、手續費與匯率改成券商成交單上的數字。`}
                    />
                  </p>
                )}
                <TradeForm key={JSON.stringify(initial)} data={data} rates={rates} today={today} initial={initial} {...(proposal === undefined ? {} : { proposal })} compact />
              </section>
            ),
          },
          {
            tab: 'overview',
            content: !empty && (
              <>
                <section className="card form" aria-label="Summary 總覽">
                  <Summary data={data} portfolio={portfolio} />
                </section>
                <HoldingsOverview supabase={supabase} data={data} portfolio={portfolio} today={today} view={view} proposals={proposals instanceof DataError ? [] : proposals[0]} rules={proposals instanceof DataError ? [] : proposals[1]} />
                <RulesStatus data={data} portfolio={portfolio} />
                <ListedHoldings data={data} portfolio={portfolio} priced={priced} />
              </>
            ),
          },
          { tab: 'watch', content: <ValuationOverview supabase={supabase} today={today} params={params} /> },
          { tab: 'overview', content: <ManualAssets data={data} portfolio={portfolio} /> },
          { tab: 'trades', content: data.trades.length > 0 && <Trades data={data} showAll={param(params, 'trades') === 'all'} /> },
          { tab: 'flows', content: <CashFlows flows={flows} showAll={param(params, 'flows') === 'all'} /> },
          { tab: 'watch', content: <SecuritiesMaster data={data} saved={param(params, 'securities')} /> },
          { tab: 'overview', content: !empty && <Footnotes /> },
        ]}
      />
      <a href="#add-trade" className="fab" lang="zh-Hant" aria-label="新增交易 Add trade">
        ＋
      </a>
    </>
  );
}

/** The holdings page's sub-tabs on a phone; a wide screen shows every part at once. */
const TABS = [
  { key: 'overview', label: { en: 'Overview', zh: '總覽' } },
  { key: 'trades', label: { en: 'Trades', zh: '交易' } },
  { key: 'flows', label: LABELS.cashFlows },
  { key: 'watch', label: { en: 'Watchlist', zh: '觀察清單' } },
] as const;

/** After a trade is saved: this ticker's analyses, whether they must wait for tonight's prices, and its class's auto-scored assumption. */
function NextSteps({
  ticker,
  productType,
  waiting,
  score,
}: {
  ticker: string;
  productType: Holding['productType'];
  waiting: boolean;
  score?: { assetClass: AssetClass; assumption: Assumption | undefined; on: boolean; included: boolean; left: LeftReason | undefined; minMonths: number; held: boolean };
}) {
  return (
    <div className="next-steps">
      {score?.on && (!score.assumption || score.assumption.auto) && (
        <p>
          <span className={`status-icon ${score.assumption ? 'ok' : 'idle'}`} aria-hidden="true">
            {score.assumption ? '✓' : '…'}
          </span>{' '}
          <Link href="/allocation/assumptions#auto">
            <Bi en={score.assetClass.nameEn} zh={score.assetClass.nameZh} />
          </Link>{' '}
          {score.assumption ? (
            <Bi
              en={`auto-scored: return ${percent(score.assumption.expectedReturn, 1)}, volatility ${percent(score.assumption.volatility, 1)}`}
              zh={`自動評分：報酬 ${percent(score.assumption.expectedReturn, 1)}・波動 ${percent(score.assumption.volatility, 1)}`}
            />
          ) : (
            <Bi en="not scored yet" zh="尚未評分" />
          )}
          {!score.included && score.held && (
            <>
              {' '}
              <span className="chip">
                {waiting ? (
                  <Bi en={`${ticker}: after tonight’s prices`} zh={`${ticker}：今晚載入價格後`} />
                ) : score.left === 'beta' ? (
                  <Bi en={`${ticker}: no β`} zh={`${ticker}：無 β`} />
                ) : (
                  <Bi en={`${ticker}: under ${score.minMonths} months`} zh={`${ticker}：不足 ${score.minMonths} 個月`} />
                )}
              </span>
            </>
          )}
        </p>
      )}
      {waiting && (
        <p>
          <span className="status-icon idle" aria-hidden="true">
            …
          </span>{' '}
          <Bi
            en={`${ticker} has no close yet: the analyses list it once tonight's job loads its prices.`}
            zh={`${ticker} 尚無收盤價：今晚排程載入價格後，各分析頁才會列入。`}
          />
        </p>
      )}
      <div className="row">
        <strong>
          <Bi en="Next" zh="下一步" />
        </strong>
        {tickerLinks(ticker, productType)
          .slice(0, -1)
          .map((link) => (
            <Link key={link.href} href={link.href} className="chip">
              <Bi {...link.label} />
            </Link>
          ))}
      </div>
    </div>
  );
}

/** Proposals waiting on a decision or a trade, as tiles: first on the page, as on the weekly dashboard (PRD Section 5). */
function OpenProposals({ proposals, rules }: { proposals: readonly Proposal[]; rules: readonly RuleRecord[] }) {
  const waiting = proposals.filter((proposal) => proposal.status === 'open' || proposal.status === 'approved');
  if (waiting.length === 0) return null;
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const open = waiting.filter((proposal) => proposal.status === 'open').length;
  const items: AlertItem[] = waiting.map((proposal) => proposalAlert(proposal, byId.get(proposal.ruleId)));
  return (
    <div id="open-proposals">
      <AlertTiles
        heading={{ en: `Proposals waiting: ${waiting.length}`, zh: `待處理提案 ${waiting.length}${open < waiting.length ? `（${waiting.length - open} 份待下單）` : ''}` }}
        tone="info"
        items={items}
      />
    </div>
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

function rulesOk(data: HoldingsData, portfolio: Portfolio): Fact[] {
  const { singleStock, satellite } = data.caps;
  const share = portfolio.pool.totalTwd > 0 ? satelliteValue(portfolio.pool) / portfolio.pool.totalTwd : 0;
  return [
    singleStock
      ? { label: { en: 'R1 single stock', zh: 'R1 單一個股' }, value: `≤ ${percent(singleStock.maxWeight, 0)}`, tone: 'ok' }
      : { label: { en: 'R1', zh: 'R1' }, value: <Bi en="off" zh="停用" />, tone: 'watch' },
    satellite
      ? { label: { en: 'R2 satellite', zh: 'R2 衛星部位' }, value: `${percent(share)} / ${percent(satellite.triggerWeight, 0)}`, tone: 'ok' }
      : { label: { en: 'R2', zh: 'R2' }, value: <Bi en="off" zh="停用" />, tone: 'watch' },
  ];
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
        <div className="form">
          <AlertTiles items={breaches.map((breach) => breachAlert(breach, data.caps))} tone="alert" />
          <Link href="/#proposals">
            <Bi en="The rules engine drafts the trim as a proposal" zh="規則引擎會把減碼擬成提案" />
          </Link>
        </div>
      ) : (
        <Facts facts={rulesOk(data, portfolio)} />
      )}
      <RuleMath caps={data.caps} pool={poolFigures(portfolio.pool)} />
      {unpriced.length > 0 && (
        <AlertTiles
          tone="info"
          items={unpriced.map((holding) => ({ key: holding.key, tone: 'info' as const, title: { en: holding.ticker ?? holding.label, zh: holding.ticker ?? holding.label }, chips: [{ label: { en: 'Not valued yet', zh: '尚未估值' }, value: '不計入' }] }))}
        />
      )}
    </section>
  );
}

/**
 * A short or leveraged line's direction and leverage, and a warning when its own money has fallen
 * to config leverage's margin_call_share of what was put in (or below zero). Nothing for a plain long.
 */
function DirectionBadges({ holding, marginCallShare }: { holding: Holding; marginCallShare: number | null }) {
  if (holding.direction === 'long' && Math.abs(holding.leverage - 1) < 1e-9) return null;
  const left = holding.valueTwd !== null && holding.costTwd ? holding.valueTwd / holding.costTwd : null;
  const call = left !== null && marginCallShare !== null && left <= marginCallShare;
  return (
    <div className="row small">
      <span className={holding.direction === 'short' ? 'badge warn' : 'badge'}>
        <Bi {...DIRECTION[holding.direction]} />
      </span>
      <span className="badge">{leverageText(holding.leverage)}</span>
      {call && (
        <span className="badge danger" role="alert">
          <Bi en={`Own money down to ${percent(left)}: margin call risk`} zh={`自有資金剩 ${percent(left)}：可能被追繳保證金`} />
        </span>
      )}
    </div>
  );
}

function Estimated({ holding }: { holding: Holding }) {
  return holding.estimated && holding.valueTwd !== null ? (
    <span className="estimate" title="Estimated 估計值">
      *
    </span>
  ) : null;
}

function ListedHoldings({ data, portfolio, priced }: { data: HoldingsData; portfolio: Portfolio; priced: ReadonlySet<string> }) {
  const classes = new Map(data.assetClasses.map((assetClass) => [assetClass.id, assetClass]));
  const positions = new Map(portfolio.positions.map((position) => [positionKey(position.pool, position.ticker, position.direction), position]));
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
    <section className="card form wide-only">
      <div className="row spread">
        <h2>
          <Bi en="Listed holdings" zh="上市持股" />
        </h2>
        <span className="muted small">
          <Bi en="Tap a ticker for its analyses, the name for its price chart" zh="點代號看分析 · 點名稱看走勢" />
        </span>
      </div>
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
                    {holding.ticker && (
                      <details className="ticker-menu">
                        <summary aria-label={`${holding.ticker}: analyses 分析`}>
                          <strong>{holding.ticker}</strong>
                        </summary>
                        <ul>
                          {tickerLinks(holding.ticker, holding.productType).map((link) => (
                            <li key={link.href}>
                              <Link href={link.href}>
                                <Bi {...link.label} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {holding.ticker ? (
                      <Link href={`/holdings/chart/${encodeURIComponent(holding.ticker)}`} className="small holding-chart-link">
                        {holding.label} <span aria-hidden="true">📈</span>
                      </Link>
                    ) : (
                      <div className="muted small">{holding.label}</div>
                    )}
                    <DirectionBadges holding={holding} marginCallShare={data.leverage.marginCallShare} />
                    {holding.ticker && !priced.has(holding.ticker) && (
                      <div className="small">
                        <span className="status-icon idle" aria-hidden="true">
                          …
                        </span>
                        <Bi en="waiting for tonight's prices" zh="等待今晚排程" />
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
                    {holding.priceDate && <div className="muted small">{holding.priceDate}</div>}
                  </td>
                  <td className="num">
                    {twd(gain)}
                    {gain !== null && holding.costTwd ? <div className="muted small">{percent(gain / holding.costTwd)}</div> : null}
                  </td>
                  <td className="num">
                    {holding.pool === 'regular' && holding.exposureTwd !== null && total > 0 ? percent(holding.exposureTwd / total) : '—'}
                    {holding.exposureTwd !== null && holding.exposureTwd !== holding.valueTwd && (
                      <div className="muted small">
                        <Bi en={`exposure ${twd(holding.exposureTwd)}`} zh={`曝險 ${twd(holding.exposureTwd)}`} />
                      </div>
                    )}
                  </td>
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
                  <Bi {...ACTION[trade.direction ?? 'long'][trade.side]} />
                  {(trade.leverage ?? 1) !== 1 && <span className="muted small">{` ${leverageText(trade.leverage ?? 1)}`}</span>}
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
                  <Link href={`/holdings/${trade.id}`} prefetch={false}>
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
          <Bi en="None yet." zh="尚無。" />
        </p>
      ) : (
        <>
          <Facts
            facts={[
              { label: FLOW_TYPE.contribution, value: twd(totals.contribution) },
              { label: FLOW_TYPE.windfall, value: twd(totals.windfall) },
              { label: FLOW_TYPE.dividend, value: twd(totals.dividend) },
              { label: FLOW_TYPE.withdrawal, value: twd(totals.withdrawal) },
            ]}
          />
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
                      <Link href={`/cash-flows/${flow.id}`} prefetch={false}>
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
    <Info label={{ en: 'How values are worked out', zh: '數值計算方式' }}>
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
    </Info>
  );
}
