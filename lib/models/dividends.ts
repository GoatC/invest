/**
 * Dividend prompts (asked by Hugo on 2026-11-12): the nightly job saves each holding's cash
 * dividends by ex-dividend date (dividend_events); on the day one is paid the app asks whether to
 * record it as a cash flow, with the amount worked out. A security whose income is reinvested by
 * itself (securities.dividends_reinvested) is never asked about.
 *
 * - Entitled shares: the long shares held at the close of the day before the ex-dividend date, in
 *   that day's units (a later split does not count), one pool at a time.
 * - Asked from the payment date; without one, from the ex-dividend date + pay_lag_days of the
 *   security's market (an estimate), and for lookback_days after that.
 * - Estimate: shares × cash a share × (1 − withholding by the security's domicile), in TWD at the
 *   newest rate. Hugo types what the broker actually paid.
 * - Answered by a dividend cash flow of the same security and pool dated from the ex-dividend date
 *   to match_days after the asking day (one flow answers one dividend, the newest ex-date first),
 *   or by "skip" (dividend_events.skipped_pools).
 */
import { addDays } from '../dates';
import { money, twd } from '../format';
import type { Message } from './notify';
import { chronological, directionOf, opens } from './positions';
import { restateTrades, type Split } from './splits';
import type { CashFlow, Market, Pool, Trade } from './types';

export interface DividendEvent {
  id: number;
  ticker: string;
  /** The first day the shares trade without the dividend. */
  exDate: string;
  /** The day it is paid; null when the feed does not tell. */
  payDate: string | null;
  /** Cash a share, before any tax withheld. */
  amount: number;
  currency: string;
  source: string;
  /** The pools answered "skip". */
  skippedPools: Pool[];
}

export interface DividendSettings {
  /** How long after its asking day a dividend is still asked about. */
  lookbackDays: number;
  /** A dividend cash flow dated up to this long after the asking day answers it. */
  matchDays: number;
  /** Days from the ex-dividend date to the asking day when no payment date is known, by market. */
  payLagDays: Record<string, number>;
  /** The share withheld, by the security's domicile; none where a domicile is missing. */
  withholding: Record<string, number>;
  /** Whether the push job sends a push on the asking day. */
  push: boolean;
  /** Only dividends due within this many days are pushed, so a backlog never goes out at once. */
  pushDays: number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numbers(value: unknown, valid: (n: number) => boolean): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && valid(entry[1])));
}

/** config dividends; undefined before its migration or when malformed. */
export function readDividendSettings(value: unknown): DividendSettings | undefined {
  const row = record(value);
  const days = (key: string, max: number) => {
    const found = row[key];
    return typeof found === 'number' && Number.isInteger(found) && found >= 0 && found <= max ? found : undefined;
  };
  const lookbackDays = days('lookback_days', 400);
  const matchDays = days('match_days', 400);
  if (lookbackDays === undefined || matchDays === undefined) return undefined;
  return {
    lookbackDays,
    matchDays,
    payLagDays: numbers(row['pay_lag_days'], (n) => Number.isInteger(n) && n >= 0 && n <= 120),
    withholding: numbers(row['withholding'], (n) => n >= 0 && n < 1),
    push: row['push'] !== false,
    pushDays: days('push_days', 60) ?? 3,
  };
}

/** What the model needs to know of a security. */
export interface DividendSecurity {
  ticker: string;
  name: string;
  market: Market;
  domicile: string;
  currency: string;
  /** securities.dividends_reinvested. */
  reinvested: boolean;
  /** securities.dividends_checked_on, for the nightly job. */
  checkedOn?: string | null;
}

/** The day a dividend is asked about: its payment date, else an estimate from the ex-dividend date. */
export function askDate(event: Pick<DividendEvent, 'exDate' | 'payDate'>, market: string, settings: Pick<DividendSettings, 'payLagDays'>): string {
  return event.payDate ?? addDays(event.exDate, settings.payLagDays[market] ?? 0);
}

