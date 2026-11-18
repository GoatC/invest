/**
 * The combined look-through (F14, PRD Module C, Phase 2 step 6): what the whole portfolio holds once
 * every fund is opened up. Each holding's TWD value is spread over its fund's constituents, by
 * their weight in the issuer's latest holdings file; a single stock held directly adds its own
 * value. So TSMC held through VT, 00692 and directly is one line, with what each route adds.
 *
 * - Companies: each constituent's TWD exposure, direct and through each fund; a constituent is
 *   named by its issuer's ISIN country and its ticker ("TW:2330"), as one company is listed under
 *   the same code wherever a fund holds it.
 * - Overlap between two looked-through funds: Σ over the constituents both hold of the smaller of
 *   the two weights (1 when they hold the same things in the same weights).
 * - Country, sector and currency: country from the ISIN (where the issuer is registered, not where
 *   it trades); sector the GICS sector (S&P 500 names from the Select Sector SPDR funds, Taiwan
 *   names from their TWSE industry); currency the country's.
 * - A fund without a holdings file is shown whole ("not looked through"), in its trade currency
 *   and, when config look_through gives one, its country; gold counts as gold, a TWD balance as
 *   TWD cash in Taiwan.
 * Pure functions; the nightly job saves the holdings files and lib/data loads them.
 */
import type { Holding } from './valuation';

export type AssetType = 'equity' | 'bond' | 'cash' | 'gold' | 'other';

/** One line of a fund's holdings file, as the nightly job saves it. */
export interface Constituent {
  /** "TW:2330": the ISIN's country and the ticker; else the ISIN, else the name. */
  key: string;
  name: string;
  ticker: string | null;
  country: string | null;
  currency: string | null;
  sector: string | null;
  assetType: AssetType;
  /** Share of the fund, 0.0452 for 4.52%. */
  weight: number;
}

export interface FundFile {
  fund: string;
  asOf: string;
  source: string;
  constituents: Constituent[];
}

/** config look_through: the funds' sources and the fund-level country of the others. */
export interface LookThroughSettings {
  /** Each fund the job reads a holdings file for, and from where. */
  sources: Record<string, { source: 'vanguard' | 'fubon'; id: string }>;
  /** The country of a fund shown whole, when it has one (a Taiwan ETF, T-bills). */
  fundCountry: Record<string, string>;
  /** Days before a holdings file is read again. */
  refreshDays: number;
  /** Companies listed by name; the rest are one line. */
  topCompanies: number;
  /** TWSE industry code → GICS sector. */
  twSectors: Record<string, string>;
  lastVerified: string | null;
}

export const GICS_SECTORS = [
  'Information Technology',
  'Financials',
  'Health Care',
  'Consumer Discretionary',
  'Communication Services',
  'Industrials',
  'Consumer Staples',
  'Energy',
  'Materials',
  'Utilities',
  'Real Estate',
] as const;
export type Sector = (typeof GICS_SECTORS)[number];

