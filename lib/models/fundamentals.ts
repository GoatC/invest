/**
 * A company's figures from its filings (F12, Phase 2 step 4), as each quarter end saw them: the
 * flows over the twelve months to it (TTM) and the balances at it, in the reporting currency.
 *
 * Filings report flows over different spans: a 10-Q gives the quarter and the year to date, a
 * 10-K the year, and a Taiwan cash-flow statement the year to date only. Every span is turned into
 * quarters first, a year-to-date figure less the shorter one before it from the same start, and a
 * quarter end's TTM is the year that ends on it, else its four quarters chained back. A figure
 * reported more than once (restated in a later filing) keeps its first report, which is what the
 * price at the time was set against; the share count above all, which a later split restates.
 *
 * Pure functions; the nightly job's SEC EDGAR and FinMind feeds turn their replies into facts.
 */

/** Flows: summed over the twelve months to a quarter end. */
export const FLOW_ITEMS = ['revenue', 'ebit', 'pretax', 'tax', 'netIncome', 'da', 'capex', 'ocf', 'dividendsPaid', 'dps', 'interest'] as const;
/** Balances: as at a quarter end. shares is the diluted count (the quarter's weighted average where reported). */
export const BALANCE_ITEMS = ['currentAssets', 'currentLiabilities', 'cash', 'debt', 'shortDebt', 'equity', 'shares'] as const;

export type FlowItem = (typeof FLOW_ITEMS)[number];
export type BalanceItem = (typeof BALANCE_ITEMS)[number];
export type Item = FlowItem | BalanceItem;

/** One reported figure: a flow has a start, a balance does not. Dates are YYYY-MM-DD. */
export interface Fact {
  item: Item;
  start: string | null;
  end: string;
  value: number;
  /** When it was filed, if the source says (SEC). */
  filed?: string;
}

/** One quarter end's figures. capex and dividendsPaid are positive amounts paid out. */
export type Figures = Partial<Record<Item, number>>;

export interface Quarter {
  periodEnd: string;
  figures: Figures;
  /** The filing that first reported this quarter end (the newest of its figures' first reports), when known. */
  filed: string | null;
}

const DAY = 86_400_000;

function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

/** Days a span covers, both ends counted. */
const span = (start: string, end: string) => days(start, end) + 1;
const isQuarter = (length: number) => length >= 80 && length <= 100;
const isYear = (length: number) => length >= 350 && length <= 380;

/** Chained quarters may sit a few days apart (52–53-week years, a source's own dating). */
const SLACK = 3;

interface Span {
  start: string;
  end: string;
  value: number;
}

/** First report wins: the earliest filed, else the first given. */
function firstReported(facts: readonly Fact[]): Fact[] {
  const kept = new Map<string, Fact>();
  for (const fact of facts) {
    const key = `${fact.item}|${fact.start ?? ''}|${fact.end}`;
    const held = kept.get(key);
    if (!held || (fact.filed && held.filed && fact.filed < held.filed)) kept.set(key, fact);
  }
  return [...kept.values()];
}

/** Every quarter a flow's spans give: reported ones, and each year-to-date less the shorter one from the same start. */
export function quartersOf(spans: readonly Span[]): Span[] {
  const out = new Map<string, Span>();
  for (const one of spans) if (isQuarter(span(one.start, one.end))) out.set(one.end, one);
  const byStart = new Map<string, Span[]>();
  for (const one of spans) byStart.set(one.start, [...(byStart.get(one.start) ?? []), one]);
  for (const group of byStart.values()) {
    const sorted = [...group].sort((a, b) => a.end.localeCompare(b.end));
    for (let i = 1; i < sorted.length; i++) {
      const [shorter, longer] = [sorted[i - 1] as Span, sorted[i] as Span];
      const start = nextDay(shorter.end);
      if (!out.has(longer.end) && isQuarter(span(start, longer.end))) out.set(longer.end, { start, end: longer.end, value: longer.value - shorter.value });
    }
  }
  return [...out.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/** The twelve months to `end`: a reported year ending on it, else its four quarters chained back. */
export function trailingTwelve(spans: readonly Span[], end: string): number | undefined {
  const year = spans.find((one) => one.end === end && isYear(span(one.start, one.end)));
  if (year) return year.value;
  const quarters = quartersOf(spans);
  let total = 0;
  let at = end;
  for (let i = 0; i < 4; i++) {
    const quarter = quarters.find((one) => Math.abs(days(one.end, at)) <= (i === 0 ? 0 : SLACK));
    if (!quarter) return undefined;
    total += quarter.value;
    at = new Date(Date.parse(`${quarter.start}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  }
  return total;
}

/**
 * Each quarter end's figures, oldest first: every date a flow's quarter or year ends on, or a
 * balance is reported at, with whatever of the figures can be worked out there.
 */
export function quarterFigures(facts: readonly Fact[]): Quarter[] {
  const kept = firstReported(facts);
  const flows = new Map<Item, Span[]>();
  const balances = new Map<Item, Map<string, number>>();
  const filed = new Map<string, string>();
  for (const fact of kept) {
    if (fact.filed && (filed.get(fact.end) ?? '') < fact.filed) filed.set(fact.end, fact.filed);
    if (fact.start === null) {
      const at = balances.get(fact.item) ?? new Map<string, number>();
      at.set(fact.end, fact.value);
      balances.set(fact.item, at);
    } else {
      flows.set(fact.item, [...(flows.get(fact.item) ?? []), { start: fact.start, end: fact.end, value: fact.value }]);
    }
  }
  // Quarter ends: where a reported flow ends after a quarter or a year, or a balance sheet stands.
  const ends = new Set<string>();
  for (const spans of flows.values()) for (const one of quartersOf(spans)) ends.add(one.end);
  for (const spans of flows.values()) for (const one of spans) if (isYear(span(one.start, one.end))) ends.add(one.end);
  for (const item of ['equity', 'currentAssets'] as const) for (const end of balances.get(item)?.keys() ?? []) ends.add(end);
  const out: Quarter[] = [];
  for (const end of [...ends].sort()) {
    const figures: Figures = {};
    for (const item of FLOW_ITEMS) {
      const spans = flows.get(item);
      const value = spans ? trailingTwelve(spans, end) : undefined;
      if (value !== undefined && Number.isFinite(value)) figures[item] = value;
    }
    for (const item of BALANCE_ITEMS) {
      const value = balances.get(item)?.get(end);
      if (value !== undefined && Number.isFinite(value)) figures[item] = value;
    }
    if (Object.keys(figures).length > 0) out.push({ periodEnd: end, figures, filed: filed.get(end) ?? null });
  }
  return out;
}

/** The quarter a year before `quarter`, within a fortnight: what ΔNWC is measured against. */
export function yearBefore(quarters: readonly Quarter[], quarter: Quarter): Quarter | undefined {
  return quarters.find((candidate) => Math.abs(days(candidate.periodEnd, quarter.periodEnd) - 365) <= 14);
}

/** Working capital as FCFF counts it: current assets less cash, less current liabilities other than debt. */
export function workingCapital(figures: Figures): number | undefined {
  const { currentAssets, currentLiabilities } = figures;
  if (currentAssets === undefined || currentLiabilities === undefined) return undefined;
  return currentAssets - (figures.cash ?? 0) - (currentLiabilities - (figures.shortDebt ?? 0));
}

/** The newest quarter end with what a valuation needs most: a TTM net income and a share count. */
export function latestQuarter(quarters: readonly Quarter[]): Quarter | undefined {
  return [...quarters].reverse().find((quarter) => quarter.figures.netIncome !== undefined && quarter.figures.shares !== undefined);
}
