/**
 * Auto-scored capital market assumptions (F6, asked by Hugo on 2026-11-09): a satellite class
 * (US stocks, Taiwan stocks, tactical themes) that has no assumption of the owner's gets one from
 * the stocks and ETFs it holds, so F2, F5 and F7 count it instead of leaving it out. An assumption
 * the owner types always wins; the score only fills a blank.
 *
 * For each long line held in the class (both pools, weighted by exposure):
 * - β: F11's β (Blume-adjusted by config capm.beta, from N1's monthly refresh or worked out now)
 *   against the index that explains the holding best, the higher R² of N1's two, so a
 *   Taiwan-listed fund of US stocks reads the S&P 500 and not TAIEX.
 * - Expected return: CAPM on that index's market, E = R_f + β × P. R_f is the market's 10-year
 *   yield (F11). P is the market's premium: by default your own assumption for the class that stands
 *   for the market (config cma_auto.anchors: US → us_global_equity, TW → tw_market_cap) less R_f, so
 *   a holding with β 1 expects what you expect of its market and the frontier finds no free lunch;
 *   F11's ERP + CRP when that class has no assumption (or premium is 'erp').
 * - Volatility: the sample standard deviation of its monthly TWD returns over lookback_years, × √12.
 *
 * The class: E = Σ w E_i over the lines scored; its volatility from the weighted basket's monthly
 * TWD returns (each month re-weighted over the lines that have it), so diversification counts. F7
 * reads that basket as the class's history, so μ and Σ describe the same holdings. A line with
 * fewer than min_months monthly returns, or with no β, is left out and named.
 *
 * Pure functions; lib/data's refreshCmaEstimates saves the result in cma_estimates, written after a
 * trade in a satellite class, a change of assumptions and every night.
 */
import { erpQuote, riskFreeQuote, type CapmSettings, type MonthValue } from './capm';
import type { Assumption, Assumptions } from './cma';
import type { Point } from './regression';

// ---------------------------------------------------------------------------
// Settings (config cma_auto)
// ---------------------------------------------------------------------------

/** Where a market's premium comes from: your assumption for its anchor class, or F11's ERP + CRP. */
export type PremiumSource = 'cma' | 'erp';

