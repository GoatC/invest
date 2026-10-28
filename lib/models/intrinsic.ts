/**
 * F12 Valuation workbench (PRD Module C, Phase 2 step 4): a single stock's intrinsic value a share,
 * bear / base / bull, by three models, and where today's price stands against it.
 *
 * - DCF (FCFF): FCFF = EBIT (1 − t) + D&A − CapEx − ΔNWC over the last twelve months; it grows at
 *   the scenario's rate for `years` years, then at its terminal rate for ever:
 *     TV_n = FCFF_{n+1} ÷ (WACC − g),  EV = Σ FCFF_t ÷ (1 + WACC)^t + TV_n ÷ (1 + WACC)^n.
 *   WACC = E/V R_e + D/V R_d (1 − t), E at today's market value, R_e from F11. Equity value =
 *   EV − net debt, a share ÷ the diluted shares.
 * - Gordon DDM: P = D_1 ÷ (R_e − g) with D_1 = D_0 (1 + g), D_0 the dividends a share over the last
 *   twelve months and g the scenario's terminal rate.
 * - Multiples: P/E, P/B and EV/EBITDA, each against the peers' median and the company's own
 *   median over five years of quarter ends; every multiple gives a price, the lowest is the bear
 *   value, the median the base and the highest the bull.
 *
 * Margin of safety = (intrinsic value − price) ÷ intrinsic value. The buy zone is a price at or
 * below base value × the buy multiple (0.75), the trim zone at or above × the trim multiple (1.25).
 * Pure functions: the Valuation page, the nightly job and the rules engine use them.
 */
import { workingCapital, type Figures } from './fundamentals';

export type Scenario = 'bear' | 'base' | 'bull';
export const SCENARIOS: readonly Scenario[] = ['bear', 'base', 'bull'];

export type ModelId = 'dcf' | 'ddm' | 'multiples';
export const MODELS: readonly ModelId[] = ['dcf', 'ddm', 'multiples'];
/** The valuations table names its models so. */
export const MODEL_COLUMN: Record<ModelId, string> = { dcf: 'dcf_fcff', ddm: 'ddm', multiples: 'multiples' };

/** Floating-point sums a hair over a limit are not over it. */
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// The formulas
// ---------------------------------------------------------------------------

/** FCFF = EBIT (1 − t) + D&A − CapEx − ΔNWC. */
export function fcff(input: { ebit: number; taxRate: number; da: number; capex: number; deltaNwc: number }): number {
  return input.ebit * (1 - input.taxRate) + input.da - input.capex - input.deltaNwc;
}

/** WACC = E/V R_e + D/V R_d (1 − t). */
export function wacc(input: { equity: number; debt: number; costOfEquity: number; costOfDebt: number; taxRate: number }): number {
  const value = input.equity + input.debt;
  return (input.equity / value) * input.costOfEquity + (input.debt / value) * input.costOfDebt * (1 - input.taxRate);
}

export interface DcfYear {
  year: number;
  fcff: number;
  /** 1 ÷ (1 + WACC)^t. */
  factor: number;
  pv: number;
}

export interface Dcf {
  flows: DcfYear[];
  /** FCFF_{n+1}, TV_n and its present value. */
  terminal: { fcff: number; value: number; pv: number };
  enterprise: number;
}

/** A two-stage DCF; undefined when the terminal rate is not below the discount rate. */
export function discountedCashFlow(input: { fcff: number; growth: number; years: number; terminalGrowth: number; discount: number }): Dcf | undefined {
  const { growth, years, terminalGrowth, discount } = input;
  if (discount - terminalGrowth <= EPS) return undefined;
  const flows: DcfYear[] = [];
  let flow = input.fcff;
  for (let year = 1; year <= years; year++) {
    flow *= 1 + growth;
    const factor = 1 / (1 + discount) ** year;
    flows.push({ year, fcff: flow, factor, pv: flow * factor });
  }
  const next = flow * (1 + terminalGrowth);
  const value = next / (discount - terminalGrowth);
  const pv = value / (1 + discount) ** years;
  return { flows, terminal: { fcff: next, value, pv }, enterprise: flows.reduce((sum, row) => sum + row.pv, 0) + pv };
}

/** Gordon: D_0 (1 + g) ÷ (R_e − g); undefined when g is not below R_e. */
export function gordon(input: { dividend: number; growth: number; costOfEquity: number }): number | undefined {
  if (input.costOfEquity - input.growth <= EPS) return undefined;
  return (input.dividend * (1 + input.growth)) / (input.costOfEquity - input.growth);
}

