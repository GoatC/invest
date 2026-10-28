/**
 * The red-flag indicator (N3, PRD Module C, Phase 2 step 5): each single stock held or watched gets
 * a red / amber / green light and the list of indicators that fired. Display only: a light never
 * blocks a trade; the two N3 rules turn a worse light into a prompt to review.
 *
 * Nine indicators, each with its flag rule from the PRD table (thresholds in config red_flags):
 * - beneish_m: the Beneish M-Score from the twelve months to the newest quarter end and the year
 *   before it; above −1.78 → red.
 * - altman_z: the Altman Z-Score for a manufacturer, Z″ for any other company (book equity in place
 *   of market value, no sales term); below the lower bound → red, below the upper → amber.
 * - cash_flow_vs_earnings: operating cash flow below net income in each of the last 3 years → amber.
 * - auditor_change (amber), going_concern (red), restatement (red), environmental_penalties
 *   (amber): any event in the last 3 years, from the filings feeds or typed in by the owner.
 * - governance_rating (Taiwan only): the TWSE corporate governance evaluation tier, typed in; in
 *   the bottom 35% → amber.
 * - excluded_business: the company's ticker or industry on the owner's exclusion list → red.
 * Banks and insurers (config red_flags.financial) have no Beneish or Altman score: their balance
 * sheets do not fit either model.
 *
 * Coverage: no free source gives full ESG scores, so the light shows the share of the indicators
 * that apply which data covers. The light is the worst level among them; with none covered, none,
 * and none too when the exclusion list is all that is green (a list check alone says nothing of the company).
 * Pure functions; lib/data.ts loads the inputs and the nightly job saves each week's scan.
 */
import { addDays } from '../dates';
import { yearBefore, type Figures, type Quarter } from './fundamentals';

export const INDICATORS = [
  'beneish_m',
  'altman_z',
  'cash_flow_vs_earnings',
  'auditor_change',
  'going_concern',
  'restatement',
  'governance_rating',
  'environmental_penalties',
  'excluded_business',
] as const;
export type Indicator = (typeof INDICATORS)[number];

/** The indicators that count events in the lookback window. */
export const EVENT_INDICATORS = ['auditor_change', 'going_concern', 'restatement', 'environmental_penalties'] as const satisfies readonly Indicator[];
export type EventIndicator = (typeof EVENT_INDICATORS)[number];
/** The indicators the owner can type an entry for: the events no feed covers fully, and the governance tier. */
export const MANUAL_INDICATORS = [...EVENT_INDICATORS, 'governance_rating'] as const satisfies readonly Indicator[];
export type ManualIndicator = (typeof MANUAL_INDICATORS)[number];

export type Level = 'green' | 'amber' | 'red';
/** A level, or none (no data covers it) or na (it does not apply to the company). */
export type Status = Level | 'none' | 'na';
export const STATUSES: readonly Status[] = ['green', 'amber', 'red', 'none', 'na'];

/** The level each event indicator flags at, as the PRD table sets it. */
export const EVENT_LEVEL: Record<EventIndicator, Level> = { auditor_change: 'amber', going_concern: 'red', restatement: 'red', environmental_penalties: 'amber' };

const RANK: Record<Level, number> = { green: 0, amber: 1, red: 2 };

export function worse(a: Level, b: Level): boolean {
  return RANK[a] > RANK[b];
}

// ---------------------------------------------------------------------------
// Settings (config red_flags)
// ---------------------------------------------------------------------------

export interface IndustryGroup {
  /** SIC code ranges, both ends included (US). */
  sic: Array<[number, number]>;
  /** TWSE industry codes (產業別), e.g. "24" for semiconductors. */
  twIndustries: string[];
}

