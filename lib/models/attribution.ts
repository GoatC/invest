/**
 * N2 Brinson attribution (PRD Module D, Phase 3 step 5): why the portfolio's return differed from
 * the SAA benchmark's, as allocation, selection, interaction and currency effects.
 *
 * Brinson–Fachler, per segment i, for one month:
 *   Allocation  A_i = (w_p,i − w_b,i) (R_b,i − R_b)
 *   Selection   S_i = w_b,i (R_p,i − R_b,i)
 *   Interaction I_i = (w_p,i − w_b,i) (R_p,i − R_b,i)
 * with w the weights at the start of the month, R_p,i and R_b,i the segment's returns in the
 * portfolio and in the benchmark and R_b the benchmark's total. The three sum, over segments, to
 * R_p − R_b (the PRD's acceptance case: 0.80% + 0.80% + 0.30% = 1.90%).
 *
 * Currency: the effects above are worked out on returns in each holding's own currency, and the
 * currency effect is what is left to the return in TWD, per segment:
 *   C_i = w_p,i (R_p,i^TWD − R_p,i^local) − w_b,i (R_b,i^TWD − R_b,i^local)
 * so that A + S + I + C summed over segments is R_p − R_b in TWD.
 *
 * A segment the portfolio does not hold has w_p = 0 and takes the benchmark's return as its own,
 * so only its underweight shows (as allocation), never a selection effect on nothing.
 *
 * Several months are linked with Carino's smoothing so the months' effects add up to the period's
 * total: each month's effects are scaled by k_t ÷ K with
 *   k_t = (ln(1 + R_p,t) − ln(1 + R_b,t)) ÷ (R_p,t − R_b,t),   K = the same for the whole period.
 *
 * Pure functions; the Attribution page and the nightly job's monthly run use them.
 */
import type { MarketHistory } from './market';
import type { DayPoint } from './performance';

/** One segment in one month. Weights are fractions of the portfolio (or of the benchmark) at the start. */
export interface Segment {
  id: string;
  /** Portfolio weight, 0 if not held. */
  wp: number;
  /** Benchmark weight. */
  wb: number;
  /** The portfolio's return in the segment, TWD and in the holdings' own currencies; null when not held. */
  rpTwd: number | null;
  rpLocal: number | null;
  /** The benchmark's return in the segment. */
  rbTwd: number;
  rbLocal: number;
}

export interface Effects {
  allocation: number;
  selection: number;
  interaction: number;
  currency: number;
}

export interface SegmentEffects extends Effects {
  id: string;
  /** w_p − w_b, the active weight. */
  active: number;
  /** R_b,i − R_b in TWD, the segment against the benchmark's total: the quadrant chart's y axis. */
  relative: number;
}