/**
 * The long shares of a ticker in a pool at the close of the day before `exDate`, in that day's
 * units: the trades before it, restated by the splits up to it. An ex-date still ahead counts the
 * shares held now.
 */
export function entitledShares(trades: readonly Trade[], splits: readonly Split[] | undefined, ticker: string, pool: Pool, exDate: string): number {
  const before = trades.filter((trade) => trade.ticker === ticker && trade.pool === pool && directionOf(trade) === 'long' && trade.tradeDate < exDate);
  const restated = restateTrades(before, splits?.filter((split) => split.exDate <= exDate));
  let qty = 0;
  for (const trade of chronological(restated)) qty = opens(trade) ? qty + trade.qty : Math.max(0, qty - trade.qty);
  return qty < 1e-9 ? 0 : qty;
}

export interface DividendDue {
  event: DividendEvent;
  security: DividendSecurity;
  pool: Pool;
  /** The shares the dividend is paid on. */
  qty: number;
  /** The day it is (or was) asked about. */
  askOn: string;
  /** True when that day is worked out from the ex-dividend date: the feed gave no payment date. */
  estimatedDate: boolean;
  /** The share withheld. */
  withholding: number;
  /** qty × cash a share. */
  grossLocal: number;
  /** After withholding: what the form is filled with. */
  netLocal: number;
  /** At the newest FX rate; null without one. */
  netTwd: number | null;
}

export interface DividendInput {
  events: readonly DividendEvent[];
  /** As traded. */
  trades: readonly Trade[];
  splits?: readonly Split[];
  securities: readonly DividendSecurity[];
  /** Every cash flow; only dividends are read. */
  flows: readonly CashFlow[];
  /** TWD per unit of a currency, the newest. */
  fx: ReadonlyMap<string, number>;
}

const POOLS: readonly Pool[] = ['regular', 'windfall'];

