/**
 * The valuation workbench's plumbing (F12, Phase 2 step 4): from a stock's saved quarters and
 * closes to the input its valuation needs, from a valuation to the rows the valuations table keeps,
 * and from those rows to what the rules engine reads. Pure; lib/data.ts loads and saves.
 */
import type { WatchInput } from './engine';
import { latestQuarter, yearBefore, type Quarter } from './fundamentals';
import { MODEL_COLUMN, MODELS, multiplesAt, type Assumed, type ModelId, type MultipleSet, type Valuation, type ValuationInput, type ValuationSettings } from './intrinsic';

export interface Close {
  date: string;
  close: number;
}

/** A stock's filings and closes as stored: quarters oldest first, quoted closes oldest first. */
export interface StockSeries {
  ticker: string;
  market: string;
  /** The currency it trades in, and the one its filings report in (null without filings). */
  currency: string;
  reportCurrency: string | null;
  quarters: readonly Quarter[];
  closes: readonly Close[];
}

/** Days a close may sit before the date it stands for (a holiday, a late feed). */
const CLOSE_GAP = 10;

/** The close on a date, else the newest within CLOSE_GAP days before it. */
export function closeOn(closes: readonly Close[], date: string): number | undefined {
  const limit = new Date(Date.parse(`${date}T00:00:00Z`) - CLOSE_GAP * 86_400_000).toISOString().slice(0, 10);
  let found: Close | undefined;
  for (const close of closes) {
    if (close.date > date) break;
    if (close.date >= limit) found = close;
  }
  return found?.close;
}

/** The company's multiples at each quarter end over the `years` before its newest quarter (its own range). */
export function historyMultiples(series: StockSeries, years: number): MultipleSet[] {
  const latest = latestQuarter(series.quarters);
  if (!latest) return [];
  const from = `${Number(latest.periodEnd.slice(0, 4)) - years}${latest.periodEnd.slice(4)}`;
  return series.quarters.flatMap((quarter) => {
    if (quarter.periodEnd <= from) return [];
    const price = closeOn(series.closes, quarter.periodEnd);
    return price === undefined ? [] : [multiplesAt(price, quarter.figures)];
  });
}

/** A stock's multiples today: its newest close over its newest quarter. */
export function currentMultiples(series: StockSeries): MultipleSet | undefined {
  const latest = latestQuarter(series.quarters);
  const price = series.closes[series.closes.length - 1]?.close;
  if (!latest || price === undefined || series.reportCurrency !== series.currency) return undefined;
  return multiplesAt(price, latest.figures);
}

export type InputProblem = 'price' | 'filings' | 'currency';

/** What valueStock needs for a stock, or why it cannot be valued yet. */
export function valuationInput(
  stock: StockSeries,
  peers: readonly StockSeries[],
  cost: { costOfEquity: number; riskFree: number } | undefined,
  assumptions: Assumed,
  settings: ValuationSettings,
): { ok: true; input: ValuationInput; quarter: Quarter; price: Close } | { ok: false; problem: InputProblem } {
  const price = stock.closes[stock.closes.length - 1];
  if (!price) return { ok: false, problem: 'price' };
  const quarter = latestQuarter(stock.quarters);
  const typed = assumptions.overrides;
  // Typed FCFF, net debt and shares are enough for a DCF of a company whose filings are not loaded.
  if (!quarter && (typed.fcff === undefined || typed.shares === undefined)) return { ok: false, problem: 'filings' };
  if (quarter && stock.reportCurrency !== stock.currency) return { ok: false, problem: 'currency' };
  const ago = quarter ? yearBefore(stock.quarters, quarter) : undefined;
  return {
    ok: true,
    quarter: quarter ?? { periodEnd: price.date, figures: {}, filed: null },
    price,
    input: {
      price: price.close,
      market: stock.market,
      figures: quarter?.figures ?? {},
      ...(ago ? { yearAgo: ago.figures } : {}),
      history: historyMultiples(stock, settings.historyYears),
      peers: peers.flatMap((peer) => {
        const set = currentMultiples(peer);
        return set && Object.keys(set).length > 0 ? [set] : [];
      }),
      ...(cost ? { costOfEquity: cost.costOfEquity, riskFree: cost.riskFree } : {}),
      assumptions,
      settings,
    },
  };
}

export type Trigger = 'edit' | 'filing';

/** One saved row of the valuations table, as the app reads it. */
export interface SavedValuation {
  ticker: string;
  date: string;
  model: ModelId;
  bear: number;
  base: number;
  bull: number;
  trigger: Trigger;
  periodEnd: string | null;
  currency: string | null;
}

/** The valuations rows a valuation saves: one per model that gave values. */
export function valuationRows(
  ticker: string,
  date: string,
  valuation: Valuation,
  meta: { trigger: Trigger; periodEnd: string; filed: string | null; price: number; currency: string; costOfEquity?: number; assumptions: Assumed },
): Array<Record<string, unknown>> {
  return MODELS.flatMap((model) => {
    const outcome = valuation[model];
    if (!outcome.ok) return [];
    const { values } = outcome.result;
    const inputs: Record<string, unknown> = {
      trigger: meta.trigger,
      period_end: meta.periodEnd,
      filed: meta.filed,
      price: meta.price,
      currency: meta.currency,
      ...(meta.costOfEquity !== undefined ? { cost_of_equity: meta.costOfEquity } : {}),
      assumptions: { model: meta.assumptions.model, years: meta.assumptions.years, growth: meta.assumptions.growth, terminal: meta.assumptions.terminal, overrides: meta.assumptions.overrides, peers: meta.assumptions.peers },
    };
    if (model === 'dcf' && valuation.dcf.ok) Object.assign(inputs, { wacc: valuation.dcf.result.wacc, fcff: valuation.dcf.result.fcff.value });
    if (model === 'ddm' && valuation.ddm.ok) Object.assign(inputs, { dividend: valuation.ddm.result.dividend.value });
    return [{ ticker, valuation_date: date, model: MODEL_COLUMN[model], iv_bear: values.bear, iv_base: values.base, iv_bull: values.bull, inputs }];
  });
}