/** The Select Sector SPDR fund of each GICS sector: its holdings name the S&P 500 members of that sector. */
export const SECTOR_FUNDS: Record<string, Sector> = {
  XLK: 'Information Technology',
  XLF: 'Financials',
  XLV: 'Health Care',
  XLY: 'Consumer Discretionary',
  XLC: 'Communication Services',
  XLI: 'Industrials',
  XLP: 'Consumer Staples',
  XLE: 'Energy',
  XLB: 'Materials',
  XLU: 'Utilities',
  XLRE: 'Real Estate',
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const TICKER = /^[A-Z0-9][A-Z0-9.-]*$/;

/** config look_through read defensively; undefined when missing or malformed. */
export function readLookThroughSettings(value: unknown): LookThroughSettings | undefined {
  const row = record(value);
  const sources: LookThroughSettings['sources'] = {};
  for (const [fund, entry] of Object.entries(record(row['sources']))) {
    const { source, id } = record(entry);
    if (!TICKER.test(fund) || (source !== 'vanguard' && source !== 'fubon') || typeof id !== 'string' || id === '') return undefined;
    sources[fund] = { source, id };
  }
  const fundCountry: Record<string, string> = {};
  for (const [fund, country] of Object.entries(record(row['fund_country']))) {
    if (!TICKER.test(fund) || typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) return undefined;
    fundCountry[fund] = country;
  }
  const twSectors: Record<string, string> = {};
  for (const [code, sector] of Object.entries(record(row['tw_sectors']))) {
    if (!/^\d{2}$/.test(code) || !(GICS_SECTORS as readonly string[]).includes(sector as string)) return undefined;
    twSectors[code] = sector as string;
  }
  const refreshDays = row['refresh_days'];
  const topCompanies = row['top_companies'];
  if (typeof refreshDays !== 'number' || !Number.isInteger(refreshDays) || refreshDays < 1) return undefined;
  if (typeof topCompanies !== 'number' || !Number.isInteger(topCompanies) || topCompanies < 5) return undefined;
  const verified = row['last_verified'];
  return { sources, fundCountry, refreshDays, topCompanies, twSectors, lastVerified: typeof verified === 'string' ? verified : null };
}

export function lookThroughSettingsValue(settings: LookThroughSettings): Record<string, unknown> {
  return {
    sources: settings.sources,
    fund_country: settings.fundCountry,
    refresh_days: settings.refreshDays,
    top_companies: settings.topCompanies,
    tw_sectors: settings.twSectors,
    last_verified: settings.lastVerified,
  };
}

/** The currency of each country's companies; a country not listed has its currency left open. */
const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD', TW: 'TWD', JP: 'JPY', GB: 'GBP', CN: 'CNY', HK: 'HKD', KR: 'KRW', IN: 'INR', CA: 'CAD', AU: 'AUD',
  CH: 'CHF', SE: 'SEK', DK: 'DKK', NO: 'NOK', SG: 'SGD', BR: 'BRL', MX: 'MXN', ZA: 'ZAR', SA: 'SAR', AE: 'AED',
  IL: 'ILS', ID: 'IDR', TH: 'THB', MY: 'MYR', PH: 'PHP', CL: 'CLP', PL: 'PLN', TR: 'TRY', NZ: 'NZD', QA: 'QAR',
  KW: 'KWD', CO: 'COP', PE: 'PEN', HU: 'HUF', CZ: 'CZK', GR: 'EUR',
  DE: 'EUR', FR: 'EUR', NL: 'EUR', IT: 'EUR', ES: 'EUR', IE: 'EUR', BE: 'EUR', FI: 'EUR', AT: 'EUR', PT: 'EUR', LU: 'EUR',
};

export function currencyOf(country: string | null): string | null {
  return country ? (COUNTRY_CURRENCY[country] ?? null) : null;
}

/** "TW:2330" from an ISIN's country and a ticker; else the ISIN; else the name. */
export function constituentKey(ticker: string | null, isin: string | null, name: string): string {
  const country = isin && /^[A-Z]{2}/.test(isin) ? isin.slice(0, 2) : null;
  if (ticker && country) return `${country}:${ticker}`;
  return isin || `name:${name.trim().toUpperCase()}`;
}

/** The key of a single stock held directly: its market's country and its ticker. */
export function directKey(market: string, ticker: string): string {
  return `${market === 'UK' ? 'GB' : market}:${ticker}`;
}

// ---------------------------------------------------------------------------
// The look-through
// ---------------------------------------------------------------------------

/** What the look-through needs of a security beyond the holding: its sector and country when held directly. */
export interface DirectInfo {
  sector: string | null;
}

export interface LookThroughInput {
  /** Every holding, both pools, valued as on the holdings page. */
  holdings: readonly Holding[];
  /** The newest holdings file of each fund that has one. */
  files: ReadonlyMap<string, FundFile>;
  /** Single stocks' sectors, by direct key ("US:AAPL"). */
  sectors: ReadonlyMap<string, string>;
  settings: LookThroughSettings;
}

export interface Exposure {
  key: string;
  name: string;
  ticker: string | null;
  country: string | null;
  currency: string | null;
  sector: string | null;
  assetType: AssetType;
  valueTwd: number;
  /** TWD through each route: "direct", or the fund's ticker. */
  via: Record<string, number>;
  /** A fund shown whole: not looked through. */
  whole?: boolean;
}

export interface Slice {
  key: string;
  valueTwd: number;
  share: number;
}

export interface FundRow {
  ticker: string;
  valueTwd: number;
  /** The holdings file it was looked through with, or none. */
  asOf: string | null;
  source: string | null;
  constituents: number;
  /** The part of the fund its file names; the rest is cash and other lines the file leaves out. */
  named: number;
}

