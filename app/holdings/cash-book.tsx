import Link from 'next/link';

import { AlertTiles } from '@/components/alert-tiles';
import { Bi } from '@/components/bi';
import { Facts, type Fact } from '@/components/facts';
import { Info } from '@/components/info';
import type { AlertItem } from '@/lib/alerts';
import type { CashFlowRecord, DividendView, HoldingsData } from '@/lib/data';
import { percent, quantity, twd } from '@/lib/format';
import { FLOW_TYPE, LABELS, leverageText, POOL, type Bilingual } from '@/lib/i18n';
import { filterLedger, ledger, ledgerTotals, LEDGER_FILTERS, type LedgerFilter, type LedgerKind, type LedgerLine } from '@/lib/models/cash-flows';
import { dueKey, estimateText, perShareText, recordHref, type DividendDue } from '@/lib/models/dividends';
import type { Portfolio } from '@/lib/models/portfolio';

import { setReinvested, skipDividend } from '../dividends/actions';

/** How many lines the book shows before "Show all". */
const RECENT = 24;

const FILTER: Record<LedgerFilter, Bilingual> = {
  all: { en: 'All', zh: '全部' },
  trades: { en: 'Trades', zh: '買賣' },
  dividends: { en: 'Dividends', zh: '股利' },
  windfall: { en: 'Windfall', zh: '大額資金' },
};

const KIND: Record<LedgerKind, Bilingual> = {
  buy: { en: 'Buy', zh: '買進' },
  sell: { en: 'Sell', zh: '賣出' },
  ...FLOW_TYPE,
};

/** A short line under the name: what the money was, as recorded. */
function detail(line: LedgerLine): string {
  if (line.trade) {
    const leverage = line.trade.leverage > 1 ? ` · ${leverageText(line.trade.leverage)}` : '';
    return `${quantity(line.trade.qty)} × ${quantity(line.trade.price)} ${line.currency}${leverage}`;
  }
  return line.currency === 'TWD' ? '' : `${quantity(line.amount)} ${line.currency} × ${line.fxRate}`;
}

function kindLabel(line: LedgerLine): Bilingual {
  if (line.trade?.direction === 'short') return line.kind === 'buy' ? { en: 'Short', zh: '放空' } : { en: 'Cover', zh: '回補' };
  return KIND[line.kind];
}

function filterHref(filter: LedgerFilter, all: boolean): string {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('flow', filter);
  if (all) params.set('flows', 'all');
  const query = params.toString();
  return `/holdings${query ? `?${query}` : ''}#cash-flows`;
}

function dueItem(line: DividendDue): AlertItem {
  const { event } = line;
  return {
    key: dueKey(line),
    tone: 'watch',
    code: event.ticker,
    title: { en: line.security.name, zh: line.security.name },
    value: `≈ ${estimateText(line)}`,
    chips: [
      line.estimatedDate ? { label: { en: 'Ex-dividend', zh: '除息' }, value: event.exDate } : { label: { en: 'Paid', zh: '發放' }, value: line.askOn },
      { label: { en: 'Shares', zh: '股數' }, value: quantity(line.qty) },
      { label: { en: 'A share', zh: '每股' }, value: perShareText(event) },
      ...(line.withholding > 0 ? [{ label: { en: 'Withheld', zh: '預扣' }, value: percent(line.withholding, 0) }] : []),
      ...(line.pool === 'windfall' ? [{ label: { en: 'Pool', zh: '資金池' }, value: POOL.windfall.zh }] : []),
    ],
  };
}

/**
 * The 現金流 tab (asked by Hugo on 2026-11-12): the dividends to confirm first, then the totals, then
 * one book of every buy and sell (read from the trades, nothing to type twice) with the windfall,
 * dividends and withdrawals typed in here.
 */