const COLUMN_MODEL = Object.fromEntries(Object.entries(MODEL_COLUMN).map(([model, column]) => [column, model])) as Record<string, ModelId>;

/** A valuations row read back; undefined when it is not one this app wrote. */
export function readSaved(row: { ticker: string; valuation_date: string; model: string; iv_bear: number | string | null; iv_base: number | string | null; iv_bull: number | string | null; inputs: unknown }): SavedValuation | undefined {
  const model = COLUMN_MODEL[row.model];
  const [bear, base, bull] = [row.iv_bear, row.iv_base, row.iv_bull].map((value) => (value === null ? NaN : Number(value)));
  if (!model || !Number.isFinite(bear) || !Number.isFinite(base) || !Number.isFinite(bull)) return undefined;
  const inputs = typeof row.inputs === 'object' && row.inputs !== null ? (row.inputs as Record<string, unknown>) : {};
  return {
    ticker: row.ticker,
    date: row.valuation_date,
    model,
    bear: bear as number,
    base: base as number,
    bull: bull as number,
    trigger: inputs['trigger'] === 'filing' ? 'filing' : 'edit',
    periodEnd: typeof inputs['period_end'] === 'string' ? inputs['period_end'] : null,
    currency: typeof inputs['currency'] === 'string' ? inputs['currency'] : null,
  };
}

/** The saved values of one stock and model, newest first. */
export function savedFor(saved: readonly SavedValuation[], ticker: string, model: ModelId): SavedValuation[] {
  return saved.filter((row) => row.ticker === ticker && row.model === model).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * What the zone rules read for each active watched stock: the newest saved base value of the model
 * its alerts use, the one before it, and its own multiples; a stock whose values are in another
 * currency than it trades in (an ADR, say) is left out.
 */
export function watchInputs(
  entries: ReadonlyArray<{ ticker: string; active: boolean; model: ModelId; buy: number | null; trim: number | null; assetClassId: string; currency: string }>,
  saved: readonly SavedValuation[],
): WatchInput[] {
  return entries.flatMap((entry) => {
    if (!entry.active) return [];
    const [newest, previous] = savedFor(saved, entry.ticker, entry.model);
    if (!newest || (newest.currency !== null && newest.currency !== entry.currency) || newest.base <= 0) return [];
    return [
      {
        ticker: entry.ticker,
        assetClassId: entry.assetClassId,
        value: newest.base,
        valuedOn: newest.date,
        trigger: newest.trigger,
        ...(previous ? { previous: { value: previous.base, valuedOn: previous.date } } : {}),
        ...(entry.buy !== null ? { buy: entry.buy } : {}),
        ...(entry.trim !== null ? { trim: entry.trim } : {}),
      },
    ];
  });
}

/**
 * Whether a filing has come in since a stock was last valued: its newest quarter end is not the one
 * its newest value used (a later quarter, or the figures replaced, as when a feed restates them).
 */
export function filedSince(quarters: readonly Quarter[], saved: readonly SavedValuation[], ticker: string): boolean {
  const latest = latestQuarter(quarters);
  if (!latest) return false;
  const newest = saved.filter((row) => row.ticker === ticker).sort((a, b) => b.date.localeCompare(a.date))[0];
  return !newest || newest.periodEnd !== latest.periodEnd;
}

/** Taiwan's filing deadlines by quarter-end month: Q1 by 15 May, Q2 by 14 August, Q3 by 14 November, the year by 31 March. */
const TW_DEADLINES: Record<string, [number, string]> = { '03': [0, '05-15'], '06': [0, '08-14'], '09': [0, '11-14'], '12': [1, '03-31'] };

function quarterAfter(periodEnd: string): string {
  const [year, month] = periodEnd.split('-').map(Number) as [number, number];
  const next = month + 3 > 12 ? [year + 1, month - 9] : [year, month + 3];
  const end = new Date(Date.UTC(next[0] as number, next[1] as number, 0));
  return end.toISOString().slice(0, 10);
}

/**
 * When a stock's next quarterly report is due (PRD Section 5's "earnings dates of holdings"): a
 * Taiwan company's statutory deadline for the quarter after its newest one; a US company's is
 * estimated as the day the same quarter was filed a year before, a year on, as free sources give
 * no dates ahead.
 */
export function nextFiling(market: string, quarters: readonly Quarter[]): { date: string; kind: 'deadline' | 'estimate' } | undefined {
  const latest = latestQuarter(quarters);
  if (!latest) return undefined;
  const next = quarterAfter(latest.periodEnd);
  if (market === 'TW') {
    const deadline = TW_DEADLINES[next.slice(5, 7)];
    return deadline ? { date: `${Number(next.slice(0, 4)) + deadline[0]}-${deadline[1]}`, kind: 'deadline' } : undefined;
  }
  const yearAgo = quarters.find((quarter) => quarter.filed && Math.abs(Date.parse(quarter.periodEnd) - Date.parse(next) + 365 * 86_400_000) <= 14 * 86_400_000);
  if (!yearAgo?.filed) return undefined;
  return { date: `${Number(yearAgo.filed.slice(0, 4)) + 1}${yearAgo.filed.slice(4)}`, kind: 'estimate' };
}