export interface LookThrough {
  totalTwd: number;
  /** Share of the total looked through or held directly; the rest is funds shown whole. */
  lookedThrough: number;
  exposures: Exposure[];
  /** The largest equity exposures, and the rest as one line. */
  companies: Exposure[];
  otherCompaniesTwd: number;
  otherCompaniesCount: number;
  countries: Slice[];
  sectors: Slice[];
  currencies: Slice[];
  assetTypes: Slice[];
  funds: FundRow[];
  /** Each pair of looked-through funds and their overlap. */
  overlaps: Array<{ a: string; b: string; overlap: number; common: number }>;
}

function assetTypeOf(holding: Holding): AssetType {
  switch (holding.productType) {
    case 'stock':
    case 'equity_etf':
    case 'theme_etf':
      return 'equity';
    case 'bond_etf':
      return 'bond';
    case 'gold':
      return 'gold';
    case 'cash_mmf':
      return 'cash';
    default:
      return 'other';
  }
}

function slices(exposures: readonly Exposure[], total: number, keyOf: (exposure: Exposure) => string): Slice[] {
  const sums = new Map<string, number>();
  for (const exposure of exposures) sums.set(keyOf(exposure), (sums.get(keyOf(exposure)) ?? 0) + exposure.valueTwd);
  return [...sums.entries()].map(([key, valueTwd]) => ({ key, valueTwd, share: total > 0 ? valueTwd / total : 0 })).sort((a, b) => b.valueTwd - a.valueTwd || a.key.localeCompare(b.key));
}

/** Σ min(w_a, w_b) over the constituents both funds hold, and how many they share. */
export function overlap(a: FundFile, b: FundFile): { overlap: number; common: number } {
  const weights = new Map<string, number>();
  for (const row of a.constituents) weights.set(row.key, (weights.get(row.key) ?? 0) + row.weight);
  const other = new Map<string, number>();
  for (const row of b.constituents) other.set(row.key, (other.get(row.key) ?? 0) + row.weight);
  let sum = 0;
  let common = 0;
  for (const [key, weight] of weights) {
    const theirs = other.get(key);
    if (theirs === undefined) continue;
    sum += Math.min(weight, theirs);
    common += 1;
  }
  return { overlap: sum, common };
}

