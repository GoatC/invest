/**
 * F18 true performance (PRD Module D). From the trades, the dividends recorded as cash flows, the
 * non-listed assets' history and the saved prices, it builds the portfolio's value for every day,
 * its time-weighted return (TWR) against the SAA benchmark, its money-weighted return (XIRR) and
 * the split of returns into local-currency, currency and cross terms. Pure functions: the
 * performance page runs them on request and the nightly job stores one NAV snapshot per day.
 *
 * Method:
 * - Value: quantity × the day's close × the day's FX rate (the newest on or before the day). A
 *   security without a close or a rate yet counts at its last trade's; gold at the gold price,
 *   or the value entered by hand until there is one; a TWD balance at itself.
 * - TWR: each day, every holding's return from its total-return price (dividends reinvested), in
 *   TWD, weighted by its value at the previous close; the days are chained. Trades count at the
 *   day's close, so money moving in or out does not change it: it measures the holdings, not the
 *   timing.
 * - Benchmark: the SAA target weights, rebalanced daily, each class at its proxy's TWD return.
 * - XIRR: the dates and TWD amounts of every buy, sell and recorded dividend, and of every change
 *   to a non-listed asset, with the value at the end; so it reflects when the money went in.
 */
import { addDays } from '../dates';
import { daysBetween } from './fx';
import { stateOn, type ManualHistory, type ManualState } from './manual-history';
import { MarketHistory, type PriceRow } from './market';
import { chronological, positionKey } from './positions';
import type { AssetClass, CashFlow, FxQuote, Pool, Security, Trade } from './types';

export type Scope = 'all' | Pool;
export const SCOPES: readonly Scope[] = ['all', 'regular', 'windfall'];

/** A benchmark proxy and its share of the SAA. */
export interface BenchmarkWeight {
  ticker: string;
  weight: number;
}

export interface PerformanceInput {
  /** The last day of the series: today in Taipei. */
  end: string;
  trades: readonly Trade[];
  /** Cash flows; only dividends count here, as money a holding paid out. */
  cashFlows: readonly CashFlow[];
  manualAssets: readonly ManualHistory[];
  /** For each traded ticker's asset class, and each proxy's currency. */
  securities: readonly Security[];
  benchmark: readonly BenchmarkWeight[];
  prices: readonly PriceRow[];
  /** "<CUR>/TWD" daily rates, and XAU/TWD: the gold price per troy ounce. */
  rates: readonly FxQuote[];
}

type PerScope = Record<Scope, number>;
type MaybePerScope = Record<Scope, number | null>;

export interface DayPoint {
  date: string;
  /** Market value at the day's close, TWD. */
  value: PerScope;
  /** Money put in (negative) or taken out (positive) that day, from the investor's side, TWD. */
  flow: PerScope;
  /** The regular pool's value per asset class, TWD, for the class weights. */
  classValue: Record<string, number>;
  /** The day's return in TWD; null when the scope held nothing at the previous close. */
  ret: MaybePerScope;
  /** The same with foreign holdings in their own currency, before the currency's move. */
  local: MaybePerScope;
  /** The SAA benchmark's TWD return that day; null when a proxy has no price yet. */
  benchmark: number | null;
  /** Some value rests on a trade price or a hand-entered value instead of a close. */
  estimated: boolean;
}

function perScope(value: number): PerScope {
  return { all: value, regular: value, windfall: value };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(key(row)) ?? [];
    list.push(row);
    out.set(key(row), list);
  }
  return out;
}

