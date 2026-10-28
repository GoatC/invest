/**
 * The red-flag indicator's feeds (N3, Phase 2 step 5): the events and company details the nightly
 * job reads for each single stock held or watched. All free; each reply turned into plain rows.
 *
 * - SEC submissions (data.sec.gov, keyless with SEC_USER_AGENT): a US company's SIC industry, and
 *   its 8-K filings with Item 4.01 (a change of the certifying accountant) or Item 4.02
 *   (non-reliance on financial statements filed before: a restatement).
 * - EDGAR full-text search (efts.sec.gov): a 10-K whose text says the auditor or management has
 *   substantial doubt about the company's ability to continue as a going concern. The phrases are
 *   the third person the audit report and the notes use ("the Company's", "its"), not the first
 *   person of a risk factor ("our ability").
 * - TWSE OpenAPI t187ap03_L: a Taiwan company's industry code, audit firm and business ID; a
 *   change of audit firm between two nights is an auditor change.
 * - TWSE OpenAPI t187ap04_L: the day's material announcements (重大訊息) of every listed company,
 *   searched for a restatement (重編), going-concern doubt, or a change of auditor that is not a
 *   rotation inside the same firm. The feed holds the last day only, so it covers from the night
 *   the job first read it.
 * - Ministry of Environment open data ems_p_46 (free key, MOENV_API_KEY): environmental penalties,
 *   filtered by the business ID; a penalty revoked on appeal is left out.
 */
import { rocDateToIso } from './twse.ts';
import { FeedError } from './types.ts';

/** An event as the job saves it in red_flag_events. */
export interface FeedEvent {
  ticker: string;
  indicator: 'auditor_change' | 'going_concern' | 'restatement' | 'environmental_penalties';
  date: string;
  source: string;
  /** The filing's accession number, the announcement's date and time, or the penalty's document number. */
  ref: string;
  title: string;
  url: string | null;
  value: number | null;
}

function parse(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new FeedError(`${label}: reply is not JSON`);
  }
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

// ---------------------------------------------------------------------------
// SEC EDGAR
// ---------------------------------------------------------------------------

export function submissionsUrl(cik: number): string {
  return `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;
}

function archiveUrl(cik: number, accession: string, document?: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}/${document ?? ''}`;
}

/** The 8-K items that flag, and the indicator each one is. */
const ITEMS: Record<string, FeedEvent['indicator']> = { '4.01': 'auditor_change', '4.02': 'restatement' };

