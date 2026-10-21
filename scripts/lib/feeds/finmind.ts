/**
 * FinMind (free "register" level with a token, 600 requests an hour): Taiwan daily prices and
 * ex-dividend results, US daily prices with an adjusted close, Bank of Taiwan exchange rates and
 * the international gold price. Checked in Phase 1, step 4 (2026-10-21); Taiwan adjusted prices
 * need a paid level, so they are computed here from the ex-dividend results.
 */
import { FeedError, positive, type DailyPrice, type DailyRate, type Get } from './types.ts';

const API = 'https://api.finmindtrade.com/api/v4/data';
export const SOURCE = 'finmind';

export type Row = Record<string, unknown>;

export function finmindUrl(dataset: string, params: { dataId?: string; start: string; end?: string }): string {
  const url = new URL(API);
  url.searchParams.set('dataset', dataset);
  if (params.dataId) url.searchParams.set('data_id', params.dataId);
  url.searchParams.set('start_date', params.start);
  if (params.end) url.searchParams.set('end_date', params.end);
  return url.toString();
}

/** The rows of a FinMind reply; an error envelope (wrong level, quota used up) becomes a FeedError. */
export function finmindRows(text: string, what: string): Row[] {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FeedError(`FinMind ${what}: reply is not JSON`);
  }
  const reply = body as { status?: unknown; msg?: unknown; data?: unknown };
  if (reply.status !== 200 || !Array.isArray(reply.data)) {
    throw new FeedError(`FinMind ${what}: ${String(reply.msg ?? 'no data').slice(0, 120)}`);
  }
  return reply.data.filter((row): row is Row => typeof row === 'object' && row !== null);
}

function date(row: Row): string | undefined {
  const text = typeof row['date'] === 'string' ? row['date'].slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

/** TaiwanStockPrice: raw closes; days without trading carry a close of 0 and are left out. */
export function taiwanPrices(rows: readonly Row[], ticker: string): DailyPrice[] {
  return rows.flatMap((row) => {
    const day = date(row);
    const close = positive(row['close']);
    return day && close ? [{ ticker, date: day, close, adjClose: null, source: SOURCE }] : [];
  });
}

/** One ex-dividend (or ex-rights) day: closes before it are scaled by after ÷ before. */
export interface Adjustment {
  date: string;
  factor: number;
}

/** TaiwanStockDividendResult: the reference price after each ex-date over the close before it. */
export function exDividendFactors(rows: readonly Row[]): Adjustment[] {
  return rows.flatMap((row) => {
    const day = date(row);
    const before = positive(row['before_price']);
    const after = positive(row['after_price']);
    return day && before && after && after < before ? [{ date: day, factor: after / before }] : [];
  });
}

/**
 * Dividend-adjusted closes, as a total-return series: each close times the factors of every
 * ex-date after it. The latest close stays as quoted.
 */
export function adjustForDividends(prices: readonly DailyPrice[], adjustments: readonly Adjustment[]): DailyPrice[] {
  const events = [...adjustments].sort((a, b) => b.date.localeCompare(a.date));
  const adjusted: DailyPrice[] = [];
  let factor = 1;
  let next = 0;
  for (const price of [...prices].sort((a, b) => b.date.localeCompare(a.date))) {
    // Walking back in time, an ex-date's factor applies to every close strictly before it.
    for (let event = events[next]; event && event.date > price.date; event = events[++next]) factor *= event.factor;
    adjusted.push({ ...price, adjClose: Math.round(price.close * factor * 1e6) / 1e6 });
  }
  return adjusted.reverse();
}

/** USStockPrice: closes with FinMind's adjusted close. */
export function usPrices(rows: readonly Row[], ticker: string): DailyPrice[] {
  return rows.flatMap((row) => {
    const day = date(row);
    const close = positive(row['Close']);
    return day && close ? [{ ticker, date: day, close, adjClose: positive(row['Adj_Close']) ?? null, source: SOURCE }] : [];
  });
}

/** TaiwanExchangeRate (Bank of Taiwan): TWD per unit, the middle of the spot rates, else of the cash rates. */
export function bankOfTaiwanRates(rows: readonly Row[], currency: string): DailyRate[] {
  return rows.flatMap((row) => {
    const day = date(row);
    const spot = [positive(row['spot_buy']), positive(row['spot_sell'])];
    const cash = [positive(row['cash_buy']), positive(row['cash_sell'])];
    const [buy, sell] = spot.every((value) => value !== undefined) ? spot : cash;
    return day && buy && sell ? [{ pair: `${currency}/TWD`, date: day, rate: Math.round(((buy + sell) / 2) * 1e4) / 1e4, source: SOURCE }] : [];
  });
}

/** GoldPrice: five-minute USD-per-ounce prices; each day's last price stands as its close (XAU/USD). */
export function goldCloses(rows: readonly Row[]): DailyRate[] {
  const last = new Map<string, { at: string; rate: number }>();
  for (const row of rows) {
    const at = typeof row['date'] === 'string' ? row['date'] : '';
    const day = at.slice(0, 10);
    const rate = positive(row['Price']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !rate) continue;
    const current = last.get(day);
    if (!current || at > current.at) last.set(day, { at, rate });
  }
  return [...last.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, { rate }]) => ({ pair: 'XAU/USD', date: day, rate, source: SOURCE }));
}

/** The FinMind client: one GET per dataset and range, with the token as a bearer header. */
export class FinMind {
  constructor(
    private readonly get: Get,
    private readonly token: string,
  ) {}

  async rows(dataset: string, params: { dataId?: string; start: string; end?: string }): Promise<Row[]> {
    const text = await this.get(finmindUrl(dataset, params), { Authorization: `Bearer ${this.token}` });
    return finmindRows(text, `${dataset}${params.dataId ? ` ${params.dataId}` : ''}`);
  }
}