export interface AutoCmaSettings {
  enabled: boolean;
  premium: PremiumSource;
  /** By market (US, TW): the asset class whose assumption stands for that market. */
  anchors: Record<string, string>;
  /** The years of monthly returns the volatility reads. */
  lookbackYears: number;
  /** Fewest monthly returns a line needs to be scored. */
  minMonths: number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** config cma_auto, read defensively; undefined when a part is missing or out of range. */
export function readAutoCmaSettings(value: unknown): AutoCmaSettings | undefined {
  const row = record(value);
  const { enabled, premium, lookback_years: years, min_months: minMonths } = row;
  if (typeof enabled !== 'boolean') return undefined;
  if (premium !== 'cma' && premium !== 'erp') return undefined;
  if (typeof years !== 'number' || !Number.isInteger(years) || years < 1 || years > 20) return undefined;
  if (typeof minMonths !== 'number' || !Number.isInteger(minMonths) || minMonths < 12 || minMonths > years * 12) return undefined;
  const anchors: Record<string, string> = {};
  for (const [market, id] of Object.entries(record(row['anchors']))) {
    if (typeof id !== 'string' || id === '') return undefined;
    anchors[market] = id;
  }
  return { enabled, premium, anchors, lookbackYears: years, minMonths };
}

/** The shape config cma_auto stores. */
export function autoCmaValue(settings: AutoCmaSettings): Record<string, unknown> {
  return { enabled: settings.enabled, premium: settings.premium, anchors: settings.anchors, lookback_years: settings.lookbackYears, min_months: settings.minMonths };
}

// ---------------------------------------------------------------------------
// Each market's CAPM line
// ---------------------------------------------------------------------------

/** A market's CAPM line: E = riskFree + β × premium. */
export interface MarketLine {
  market: string;
  /** The index N1's β is measured against (SPX, TAIEX). */
  benchmark: string;
  riskFree: number;
  premium: number;
  source: PremiumSource;
  /** The class whose assumption set the premium (source cma), else null. */
  anchor: string | null;
}

/**
 * Each F11 market's line. With premium 'cma' and an assumption of yours for the market's anchor
 * class, P = that expected return − R_f; otherwise F11's ERP + the market's CRP.
 */
export function marketLines(
  settings: Pick<AutoCmaSettings, 'premium' | 'anchors'>,
  capm: Pick<CapmSettings, 'markets' | 'erp'>,
  series: ReadonlyMap<string, readonly MonthValue[]>,
  manual: Assumptions,
): MarketLine[] {
  const erp = erpQuote(capm, series).value;
  return Object.entries(capm.markets).map(([market, inputs]) => {
    const riskFree = riskFreeQuote(inputs, series).value;
    const anchor = settings.anchors[market];
    const own = anchor ? manual[anchor] : undefined;
    if (settings.premium === 'cma' && anchor && own) {
      return { market, benchmark: inputs.benchmark, riskFree, premium: own.expectedReturn - riskFree, source: 'cma', anchor };
    }
    return { market, benchmark: inputs.benchmark, riskFree, premium: erp + inputs.countryPremium, source: 'erp', anchor: null };
  });
}

/** E = R_f + β × P. */
export function capmReturn(line: Pick<MarketLine, 'riskFree' | 'premium'>, beta: number): number {
  return line.riskFree + beta * line.premium;
}

// ---------------------------------------------------------------------------
// From the lines held to the class's estimate
// ---------------------------------------------------------------------------

/** One holding's fit against one index (N1): the β used (by config capm.beta) and its R². */
export interface IndexFit {
  benchmark: string;
  beta: number;
  r2: number | null;
}

/**
 * The fit to read: the highest R² among the indices that have a market line; on a tie, or with no
 * R², the index of the market the holding is listed in.
 */
export function bestFit(fits: readonly IndexFit[], lines: readonly MarketLine[], listedIn: string): { fit: IndexFit; line: MarketLine } | undefined {
  let best: { fit: IndexFit; line: MarketLine } | undefined;
  for (const fit of fits) {
    const line = lines.find((candidate) => candidate.benchmark === fit.benchmark);
    if (!line || !Number.isFinite(fit.beta)) continue;
    if (!best) {
      best = { fit, line };
      continue;
    }
    const r2 = fit.r2 ?? -1;
    const bestR2 = best.fit.r2 ?? -1;
    if (r2 > bestR2 + 1e-12 || (Math.abs(r2 - bestR2) <= 1e-12 && line.market === listedIn && best.line.market !== listedIn)) best = { fit, line };
  }
  return best;
}

export interface LineInput {
  ticker: string;
  /** The market it is listed in (US, TW, UK). */
  market: string;
  /** What it moves with the market, TWD (the market value of a plain long). */
  exposure: number;
  fits: readonly IndexFit[];
  /** Monthly TWD returns, oldest first; `date` is the month's end. */
  returns: readonly Point[];
}

export type LeftReason = 'history' | 'beta';

export interface LineEstimate {
  ticker: string;
  /** Its share of the lines scored. */
  weight: number;
  benchmark: string;
  market: string;
  beta: number;
  r2: number | null;
  expectedReturn: number;
  volatility: number;
  months: number;
}

export interface ClassEstimate {
  classId: string;
  expectedReturn: number;
  volatility: number;
  /** The basket's months, the first and the last (YYYY-MM). */
  months: number;
  from: string;
  to: string;
  lines: LineEstimate[];
  left: Array<{ ticker: string; reason: LeftReason }>;
}

export type EstimateOutcome = { ok: true; estimate: ClassEstimate } | { ok: false; classId: string; left: ClassEstimate['left'] };

/** The sample standard deviation of yearly-scaled monthly returns: SD × √12. */
export function yearlyVolatility(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance * 12);
}

const monthOf = (point: Point) => point.date.slice(0, 7);

/** The month `count − 1` months before `month` (YYYY-MM). */
function monthsBefore(month: string, count: number): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (mon - 1) - (count - 1);
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The weighted basket's monthly returns: each month, Σ w r over the lines that have it ÷ Σ w of those
 * lines, so a line with a shorter history leaves the others to stand for the class before it starts.
 */
export function basketReturns(lines: ReadonlyArray<{ ticker: string; weight: number }>, returns: ReadonlyMap<string, readonly Point[]>): Point[] {
  const sums = new Map<string, { date: string; value: number; weight: number }>();
  for (const line of lines) {
    if (!(line.weight > 0)) continue;
    for (const point of returns.get(line.ticker) ?? []) {
      const month = monthOf(point);
      const sum = sums.get(month) ?? { date: point.date, value: 0, weight: 0 };
      sum.value += line.weight * point.value;
      sum.weight += line.weight;
      if (point.date > sum.date) sum.date = point.date;
      sums.set(month, sum);
    }
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, sum]) => ({ date: sum.date, value: sum.value / sum.weight }));
}