export interface RedFlagSettings {
  lookbackYears: number;
  /** Days between scans: the nightly job scans a company whose newest scan is this old. */
  scanDays: number;
  beneish: { redAbove: number };
  altman: { z: { redBelow: number; amberBelow: number }; z2: { redBelow: number; amberBelow: number } };
  /** Years in a row of operating cash flow below net income that flag amber. */
  cashFlowYears: number;
  /** The share at the bottom of the governance evaluation that flags amber. */
  governanceBottomShare: number;
  manufacturing: IndustryGroup;
  financial: IndustryGroup;
  excluded: { industries: string[]; tickers: string[] };
  lastVerified: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? (value as string[]) : undefined;
}

function group(value: unknown): IndustryGroup | undefined {
  const row = record(value);
  const sic = row['sic'];
  const tw = strings(row['tw_industries']);
  if (!Array.isArray(sic) || !tw) return undefined;
  const ranges: Array<[number, number]> = [];
  for (const range of sic) {
    if (!Array.isArray(range) || range.length !== 2) return undefined;
    const [low, high] = [num(range[0]), num(range[1])];
    if (low === undefined || high === undefined || low > high) return undefined;
    ranges.push([low, high]);
  }
  return { sic: ranges, twIndustries: tw };
}

function bounds(value: unknown): { redBelow: number; amberBelow: number } | undefined {
  const row = record(value);
  const [red, amber] = [num(row['red_below']), num(row['amber_below'])];
  return red !== undefined && amber !== undefined && red <= amber ? { redBelow: red, amberBelow: amber } : undefined;
}

/** config red_flags read defensively; undefined when missing or malformed (before its migration, say). */
export function readRedFlagSettings(value: unknown): RedFlagSettings | undefined {
  const row = record(value);
  const lookbackYears = num(row['lookback_years']);
  const scanDays = num(row['scan_days']);
  const redAbove = num(record(row['beneish'])['red_above']);
  const altman = record(row['altman']);
  const [z, z2] = [bounds(altman['z']), bounds(altman['z2'])];
  const cashFlowYears = num(row['cash_flow_years']);
  const bottom = num(record(row['governance'])['bottom_share']);
  const [manufacturing, financial] = [group(row['manufacturing']), group(row['financial'])];
  const excluded = record(row['excluded']);
  const [industries, tickers] = [strings(excluded['industries']), strings(excluded['tickers'])];
  const verified = row['last_verified'];
  if (
    lookbackYears === undefined || !(lookbackYears > 0) ||
    scanDays === undefined || !(scanDays >= 1) ||
    redAbove === undefined || !z || !z2 ||
    cashFlowYears === undefined || !Number.isInteger(cashFlowYears) || cashFlowYears < 1 ||
    bottom === undefined || bottom <= 0 || bottom >= 1 ||
    !manufacturing || !financial || !industries || !tickers
  ) {
    return undefined;
  }
  return {
    lookbackYears,
    scanDays,
    beneish: { redAbove },
    altman: { z, z2 },
    cashFlowYears,
    governanceBottomShare: bottom,
    manufacturing,
    financial,
    excluded: { industries, tickers },
    lastVerified: typeof verified === 'string' ? verified : null,
  };
}