function roundCash(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The dividends to ask about today (`due`, the newest first) and those still ahead (`upcoming`,
 * the nearest first): each event once per pool that held the security before its ex-dividend date.
 */
export function dividendsDue(input: DividendInput, settings: DividendSettings, today: string): { due: DividendDue[]; upcoming: DividendDue[] } {
  const securities = new Map(input.securities.map((security) => [security.ticker, security]));
  const lines: DividendDue[] = [];
  for (const event of input.events) {
    const security = securities.get(event.ticker);
    if (!security || security.reinvested) continue;
    const askOn = askDate(event, security.market, settings);
    if (askOn < addDays(today, -settings.lookbackDays)) continue;
    for (const pool of POOLS) {
      const qty = entitledShares(input.trades, input.splits, event.ticker, pool, event.exDate);
      if (qty <= 0) continue;
      const withholding = settings.withholding[security.domicile] ?? 0;
      const grossLocal = qty * event.amount;
      const netLocal = roundCash(grossLocal * (1 - withholding));
      const rate = event.currency === 'TWD' ? 1 : input.fx.get(event.currency);
      lines.push({ event, security, pool, qty, askOn, estimatedDate: event.payDate === null, withholding, grossLocal, netLocal, netTwd: rate === undefined ? null : netLocal * rate });
    }
  }

  // A recorded dividend answers one event: the newest ex-date not after it, within the window.
  const answered = new Set<DividendDue>();
  const dividends = input.flows.filter((flow) => flow.type === 'dividend' && flow.ticker !== null).sort((a, b) => a.flowDate.localeCompare(b.flowDate));
  for (const flow of dividends) {
    const match = lines
      .filter((line) => !answered.has(line) && line.event.ticker === flow.ticker && line.pool === flow.pool && line.event.exDate <= flow.flowDate && flow.flowDate <= addDays(line.askOn, settings.matchDays))
      .sort((a, b) => b.event.exDate.localeCompare(a.event.exDate))[0];
    if (match) answered.add(match);
  }

  const open = lines.filter((line) => !answered.has(line) && !line.event.skippedPools.includes(line.pool));
  return {
    due: open.filter((line) => line.askOn <= today).sort((a, b) => b.askOn.localeCompare(a.askOn) || a.event.ticker.localeCompare(b.event.ticker)),
    upcoming: open.filter((line) => line.askOn > today).sort((a, b) => a.askOn.localeCompare(b.askOn) || a.event.ticker.localeCompare(b.event.ticker)),
  };
}

/** What the nightly job's dividend step reads: each security held since `since`, and its dividends already saved from there on. */
export interface DividendPlan {
  /** Ex-dividend dates from this day on are kept: the prompt's lookback with its longest lag to the payment. */
  since: string;
  holdings: Array<{
    ticker: string;
    market: string;
    currency: string;
    /** A fund (Nasdaq's asset class etf) rather than a single stock. */
    etf: boolean;
    /** Saved already, by ex-dividend date. */
    known: Record<string, { payDate: string | null; source: string }>;
    /** securities.dividends_checked_on: the day Alpha Vantage last answered for it; null when never. */
    checkedOn: string | null;
  }>;
}

/** The first ex-dividend date worth keeping: the lookback, the longest lag from an ex-date to its asking day, and a week to spare. */
export function eventsSince(settings: Pick<DividendSettings, 'lookbackDays' | 'payLagDays'>, today: string): string {
  return addDays(today, -(settings.lookbackDays + Math.max(0, ...Object.values(settings.payLagDays)) + 7));
}

/**
 * The securities whose dividends the job looks up: Taiwan and US lines held long at `since` or
 * bought since, in either pool, whose income is not reinvested by itself.
 */
export function dividendHoldings(trades: readonly Trade[], splits: readonly Split[] | undefined, securities: readonly DividendSecurity[], since: string): DividendSecurity[] {
  return securities.filter((security) => {
    if (security.reinvested || (security.market !== 'TW' && security.market !== 'US')) return false;
    const bought = trades.some((trade) => trade.ticker === security.ticker && directionOf(trade) === 'long' && opens(trade) && trade.tradeDate >= since);
    return bought || POOLS.some((pool) => entitledShares(trades, splits, security.ticker, pool, since) > 0);
  });
}

/** "約 NT$1,234", or the amount in its own currency while no rate is known. */
export function estimateText(line: Pick<DividendDue, 'netTwd' | 'netLocal'> & { event: Pick<DividendEvent, 'currency'> }): string {
  return line.netTwd === null ? money(line.netLocal, line.event.currency) : twd(line.netTwd);
}

/** The cash a share as written: "0.4084 USD", "1.92 TWD" (up to four decimals, no trailing zeros). */
export function perShareText(event: Pick<DividendEvent, 'amount' | 'currency'>): string {
  return `${Number(event.amount.toFixed(4))} ${event.currency}`;
}

/** The key of a prompt: an event in a pool. */
export function dueKey(line: Pick<DividendDue, 'pool'> & { event: Pick<DividendEvent, 'id'> }): string {
  return `${line.event.id}:${line.pool}`;
}

/** The form that records it, filled in. */
export function recordHref(line: Pick<DividendDue, 'pool'> & { event: Pick<DividendEvent, 'id'> }): string {
  return `/cash-flows/new?dividend=${line.event.id}&pool=${line.pool}`;
}

/** The push on the asking day: a title and one line, in Chinese. */
export function dividendMessage(line: DividendDue): Message {
  const when = line.estimatedDate ? `${line.event.exDate} 除息` : `${line.askOn} 發放`;
  return {
    kind: 'dividend',
    key: dueKey(line),
    title: `${line.event.ticker} 配息`,
    body: `${when}，約 ${estimateText(line)}：要記一筆股利嗎？`,
    url: recordHref(line),
  };
}

/** The dividends to push now: due within the last push_days and not pushed before. */
export function dividendPushes(due: readonly DividendDue[], settings: DividendSettings, today: string, planned: ReadonlySet<string>): Message[] {
  if (!settings.push) return [];
  const since = addDays(today, -settings.pushDays);
  return due.filter((line) => line.askOn >= since && !planned.has(dueKey(line))).map(dividendMessage);
}