/** A company's SIC code and industry, and its 8-K events (Items 4.01 and 4.02) from `since` on. */
export function secSubmissions(text: string, ticker: string, since: string): { sic: number | null; industry: string | null; events: FeedEvent[] } {
  const body = (parse(text, 'SEC submissions') ?? {}) as { cik?: unknown; sic?: unknown; sicDescription?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = body.filings?.recent;
  if (!recent || !Array.isArray(recent['form'])) throw new FeedError('SEC submissions: no recent filings in the reply');
  const cik = Number(body.cik);
  const column = (name: string) => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const [forms, items, filed, reported, accessions, documents] = ['form', 'items', 'filingDate', 'reportDate', 'accessionNumber', 'primaryDocument'].map(column) as [unknown[], unknown[], unknown[], unknown[], unknown[], unknown[]];
  const events: FeedEvent[] = [];
  forms.forEach((form, i) => {
    if (form !== '8-K' && form !== '8-K/A') return;
    const accession = accessions[i];
    const date = isDate(reported[i]) ? (reported[i] as string) : filed[i];
    if (typeof accession !== 'string' || !isDate(date) || date < since) return;
    for (const item of String(items[i] ?? '').split(',').map((one) => one.trim())) {
      const indicator = ITEMS[item];
      if (!indicator) continue;
      events.push({
        ticker,
        indicator,
        date,
        source: 'sec',
        ref: `${accession}:${item}`,
        title: `${form} Item ${item}${isDate(filed[i]) ? `, filed ${filed[i]}` : ''}`,
        url: Number.isFinite(cik) && typeof documents[i] === 'string' ? archiveUrl(cik, accession, documents[i] as string) : null,
        value: null,
      });
    }
  });
  const sic = Number(body.sic);
  return { sic: Number.isInteger(sic) && sic >= 100 && sic <= 9999 ? sic : null, industry: typeof body.sicDescription === 'string' && body.sicDescription.trim() ? body.sicDescription.trim() : null, events };
}

/** The phrases of a going-concern paragraph, in the third person of an audit report or a note. */
export const GOING_CONCERN_PHRASES = [
  "substantial doubt about the Company's ability to continue as a going concern",
  'substantial doubt about the Company’s ability to continue as a going concern',
  'substantial doubt about its ability to continue as a going concern',
] as const;

/** EDGAR full-text search for a going-concern paragraph in one company's 10-K filings over a span. */
export function fullTextUrl(cik: number, from: string, to: string): string {
  const q = GOING_CONCERN_PHRASES.map((phrase) => `"${phrase}"`).join(' OR ');
  const params = new URLSearchParams({ q, forms: '10-K', ciks: String(cik).padStart(10, '0'), dateRange: 'custom', startdt: from, enddt: to });
  return `https://efts.sec.gov/LATEST/search-index?${params}`;
}

/** The 10-K filings the search found, one event per filing. */
export function secGoingConcern(text: string, ticker: string, cik: number): FeedEvent[] {
  const body = (parse(text, 'EDGAR full-text search') ?? {}) as { hits?: { hits?: unknown } };
  const hits = body.hits?.hits;
  if (!Array.isArray(hits)) throw new FeedError('EDGAR full-text search: no hits list in the reply');
  const out = new Map<string, FeedEvent>();
  for (const hit of hits) {
    const source = ((hit ?? {}) as { _source?: Record<string, unknown> })._source ?? {};
    const accession = source['adsh'];
    const date = source['file_date'];
    if (typeof accession !== 'string' || !isDate(date) || out.has(accession)) continue;
    const period = isDate(source['period_ending']) ? ` for ${source['period_ending']}` : '';
    out.set(accession, { ticker, indicator: 'going_concern', date, source: 'sec', ref: accession, title: `10-K${period}: substantial doubt about going concern`, url: archiveUrl(cik, accession), value: null });
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// TWSE OpenAPI
// ---------------------------------------------------------------------------

export const TWSE_PROFILES = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
export const TWSE_MATERIAL = 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L';

/** TWSE's industry codes (產業別) and their names. */
export const TW_INDUSTRIES: Record<string, string> = {
  '01': '水泥工業', '02': '食品工業', '03': '塑膠工業', '04': '紡織纖維', '05': '電機機械', '06': '電器電纜',
  '08': '玻璃陶瓷', '09': '造紙工業', '10': '鋼鐵工業', '11': '橡膠工業', '12': '汽車工業', '14': '建材營造業',
  '15': '航運業', '16': '觀光餐旅', '17': '金融保險業', '18': '貿易百貨業', '19': '綜合', '20': '其他業',
  '21': '化學工業', '22': '生技醫療業', '23': '油電燃氣業', '24': '半導體業', '25': '電腦及週邊設備業', '26': '光電業',
  '27': '通信網路業', '28': '電子零組件業', '29': '電子通路業', '30': '資訊服務業', '31': '其他電子業', '32': '文化創意業',
  '33': '農業科技業', '34': '電子商務', '35': '綠能環保', '36': '數位雲端', '37': '運動休閒', '38': '居家生活',
  '80': '管理股票', '91': '存託憑證',
};

export interface TwProfile {
  industryCode: string | null;
  industry: string | null;
  auditor: string | null;
  businessId: string | null;
}

function rows(text: string, label: string): Array<Record<string, unknown>> {
  const body = parse(text, label);
  if (!Array.isArray(body)) throw new FeedError(`${label}: reply is not a list`);
  return body as Array<Record<string, unknown>>;
}

/** A field whose name TWSE writes with or without a trailing space. */
function field(row: Record<string, unknown>, name: string): string {
  const value = row[name] ?? row[`${name} `];
  return typeof value === 'string' ? value.trim() : '';
}

/** Each listed company's industry, audit firm and business ID, for the tickers asked for. */
export function twseProfiles(text: string, tickers: ReadonlySet<string>): Map<string, TwProfile> {
  const out = new Map<string, TwProfile>();
  for (const row of rows(text, 'TWSE company profiles')) {
    const ticker = field(row, '公司代號');
    if (!tickers.has(ticker)) continue;
    const code = field(row, '產業別').padStart(2, '0');
    const id = field(row, '營利事業統一編號');
    out.set(ticker, {
      industryCode: /^\d{2}$/.test(code) ? code : null,
      industry: TW_INDUSTRIES[code] ?? null,
      auditor: field(row, '簽證會計師事務所') || null,
      businessId: /^\d{8}$/.test(id) ? id : null,
    });
  }
  return out;
}

const RESTATEMENT = /重編/;
const GOING_CONCERN = /繼續經營/;
const DOUBT = /疑慮|重大不確定|不確定性/;
const AUDITOR = /(更換|變更|異動).{0,6}會計師/;
/** A partner rotating inside the same audit firm, which the rules require every few years. */
const ROTATION = /內部(組織)?(調整|輪調|輪替)|輪調|輪替/;

/** The day's announcements of the tickers asked for that flag: a restatement, going-concern doubt, an auditor change. */
export function twseMaterial(text: string, tickers: ReadonlySet<string>): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (const row of rows(text, 'TWSE material announcements')) {
    const ticker = field(row, '公司代號');
    if (!tickers.has(ticker)) continue;
    const subject = field(row, '主旨');
    const body = field(row, '說明');
    const date = rocDateToIso(field(row, '發言日期'));
    if (!date) continue;
    const indicator: FeedEvent['indicator'] | undefined = RESTATEMENT.test(subject)
      ? 'restatement'
      : GOING_CONCERN.test(subject + body) && DOUBT.test(subject + body)
        ? 'going_concern'
        : AUDITOR.test(subject) && !ROTATION.test(subject + body)
          ? 'auditor_change'
          : undefined;
    if (!indicator) continue;
    out.push({ ticker, indicator, date, source: 'twse', ref: `${field(row, '發言日期')}-${field(row, '發言時間')}-${indicator}`, title: subject.replace(/\s+/g, ' ').slice(0, 500), url: null, value: null });
  }
  return out;
}

/** An auditor change between the saved profile and tonight's: a different audit firm. */
export function auditorChange(ticker: string, before: string | null, now: string | null, date: string): FeedEvent | undefined {
  if (!before || !now || before === now) return undefined;
  return { ticker, indicator: 'auditor_change', date, source: 'twse', ref: `profile-${date}`, title: `簽證會計師事務所：${before} → ${now}`, url: null, value: null };
}

// ---------------------------------------------------------------------------
// Ministry of Environment
// ---------------------------------------------------------------------------

export function moenvUrl(key: string, businessId: string): string {
  const params = new URLSearchParams({ api_key: key, format: 'JSON', limit: '1000', offset: '0', filters: `ban,EQ,${businessId}` });
  return `https://data.moenv.gov.tw/api/v2/ems_p_46?${params}`;
}

/** A company's environmental penalties from `since` on, by their penalty date; one revoked on appeal is left out. */
export function moenvPenalties(text: string, ticker: string, since: string): FeedEvent[] {
  const out = new Map<string, FeedEvent>();
  for (const row of rows(text, 'MOENV penalties')) {
    const ref = field(row, 'document_no');
    const date = field(row, 'penalty_date');
    if (!ref || !isDate(date) || date < since || /撤銷/.test(field(row, 'appeal_or_rescind'))) continue;
    const amount = Number(field(row, 'penalty_money'));
    const what = [field(row, 'transgress_type'), field(row, 'transgress_law')].filter(Boolean).join('：');
    out.set(ref, { ticker, indicator: 'environmental_penalties', date, source: 'moenv', ref, title: `${what || '環境裁罰'}（${field(row, 'fac_name') || ticker}）`.slice(0, 500), url: null, value: Number.isFinite(amount) ? amount : null });
  }
  return [...out.values()];
}