/** (Intrinsic value − price) ÷ intrinsic value. */
export function marginOfSafety(value: number, price: number): number {
  return (value - price) / value;
}

export type Zone = 'buy' | 'trim' | 'between';

export interface ZoneCheck {
  zone: Zone;
  buyPrice: number;
  trimPrice: number;
  /** How far the price would have to fall to reach the buy zone, a fraction of it (0 inside). */
  toBuy: number;
  /** How far it would have to rise to reach the trim zone (0 inside). */
  toTrim: number;
}

/** Where a price stands: at or below value × buy multiple is the buy zone, at or above value × trim multiple the trim zone. */
export function zoneOf(price: number, value: number, multiples: { buy: number; trim: number }): ZoneCheck {
  const buyPrice = value * multiples.buy;
  const trimPrice = value * multiples.trim;
  const zone: Zone = price <= buyPrice + EPS ? 'buy' : price + EPS >= trimPrice ? 'trim' : 'between';
  return { zone, buyPrice, trimPrice, toBuy: Math.max(0, 1 - buyPrice / price), toTrim: Math.max(0, trimPrice / price - 1) };
}

// ---------------------------------------------------------------------------
// Multiples
// ---------------------------------------------------------------------------

export type MultipleId = 'pe' | 'pb' | 'evEbitda';
export const MULTIPLES: readonly MultipleId[] = ['pe', 'pb', 'evEbitda'];
export type MultipleSet = Partial<Record<MultipleId, number>>;

const per = (amount: number | undefined, shares: number | undefined) => (amount !== undefined && shares !== undefined && shares > 0 ? amount / shares : undefined);

/** Earnings, book value and EBITDA a company's multiples divide by; each only where positive. */
export function metrics(figures: Figures): { eps?: number; bookPerShare?: number; ebitda?: number; netDebt: number; shares?: number } {
  const eps = per(figures.netIncome, figures.shares);
  const bookPerShare = per(figures.equity, figures.shares);
  const ebitda = figures.ebit !== undefined && figures.da !== undefined ? figures.ebit + figures.da : undefined;
  return {
    ...(eps !== undefined && eps > 0 ? { eps } : {}),
    ...(bookPerShare !== undefined && bookPerShare > 0 ? { bookPerShare } : {}),
    ...(ebitda !== undefined && ebitda > 0 ? { ebitda } : {}),
    netDebt: (figures.debt ?? 0) - (figures.cash ?? 0),
    ...(figures.shares !== undefined && figures.shares > 0 ? { shares: figures.shares } : {}),
  };
}

/** P/E, P/B and EV/EBITDA at a price. */
export function multiplesAt(price: number, figures: Figures): MultipleSet {
  const m = metrics(figures);
  const out: MultipleSet = {};
  if (m.eps) out.pe = price / m.eps;
  if (m.bookPerShare) out.pb = price / m.bookPerShare;
  if (m.ebitda && m.shares) {
    const ev = price * m.shares + m.netDebt;
    if (ev > 0) out.evEbitda = ev / m.ebitda;
  }
  return out;
}