/**
 * A class's estimate from the lines it holds: each scored by CAPM on its best-fitting market, the
 * class's expected return their exposure-weighted mean, its volatility the basket's.
 */
export function estimateClass(classId: string, inputs: readonly LineInput[], lines: readonly MarketLine[], settings: Pick<AutoCmaSettings, 'lookbackYears' | 'minMonths'>): EstimateOutcome {
  const left: ClassEstimate['left'] = [];
  const newest = inputs.flatMap((input) => input.returns.map(monthOf)).reduce<string | null>((best, month) => (best === null || month > best ? month : best), null);
  const start = newest ? monthsBefore(newest, settings.lookbackYears * 12) : null;
  const scored: Array<Omit<LineEstimate, 'weight'> & { exposure: number; window: Point[] }> = [];
  for (const input of [...inputs].sort((a, b) => b.exposure - a.exposure || a.ticker.localeCompare(b.ticker))) {
    if (!(input.exposure > 0)) continue;
    const window = start ? input.returns.filter((point) => monthOf(point) >= start && Number.isFinite(point.value)) : [];
    if (window.length < settings.minMonths) {
      left.push({ ticker: input.ticker, reason: 'history' });
      continue;
    }
    const found = bestFit(input.fits, lines, input.market);
    if (!found) {
      left.push({ ticker: input.ticker, reason: 'beta' });
      continue;
    }
    scored.push({
      ticker: input.ticker,
      exposure: input.exposure,
      benchmark: found.line.benchmark,
      market: found.line.market,
      beta: found.fit.beta,
      r2: found.fit.r2,
      expectedReturn: capmReturn(found.line, found.fit.beta),
      volatility: yearlyVolatility(window.map((point) => point.value)),
      months: window.length,
      window,
    });
  }
  const total = scored.reduce((sum, line) => sum + line.exposure, 0);
  if (scored.length === 0 || !(total > 0)) return { ok: false, classId, left };
  const weighted = scored.map(({ exposure, window: _window, ...line }) => ({ ...line, weight: exposure / total }));
  const basket = basketReturns(weighted, new Map(scored.map((line) => [line.ticker, line.window])));
  return {
    ok: true,
    estimate: {
      classId,
      expectedReturn: weighted.reduce((sum, line) => sum + line.weight * line.expectedReturn, 0),
      volatility: yearlyVolatility(basket.map((point) => point.value)),
      months: basket.length,
      from: basket[0] ? monthOf(basket[0]) : '',
      to: basket[basket.length - 1] ? monthOf(basket[basket.length - 1] as Point) : '',
      lines: weighted,
      left,
    },
  };
}

// ---------------------------------------------------------------------------
// The saved estimate (cma_estimates) and the assumptions the models read
// ---------------------------------------------------------------------------