export interface Month {
  /** The portfolio's and the benchmark's return in TWD, Σ w R. */
  rp: number;
  rb: number;
  /** The same in own currencies. */
  rpLocal: number;
  rbLocal: number;
  segments: SegmentEffects[];
  total: Effects;
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** One month's Brinson–Fachler effects; the weights of each side must each add to 1 (they are not rescaled). */
export function brinson(segments: readonly Segment[]): Month {
  const rp = sum(segments.map((s) => s.wp * (s.rpTwd ?? s.rbTwd)));
  const rb = sum(segments.map((s) => s.wb * s.rbTwd));
  const rpLocal = sum(segments.map((s) => s.wp * (s.rpLocal ?? s.rbLocal)));
  const rbLocal = sum(segments.map((s) => s.wb * s.rbLocal));
  const rows: SegmentEffects[] = segments.map((s) => {
    const own = s.rpLocal ?? s.rbLocal;
    const ownTwd = s.rpTwd ?? s.rbTwd;
    const active = s.wp - s.wb;
    return {
      id: s.id,
      active,
      relative: s.rbTwd - rb,
      // Worked out on own-currency returns, against the benchmark's own-currency total.
      allocation: active * (s.rbLocal - rbLocal),
      selection: s.wb * (own - s.rbLocal),
      interaction: active * (own - s.rbLocal),
      currency: s.wp * (ownTwd - own) - s.wb * (s.rbTwd - s.rbLocal),
    };
  });
  const total: Effects = {
    allocation: sum(rows.map((row) => row.allocation)),
    selection: sum(rows.map((row) => row.selection)),
    interaction: sum(rows.map((row) => row.interaction)),
    currency: sum(rows.map((row) => row.currency)),
  };
  return { rp, rb, rpLocal, rbLocal, segments: rows, total };
}

// ---------------------------------------------------------------------------
// Linking months
// ---------------------------------------------------------------------------

/** Carino's coefficient for a return pair: (ln(1 + p) − ln(1 + b)) ÷ (p − b), its limit 1 ÷ (1 + p) when they are equal. */
export function carino(rp: number, rb: number): number {
  return Math.abs(rp - rb) < 1e-12 ? 1 / (1 + rp) : (Math.log(1 + rp) - Math.log(1 + rb)) / (rp - rb);
}

export interface Linked {
  /** The period's compounded returns, TWD. */
  rp: number;
  rb: number;
  segments: Array<Effects & { id: string }>;
  total: Effects;
}

/** The months' effects linked by Carino's smoothing; they add up to rp − rb of the period. */
export function link(months: readonly Month[]): Linked | null {
  if (months.length === 0) return null;
  const rp = months.reduce((acc, month) => acc * (1 + month.rp), 1) - 1;
  const rb = months.reduce((acc, month) => acc * (1 + month.rb), 1) - 1;
  const whole = carino(rp, rb);
  const ids = [...new Set(months.flatMap((month) => month.segments.map((segment) => segment.id)))];
  const segments = ids.map((id) => {
    const out: Effects = { allocation: 0, selection: 0, interaction: 0, currency: 0 };
    for (const month of months) {
      const scale = carino(month.rp, month.rb) / whole;
      const row = month.segments.find((segment) => segment.id === id);
      if (!row) continue;
      out.allocation += row.allocation * scale;
      out.selection += row.selection * scale;
      out.interaction += row.interaction * scale;
      out.currency += row.currency * scale;
    }
    return { id, ...out };
  });
  return {
    rp,
    rb,
    segments,
    total: {
      allocation: sum(segments.map((row) => row.allocation)),
      selection: sum(segments.map((row) => row.selection)),
      interaction: sum(segments.map((row) => row.interaction)),
      currency: sum(segments.map((row) => row.currency)),
    },
  };
}

/** A cumulative effect after each month, for the lines over time: the effects linked from the first month to this one. */
export function cumulative(months: ReadonlyArray<{ month: string } & Month>): Array<{ month: string } & Effects> {
  return months.map((_, index) => {
    const linked = link(months.slice(0, index + 1));
    return { month: (months[index] as { month: string }).month, ...(linked?.total ?? { allocation: 0, selection: 0, interaction: 0, currency: 0 }) };
  });
}

/** The waterfall from the benchmark's return to the portfolio's: each step and the running level. */
export function waterfall(linked: Pick<Linked, 'rb' | 'total'>): Array<{ step: 'benchmark' | 'allocation' | 'selection' | 'interaction' | 'currency' | 'portfolio'; value: number; level: number }> {
  const steps = (['allocation', 'selection', 'interaction', 'currency'] as const).map((step) => ({ step, value: linked.total[step] }));
  let level = linked.rb;
  const out: ReturnType<typeof waterfall> = [{ step: 'benchmark', value: linked.rb, level }];
  for (const { step, value } of steps) {
    level += value;
    out.push({ step, value, level });
  }
  out.push({ step: 'portfolio', value: level, level });
  return out;
}

// ---------------------------------------------------------------------------
// From the daily series to a month's segments
// ---------------------------------------------------------------------------

/** An asset class and the benchmark ETF its returns are measured against (F6, F18, N4). */
export interface ClassSpec {
  id: string;
  /** Its share of the SAA: the benchmark's weight. */
  targetWeight: number;
  benchmarkTicker: string | null;
  /** The benchmark ETF's currency. */
  benchmarkCurrency: string;
}

export interface MonthInput {
  /** YYYY-MM. */
  month: string;
  /** The last close before the month, and the month's last day in the series. */
  from: string;
  to: string;
  /** False for the month still running. */
  complete: boolean;
  segments: Segment[];
  /** The regular pool's own return in TWD that month (F18's chain), to set beside the attribution's. */
  twr: number | null;
  /** Classes left out for want of a benchmark price, or with nothing in it either side. */
  left: string[];
}

function lastDayOfMonth(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

/**
 * Each month's segments for the regular pool: weights at the start of the month (the previous
 * day's value by class), the portfolio's return in each class chained from the daily series, and
 * the benchmark's from the class's benchmark ETF. A month needs a day before it, so the first
 * month of the series is left out; a class with no benchmark price is left out and the rest
 * re-weighted to 100% on both sides.
 */
export function monthInputs(days: readonly DayPoint[], market: MarketHistory, classes: readonly ClassSpec[]): MonthInput[] {
  const out: MonthInput[] = [];
  const byMonth = new Map<string, DayPoint[]>();
  for (const day of days) {
    const list = byMonth.get(day.date.slice(0, 7)) ?? [];
    list.push(day);
    byMonth.set(day.date.slice(0, 7), list);
  }
  const months = [...byMonth.keys()].sort();
  let previous: DayPoint | undefined;
  for (const month of months) {
    const list = byMonth.get(month) as DayPoint[];
    const last = list[list.length - 1] as DayPoint;
    const before = previous;
    previous = last;
    if (!before) continue;
    const startTotal = Object.values(before.classValue).reduce((a, b) => a + b, 0);
    if (!(startTotal > 0)) continue;

    const rows: Array<{ spec: ClassSpec; wp: number; rpTwd: number | null; rpLocal: number | null; rbTwd: number; rbLocal: number }> = [];
    const left: string[] = [];
    for (const spec of classes) {
      const wp = (before.classValue[spec.id] ?? 0) / startTotal;
      if (spec.targetWeight <= 0 && wp <= 0) continue;
      const ticker = spec.benchmarkTicker;
      const growth = ticker ? market.growth(ticker, before.date, last.date) : undefined;
      const fx = ticker ? market.fxGrowth(spec.benchmarkCurrency, before.date, last.date) : undefined;
      if (growth === undefined || fx === undefined) {
        left.push(spec.id);
        continue;
      }
      let twd: number | null = null;
      let local: number | null = null;
      for (const day of list) {
        const row = day.classDay[spec.id];
        if (!row || !(row.base > 0)) continue;
        twd = (twd === null ? 1 : twd) * (1 + row.twd / row.base);
        local = (local === null ? 1 : local) * (1 + row.local / row.base);
      }
      rows.push({ spec, wp, rpTwd: twd === null ? null : twd - 1, rpLocal: local === null ? null : local - 1, rbTwd: growth * fx - 1, rbLocal: growth - 1 });
    }
    const wpTotal = rows.reduce((sum, row) => sum + row.wp, 0);
    const wbTotal = rows.reduce((sum, row) => sum + row.spec.targetWeight, 0);
    if (rows.length === 0 || !(wpTotal > 0) || !(wbTotal > 0)) continue;
    let twr: number | null = null;
    for (const day of list) if (day.ret.regular !== null) twr = (twr === null ? 1 : twr) * (1 + day.ret.regular);
    out.push({
      month,
      from: before.date,
      to: last.date,
      complete: last.date === lastDayOfMonth(month),
      segments: rows.map((row) => ({ id: row.spec.id, wp: row.wp / wpTotal, wb: row.spec.targetWeight / wbTotal, rpTwd: row.rpTwd, rpLocal: row.rpLocal, rbTwd: row.rbTwd, rbLocal: row.rbLocal })),
      twr: twr === null ? null : twr - 1,
      left,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Level 2: the satellite's stocks by sector against the core equity fund's sectors
// ---------------------------------------------------------------------------

export interface SectorBenchmark {
  /** GICS sector. */
  sector: string;
  /** The core global-equity ETF's weight in it (renormalised over the sectors with a proxy). */
  weight: number;
  /** The fund that prices the sector (a Select Sector SPDR) and its currency. */
  proxy: string;
  currency: string;
}

export interface SatelliteStock {
  ticker: string;
  currency: string;
  /** GICS sector, from the company's profile; null when unknown. */
  sector: string | null;
}

/**
 * Each month's satellite segments by sector (level 2): the stocks' weights at the start of the
 * month by sector, their buy-and-hold return through it, against the core equity ETF's sector
 * weights and each sector's proxy fund. A sector without a proxy price is left out and the rest
 * re-weighted; stocks with no sector fall in "Unclassified" at the benchmark's own return of 0
 * weight, so only the underweight of the sectors shows. Months with no satellite stock are skipped.
 */
export function sectorInputs(
  months: ReadonlyArray<Pick<MonthInput, 'month' | 'from' | 'to' | 'complete'>>,
  days: readonly DayPoint[],
  market: MarketHistory,
  stocks: readonly SatelliteStock[],
  benchmark: readonly SectorBenchmark[],
): MonthInput[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const info = new Map(stocks.map((stock) => [stock.ticker, stock]));
  const out: MonthInput[] = [];
  for (const month of months) {
    const start = byDate.get(month.from);
    if (!start) continue;
    // The satellite stocks at the start: value, return in TWD and in own currency.
    const held = new Map<string, { value: number; twd: number; local: number }[]>();
    let total = 0;
    for (const [key, value] of Object.entries(start.held)) {
      if (!key.startsWith('regular:') || !(value > 0)) continue;
      const stock = info.get(key.slice('regular:'.length));
      if (!stock) continue;
      const local = market.growth(stock.ticker, month.from, month.to);
      const twd = market.twdGrowth(stock.ticker, stock.currency, month.from, month.to);
      if (local === undefined || twd === undefined) continue;
      const sector = stock.sector ?? 'Unclassified';
      held.set(sector, [...(held.get(sector) ?? []), { value, twd: twd - 1, local: local - 1 }]);
      total += value;
    }
    if (!(total > 0)) continue;

    const rows: Array<{ id: string; wp: number; wb: number; rpTwd: number | null; rpLocal: number | null; rbTwd: number; rbLocal: number }> = [];
    const left: string[] = [];
    for (const entry of benchmark) {
      const growth = market.growth(entry.proxy, month.from, month.to);
      const fx = market.fxGrowth(entry.currency, month.from, month.to);
      if (growth === undefined || fx === undefined) {
        left.push(entry.sector);
        continue;
      }
      const list = held.get(entry.sector) ?? [];
      const value = list.reduce((sum, one) => sum + one.value, 0);
      rows.push({
        id: entry.sector,
        wp: value / total,
        wb: entry.weight,
        rpTwd: value > 0 ? list.reduce((sum, one) => sum + one.value * one.twd, 0) / value : null,
        rpLocal: value > 0 ? list.reduce((sum, one) => sum + one.value * one.local, 0) / value : null,
        rbTwd: growth * fx - 1,
        rbLocal: growth - 1,
      });
    }
    // Stocks in a sector the benchmark does not price count against the rest: re-weight what is covered.
    const wpTotal = rows.reduce((sum, row) => sum + row.wp, 0);
    const wbTotal = rows.reduce((sum, row) => sum + row.wb, 0);
    if (rows.length === 0 || !(wpTotal > 0) || !(wbTotal > 0)) continue;
    out.push({
      month: month.month,
      from: month.from,
      to: month.to,
      complete: month.complete,
      segments: rows.map((row) => ({ ...row, wp: row.wp / wpTotal, wb: row.wb / wbTotal })),
      twr: null,
      left,
    });
  }
  return out;
}