/** The benchmark from the SAA: each class's target weight on its proxy (PRD N4 proxy table), merged per proxy. */
export function benchmarkWeights(assetClasses: readonly (Pick<AssetClass, 'targetWeight'> & { benchmarkTicker: string | null })[]): BenchmarkWeight[] {
  const weights = new Map<string, number>();
  for (const assetClass of assetClasses) {
    if (!assetClass.benchmarkTicker || assetClass.targetWeight <= 0) continue;
    weights.set(assetClass.benchmarkTicker, (weights.get(assetClass.benchmarkTicker) ?? 0) + assetClass.targetWeight);
  }
  return [...weights].map(([ticker, weight]) => ({ ticker, weight })).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** The first day anything was bought or recorded. */
export function firstDay(input: Pick<PerformanceInput, 'trades' | 'cashFlows' | 'manualAssets'>): string | undefined {
  const dates = [
    ...input.trades.map((trade) => trade.tradeDate),
    ...input.cashFlows.filter((flow) => flow.type === 'dividend').map((flow) => flow.flowDate),
    ...input.manualAssets.flatMap((asset) => asset.states.slice(0, 1).map((state) => state.from)),
  ];
  return dates.length === 0 ? undefined : dates.reduce((min, date) => (date < min ? date : min));
}

interface Held {
  ticker: string;
  pool: Pool;
  currency: string;
  assetClassId: string;
  qty: number;
  /** The last trade's price and rate: the value until the feeds have a close and a rate. */
  lastPrice: number;
  lastFx: number;
}

/** Each day's value, money moved, returns and benchmark, from the first trade to `end`. */
export function buildSeries(input: PerformanceInput): DayPoint[] {
  const start = firstDay(input);
  if (!start || start > input.end) return [];

  const market = new MarketHistory(input.prices, input.rates);
  const securities = new Map(input.securities.map((security) => [security.ticker, security]));
  const tradesOn = groupBy(chronological(input.trades), (trade) => trade.tradeDate);
  const dividendsOn = groupBy(
    input.cashFlows.filter((flow) => flow.type === 'dividend'),
    (flow) => flow.flowDate,
  );
  const benchmark = input.benchmark.filter((proxy) => proxy.weight > 0);
  const benchmarkTotal = benchmark.reduce((sum, proxy) => sum + proxy.weight, 0);

  /**
   * TWD per unit of a non-listed asset on a date: 1 for a TWD balance; for gold the gold price per
   * gram, or, until there is one, the value entered by hand per gram (estimated).
   */
  const unitPrice = (state: ManualState, date: string): { price: number; estimated: boolean } => {
    if (state.unit === 'TWD') return { price: 1, estimated: false };
    const perGram = market.goldPerGram(date);
    if (perGram !== undefined) return { price: perGram, estimated: false };
    return { price: state.quantity > 0 && state.lastValueTwd !== null ? state.lastValueTwd / state.quantity : 0, estimated: true };
  };

  const holdings = new Map<string, Held>();
  /** Yesterday's manual-asset states, and every holding's value at yesterday's close. */
  let manual = new Map<number, ManualState>();
  let closing = new Map<string, number>();
  const days: DayPoint[] = [];

  let before: string | undefined;
  for (let date = start; date <= input.end; before = date, date = addDays(date, 1)) {
    let estimated = false;
    // Each non-listed asset today and at yesterday's close, priced once for the day. A value
    // entered by hand today is today's price, so revaluing gold by hand counts as return, not as
    // money moved; a quantity set to 0 keeps yesterday's price.
    const assets = input.manualAssets.flatMap((asset) => {
      const now = stateOn(asset, date);
      const was = manual.get(asset.id);
      if (!now && !was) return [];
      const sameUnit = now !== undefined && was !== undefined && now.unit === was.unit;
      const wasPrice = was ? unitPrice(sameUnit && now.quantity > 0 ? now : was, date) : undefined;
      const nowPrice = now ? (sameUnit && now.quantity === 0 && wasPrice ? wasPrice : unitPrice(now, date)) : undefined;
      return [{ id: asset.id, now, was, wasPrice, nowPrice }];
    });

    // 1. The day's return on what was held at the previous close.
    const base = perScope(0);
    const twdSum = perScope(0);
    const localSum = perScope(0);
    const add = (pool: Pool, value: number, twd: number, local: number) => {
      for (const scope of ['all', pool] as const) {
        base[scope] += value;
        twdSum[scope] += value * twd;
        localSum[scope] += value * local;
      }
    };
    if (before !== undefined) {
      const then = before;
      for (const [key, held] of holdings) {
        const value = closing.get(key);
        if (value === undefined || value <= 0) continue;
        // Valued at the trade price yesterday (no close yet): today's close against that price.
        const close = market.close(held.ticker, date);
        const price = market.growth(held.ticker, then, date) ?? (close === undefined ? 1 : close / held.lastPrice);
        const rate = market.fx(held.currency, date);
        const fx = market.fxGrowth(held.currency, then, date) ?? (rate === undefined ? 1 : rate / held.lastFx);
        add(held.pool, value, price * fx - 1, price - 1);
      }
      for (const { id, was, wasPrice } of assets) {
        const value = closing.get(`manual:${id}`);
        if (!was || !wasPrice || value === undefined || value <= 0) continue;
        const twd = (was.quantity * wasPrice.price) / value - 1;
        // Gold is priced in US dollars (XAU/USD × USD/TWD): its local return leaves the dollar's move out.
        const usd = was.unit === 'grams' ? market.fxGrowth('USD', then, date) : undefined;
        add(was.pool, value, twd, usd === undefined ? twd : (1 + twd) / usd - 1);
      }
    }
    const ret = {} as MaybePerScope;
    const local = {} as MaybePerScope;
    for (const scope of SCOPES) {
      ret[scope] = base[scope] > 0 ? twdSum[scope] / base[scope] : null;
      local[scope] = base[scope] > 0 ? localSum[scope] / base[scope] : null;
    }
    let benchmarkReturn: number | null = null;
    if (before !== undefined && benchmarkTotal > 0) {
      let sum = 0;
      for (const proxy of benchmark) {
        const growth = market.twdGrowth(proxy.ticker, securities.get(proxy.ticker)?.currency ?? 'USD', before, date);
        if (growth === undefined) {
          sum = Number.NaN;
          break;
        }
        sum += proxy.weight * (growth - 1);
      }
      benchmarkReturn = Number.isNaN(sum) ? null : sum / benchmarkTotal;
    }

    // 2. The day's trades and dividends: positions change, money moves.
    const flow = perScope(0);
    const move = (pool: Pool, amount: number) => {
      flow.all += amount;
      flow[pool] += amount;
    };
    for (const trade of tradesOn.get(date) ?? []) {
      const key = positionKey(trade.pool, trade.ticker);
      const held = holdings.get(key) ?? {
        ticker: trade.ticker,
        pool: trade.pool,
        currency: trade.currency,
        assetClassId: securities.get(trade.ticker)?.assetClassId ?? '',
        qty: 0,
        lastPrice: trade.price,
        lastFx: trade.fxRate,
      };
      held.qty = trade.side === 'buy' ? held.qty + trade.qty : Math.max(0, held.qty - trade.qty);
      held.lastPrice = trade.price;
      held.lastFx = trade.fxRate;
      holdings.set(key, held);
      const gross = trade.qty * trade.price;
      move(trade.pool, trade.side === 'buy' ? -(gross + trade.fee + trade.tax) * trade.fxRate : (gross - trade.fee - trade.tax) * trade.fxRate);
    }
    for (const dividend of dividendsOn.get(date) ?? []) move(dividend.pool, dividend.amount * dividend.fxRate);

    // 3. The values at the day's close.
    const value = perScope(0);
    const classValue: Record<string, number> = {};
    const count = (pool: Pool, assetClassId: string, amount: number) => {
      value.all += amount;
      value[pool] += amount;
      if (pool === 'regular') classValue[assetClassId] = (classValue[assetClassId] ?? 0) + amount;
    };
    const nextClosing = new Map<string, number>();
    for (const [key, held] of holdings) {
      if (held.qty <= 0) continue;
      const close = market.close(held.ticker, date);
      const rate = market.fx(held.currency, date);
      if (close === undefined || rate === undefined) estimated = true;
      const amount = held.qty * (close ?? held.lastPrice) * (rate ?? held.lastFx);
      count(held.pool, held.assetClassId, amount);
      nextClosing.set(key, amount);
    }
    const nextManual = new Map<number, ManualState>();
    for (const { id, now, was, wasPrice, nowPrice } of assets) {
      // Adding, changing or removing a non-listed asset is money in or out: the change in quantity at the day's price.
      if (now && was && nowPrice && now.unit === was.unit && now.pool === was.pool) move(now.pool, (was.quantity - now.quantity) * nowPrice.price);
      else {
        if (was && wasPrice) move(was.pool, was.quantity * wasPrice.price);
        if (now && nowPrice) move(now.pool, -now.quantity * nowPrice.price);
      }
      if (!now || !nowPrice) continue;
      if (nowPrice.estimated) estimated = true;
      const amount = now.quantity * nowPrice.price;
      nextManual.set(id, now);
      count(now.pool, now.assetClassId, amount);
      nextClosing.set(`manual:${id}`, amount);
    }
    closing = nextClosing;
    manual = nextManual;
    days.push({ date, value, flow, classValue, ret, local, benchmark: benchmarkReturn, estimated });
  }
  return days;
}

// ---------------------------------------------------------------------------
// Returns over a period
// ---------------------------------------------------------------------------

/** Chains daily returns: (1 + r1)(1 + r2)… − 1; null when no day had one. */
export function chain(returns: ReadonlyArray<number | null>): number | null {
  let product = 1;
  let any = false;
  for (const r of returns) {
    if (r === null) continue;
    product *= 1 + r;
    any = true;
  }
  return any ? product - 1 : null;
}

/** A cumulative return over `days` calendar days as a yearly rate. */
export function annualise(cumulative: number, days: number): number {
  return (1 + cumulative) ** (365 / days) - 1;
}

/**
 * Splits a TWD return into the local-currency return, the currency's return and the cross term:
 * (1 + TWD) = (1 + local)(1 + currency), so TWD = local + currency + local × currency (PRD F18).
 */
export function fxSplit(twd: number, local: number): { local: number; currency: number; cross: number } {
  const currency = (1 + twd) / (1 + local) - 1;
  return { local, currency, cross: local * currency };
}

export interface PeriodReturn {
  /** The close the period is measured from: `from`, or the first purchase if that is later. */
  from: string;
  to: string;
  days: number;
  twr: number | null;
  local: number | null;
  /** The benchmark over the same days; null when a proxy had no price on one of them. */
  benchmark: number | null;
  /** Money-weighted, as a yearly rate (spreadsheet XIRR). */
  xirr: number | null;
  /** Value at the close of `from` and of `to`, and the gain in between net of money moved, TWD. */
  startValue: number;
  endValue: number;
  gain: number;
  /** Some day in the period rests on a trade price or a hand-entered value. */
  estimated: boolean;
}

/** The returns from the close of `from` to the close of `to`. */
export function periodReturn(days: readonly DayPoint[], scope: Scope, from: string, to: string): PeriodReturn {
  const inside = days.filter((day) => day.date > from && day.date <= to);
  const invested = inside.filter((day) => day.ret[scope] !== null);
  const first = invested[0];
  const measuredFrom = first && addDays(first.date, -1) > from ? addDays(first.date, -1) : from;
  const benchmarks = invested.map((day) => day.benchmark);
  const startValue = days.find((day) => day.date === from)?.value[scope] ?? 0;
  const endValue = inside[inside.length - 1]?.value[scope] ?? startValue;
  return {
    from: measuredFrom,
    to,
    days: daysBetween(measuredFrom, to),
    twr: chain(invested.map((day) => day.ret[scope])),
    local: chain(invested.map((day) => day.local[scope])),
    benchmark: benchmarks.length === 0 || benchmarks.includes(null) ? null : chain(benchmarks),
    // From `from` itself, so a period that starts before the first buy counts the buys' fees and tax.
    xirr: periodXirr(days, scope, from, to) ?? null,
    startValue,
    endValue,
    gain: endValue - startValue + inside.reduce((sum, day) => sum + day.flow[scope], 0),
    estimated: inside.some((day) => day.estimated),
  };
}

/** The periods the performance page reports, shortest first. */
export const PERIODS = ['1m', '3m', 'ytd', '1y', '3y', '5y', 'all'] as const;
export type Period = (typeof PERIODS)[number];

const MONTHS_BACK: Partial<Record<Period, number>> = { '1m': 1, '3m': 3, '1y': 12, '3y': 36, '5y': 60 };

/** The same day `months` months earlier, or that month's last day when it is shorter (31 March → 28 February). */
export function monthsBefore(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const index = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/**
 * The close a period ending on `end` is measured from: the last close of the previous year for
 * year to date, the day before `first` (the first day of the series) for since the start.
 */
export function periodStart(period: Period, end: string, first: string): string {
  if (period === 'all') return addDays(first, -1);
  if (period === 'ytd') return `${Number(end.slice(0, 4)) - 1}-12-31`;
  return monthsBefore(end, MONTHS_BACK[period] ?? 0);
}

/** Each period the scope was invested for in full, then since the start. */
export function periodTable(days: readonly DayPoint[], scope: Scope, end: string): Array<{ period: Period; result: PeriodReturn }> {
  const first = days[0]?.date;
  if (!first) return [];
  const rows: Array<{ period: Period; result: PeriodReturn }> = [];
  for (const period of PERIODS) {
    const from = periodStart(period, end, first);
    const result = periodReturn(days, scope, from, end);
    if (result.twr === null) continue;
    // A period that began before the first purchase would only repeat "since the start".
    if (period !== 'all' && result.from > from) continue;
    rows.push({ period, result });
  }
  return rows;
}

/**
 * The returns as reported: a period of a year or more per year, a shorter one as it was, since
 * a yearly rate over a few weeks exaggerates. The XIRR, a yearly rate already, follows the same rule.
 */
export function asReported(result: PeriodReturn): { perYear: boolean; twr: number | null; benchmark: number | null; moneyWeighted: number | null } {
  const perYear = result.days >= 365;
  const yearly = (cumulative: number | null) => (cumulative === null ? null : perYear ? annualise(cumulative, result.days) : cumulative);
  const moneyWeighted = result.xirr === null ? null : perYear ? result.xirr : (1 + result.xirr) ** (result.days / 365) - 1;
  return { perYear, twr: yearly(result.twr), benchmark: yearly(result.benchmark), moneyWeighted };
}

export interface MonthReturn {
  /** YYYY-MM. */
  month: string;
  twr: number;
  local: number;
  currency: number;
  cross: number;
  benchmark: number | null;
}

/** Month by month, the TWR and its split into local, currency and cross terms. */
export function monthlyReturns(days: readonly DayPoint[], scope: Scope): MonthReturn[] {
  const out: MonthReturn[] = [];
  for (const [month, list] of groupBy(days, (day) => day.date.slice(0, 7))) {
    const invested = list.filter((day) => day.ret[scope] !== null);
    const twr = chain(invested.map((day) => day.ret[scope]));
    const local = chain(invested.map((day) => day.local[scope]));
    if (twr === null || local === null) continue;
    const benchmarks = invested.map((day) => day.benchmark);
    out.push({ month, twr, ...fxSplit(twr, local), benchmark: benchmarks.includes(null) ? null : chain(benchmarks) });
  }
  return out;
}

export interface CumulativePoint {
  date: string;
  twr: number;
  /** Null until the benchmark has a price for every proxy. */
  benchmark: number | null;
}

/** The cumulative TWR and benchmark day by day, from 0 at the first close with a value on or after `from`. */
export function cumulativeReturns(days: readonly DayPoint[], scope: Scope, from = ''): CumulativePoint[] {
  const out: CumulativePoint[] = [];
  let twr = 1;
  let benchmark: number | null = null;
  for (const day of days) {
    if (day.date < from) continue;
    if (out.length === 0) {
      if (day.value[scope] <= 0) continue;
      out.push({ date: day.date, twr: 0, benchmark: null });
      continue;
    }
    const r = day.ret[scope];
    if (r !== null) {
      twr *= 1 + r;
      if (day.benchmark !== null) {
        // The benchmark line starts at 0 on the close before its first return.
        if (benchmark === null) {
          benchmark = 1;
          const previous = out[out.length - 1];
          if (previous) previous.benchmark = 0;
        }
        benchmark *= 1 + day.benchmark;
      }
    }
    out.push({ date: day.date, twr: twr - 1, benchmark: benchmark === null ? null : benchmark - 1 });
  }
  return out;
}

/** The first point, the last of each month and the very last: the cumulative line as a table. */
export function monthEnds(points: readonly CumulativePoint[]): CumulativePoint[] {
  return points.filter((point, index) => {
    const next = points[index + 1];
    return index === 0 || !next || next.date.slice(0, 7) !== point.date.slice(0, 7);
  });
}

// ---------------------------------------------------------------------------
// Money-weighted return
// ---------------------------------------------------------------------------

/** A dated TWD amount from the investor's side: negative is money put in, positive money taken out. */
export interface Flow {
  date: string;
  amount: number;
}

/**
 * The yearly rate r at which the flows' present value is zero, Σ amount / (1 + r)^(days / 365),
 * as a spreadsheet's XIRR computes it. Undefined without money both in and out, or without a root.
 */
export function xirr(flows: readonly Flow[]): number | undefined {
  const sorted = flows.filter((flow) => flow.amount !== 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.some((flow) => flow.amount < 0) || !sorted.some((flow) => flow.amount > 0)) return undefined;
  const first = sorted[0]?.date ?? '';
  const years = sorted.map((flow) => daysBetween(first, flow.date) / 365);
  const npv = (rate: number) => sorted.reduce((sum, flow, i) => sum + flow.amount / (1 + rate) ** (years[i] ?? 0), 0);
  const slope = (rate: number) => sorted.reduce((sum, flow, i) => sum - ((years[i] ?? 0) * flow.amount) / (1 + rate) ** ((years[i] ?? 0) + 1), 0);
  // Newton's method from 10%, a spreadsheet's default guess; bisection if it wanders off.
  let rate = 0.1;
  for (let step = 0; step < 100; step++) {
    const value = npv(rate);
    const derivative = slope(rate);
    if (!Number.isFinite(value) || !Number.isFinite(derivative) || derivative === 0) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < 1e-12) return next;
    rate = next;
  }
  let low = -0.999999;
  let high = 1e4;
  let lowValue = npv(low);
  if (!Number.isFinite(lowValue) || lowValue * npv(high) > 0) return undefined;
  for (let step = 0; step < 300 && high - low > 1e-12; step++) {
    const middle = (low + high) / 2;
    const middleValue = npv(middle);
    if (lowValue * middleValue <= 0) high = middle;
    else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return (low + high) / 2;
}

/**
 * A scope's XIRR from the close of `from` to the close of `to`: what it was worth at the start
 * as money put in, the money moved in between, and what it is worth at the end as money taken out.
 * A `from` before the first day counts every flow from the first buy on.
 */
export function periodXirr(days: readonly DayPoint[], scope: Scope, from: string, to: string): number | undefined {
  const flows: Flow[] = [];
  let last: DayPoint | undefined;
  for (const day of days) {
    if (day.date > to) break;
    if (day.date === from) flows.push({ date: day.date, amount: -day.value[scope] });
    else if (day.date > from) flows.push({ date: day.date, amount: day.flow[scope] });
    last = day;
  }
  if (!last || last.date <= from) return undefined;
  flows.push({ date: last.date, amount: last.value[scope] });
  return xirr(flows);
}

// ---------------------------------------------------------------------------
// Per holding: the PRD's FX split
// ---------------------------------------------------------------------------

export interface HoldingSplit {
  ticker: string;
  currency: string;
  /** From this close (`from`, or the first buy if later) to `to`. */
  from: string;
  to: string;
  twd: number;
  split: { local: number; currency: number; cross: number };
}

/** Each foreign security held at `to`: its TWD total return since `from` or its first buy, split. */
export function holdingSplits(input: Pick<PerformanceInput, 'trades' | 'prices' | 'rates'>, from: string, to: string): HoldingSplit[] {
  const market = new MarketHistory(input.prices, input.rates);
  const held = new Map<string, { qty: number; first: string; currency: string }>();
  for (const trade of chronological(input.trades)) {
    if (trade.tradeDate > to) break;
    const entry = held.get(trade.ticker) ?? { qty: 0, first: trade.tradeDate, currency: trade.currency };
    entry.qty += trade.side === 'buy' ? trade.qty : -trade.qty;
    // Sold out: a later buy starts a new holding period.
    if (entry.qty <= 1e-9) held.delete(trade.ticker);
    else held.set(trade.ticker, entry);
  }
  const out: HoldingSplit[] = [];
  for (const [ticker, entry] of held) {
    if (entry.currency === 'TWD') continue;
    const start = entry.first > from ? entry.first : from;
    const price = market.growth(ticker, start, to);
    const fx = market.fxGrowth(entry.currency, start, to);
    if (price === undefined || fx === undefined) continue;
    const twd = price * fx - 1;
    out.push({ ticker, currency: entry.currency, from: start, to, twd, split: fxSplit(twd, price - 1) });
  }
  return out.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ---------------------------------------------------------------------------
// NAV snapshots (nav_snapshots)
// ---------------------------------------------------------------------------

export interface Snapshot {
  date: string;
  /** Everything held, both pools, TWD. */
  totalTwd: number;
  /** Each asset class's share of the regular pool, the base the SAA targets are measured on. */
  weightsByClass: Record<string, number>;
}

export function snapshots(days: readonly DayPoint[]): Snapshot[] {
  return days.map((day) => {
    const regular = day.value.regular;
    const weightsByClass: Record<string, number> = {};
    for (const [id, amount] of Object.entries(day.classValue)) {
      if (amount > 0 && regular > 0) weightsByClass[id] = Math.round((amount / regular) * 1e6) / 1e6;
    }
    return { date: day.date, totalTwd: Math.round(day.value.all * 100) / 100, weightsByClass };
  });
}