/** The settings as config red_flags stores them. */
export function redFlagSettingsValue(settings: RedFlagSettings): Record<string, unknown> {
  const groupValue = (one: IndustryGroup) => ({ sic: one.sic, tw_industries: one.twIndustries });
  return {
    lookback_years: settings.lookbackYears,
    scan_days: settings.scanDays,
    beneish: { red_above: settings.beneish.redAbove },
    altman: {
      z: { red_below: settings.altman.z.redBelow, amber_below: settings.altman.z.amberBelow },
      z2: { red_below: settings.altman.z2.redBelow, amber_below: settings.altman.z2.amberBelow },
    },
    cash_flow_years: settings.cashFlowYears,
    governance: { bottom_share: settings.governanceBottomShare },
    manufacturing: groupValue(settings.manufacturing),
    financial: groupValue(settings.financial),
    excluded: { industries: settings.excluded.industries, tickers: settings.excluded.tickers },
    last_verified: settings.lastVerified,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** What the nightly job knows of a company besides its filings (company_profiles). */
export interface Profile {
  /** TWSE industry code (產業別) or the SEC SIC code, as text. */
  industryCode: string | null;
  /** The industry's name: TWSE's, or SEC's SIC description. */
  industry: string | null;
  sic: number | null;
  /** The audit firm (Taiwan, from the company profile). */
  auditor: string | null;
  /** Each event indicator a feed checks for this company: the newest check, and the first one where the feed only reaches forward. */
  checked: Partial<Record<EventIndicator, { on: string; since?: string }>>;
}

/** One event a feed found or the owner typed: an auditor change, a going-concern opinion, a restatement, a penalty. */
export interface FlagEvent {
  indicator: EventIndicator;
  date: string;
  source: string;
  title: string;
  url?: string | null;
  /** A penalty's amount, in its currency. */
  value?: number | null;
}

/**
 * An owner's entry for one indicator as of a date. For an event indicator, `value` is the number of
 * events found in the lookback window then (0: checked, none); for governance_rating, the bottom
 * edge of the tier as a percentage from the top (5, 20, 35, 50, 65, 80 or 100).
 */
export interface ManualEntry {
  id: number;
  indicator: ManualIndicator;
  asOf: string;
  value: number;
  note: string;
}

export interface CompanyInput {
  ticker: string;
  market: string;
  /** Saved quarters, oldest first, in the reporting currency. */
  quarters: readonly Quarter[];
  reportCurrency: string | null;
  /** The newest quoted close, for the market value of equity (Altman Z). */
  price: { close: number; date: string; currency: string } | null;
  profile: Profile | null;
  events: readonly FlagEvent[];
  entries: readonly ManualEntry[];
}

// ---------------------------------------------------------------------------
// The indicators
// ---------------------------------------------------------------------------

export interface IndicatorResult {
  indicator: Indicator;
  status: Status;
  /** The score (M, Z), the count of events or years, or the governance tier. */
  value: number | null;
  /** Why the status is none or na: e.g. 'financial', 'missing', 'no_prior_year', 'not_taiwan', 'no_feed'. */
  why?: string;
  /** Figures a score lacks. */
  missing?: string[];
  periodEnd?: string;
  priorEnd?: string;
  /** Beneish's eight indices; Altman's ratios X1…X5. */
  parts?: Record<string, number>;
  variant?: 'Z' | 'Z2';
  /** Altman: market value of equity (Z) or book equity (Z″, or Z without a price in the filings' currency). */
  equityBasis?: 'market' | 'book';
  /** Cash flow vs earnings: the years compared. */
  years?: Array<{ end: string; ocf: number; netIncome: number }>;
  /** Events in the lookback window, newest first. */
  events?: FlagEvent[];
  /** The owner's entry it read. */
  entry?: ManualEntry;
  /** The feed's newest check, and since when a forward-only feed has looked. */
  checkedOn?: string;
  since?: string;
  /** Excluded business: what matched. */
  matched?: string;
}

export interface Assessment {
  ticker: string;
  light: Level | null;
  /** Covered ÷ applicable, as a percentage. */
  coverage: number;
  covered: number;
  applicable: number;
  /** The indicators at amber or red, worst first. */
  fired: Indicator[];
  indicators: IndicatorResult[];
}

export type CompanyKind = 'manufacturer' | 'other' | 'financial' | 'unknown';

function inGroup(groupOf: IndustryGroup, market: string, profile: Profile | null): boolean {
  if (!profile) return false;
  if (market === 'US' && profile.sic !== null) return groupOf.sic.some(([low, high]) => (profile.sic as number) >= low && (profile.sic as number) <= high);
  if (market === 'TW' && profile.industryCode !== null) return groupOf.twIndustries.includes(profile.industryCode);
  return false;
}

/** Manufacturer (Altman Z), financial (no Beneish or Altman), other (Z″), or unknown without a profile (Z″). */
export function companyKind(market: string, profile: Profile | null, settings: RedFlagSettings): CompanyKind {
  if (!profile || (profile.sic === null && profile.industryCode === null)) return 'unknown';
  if (inGroup(settings.financial, market, profile)) return 'financial';
  return inGroup(settings.manufacturing, market, profile) ? 'manufacturer' : 'other';
}

/** Gross profit: reported, else revenue less the cost of revenue. */
function grossProfit(figures: Figures): number | undefined {
  if (figures.grossProfit !== undefined) return figures.grossProfit;
  return figures.revenue !== undefined && figures.cogs !== undefined ? figures.revenue - figures.cogs : undefined;
}

/** Total liabilities: reported, else total assets less equity. */
export function liabilities(figures: Figures): number | undefined {
  if (figures.totalLiabilities !== undefined) return figures.totalLiabilities;
  return figures.totalAssets !== undefined && figures.equity !== undefined ? figures.totalAssets - figures.equity : undefined;
}

/** Debt beyond a year: all debt less its current part. */
function longTermDebt(figures: Figures): number | undefined {
  return figures.debt === undefined ? undefined : figures.debt - (figures.shortDebt ?? 0);
}

export interface BeneishYear {
  revenue: number;
  receivables: number;
  grossProfit: number;
  currentAssets: number;
  ppe: number;
  totalAssets: number;
  da: number;
  sga: number;
  currentLiabilities: number;
  longTermDebt: number;
  netIncome: number;
  ocf: number;
}

function beneishYear(figures: Figures): { year?: BeneishYear; missing: string[] } {
  const values: Record<keyof BeneishYear, number | undefined> = {
    revenue: figures.revenue,
    receivables: figures.receivables,
    grossProfit: grossProfit(figures),
    currentAssets: figures.currentAssets,
    ppe: figures.ppe,
    totalAssets: figures.totalAssets,
    da: figures.da,
    sga: figures.sga,
    currentLiabilities: figures.currentLiabilities,
    longTermDebt: longTermDebt(figures),
    netIncome: figures.netIncome,
    ocf: figures.ocf,
  };
  const missing = Object.entries(values).flatMap(([key, value]) => (value === undefined ? [key] : []));
  return missing.length > 0 ? { missing } : { year: values as BeneishYear, missing };
}

/** Beneish's coefficients for the eight-variable model, and its constant. */
export const BENEISH = { constant: -4.84, DSRI: 0.92, GMI: 0.528, AQI: 0.404, SGI: 0.892, DEPI: 0.115, SGAI: -0.172, TATA: 4.679, LVGI: -0.327 } as const;

/** The eight indices of year t against year t−1, and M. Undefined when a ratio divides by zero. */
export function beneishM(t: BeneishYear, prior: BeneishYear): { m: number; parts: Record<string, number> } | undefined {
  const ratio = (a: number, b: number) => (b === 0 ? undefined : a / b);
  const dsri = ratio(t.receivables / t.revenue, prior.receivables / prior.revenue);
  const gmi = ratio(prior.grossProfit / prior.revenue, t.grossProfit / t.revenue);
  const aqi = ratio(1 - (t.currentAssets + t.ppe) / t.totalAssets, 1 - (prior.currentAssets + prior.ppe) / prior.totalAssets);
  const sgi = ratio(t.revenue, prior.revenue);
  const depi = ratio(prior.da / (prior.da + prior.ppe), t.da / (t.da + t.ppe));
  const sgai = ratio(t.sga / t.revenue, prior.sga / prior.revenue);
  const tata = ratio(t.netIncome - t.ocf, t.totalAssets);
  const lvgi = ratio((t.currentLiabilities + t.longTermDebt) / t.totalAssets, (prior.currentLiabilities + prior.longTermDebt) / prior.totalAssets);
  const parts = { DSRI: dsri, GMI: gmi, AQI: aqi, SGI: sgi, DEPI: depi, SGAI: sgai, TATA: tata, LVGI: lvgi };
  if (Object.values(parts).some((value) => value === undefined || !Number.isFinite(value))) return undefined;
  const p = parts as Record<keyof typeof parts, number>;
  const m =
    BENEISH.constant + BENEISH.DSRI * p.DSRI + BENEISH.GMI * p.GMI + BENEISH.AQI * p.AQI + BENEISH.SGI * p.SGI + BENEISH.DEPI * p.DEPI + BENEISH.SGAI * p.SGAI + BENEISH.TATA * p.TATA + BENEISH.LVGI * p.LVGI;
  return { m, parts: p };
}

function scoreBeneish(company: CompanyInput, kind: CompanyKind, settings: RedFlagSettings): IndicatorResult {
  const base = { indicator: 'beneish_m' as const, value: null };
  if (kind === 'financial') return { ...base, status: 'na', why: 'financial' };
  if (company.quarters.length === 0) return { ...base, status: 'none', why: 'no_filings' };
  let firstMissing: string[] | undefined;
  for (const quarter of [...company.quarters].reverse()) {
    const now = beneishYear(quarter.figures);
    if (!now.year) {
      firstMissing ??= now.missing;
      continue;
    }
    const before = yearBefore(company.quarters, quarter);
    if (!before) continue;
    const prior = beneishYear(before.figures);
    if (!prior.year) {
      firstMissing ??= prior.missing;
      continue;
    }
    const score = beneishM(now.year, prior.year);
    if (!score) continue;
    return { ...base, status: score.m > settings.beneish.redAbove ? 'red' : 'green', value: score.m, periodEnd: quarter.periodEnd, priorEnd: before.periodEnd, parts: score.parts };
  }
  return firstMissing ? { ...base, status: 'none', why: 'missing', missing: firstMissing } : { ...base, status: 'none', why: 'no_prior_year' };
}

/** Altman's coefficients: Z for a public manufacturer, Z″ for any other company. */
export const ALTMAN = {
  Z: { X1: 1.2, X2: 1.4, X3: 3.3, X4: 0.6, X5: 1.0 },
  Z2: { X1: 6.56, X2: 3.26, X3: 6.72, X4: 1.05 },
} as const;

export interface AltmanInput {
  currentAssets: number;
  currentLiabilities: number;
  totalAssets: number;
  retainedEarnings: number;
  ebit: number;
  revenue: number;
  totalLiabilities: number;
  /** Market value of equity for Z, book equity for Z″. */
  equity: number;
}

/** X1 working capital, X2 retained earnings, X3 EBIT, X5 sales, each over total assets; X4 equity over liabilities. */
export function altmanZ(input: AltmanInput, variant: 'Z' | 'Z2'): { z: number; parts: Record<string, number> } | undefined {
  if (input.totalAssets <= 0 || input.totalLiabilities <= 0) return undefined;
  const parts: Record<string, number> = {
    X1: (input.currentAssets - input.currentLiabilities) / input.totalAssets,
    X2: input.retainedEarnings / input.totalAssets,
    X3: input.ebit / input.totalAssets,
    X4: input.equity / input.totalLiabilities,
  };
  if (variant === 'Z') {
    parts['X5'] = input.revenue / input.totalAssets;
    const c = ALTMAN.Z;
    return { z: c.X1 * (parts['X1'] as number) + c.X2 * (parts['X2'] as number) + c.X3 * (parts['X3'] as number) + c.X4 * (parts['X4'] as number) + c.X5 * (parts['X5'] as number), parts };
  }
  const c = ALTMAN.Z2;
  return { z: c.X1 * (parts['X1'] as number) + c.X2 * (parts['X2'] as number) + c.X3 * (parts['X3'] as number) + c.X4 * (parts['X4'] as number), parts };
}

function scoreAltman(company: CompanyInput, kind: CompanyKind, settings: RedFlagSettings): IndicatorResult {
  const base = { indicator: 'altman_z' as const, value: null };
  if (kind === 'financial') return { ...base, status: 'na', why: 'financial' };
  if (company.quarters.length === 0) return { ...base, status: 'none', why: 'no_filings' };
  const variant = kind === 'manufacturer' ? 'Z' : 'Z2';
  let firstMissing: string[] | undefined;
  for (const quarter of [...company.quarters].reverse()) {
    const f = quarter.figures;
    // Z weighs the market value of equity: shares at the newest close, when it is in the filings' currency.
    const priced = company.price && company.price.currency === company.reportCurrency && f.shares !== undefined ? f.shares * company.price.close : undefined;
    const equityBasis: 'market' | 'book' = variant === 'Z' && priced !== undefined ? 'market' : 'book';
    const values = {
      currentAssets: f.currentAssets,
      currentLiabilities: f.currentLiabilities,
      totalAssets: f.totalAssets,
      retainedEarnings: f.retainedEarnings,
      ebit: f.ebit,
      revenue: variant === 'Z' ? f.revenue : (f.revenue ?? 0),
      totalLiabilities: liabilities(f),
      equity: equityBasis === 'market' ? priced : f.equity,
    };
    const missing = Object.entries(values).flatMap(([key, value]) => (value === undefined ? [key] : []));
    if (missing.length > 0) {
      firstMissing ??= missing;
      continue;
    }
    const score = altmanZ(values as AltmanInput, variant);
    if (!score) continue;
    const zone = variant === 'Z' ? settings.altman.z : settings.altman.z2;
    const status: Level = score.z < zone.redBelow ? 'red' : score.z < zone.amberBelow ? 'amber' : 'green';
    return { ...base, status, value: score.z, periodEnd: quarter.periodEnd, parts: score.parts, variant, equityBasis };
  }
  return { ...base, status: 'none', why: 'missing', ...(firstMissing ? { missing: firstMissing } : {}) };
}

function scoreCashFlow(company: CompanyInput, settings: RedFlagSettings): IndicatorResult {
  const base = { indicator: 'cash_flow_vs_earnings' as const, value: null };
  if (company.quarters.length === 0) return { ...base, status: 'none', why: 'no_filings' };
  const latest = [...company.quarters].reverse().find((quarter) => quarter.figures.ocf !== undefined && quarter.figures.netIncome !== undefined);
  if (!latest) return { ...base, status: 'none', why: 'missing', missing: ['ocf', 'netIncome'] };
  const years: Array<{ end: string; ocf: number; netIncome: number }> = [];
  let at: Quarter | undefined = latest;
  while (at && years.length < settings.cashFlowYears) {
    const { ocf, netIncome } = at.figures;
    if (ocf === undefined || netIncome === undefined) break;
    years.push({ end: at.periodEnd, ocf, netIncome });
    at = yearBefore(company.quarters, at);
  }
  if (years.length < settings.cashFlowYears) return { ...base, status: 'none', why: 'no_prior_year', years };
  const below = years.filter((year) => year.ocf < year.netIncome).length;
  return { ...base, status: below === years.length ? 'amber' : 'green', value: below, periodEnd: latest.periodEnd, years };
}

/** The first day of the lookback window: `years` of 365.25 days before today. */
export function windowStart(today: string, years: number): string {
  return addDays(today, -Math.round(years * 365.25));
}

/** The owner's newest entry for an indicator within the window. */
function newestEntry(entries: readonly ManualEntry[], indicator: ManualIndicator, from: string, today: string): ManualEntry | undefined {
  return entries
    .filter((entry) => entry.indicator === indicator && entry.asOf >= from && entry.asOf <= today)
    .sort((a, b) => b.asOf.localeCompare(a.asOf) || b.id - a.id)[0];
}

function scoreEvents(company: CompanyInput, indicator: EventIndicator, from: string, today: string): IndicatorResult {
  const events = company.events.filter((event) => event.indicator === indicator && event.date >= from && event.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const entry = newestEntry(company.entries, indicator, from, today);
  const checked = company.profile?.checked[indicator];
  const covered = checked !== undefined || entry !== undefined || events.length > 0;
  const base = { indicator, events, ...(entry ? { entry } : {}), ...(checked ? { checkedOn: checked.on, ...(checked.since ? { since: checked.since } : {}) } : {}) };
  if (!covered) return { ...base, status: 'none', value: null, why: 'no_feed' };
  const count = events.length + (entry?.value ?? 0);
  return { ...base, status: count > 0 ? EVENT_LEVEL[indicator] : 'green', value: count };
}

/** The bottom edges of the TWSE governance evaluation's tiers, as percentages from the top. */
export const GOVERNANCE_TIERS = [5, 20, 35, 50, 65, 80, 100] as const;

function scoreGovernance(company: CompanyInput, from: string, today: string, settings: RedFlagSettings): IndicatorResult {
  const base = { indicator: 'governance_rating' as const };
  if (company.market !== 'TW') return { ...base, status: 'na', value: null, why: 'not_taiwan' };
  const entry = newestEntry(company.entries, 'governance_rating', from, today);
  if (!entry) return { ...base, status: 'none', value: null, why: 'no_feed' };
  // A tier ending below the top (100 − 35)% sits in the bottom 35%.
  const status: Level = entry.value > 100 - settings.governanceBottomShare * 100 + 1e-9 ? 'amber' : 'green';
  return { ...base, status, value: entry.value, entry };
}

function scoreExcluded(company: CompanyInput, settings: RedFlagSettings): IndicatorResult {
  const base = { indicator: 'excluded_business' as const };
  if (settings.excluded.tickers.some((ticker) => ticker.toUpperCase() === company.ticker.toUpperCase())) return { ...base, status: 'red', value: 1, matched: company.ticker };
  const industry = company.profile?.industry?.toLowerCase() ?? '';
  const code = company.profile?.industryCode ?? '';
  const hit = settings.excluded.industries.find((entry) => {
    const wanted = entry.trim().toLowerCase();
    return wanted !== '' && (wanted === code.toLowerCase() || (industry !== '' && industry.includes(wanted)));
  });
  if (hit) return { ...base, status: 'red', value: 1, matched: hit };
  return { ...base, status: 'green', value: 0, ...(settings.excluded.industries.length + settings.excluded.tickers.length === 0 ? { why: 'empty_list' } : {}) };
}

/** Every indicator for one company as of `today`, its coverage and its light. */
export function assess(company: CompanyInput, settings: RedFlagSettings, today: string): Assessment {
  const kind = companyKind(company.market, company.profile, settings);
  const from = windowStart(today, settings.lookbackYears);
  const byIndicator: Record<Indicator, IndicatorResult> = {
    beneish_m: scoreBeneish(company, kind, settings),
    altman_z: scoreAltman(company, kind, settings),
    cash_flow_vs_earnings: scoreCashFlow(company, settings),
    auditor_change: scoreEvents(company, 'auditor_change', from, today),
    going_concern: scoreEvents(company, 'going_concern', from, today),
    restatement: scoreEvents(company, 'restatement', from, today),
    governance_rating: scoreGovernance(company, from, today, settings),
    environmental_penalties: scoreEvents(company, 'environmental_penalties', from, today),
    excluded_business: scoreExcluded(company, settings),
  };
  const indicators = INDICATORS.map((indicator) => byIndicator[indicator]);
  return summarise(company.ticker, indicators);
}

function isLevel(status: Status): status is Level {
  return status === 'green' || status === 'amber' || status === 'red';
}

/** The light, coverage and fired list of a set of indicator results. */
export function summarise(ticker: string, indicators: IndicatorResult[]): Assessment {
  const applicable = indicators.filter((row) => row.status !== 'na').length;
  const levels = indicators.flatMap((row) => (isLevel(row.status) ? [row.status] : []));
  const worst = levels.length === 0 ? null : levels.reduce((most, level) => (worse(level, most) ? level : most), 'green' as Level);
  // The exclusion list can turn a light red, never green: green needs an indicator data covers.
  const fromData = indicators.some((row) => row.indicator !== 'excluded_business' && isLevel(row.status));
  const light = worst === 'green' && !fromData ? null : worst;
  const fired = indicators
    .filter((row) => row.status === 'red' || row.status === 'amber')
    .sort((a, b) => RANK[b.status as Level] - RANK[a.status as Level] || INDICATORS.indexOf(a.indicator) - INDICATORS.indexOf(b.indicator))
    .map((row) => row.indicator);
  return { ticker, light, coverage: applicable === 0 ? 0 : Math.round((levels.length / applicable) * 1000) / 10, covered: levels.length, applicable, fired, indicators };
}

// ---------------------------------------------------------------------------
// Scans: what the nightly job saves, and the light's history the rules read
// ---------------------------------------------------------------------------

/** One saved red_flags row. */
export interface FlagRow {
  ticker: string;
  flag_date: string;
  indicator: Indicator;
  value: number | null;
  level: Status;
  coverage_pct: number;
  detail: Record<string, unknown>;
}

/** The rows a scan saves: one per indicator, each with the company's coverage and what the indicator read. */
export function scanRows(assessment: Assessment, date: string): FlagRow[] {
  return assessment.indicators.map((row) => {
    const { indicator, status, value, ...detail } = row;
    return { ticker: assessment.ticker, flag_date: date, indicator, value: value === null ? null : Math.round(value * 1e6) / 1e6, level: status, coverage_pct: assessment.coverage, detail: detail as Record<string, unknown> };
  });
}

/** One company's scan as the rules and pages read it back. */
export interface Scan {
  date: string;
  light: Level | null;
  coverage: number;
  fired: Indicator[];
  indicators: IndicatorResult[];
}

/** Saved rows grouped back into scans, per ticker, newest first. */
export function readScans(rows: ReadonlyArray<{ ticker: string; flag_date: string; indicator: string; value: number | string | null; level: string; coverage_pct: number | string | null; detail?: unknown }>): Map<string, Scan[]> {
  const grouped = new Map<string, Map<string, IndicatorResult[]>>();
  for (const row of rows) {
    if (!(INDICATORS as readonly string[]).includes(row.indicator) || !(STATUSES as readonly string[]).includes(row.level)) continue;
    const byDate = grouped.get(row.ticker) ?? new Map<string, IndicatorResult[]>();
    const list = byDate.get(row.flag_date) ?? [];
    list.push({ ...(record(row.detail) as Partial<IndicatorResult>), indicator: row.indicator as Indicator, status: row.level as Status, value: row.value === null ? null : Number(row.value) });
    byDate.set(row.flag_date, list);
    grouped.set(row.ticker, byDate);
  }
  const out = new Map<string, Scan[]>();
  for (const [ticker, byDate] of grouped) {
    const scans = [...byDate.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, list]) => {
        const sorted = [...list].sort((a, b) => INDICATORS.indexOf(a.indicator) - INDICATORS.indexOf(b.indicator));
        const summary = summarise(ticker, sorted);
        return { date, light: summary.light, coverage: summary.coverage, fired: summary.fired, indicators: sorted };
      });
    out.set(ticker, scans);
  }
  return out;
}

/**
 * The light's current run: the light of the newest scan with one, the date that run of scans began,
 * and the light of the scan before the run. Scans without a light (nothing covered) are skipped.
 */
export function currentRun(scans: readonly Scan[]): { light: Level; since: string; before: Level | null; fired: Indicator[] } | undefined {
  const lit = scans.filter((scan): scan is Scan & { light: Level } => scan.light !== null);
  const newest = lit[0];
  if (!newest) return undefined;
  let since = newest.date;
  let before: Level | null = null;
  for (const scan of lit.slice(1)) {
    if (scan.light !== newest.light) {
      before = scan.light;
      break;
    }
    since = scan.date;
  }
  return { light: newest.light, since, before, fired: newest.fired };
}

/** Whether a company is due a scan: never scanned, or its newest scan `scanDays` or more ago. */
export function scanDue(newest: string | undefined, today: string, scanDays: number): boolean {
  if (!newest) return true;
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${newest}T00:00:00Z`) >= scanDays * 86_400_000;
}
