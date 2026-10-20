/** Where a holding trades. "unlisted" covers physical gold, money-market funds and savings (PRD N5). */
export type Market = 'US' | 'TW' | 'UK' | 'unlisted';

export type TickerKind = 'etf' | 'stock' | 'other';

export interface TickerSpec {
  /** Key used in coverage maps; also the symbol unless `symbols` overrides it. */
  id: string;
  label: string;
  market: Market;
  kind: TickerKind;
  /** "principles" = named in the Investment Principles table; "supporting" = a proxy or example the models need. */
  group: 'principles' | 'supporting';
  role: string;
  /** Per-source symbol spellings, e.g. Alpha Vantage writes London tickers as AGGU.LON. */
  symbols?: Partial<Record<'alphaVantage' | 'fmp', string>>;
}

/**
 * yes = the source lists or served the ticker; no = it answered without it;
 * na = outside the source's scope; skipped = needs a key that is not set;
 * failed = the call itself failed, so coverage is unknown; unchecked = not tested this run.
 */
export type Mark = 'yes' | 'no' | 'na' | 'skipped' | 'failed' | 'unchecked';

export interface Coverage {
  mark: Mark;
  detail?: string;
}

export interface CallRecord {
  label: string;
  /** Request URL with every key and token blanked out. */
  url: string;
  status: number | null;
  ok: boolean;
  ms: number;
  bytes: number;
  contentType?: string;
  lastModified?: string;
  finalUrl?: string;
  rateLimitHeaders: Record<string, string>;
  error?: string;
  /** Raw payload saved on disk, relative to the report folder (git-ignored). */
  sampleFile?: string;
}

/** Latest point of a market-level series (rates, FX, CAPE, ERP, factors, gold). */
export interface SeriesPoint {
  name: string;
  latestDate?: string;
  latestValue?: string;
  unit?: string;
}

export interface Preview {
  label: string;
  lang: string;
  text: string;
}

export type SourceStatus = 'ok' | 'partial' | 'failed' | 'skipped';

export interface SourceResult {
  id: string;
  name: string;
  /** Column header in the coverage table. */
  short: string;
  /** The PRD Section 6 data row this source serves. */
  row: string;
  usedBy: string;
  auth: string;
  documentedLimit: string;
  /** Markets whose tickers this source is checked against; absent for market-level sources. */
  coverageMarkets?: Market[];
  /** Limits coverage to these kinds, e.g. filings sources only apply to single stocks. */
  coverageKinds?: TickerKind[];
  checkedAt: string;
  status: SourceStatus;
  calls: CallRecord[];
  observedLimits: string[];
  coverage: Record<string, Coverage>;
  series: SeriesPoint[];
  previews: Preview[];
  notes: string[];
  skipped: string[];
}

export interface RunReport {
  schemaVersion: 1;
  generatedAt: string;
  node: string;
  runner: string;
  keys: Record<string, boolean>;
  sources: SourceResult[];
}
