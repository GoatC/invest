/**
 * F11 CAPM cost of equity (PRD Module C, Phase 2 step 3): the return a single stock's holders
 * should expect for the market risk it carries, the discount rate F12's valuations use.
 *
 *   E(R_i) = R_f + β_i (ERP + CRP)
 *
 * Method:
 * - Each market has its own inputs (config capm.markets): a US stock is measured in USD against
 *   the S&P 500 at the US 10-year Treasury yield (FRED DGS10, the month's last day); a Taiwan
 *   stock in TWD against TAIEX at the Taiwan 10-year government bond yield (the Central Bank's
 *   secondary-market rate, the month's average).
 * - β comes from N1: the newest one the nightly job saved for the stock against its market's
 *   index (weekly, 2 years, local currency), else worked out the same way on request. Blume's
 *   adjusted β by default (config capm.beta), the raw one if chosen.
 * - ERP is Damodaran's implied equity risk premium for the S&P 500 at the start of the newest
 *   month (his trailing-12-month cash-yield figure), or a value Hugo types (config capm.erp).
 *   A market outside the US adds its country risk premium (CRP: Taiwan's from Damodaran's country
 *   table), so β multiplies the market's whole premium.
 * - A yield or ERP not loaded yet falls back to the value in config capm, and the page says so.
 *
 * Asset classes take their expected returns from the capital market assumptions (F6), not from
 * here: F11 is for single stocks. Pure functions; the Cost of equity page and F12 use them.
 */

export type BetaChoice = 'adjusted' | 'raw';
export type ErpSource = 'damodaran' | 'manual';

/** The monthly series F11 reads from market_series, each a fraction a year. */
export const CAPM_SERIES = {
  /** The US 10-year Treasury yield, the month's last daily value (FRED DGS10). */
  usTreasury10y: 'us_treasury_10y',
  /** The Taiwan 10-year government bond yield, the month's average (Central Bank, secondary market). */
  twGovt10y: 'tw_govt_10y',
  /** Damodaran's implied ERP for the S&P 500 at the start of the month. */
  impliedErp: 'us_implied_erp',
} as const;

export interface MarketInputs {
  /** The index N1's β is measured against (config regression.benchmarks). */
  benchmark: string;
  /** The market_series holding the market's 10-year yield. */
  riskFreeSeries: string;
  /** The yield used until the series is loaded, a fraction a year. */
  riskFree: number;
  /** Added to the ERP for this market, a fraction a year. */
  countryPremium: number;
}

export interface CapmSettings {
  beta: BetaChoice;
  erp: { source: ErpSource; manual: number };
  /** By market (US, TW). */
  markets: Record<string, MarketInputs>;
  checked: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRate = (value: unknown): value is number => isNumber(value) && value > -0.1 && value < 0.5;

/** config capm, read defensively; undefined when a part is missing or out of range. */
export function readCapmSettings(value: unknown): CapmSettings | undefined {
  const row = record(value);
  const beta = row['beta'];
  const erp = record(row['erp']);
  if (beta !== 'adjusted' && beta !== 'raw') return undefined;
  if ((erp['source'] !== 'damodaran' && erp['source'] !== 'manual') || !isRate(erp['manual'])) return undefined;
  const markets: Record<string, MarketInputs> = {};
  for (const [market, entry] of Object.entries(record(row['markets']))) {
    const item = record(entry);
    const { benchmark, risk_free_series: riskFreeSeries, risk_free: riskFree, country_premium: countryPremium } = item;
    if (typeof benchmark !== 'string' || typeof riskFreeSeries !== 'string' || !isRate(riskFree) || !isRate(countryPremium)) return undefined;
    markets[market] = { benchmark, riskFreeSeries, riskFree, countryPremium };
  }
  if (Object.keys(markets).length === 0) return undefined;
  const checked = row['last_verified'];
  return { beta, erp: { source: erp['source'], manual: erp['manual'] }, markets, checked: typeof checked === 'string' ? checked : null };
}

/** E(R) = R_f + β × (ERP + CRP). */
export function costOfEquity(input: { riskFree: number; beta: number; erp: number; countryPremium: number }): number {
  return input.riskFree + input.beta * (input.erp + input.countryPremium);
}

/** One month of a series: month is YYYY-MM. */
export interface MonthValue {
  month: string;
  value: number;
}

/** A rate as used: from its series' newest month, or the setting when none is loaded (or manual is chosen). */
export interface Quote {
  value: number;
  month: string | null;
  from: 'series' | 'setting';
}

function newest(points: readonly MonthValue[] | undefined): MonthValue | undefined {
  return (points ?? []).reduce<MonthValue | undefined>((best, point) => (!best || point.month > best.month ? point : best), undefined);
}

/** The market's 10-year yield: the series' newest month, else the setting. */
export function riskFreeQuote(inputs: MarketInputs, series: ReadonlyMap<string, readonly MonthValue[]>): Quote {
  const point = newest(series.get(inputs.riskFreeSeries));
  return point ? { value: point.value, month: point.month, from: 'series' } : { value: inputs.riskFree, month: null, from: 'setting' };
}

/** The ERP: Damodaran's newest month, else (or when manual is chosen) the typed value. */
export function erpQuote(settings: Pick<CapmSettings, 'erp'>, series: ReadonlyMap<string, readonly MonthValue[]>): Quote {
  const point = settings.erp.source === 'damodaran' ? newest(series.get(CAPM_SERIES.impliedErp)) : undefined;
  return point ? { value: point.value, month: point.month, from: 'series' } : { value: settings.erp.manual, month: null, from: 'setting' };
}

/** β as N1 gives it: the raw slope and Blume's adjustment, saved monthly (runDate) or worked out now (null). */
export interface BetaInput {
  raw: number;
  adjusted: number;
  runDate: string | null;
}

export interface CostOfEquity {
  ticker: string;
  market: string;
  benchmark: string;
  /** The β used, by config capm.beta. */
  beta: number;
  betaInput: BetaInput;
  riskFree: Quote;
  erp: Quote;
  countryPremium: number;
  /** ERP + CRP: what β multiplies. */
  premium: number;
  rate: number;
}

export type CostOutcome = { ok: true; result: CostOfEquity } | { ok: false; problem: 'market' | 'beta' };

/** A stock's cost of equity from its market's inputs and its β; or why there is none. */
export function stockCostOfEquity(
  security: { ticker: string; market: string },
  beta: BetaInput | undefined,
  settings: CapmSettings,
  series: ReadonlyMap<string, readonly MonthValue[]>,
): CostOutcome {
  const inputs = settings.markets[security.market];
  if (!inputs) return { ok: false, problem: 'market' };
  if (!beta) return { ok: false, problem: 'beta' };
  const riskFree = riskFreeQuote(inputs, series);
  const erp = erpQuote(settings, series);
  const used = settings.beta === 'adjusted' ? beta.adjusted : beta.raw;
  const premium = erp.value + inputs.countryPremium;
  return {
    ok: true,
    result: {
      ticker: security.ticker,
      market: security.market,
      benchmark: inputs.benchmark,
      beta: used,
      betaInput: beta,
      riskFree,
      erp,
      countryPremium: inputs.countryPremium,
      premium,
      rate: costOfEquity({ riskFree: riskFree.value, beta: used, erp: erp.value, countryPremium: inputs.countryPremium }),
    },
  };
}
