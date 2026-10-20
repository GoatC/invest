import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import type { Http, Redactor } from './http.ts';
import { decodeText, sniff } from './payload.ts';
import { TICKERS } from './tickers.ts';
import type { CallRecord, Market, Mark, SeriesPoint, SourceResult, TickerKind, TickerSpec } from './types.ts';

export const KEY_NAMES = ['ALPHAVANTAGE_API_KEY', 'FINMIND_TOKEN', 'FRED_API_KEY', 'FMP_API_KEY', 'MOENV_API_KEY', 'SEC_USER_AGENT'] as const;

export type KeyName = (typeof KEY_NAMES)[number];
export type Env = Partial<Record<KeyName, string>>;
export type Json = Record<string, unknown>;

/** One data source: what it serves (PRD Section 6) and how to call it once. */
export interface Probe {
  id: string;
  name: string;
  short: string;
  row: string;
  usedBy: string;
  documentedLimit: string;
  coverageMarkets?: Market[];
  coverageKinds?: TickerKind[];
  auth(env: Env): string;
  run(s: SourceRun, env: Env): Promise<void>;
}

const TEXT_EXTENSIONS = new Set(['json', 'csv', 'html', 'xml', 'txt']);

export function extensionFor(contentType: string | undefined, body: Uint8Array): string {
  const type = contentType?.toLowerCase() ?? '';
  if (type.includes('json')) return 'json';
  if (type.includes('csv')) return 'csv';
  if (type.includes('html')) return 'html';
  if (type.includes('spreadsheetml')) return 'xlsx';
  if (type.includes('ms-excel')) return 'xls';
  if (type.includes('xml')) return 'xml';
  if (type.includes('pdf')) return 'pdf';
  if (type.startsWith('text/')) return 'txt';
  const kind = sniff(body);
  if (kind === 'zip') return 'zip';
  if (kind === 'ole2') return 'xls';
  if (kind === 'pdf') return 'pdf';
  return 'bin';
}

/** Keeps each raw payload on disk (git-ignored); text payloads are redacted first. */
export class SampleStore {
  private readonly counters = new Map<string, number>();

  constructor(
    private readonly reportDir: string,
    private readonly redact: Redactor,
  ) {}

  reset(sourceId: string): void {
    rmSync(join(this.reportDir, 'samples', sourceId), { recursive: true, force: true });
  }

  save(sourceId: string, label: string, body: Uint8Array, contentType: string | undefined, ext?: string): string {
    const n = (this.counters.get(sourceId) ?? 0) + 1;
    this.counters.set(sourceId, n);
    const extension = ext ?? extensionFor(contentType, body);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'payload';
    const file = join(this.reportDir, 'samples', sourceId, `${String(n).padStart(2, '0')}-${slug}.${extension}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, TEXT_EXTENSIONS.has(extension) ? this.redact(decodeText(body, contentType)) : body);
    return relative(this.reportDir, file);
  }
}

export function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** A response plus helpers; `fail` turns an HTTP 200 that carries a refusal into a failed call. */
export class Fetched {
  private decoded?: string;

  constructor(
    readonly call: CallRecord,
    readonly bytes: Uint8Array,
  ) {}

  get ok(): boolean {
    return this.call.ok;
  }

  text(): string {
    this.decoded ??= decodeText(this.bytes, this.call.contentType);
    return this.decoded;
  }

  /** Parsed JSON of a successful reply; undefined (and the call marked failed) if it is not JSON. */
  json<T>(): T | undefined {
    if (!this.ok) return undefined;
    const parsed = parseJson<T>(this.text());
    if (parsed === undefined) this.fail('reply is not valid JSON');
    return parsed;
  }

  fail(reason: string): void {
    this.call.ok = false;
    this.call.error = this.call.error ? `${this.call.error}; ${reason}` : reason;
  }
}

/** Applies the redactor to every string in a value, as a last guard before anything is written. */
export function deepRedact<T>(value: T, redact: Redactor): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => deepRedact(item, redact)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepRedact(item, redact)])) as T;
  }
  return value;
}

export function taipeiNow(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false });
}

/** Collects one source's calls, coverage marks, series, samples and notes. */
export class SourceRun {
  private readonly result: SourceResult;

  constructor(
    probe: Probe,
    env: Env,
    private readonly http: Http,
    private readonly samples: SampleStore,
  ) {
    this.result = {
      id: probe.id,
      name: probe.name,
      short: probe.short,
      row: probe.row,
      usedBy: probe.usedBy,
      auth: probe.auth(env),
      documentedLimit: probe.documentedLimit,
      coverageMarkets: probe.coverageMarkets,
      coverageKinds: probe.coverageKinds,
      checkedAt: taipeiNow(),
      status: 'ok',
      calls: [],
      observedLimits: [],
      coverage: {},
      series: [],
      previews: [],
      notes: [],
      skipped: [],
    };
    samples.reset(probe.id);
  }

  async get(
    label: string,
    url: string,
    options: { headers?: Record<string, string>; minGapMs?: number; ext?: string; keepSample?: boolean } = {},
  ): Promise<Fetched> {
    const { call, body } = await this.http.get(url, { label, headers: options.headers, minGapMs: options.minGapMs });
    if (body.byteLength > 0 && options.keepSample !== false) {
      call.sampleFile = this.samples.save(this.result.id, label, body, call.contentType, options.ext);
    }
    this.result.calls.push(call);
    return new Fetched(call, body);
  }

  cover(tickerId: string, mark: Mark, detail?: string): void {
    this.result.coverage[tickerId] = detail ? { mark, detail } : { mark };
  }

  /**
   * Marks every in-scope ticker of `markets` by whether a listing contains it; no listing means the
   * call failed. Tickers outside the source's kinds (e.g. ETFs for a filings source) stay "not applicable".
   */
  coverFromListing(
    markets: readonly Market[],
    listing: ReadonlyMap<string, string> | undefined,
    symbol: (ticker: TickerSpec) => string = (ticker) => ticker.id,
  ): void {
    const kinds = this.result.coverageKinds;
    for (const ticker of TICKERS.filter((t) => markets.includes(t.market) && (!kinds || kinds.includes(t.kind)))) {
      const found = listing?.get(symbol(ticker));
      if (!listing) this.cover(ticker.id, 'failed');
      else if (found === undefined) this.cover(ticker.id, 'no');
      else this.cover(ticker.id, 'yes', found || undefined);
    }
  }

  skip(reason: string): void {
    this.result.skipped.push(reason);
  }

  note(text: string): void {
    this.result.notes.push(text);
  }

  observe(text: string): void {
    this.result.observedLimits.push(text);
  }

  series(point: SeriesPoint): void {
    this.result.series.push(point);
  }

  preview(label: string, text: string, lang = 'text'): void {
    this.result.previews.push({ label, lang, text });
  }

  finish(redact: Redactor): SourceResult {
    const { calls, skipped } = this.result;
    const okCount = calls.filter((call) => call.ok).length;
    if (calls.length === 0) this.result.status = skipped.length > 0 ? 'skipped' : 'failed';
    else if (okCount === 0) this.result.status = 'failed';
    else this.result.status = okCount < calls.length || skipped.length > 0 ? 'partial' : 'ok';
    return deepRedact(this.result, redact);
  }
}