/** The price each multiple gives the company: P/E × EPS, P/B × book a share, (EV/EBITDA × EBITDA − net debt) ÷ shares. */
export function impliedPrices(figures: Figures, reference: MultipleSet): MultipleSet {
  const m = metrics(figures);
  const out: MultipleSet = {};
  if (reference.pe !== undefined && m.eps) out.pe = reference.pe * m.eps;
  if (reference.pb !== undefined && m.bookPerShare) out.pb = reference.pb * m.bookPerShare;
  if (reference.evEbitda !== undefined && m.ebitda && m.shares) {
    const price = (reference.evEbitda * m.ebitda - m.netDebt) / m.shares;
    if (price > 0) out.evEbitda = price;
  }
  return out;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export interface Range {
  low: number;
  median: number;
  high: number;
  n: number;
}

/** Each multiple's low, median and high over a series of quarter ends; a multiple seen fewer than `minimum` times is left out. */
export function ranges(history: readonly MultipleSet[], minimum: number): Partial<Record<MultipleId, Range>> {
  const out: Partial<Record<MultipleId, Range>> = {};
  for (const id of MULTIPLES) {
    const values = history.flatMap((set) => (set[id] !== undefined ? [set[id] as number] : []));
    const middle = median(values);
    if (values.length >= minimum && middle !== undefined) out[id] = { low: Math.min(...values), median: middle, high: Math.max(...values), n: values.length };
  }
  return out;
}

/** The peers' median of each multiple. */
export function peerMedians(peers: readonly MultipleSet[]): MultipleSet {
  const out: MultipleSet = {};
  for (const id of MULTIPLES) {
    const middle = median(peers.flatMap((set) => (set[id] !== undefined ? [set[id] as number] : [])));
    if (middle !== undefined) out[id] = middle;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Settings and assumptions
// ---------------------------------------------------------------------------

export interface ValuationSettings {
  /** The model a new stock's alerts use. */
  model: ModelId;
  years: number;
  growth: Record<Scenario, number>;
  terminal: Record<Scenario, number>;
  /** R_d when the filings give none: R_f + this. */
  debtSpread: number;
  /** The tax rate when the filings give none, by market. */
  taxRate: Record<string, number>;
  /** Years of quarter ends in the company's own range, and how many of them a range needs. */
  historyYears: number;
  minQuarters: number;
  checked: string | null;
}

/** What Hugo sets for one stock (watchlist.assumptions); anything left out takes config valuation's default. */
export interface StockAssumptions {
  model?: ModelId;
  years?: number;
  growth?: Partial<Record<Scenario, number>>;
  terminal?: Partial<Record<Scenario, number>>;
  /** Figures typed in place of the filings'. */
  overrides?: { fcff?: number; netDebt?: number; shares?: number; taxRate?: number; costOfDebt?: number };
  peers?: string[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRate = (value: unknown): value is number => isNumber(value) && value > -0.5 && value < 1;
const isModel = (value: unknown): value is ModelId => value === 'dcf' || value === 'ddm' || value === 'multiples';

function byScenario(value: unknown): Record<Scenario, number> | undefined {
  const row = record(value);
  const [bear, base, bull] = SCENARIOS.map((scenario) => row[scenario]);
  if (!isRate(bear) || !isRate(base) || !isRate(bull) || bear > base || base > bull) return undefined;
  return { bear, base, bull };
}

/** config valuation, read defensively; undefined when a part is missing or out of range. */
export function readValuationSettings(value: unknown): ValuationSettings | undefined {
  const row = record(value);
  const { model, years, debt_spread: debtSpread, history_years: historyYears, min_quarters: minQuarters } = row;
  const growth = byScenario(row['growth']);
  const terminal = byScenario(row['terminal']);
  if (!isModel(model) || !isNumber(years) || !Number.isInteger(years) || years < 1 || years > 20 || !growth || !terminal || !isRate(debtSpread)) return undefined;
  if (!isNumber(historyYears) || historyYears < 1 || !isNumber(minQuarters) || minQuarters < 1) return undefined;
  const taxRate: Record<string, number> = {};
  for (const [market, rate] of Object.entries(record(row['tax_rate']))) {
    if (!isRate(rate) || rate < 0) return undefined;
    taxRate[market] = rate;
  }
  const checked = row['last_verified'];
  return { model, years, growth, terminal, debtSpread, taxRate, historyYears, minQuarters, checked: typeof checked === 'string' ? checked : null };
}

/** watchlist.assumptions read back: what is well formed is kept, the rest falls to the defaults. */
export function readAssumptions(value: unknown): StockAssumptions {
  const row = record(value);
  const out: StockAssumptions = {};
  if (isModel(row['model'])) out.model = row['model'];
  if (isNumber(row['years']) && Number.isInteger(row['years']) && row['years'] >= 1 && row['years'] <= 20) out.years = row['years'];
  for (const key of ['growth', 'terminal'] as const) {
    const part = record(row[key]);
    const kept = Object.fromEntries(SCENARIOS.flatMap((scenario) => (isRate(part[scenario]) ? [[scenario, part[scenario]]] : [])));
    if (Object.keys(kept).length > 0) out[key] = kept;
  }
  const overrides = record(row['overrides']);
  const typed = Object.fromEntries(
    (['fcff', 'netDebt', 'shares', 'taxRate', 'costOfDebt'] as const).flatMap((key) => (isNumber(overrides[key]) && (key !== 'shares' || (overrides[key] as number) > 0) ? [[key, overrides[key]]] : [])),
  );
  if (Object.keys(typed).length > 0) out.overrides = typed;
  if (Array.isArray(row['peers'])) out.peers = row['peers'].filter((peer): peer is string => typeof peer === 'string' && peer.length > 0).slice(0, 8);
  return out;
}

/** A stock's assumptions with the defaults filled in. */
export interface Assumed {
  model: ModelId;
  years: number;
  growth: Record<Scenario, number>;
  terminal: Record<Scenario, number>;
  overrides: NonNullable<StockAssumptions['overrides']>;
  peers: string[];
}

export function assumed(settings: ValuationSettings, assumptions: StockAssumptions): Assumed {
  const merged = (key: 'growth' | 'terminal') => {
    const values = { ...settings[key], ...(assumptions[key] ?? {}) };
    // A partial edit that leaves the scenarios out of order keeps the defaults.
    return values.bear <= values.base && values.base <= values.bull ? values : settings[key];
  };
  return {
    model: assumptions.model ?? settings.model,
    years: assumptions.years ?? settings.years,
    growth: merged('growth'),
    terminal: merged('terminal'),
    overrides: assumptions.overrides ?? {},
    peers: assumptions.peers ?? [],
  };
}

// ---------------------------------------------------------------------------
// Valuing one stock
// ---------------------------------------------------------------------------

/** A figure as used: from the filings, typed in place of them, or a default. */
export interface Used {
  value: number;
  from: 'filings' | 'typed' | 'default';
}

export type Values = Record<Scenario, number>;

export type DcfProblem = 'cost_of_equity' | 'figures' | 'fcff' | 'growth';
export type DdmProblem = 'cost_of_equity' | 'dividend' | 'growth';
export type MultiplesProblem = 'figures' | 'none';

export interface DcfResult {
  values: Values;
  taxRate: Used;
  fcff: Used;
  /** The parts of the FCFF worked out from the filings. */
  parts?: { ebit: number; da: number; capex: number; deltaNwc: number };
  costOfDebt: Used;
  equity: number;
  debt: number;
  wacc: number;
  netDebt: Used;
  shares: Used;
  scenarios: Record<Scenario, Dcf>;
}

export interface DdmResult {
  values: Values;
  dividend: Used;
}

export interface MultiplesResult {
  values: Values;
  current: MultipleSet;
  own: Partial<Record<MultipleId, Range>>;
  peers: MultipleSet;
  peerCount: number;
  /** Each reference's implied price. */
  implied: { own: MultipleSet; peers: MultipleSet };
}

export type Outcome<T, P> = { ok: true; result: T } | { ok: false; problem: P };

export interface ValuationInput {
  price: number;
  market: string;
  /** The newest quarter's figures, and the quarter a year before it (ΔNWC). */
  figures: Figures;
  yearAgo?: Figures;
  /** Multiples at past quarter ends, for the company's own range. */
  history: readonly MultipleSet[];
  /** Each peer's multiples today. */
  peers: readonly MultipleSet[];
  /** F11's cost of equity and its R_f; undefined when F11 has none for the stock. */
  costOfEquity?: number;
  riskFree?: number;
  assumptions: Assumed;
  settings: ValuationSettings;
}

export interface Valuation {
  dcf: Outcome<DcfResult, DcfProblem>;
  ddm: Outcome<DdmResult, DdmProblem>;
  multiples: Outcome<MultiplesResult, MultiplesProblem>;
}

function taxRateOf(input: ValuationInput): Used {
  const typed = input.assumptions.overrides.taxRate;
  if (typed !== undefined) return { value: typed, from: 'typed' };
  const { tax, pretax } = input.figures;
  if (tax !== undefined && pretax !== undefined && pretax > 0 && tax >= 0 && tax / pretax <= 0.5) return { value: tax / pretax, from: 'filings' };
  return { value: input.settings.taxRate[input.market] ?? 0.2, from: 'default' };
}

function valueDcf(input: ValuationInput): Outcome<DcfResult, DcfProblem> {
  const { figures, assumptions } = input;
  if (input.costOfEquity === undefined) return { ok: false, problem: 'cost_of_equity' };
  const typed = assumptions.overrides;
  const shares: Used | undefined = typed.shares !== undefined ? { value: typed.shares, from: 'typed' } : figures.shares !== undefined && figures.shares > 0 ? { value: figures.shares, from: 'filings' } : undefined;
  if (!shares) return { ok: false, problem: 'figures' };
  const taxRate = taxRateOf(input);
  let flow: Used;
  let parts: DcfResult['parts'];
  if (typed.fcff !== undefined) {
    flow = { value: typed.fcff, from: 'typed' };
  } else {
    const { ebit, da, capex } = figures;
    const now = workingCapital(figures);
    const before = input.yearAgo ? workingCapital(input.yearAgo) : undefined;
    if (ebit === undefined || da === undefined || capex === undefined) return { ok: false, problem: 'figures' };
    const deltaNwc = now !== undefined && before !== undefined ? now - before : 0;
    parts = { ebit, da, capex, deltaNwc };
    flow = { value: fcff({ ebit, taxRate: taxRate.value, da, capex, deltaNwc }), from: 'filings' };
  }
  if (flow.value <= 0) return { ok: false, problem: 'fcff' };
  const debt = Math.max(0, figures.debt ?? 0);
  const netDebt: Used = typed.netDebt !== undefined ? { value: typed.netDebt, from: 'typed' } : { value: debt - (figures.cash ?? 0), from: 'filings' };
  const interest = figures.interest;
  const costOfDebt: Used =
    typed.costOfDebt !== undefined
      ? { value: typed.costOfDebt, from: 'typed' }
      : interest !== undefined && interest > 0 && debt > 0 && interest / debt < 0.2
        ? { value: interest / debt, from: 'filings' }
        : { value: (input.riskFree ?? 0) + input.settings.debtSpread, from: 'default' };
  const equity = input.price * shares.value;
  const rate = wacc({ equity, debt, costOfEquity: input.costOfEquity, costOfDebt: costOfDebt.value, taxRate: taxRate.value });
  const scenarios = {} as Record<Scenario, Dcf>;
  const values = {} as Values;
  for (const scenario of SCENARIOS) {
    const run = discountedCashFlow({ fcff: flow.value, growth: assumptions.growth[scenario], years: assumptions.years, terminalGrowth: assumptions.terminal[scenario], discount: rate });
    if (!run) return { ok: false, problem: 'growth' };
    scenarios[scenario] = run;
    values[scenario] = (run.enterprise - netDebt.value) / shares.value;
  }
  return { ok: true, result: { values, taxRate, fcff: flow, ...(parts ? { parts } : {}), costOfDebt, equity, debt, wacc: rate, netDebt, shares, scenarios } };
}

function valueDdm(input: ValuationInput): Outcome<DdmResult, DdmProblem> {
  if (input.costOfEquity === undefined) return { ok: false, problem: 'cost_of_equity' };
  const { figures } = input;
  const shares = input.assumptions.overrides.shares ?? figures.shares;
  const paid = figures.dividendsPaid !== undefined && shares ? figures.dividendsPaid / shares : undefined;
  const dividend: Used | undefined = figures.dps !== undefined && figures.dps > 0 ? { value: figures.dps, from: 'filings' } : paid !== undefined && paid > 0 ? { value: paid, from: 'filings' } : undefined;
  if (!dividend) return { ok: false, problem: 'dividend' };
  const values = {} as Values;
  for (const scenario of SCENARIOS) {
    const value = gordon({ dividend: dividend.value, growth: input.assumptions.terminal[scenario], costOfEquity: input.costOfEquity });
    if (value === undefined) return { ok: false, problem: 'growth' };
    values[scenario] = value;
  }
  return { ok: true, result: { values, dividend } };
}

function valueMultiples(input: ValuationInput): Outcome<MultiplesResult, MultiplesProblem> {
  const figures: Figures = { ...input.figures, ...(input.assumptions.overrides.shares !== undefined ? { shares: input.assumptions.overrides.shares } : {}) };
  if (figures.shares === undefined) return { ok: false, problem: 'figures' };
  const own = ranges(input.history, input.settings.minQuarters);
  const peers = peerMedians(input.peers);
  const ownMedians: MultipleSet = Object.fromEntries(Object.entries(own).map(([id, range]) => [id, range.median]));
  const implied = { own: impliedPrices(figures, ownMedians), peers: impliedPrices(figures, peers) };
  const prices = [...Object.values(implied.own), ...Object.values(implied.peers)].filter((value): value is number => value !== undefined && value > 0);
  const middle = median(prices);
  if (middle === undefined) return { ok: false, problem: 'none' };
  return {
    ok: true,
    result: { values: { bear: Math.min(...prices), base: middle, bull: Math.max(...prices) }, current: multiplesAt(input.price, figures), own, peers, peerCount: input.peers.length, implied },
  };
}

/** Every model's bear / base / bull value a share, in the reporting currency, or why there is none. */
export function valueStock(input: ValuationInput): Valuation {
  return { dcf: valueDcf(input), ddm: valueDdm(input), multiples: valueMultiples(input) };
}

/** The values of one model, when it gave any. */
export function valuesOf(valuation: Valuation, model: ModelId): Values | undefined {
  const outcome = valuation[model];
  return outcome.ok ? outcome.result.values : undefined;
}