export function CashBook({
  data,
  flows,
  portfolio,
  dividends,
  filter,
  showAll,
  settingsOpen,
}: {
  data: HoldingsData;
  flows: readonly CashFlowRecord[];
  portfolio: Portfolio;
  /** Undefined before the dividends migration is applied. */
  dividends: DividendView | undefined;
  filter: LedgerFilter;
  showAll: boolean;
  /** Just saved: the dividend settings stay open. */
  settingsOpen: boolean;
}) {
  const lines = ledger(data.trades, data.splits, flows);
  const totals = ledgerTotals(lines);
  const picked = filterLedger(lines, filter);
  const shown = showAll ? picked : picked.slice(0, RECENT);
  const due = dividends?.due ?? [];
  const upcoming = dividends?.upcoming ?? [];
  const lastArrival = flows.filter((flow) => flow.type === 'windfall').reduce<string | null>((newest, flow) => (newest === null || flow.flowDate > newest ? flow.flowDate : newest), null);
  const hasWindfall = totals.windfall.arrivedTwd > 0 || totals.windfall.deployedTwd !== 0;

  const facts: Fact[] = [
    {
      label: { en: 'Net put in', zh: '淨投入' },
      value: twd(totals.regular.netTwd),
      note: { en: `bought ${twd(totals.regular.boughtTwd)} − sold ${twd(totals.regular.soldTwd)}`, zh: `買進 ${twd(totals.regular.boughtTwd)} − 賣出 ${twd(totals.regular.soldTwd)}` },
    },
    {
      label: { en: 'Dividends', zh: '股利' },
      value: twd(totals.dividendTwd),
      note: due.length > 0 ? { en: `${totals.dividends} recorded · ${due.length} to confirm`, zh: `${totals.dividends} 筆・待確認 ${due.length} 筆` } : { en: `${totals.dividends} recorded`, zh: `${totals.dividends} 筆` },
      ...(due.length > 0 ? { tone: 'watch' as const } : {}),
    },
    ...(hasWindfall
      ? [
          { label: { en: 'Windfall arrived', zh: '大額資金入帳' }, value: twd(totals.windfall.arrivedTwd), ...(lastArrival ? { note: { en: lastArrival, zh: lastArrival } } : {}) },
          {
            label: { en: 'Windfall deployed', zh: '大額已投入' },
            value: twd(totals.windfall.deployedTwd),
            note: { en: `${percent(totals.windfall.share, 0)} · ${twd(totals.windfall.waitingTwd)} waiting`, zh: `${percent(totals.windfall.share, 0)}・等待 ${twd(totals.windfall.waitingTwd)}` },
          },
        ]
      : []),
    ...(totals.withdrawnTwd > 0 ? [{ label: FLOW_TYPE.withdrawal, value: twd(totals.withdrawnTwd) }] : []),
  ];

  // The lines a setting can be changed for: the listed securities held long now.
  const held = [...new Set(portfolio.holdings.flatMap((holding) => (holding.ticker && holding.qty > 0 && holding.direction === 'long' ? [holding.ticker] : [])))].sort();
  const flags = new Map(dividends?.securities.map((security) => [security.ticker, security]));

  return (
    <section className="card form cash-book" id="cash-flows">
      <div className="row spread">
        <h2>
          <Bi {...LABELS.cashFlows} />
        </h2>
        <Link href="/cash-flows/new" className="button">
          <Bi {...LABELS.addCashFlow} />
        </Link>
      </div>
      {due.length > 0 && (
        <div id="dividends-due">
          <AlertTiles
            heading={{ en: 'Dividends paid: record them?', zh: '配息已發放：要記一筆嗎？' }}
            tone="watch"
            items={due.map(dueItem)}
            actions={Object.fromEntries(
              due.map((line) => [
                dueKey(line),
                <>
                  <Link href={recordHref(line)} className="button primary">
                    <Bi en="Record" zh="記一筆" />
                  </Link>
                  <form action={skipDividend}>
                    <input type="hidden" name="event" value={line.event.id} />
                    <input type="hidden" name="pool" value={line.pool} />
                    <input type="hidden" name="back" value="/holdings?saved=dividend-skipped#cash-flows" />
                    <button type="submit">
                      <Bi en="Skip" zh="略過" />
                    </button>
                  </form>
                </>,
              ]),
            )}
          />
        </div>
      )}
      {lines.length === 0 ? (
        <p className="muted">
          <Bi en="None yet." zh="尚無。" />
        </p>
      ) : (
        <>
          <Facts facts={facts} />
          <div className="segmented slide" role="group" aria-label="Show 顯示">
            {LEDGER_FILTERS.filter((option) => option !== 'windfall' || hasWindfall).map((option) => (
              <Link prefetch key={option} href={filterHref(option, false)} aria-current={option === filter ? 'true' : undefined} scroll={false}>
                <Bi {...FILTER[option]} />
              </Link>
            ))}
          </div>
          <div className="table-wrap">
            <table className="book">
              <thead>
                <tr>
                  <th>
                    <Bi {...LABELS.flowDate} />
                  </th>
                  <th>
                    <Bi en="Entry" zh="項目" />
                  </th>
                  <th className="num">
                    <Bi {...LABELS.amountTwd} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((line) => {
                  const text = [detail(line), line.note ?? ''].filter(Boolean).join(' · ');
                  return (
                    <tr key={line.key} className={line.counted ? undefined : 'uncounted'}>
                      <td className="nowrap">{line.date}</td>
                      <td>
                        <Link href={line.source === 'trade' ? `/holdings/${line.id}` : `/cash-flows/${line.id}`} prefetch={false} className="book-entry">
                          <span className={`kind ${line.kind}`}>
                            <Bi {...kindLabel(line)} />
                          </span>{' '}
                          {line.ticker && <strong>{line.ticker}</strong>}
                        </Link>
                        {line.pool === 'windfall' && line.kind !== 'windfall' && (
                          <>
                            {' '}
                            <span className="badge">
                              <Bi {...POOL.windfall} />
                            </span>
                          </>
                        )}
                        {!line.counted && (
                          <>
                            {' '}
                            <span className="badge warn">
                              <Bi en="Not added" zh="不計入" />
                            </span>
                          </>
                        )}
                        {text && <span className="book-detail">{text}</span>}
                      </td>
                      <td className="num">{twd(line.amountTwd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {picked.length === 0 && (
            <p className="muted">
              <Bi en="None yet." zh="尚無。" />
            </p>
          )}
          {!showAll && picked.length > RECENT && (
            <p>
              <Link href={filterHref(filter, true)}>
                <Bi en={`Show all ${picked.length} entries`} zh={`顯示全部 ${picked.length} 筆`} />
              </Link>
            </p>
          )}
        </>
      )}
      {upcoming.length > 0 && (
        <details className="nested" id="dividends-upcoming">
          <summary>
            <Bi en={`${upcoming.length} dividend${upcoming.length === 1 ? '' : 's'} ahead.`} zh={`即將配息 ${upcoming.length} 筆`} />
          </summary>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>
                    <Bi {...LABELS.ticker} />
                  </th>
                  <th>
                    <Bi en="Asked on" zh="詢問日" />
                  </th>
                  <th className="num">
                    <Bi en="About" zh="約" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((line) => (
                  <tr key={dueKey(line)}>
                    <td>
                      <strong>{line.event.ticker}</strong>
                      {line.pool === 'windfall' && (
                        <>
                          {' '}
                          <span className="badge">
                            <Bi {...POOL.windfall} />
                          </span>
                        </>
                      )}
                    </td>
                    <td className="nowrap">
                      {line.askOn}
                      {line.estimatedDate && (
                        <span className="book-detail">
                          <Bi en={`estimated from ex-dividend ${line.event.exDate}`} zh={`依除息日 ${line.event.exDate} 估計`} />
                        </span>
                      )}
                    </td>
                    <td className="num">{estimateText(line)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {dividends && held.length > 0 && (
        <details className="nested" id="dividend-settings" open={settingsOpen}>
          <summary>
            <Bi en="Dividend prompts" zh="配息詢問設定" />
          </summary>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>
                    <Bi {...LABELS.ticker} />
                  </th>
                  <th>
                    <Bi en="Dividends" zh="配息" />
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {held.map((ticker) => {
                  const reinvested = flags.get(ticker)?.reinvested ?? false;
                  return (
                    <tr key={ticker}>
                      <td>
                        <strong>{ticker}</strong>
                      </td>
                      <td>{reinvested ? <Bi en="Reinvested: not asked" zh="自動再投入：不詢問" /> : <Bi en="Asked when paid" zh="發放時詢問" />}</td>
                      <td>
                        <form action={setReinvested}>
                          <input type="hidden" name="ticker" value={ticker} />
                          <input type="hidden" name="reinvested" value={reinvested ? '0' : '1'} />
                          <button type="submit" aria-label={`${ticker} ${reinvested ? '改為詢問 Ask' : '不再詢問 Stop asking'}`}>
                            {reinvested ? <Bi en="Ask" zh="改為詢問" /> : <Bi en="Stop asking" zh="不再詢問" />}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <Info>
        <p>
          <Bi
            en="Buys and sells count by themselves, read from the trades: record a purchase once, on the holdings page. Type in here only what no trade tells: the windfall arriving, a dividend, a withdrawal."
            zh="買進與賣出由交易自動計入，在持倉頁記一次就好。這裡只需要登錄交易看不出來的：大額資金入帳、股利、提領。"
          />
        </p>
        <p>
          <Bi
            en="Net put in = bought − sold in the regular pool: each buy's own money with its fee and tax, each sell after them, at the trade's FX rate. Windfall deployed = bought − sold in the windfall pool, against what arrived."
            zh="淨投入 = 一般資金池的買進 − 賣出：買進含手續費與稅，賣出為扣除後金額，皆依交易當日匯率。大額已投入 = 大額資金池的買進 − 賣出，對照入帳金額。"
          />
        </p>
        <p>
          <Bi
            en="Dividends: each night the app looks up the ex-dividend and payment dates of what you hold and asks from the payment date. Estimate = shares the day before the ex-dividend date × cash a share × (1 − tax withheld); type what the broker paid. A contribution typed in earlier stays listed but is not added, as its buy already counts."
            zh="配息：每夜查詢持有標的的除息日與發放日，發放日起詢問。估計金額 = 除息前一日股數 × 每股配息 ×（1 − 預扣稅率），請填券商實際入帳金額。先前手動登錄的「投入資金」仍會列出，但不再加總（買進已計入）。"
          />
        </p>
      </Info>
    </section>
  );
}
