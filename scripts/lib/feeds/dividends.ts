/**
 * Each holding's cash dividends, for the dividend prompt (asked by Hugo on 2026-11-12; checked
 * live the same day): the ex-dividend date, the cash a share and, where the feed tells, the day it
 * is paid.
 *
 * - Taiwan: FinMind's TaiwanStockDividend (stocks and ETFs), with both dates.
 * - US: Nasdaq's dividend history (api.nasdaq.com, no key), with both dates, for Nasdaq-listed
 *   symbols only; any other symbol answers "not available".
 * - US, the rest (NYSE Arca ETFs such as VT): the ex-dividend date and the amount are read off the
 *   adjusted closes the job loads anyway, and Alpha Vantage's DIVIDENDS (the free key's 25 a day,
 *   so asked only when a new dividend has no payment date yet) adds the payment date.
 * London lines have no free feed; the ones in the reference data accumulate their income.
 */
import { avUrl } from './alphavantage.ts';
import type { Row } from './finmind.ts';
import { FeedError, positive, type DailyPrice } from './types.ts';

export interface DividendRow {
  ticker: string;
  exDate: string;
  payDate: string | null;
  /** Cash a share, before any tax withheld. */
  amount: number;
  currency: string;
  source: string;
}

function isoDate(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim().slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

/** A payment date before its ex-dividend date is a slip of the feed: left out rather than saved. */
function row(ticker: string, exDate: string, payDate: string | undefined, amount: number, currency: string, source: string): DividendRow {
  return { ticker, exDate, payDate: payDate && payDate >= exDate ? payDate : null, amount: Math.round(amount * 1e6) / 1e6, currency, source };
}

/**
 * TaiwanStockDividend: one row per distribution, cash from earnings and from the statutory
 * surplus added; rows that are stock only, or whose ex-dividend date is not set yet, are left out.
 */
export function finmindDividends(rows: readonly Row[], ticker: string): DividendRow[] {
  return rows.flatMap((entry) => {
    const exDate = isoDate(entry['CashExDividendTradingDate']);
    const cash = (positive(entry['CashEarningsDistribution']) ?? 0) + (positive(entry['CashStatutorySurplus']) ?? 0);
    return exDate && cash > 0 ? [row(ticker, exDate, isoDate(entry['CashDividendPaymentDate']), cash, 'TWD', 'finmind')] : [];
  });
}

/** Nasdaq's dividend history of a symbol; the asset class is `stocks` or `etf`. */
export function nasdaqDividendUrl(ticker: string, etf: boolean): string {
  return `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/dividends?assetclass=${etf ? 'etf' : 'stocks'}`;
}

/** Nasdaq answers a plain script's User-Agent slowly or not at all; a browser's passes. */
export const NASDAQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

/** "11/12/2026" → "2026-11-12"; "N/A" → undefined. */
function usDate(value: unknown): string | undefined {
  const found = typeof value === 'string' ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim()) : null;
  return found ? `${found[3]}-${found[1]?.padStart(2, '0')}-${found[2]?.padStart(2, '0')}` : undefined;
}

/**
 * Nasdaq's reply: each cash dividend's ex-date, amount ("$0.27") and payment date. Undefined when
 * Nasdaq does not carry the symbol (listed elsewhere), so the caller turns to the next source.
 */
export function nasdaqDividends(json: string, ticker: string, currency: string): DividendRow[] | undefined {
  let body: { data?: { dividends?: { rows?: unknown } } | null; message?: unknown; status?: { rCode?: unknown } };
  try {
    body = JSON.parse(json) as typeof body;
  } catch {
    throw new FeedError('Nasdaq: reply is not JSON');
  }
  const rows = body.data?.dividends?.rows;
  if (!Array.isArray(rows)) {
    if (body.status?.rCode === 200 || typeof body.message === 'string') return undefined;
    throw new FeedError('Nasdaq: no dividends in the reply');
  }
  return rows.flatMap((entry) => {
    const line = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const exDate = usDate(line['exOrEffDate']);
    const amount = positive(typeof line['amount'] === 'string' ? line['amount'].replace(/[$,\s]/g, '') : line['amount']);
    const cash = typeof line['type'] !== 'string' || /cash/i.test(line['type']);
    return exDate && amount && cash ? [row(ticker, exDate, usDate(line['paymentDate']), amount, currency, 'nasdaq')] : [];
  });
}

export function avDividendUrl(symbol: string, key: string): string {
  return avUrl('DIVIDENDS', symbol, key);
}

/** Alpha Vantage DIVIDENDS: { data: [{ ex_dividend_date, payment_date, amount }] }. */
export function avDividends(json: string, ticker: string, currency: string): DividendRow[] {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new FeedError('Alpha Vantage: reply is not JSON');
  }
  const refusal = body['Information'] ?? body['Note'] ?? body['Error Message'];
  if (typeof refusal === 'string') throw new FeedError(`Alpha Vantage refused: ${refusal.slice(0, 120)}`);
  if (!Array.isArray(body['data'])) throw new FeedError('Alpha Vantage: no "data" in the reply');
  return body['data'].flatMap((entry) => {
    const line = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const exDate = isoDate(line['ex_dividend_date']);
    const amount = positive(line['amount']);
    return exDate && amount ? [row(ticker, exDate, isoDate(line['payment_date']), amount, currency, 'alphavantage')] : [];
  });
}

/** The smallest dividend read off the closes: FinMind rounds them to a cent, so less is noise. */
const MIN_CASH = 0.03;
/** And the smallest share of the price (0.05%). */
const MIN_YIELD = 0.0005;
/** A factor that moves this much in a day is a split, not a dividend. */
const MAX_YIELD = 0.2;

/**
 * Cash dividends read off closes and their adjusted closes, from `since` on: an adjusted close is
 * the close × a factor that every later dividend lowers by (1 − cash ÷ the close before it), so on
 * an ex-dividend date the factor steps up, and the step gives the cash:
 *   cash = close before × (1 − factor before ÷ factor on the day).
 * The ex-date is exact; the amount is good to about a cent (the closes' rounding), and no payment
 * date comes with it.
 */
export function dividendsFromAdjusted(prices: readonly DailyPrice[], ticker: string, currency: string, since: string): DividendRow[] {
  const days = prices.filter((price) => price.ticker === ticker && price.adjClose !== null && price.adjClose > 0).sort((a, b) => a.date.localeCompare(b.date));
  const out: DividendRow[] = [];
  for (let i = 1; i < days.length; i++) {
    const [before, day] = [days[i - 1], days[i]];
    if (!before || !day || day.date < since) continue;
    const step = 1 - (before.adjClose as number) / before.close / ((day.adjClose as number) / day.close);
    const cash = Math.round(before.close * step * 100) / 100;
    if (cash >= MIN_CASH && step >= MIN_YIELD && step <= MAX_YIELD) out.push(row(ticker, day.date, undefined, cash, currency, 'adjusted_close'));
  }
  return out;
}