/** An estimate as cma_estimates keeps it, with the markets' lines it was scored on. */
export interface SavedEstimate extends ClassEstimate {
  asOf: string;
  markets: MarketLine[];
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The row cma_estimates stores for an estimate. */
export function estimateRow(estimate: ClassEstimate, markets: readonly MarketLine[], asOf: string): Record<string, unknown> {
  const used = new Set(estimate.lines.map((line) => line.market));
  return {
    class_id: estimate.classId,
    as_of: asOf,
    expected_return: estimate.expectedReturn,
    volatility: estimate.volatility,
    months: estimate.months,
    detail: {
      from: estimate.from,
      to: estimate.to,
      lines: estimate.lines.map((line) => ({
        ticker: line.ticker,
        weight: line.weight,
        benchmark: line.benchmark,
        market: line.market,
        beta: line.beta,
        r2: line.r2,
        expected_return: line.expectedReturn,
        volatility: line.volatility,
        months: line.months,
      })),
      left: estimate.left,
      markets: markets
        .filter((line) => used.has(line.market))
        .map((line) => ({ market: line.market, benchmark: line.benchmark, risk_free: line.riskFree, premium: line.premium, source: line.source, anchor: line.anchor })),
    },
  };
}

/** A class held whose lines none can be scored yet, and why each was left out. */
export interface Unscored {
  classId: string;
  asOf: string;
  left: ClassEstimate['left'];
}

/** The row cma_estimates keeps for a class held with nothing that can be scored yet: no figures, the lines left out. */
export function unscoredRow(classId: string, left: ClassEstimate['left'], asOf: string): Record<string, unknown> {
  return { class_id: classId, as_of: asOf, expected_return: null, volatility: null, months: 0, detail: { left } };
}

type EstimateRowData = { class_id: string; as_of: string; expected_return: unknown; volatility: unknown; months: unknown; detail: unknown };

function readLeft(detail: Record<string, unknown>): ClassEstimate['left'] {
  return (Array.isArray(detail['left']) ? detail['left'] : []).flatMap((entry) => {
    const { ticker, reason } = record(entry);
    return typeof ticker === 'string' && (reason === 'history' || reason === 'beta') ? [{ ticker, reason: reason as LeftReason }] : [];
  });
}

/** A row with no figures read back: the class is held, nothing in it scored yet. Undefined for a scored row. */
export function readUnscoredRow(row: EstimateRowData): Unscored | undefined {
  if (row.expected_return !== null && row.expected_return !== undefined) return undefined;
  return { classId: row.class_id, asOf: row.as_of, left: readLeft(record(row.detail)) };
}

/** A cma_estimates row read back; undefined when it has no figures or they are not usable. */
export function readEstimateRow(row: EstimateRowData): SavedEstimate | undefined {
  if (row.expected_return === null || row.expected_return === undefined || row.volatility === null || row.volatility === undefined) return undefined;
  const expectedReturn = Number(row.expected_return);
  const volatility = Number(row.volatility);
  const months = Number(row.months);
  if (!isNumber(expectedReturn) || !isNumber(volatility) || volatility < 0 || !Number.isInteger(months)) return undefined;
  const detail = record(row.detail);
  const lines: LineEstimate[] = (Array.isArray(detail['lines']) ? detail['lines'] : []).flatMap((entry) => {
    const line = record(entry);
    const { ticker, weight, benchmark, market, beta, r2, expected_return: lineReturn, volatility: lineVolatility, months: lineMonths } = line;
    if (typeof ticker !== 'string' || !isNumber(weight) || typeof benchmark !== 'string' || typeof market !== 'string' || !isNumber(beta) || !isNumber(lineReturn) || !isNumber(lineVolatility)) return [];
    return [{ ticker, weight, benchmark, market, beta, r2: isNumber(r2) ? r2 : null, expectedReturn: lineReturn, volatility: lineVolatility, months: isNumber(lineMonths) ? lineMonths : 0 }];
  });
  const left = readLeft(detail);
  const markets: MarketLine[] = (Array.isArray(detail['markets']) ? detail['markets'] : []).flatMap((entry) => {
    const { market, benchmark, risk_free: riskFree, premium, source, anchor } = record(entry);
    if (typeof market !== 'string' || typeof benchmark !== 'string' || !isNumber(riskFree) || !isNumber(premium) || (source !== 'cma' && source !== 'erp')) return [];
    return [{ market, benchmark, riskFree, premium, source, anchor: typeof anchor === 'string' ? anchor : null }];
  });
  return {
    classId: row.class_id,
    asOf: row.as_of,
    expectedReturn,
    volatility,
    months,
    from: typeof detail['from'] === 'string' ? detail['from'] : '',
    to: typeof detail['to'] === 'string' ? detail['to'] : '',
    lines,
    left,
    markets,
  };
}

/** The source an auto-scored assumption carries. */
export function autoSource(asOf: string): string {
  return `Auto-scored from holdings 依持股自動評分 ${asOf}`;
}

/**
 * The assumptions the models read: yours, and for each satellite class you left blank the saved
 * estimate, marked auto. A core class is never scored: its assumption is yours alone.
 */
export function mergeAssumptions(manual: Assumptions, estimates: readonly SavedEstimate[], satellite: ReadonlySet<string>): Assumptions {
  const merged: Assumptions = { ...manual };
  for (const estimate of estimates) {
    if (manual[estimate.classId] || !satellite.has(estimate.classId)) continue;
    const auto: Assumption = { expectedReturn: estimate.expectedReturn, volatility: estimate.volatility, source: autoSource(estimate.asOf), auto: { asOf: estimate.asOf } };
    merged[estimate.classId] = auto;
  }
  return merged;
}