/** The whole portfolio opened up: every exposure, and the companies, countries, sectors and currencies it adds up to. */
export function lookThrough(input: LookThroughInput): LookThrough {
  const exposures = new Map<string, Exposure>();
  const add = (base: Omit<Exposure, 'valueTwd' | 'via'>, route: string, valueTwd: number) => {
    if (!(valueTwd > 0)) return;
    const held = exposures.get(base.key) ?? { ...base, valueTwd: 0, via: {} };
    held.valueTwd += valueTwd;
    held.via[route] = (held.via[route] ?? 0) + valueTwd;
    // A name from a direct holding or a file beats none.
    if (!held.sector && base.sector) held.sector = base.sector;
    exposures.set(base.key, held);
  };
  const funds = new Map<string, FundRow>();
  let total = 0;
  let opened = 0;
  for (const holding of input.holdings) {
    const value = holding.valueTwd ?? 0;
    if (!(value > 0)) continue;
    total += value;
    if (holding.ticker === null) {
      if (holding.productType === 'gold') add({ key: 'gold', name: 'Gold', ticker: null, country: null, currency: 'USD', sector: null, assetType: 'gold' }, 'direct', value);
      else add({ key: `cash:${holding.currency}`, name: `${holding.currency} cash`, ticker: null, country: holding.currency === 'TWD' ? 'TW' : null, currency: holding.currency, sector: null, assetType: 'cash' }, 'direct', value);
      opened += value;
      continue;
    }
    if (holding.productType === 'stock') {
      const key = directKey(holding.market ?? '', holding.ticker);
      const country = key.slice(0, 2);
      add({ key, name: holding.label, ticker: holding.ticker, country, currency: holding.currency, sector: input.sectors.get(key) ?? null, assetType: 'equity' }, 'direct', value);
      opened += value;
      continue;
    }
    const file = input.files.get(holding.ticker);
    const row = funds.get(holding.ticker) ?? { ticker: holding.ticker, valueTwd: 0, asOf: file?.asOf ?? null, source: file?.source ?? null, constituents: file?.constituents.length ?? 0, named: 0 };
    row.valueTwd += value;
    funds.set(holding.ticker, row);
    if (!file || file.constituents.length === 0) {
      const country = input.settings.fundCountry[holding.ticker] ?? null;
      add({ key: `fund:${holding.ticker}`, name: holding.label, ticker: holding.ticker, country, currency: holding.currency, sector: null, assetType: assetTypeOf(holding), whole: true }, holding.ticker, value);
      continue;
    }
    const named = Math.min(1, file.constituents.reduce((sum, constituent) => sum + Math.max(0, constituent.weight), 0));
    row.named = named;
    for (const constituent of file.constituents) {
      add({ key: constituent.key, name: constituent.name, ticker: constituent.ticker, country: constituent.country, currency: constituent.currency, sector: constituent.sector, assetType: constituent.assetType }, holding.ticker, value * Math.max(0, constituent.weight));
    }
    // What the file does not name (cash, futures, rounding) stays with the fund.
    add({ key: `rest:${holding.ticker}`, name: `${holding.ticker}: cash and other lines`, ticker: holding.ticker, country: null, currency: holding.currency, sector: null, assetType: 'cash' }, holding.ticker, value * (1 - named));
    opened += value * named;
  }
  const all = [...exposures.values()].sort((a, b) => b.valueTwd - a.valueTwd || a.key.localeCompare(b.key));
  const equities = all.filter((exposure) => exposure.assetType === 'equity' && !exposure.whole);
  const companies = equities.slice(0, input.settings.topCompanies);
  const rest = equities.slice(input.settings.topCompanies);
  const opens = [...funds.keys()].filter((ticker) => (input.files.get(ticker)?.constituents.length ?? 0) > 0).sort();
  const overlaps: LookThrough['overlaps'] = [];
  for (let i = 0; i < opens.length; i++) {
    for (let j = i + 1; j < opens.length; j++) {
      const [a, b] = [opens[i] as string, opens[j] as string];
      overlaps.push({ a, b, ...overlap(input.files.get(a) as FundFile, input.files.get(b) as FundFile) });
    }
  }
  const equityTotal = equities.reduce((sum, exposure) => sum + exposure.valueTwd, 0);
  return {
    totalTwd: total,
    lookedThrough: total > 0 ? opened / total : 0,
    exposures: all,
    companies,
    otherCompaniesTwd: rest.reduce((sum, exposure) => sum + exposure.valueTwd, 0),
    otherCompaniesCount: rest.length,
    countries: slices(all, total, (exposure) => exposure.country ?? (exposure.whole ? 'whole' : exposure.assetType === 'gold' ? 'gold' : 'unknown')),
    // Sectors are the equities': a share of the equity looked through.
    sectors: slices(equities, equityTotal, (exposure) => exposure.sector ?? 'unclassified'),
    currencies: slices(all, total, (exposure) => exposure.currency ?? 'unknown'),
    assetTypes: slices(all, total, (exposure) => exposure.assetType),
    funds: [...funds.values()].sort((a, b) => b.valueTwd - a.valueTwd),
    overlaps,
  };
}

// ---------------------------------------------------------------------------
// The saved form of a file's constituents (fund_holdings.constituents)
// ---------------------------------------------------------------------------

const ASSET_TYPES: readonly AssetType[] = ['equity', 'bond', 'cash', 'gold', 'other'];

/** A constituent as one compact array: [key, name, ticker, country, currency, sector, asset type, weight]. */
export function packConstituent(row: Constituent): unknown[] {
  return [row.key, row.name, row.ticker, row.country, row.currency, row.sector, row.assetType, row.weight];
}

/** The saved arrays read back; a malformed line is left out. */
export function unpackConstituents(value: unknown): Constituent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Constituent[] => {
    if (!Array.isArray(entry) || entry.length < 8) return [];
    const [key, name, ticker, country, currency, sector, assetType, weight] = entry as unknown[];
    const text = (one: unknown) => (typeof one === 'string' && one !== '' ? one : null);
    if (typeof key !== 'string' || typeof name !== 'string' || typeof weight !== 'number' || !Number.isFinite(weight)) return [];
    return [{ key, name, ticker: text(ticker), country: text(country), currency: text(currency), sector: text(sector), assetType: ASSET_TYPES.includes(assetType as AssetType) ? (assetType as AssetType) : 'other', weight }];
  });
}

/** Whether a fund's file is due: never read, or read `refreshDays` or more ago. */
export function fileDue(loadedOn: string | undefined, today: string, refreshDays: number): boolean {
  if (!loadedOn) return true;
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${loadedOn.slice(0, 10)}T00:00:00Z`) >= refreshDays * 86_400_000;
}
