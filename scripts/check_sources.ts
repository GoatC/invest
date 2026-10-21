/**
 * Phase 1, step 1 (PRD Section 11): data-source check.
 *
 * Calls each free data source in PRD Section 6 once, records rate-limit details and a
 * sample payload, and reports which Investment Principles tickers each source covers,
 * including the open question of a free price source for LSE-listed AGGU.
 *
 *   npm run check:sources                         every source
 *   npm run check:sources -- --only=fred,twse     just these; the others keep their last result
 *   npm run check:sources -- --skip=alphavantage  everything except these
 *
 * Keys come from .env.local (git-ignored; template in .env.example). A missing key skips
 * only the checks that need it. Output: reports/source-check/report.md and report.json;
 * raw payloads go to reports/source-check/samples/ (git-ignored). Never retries a call.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { describeError, Http, makeRedactor } from './lib/http.ts';
import {
  dayMonthYearToIso,
  decodeText,
  extractLinks,
  findUrls,
  headTail,
  htmlTableRows,
  htmlToText,
  isoDaysAgo,
  jsonPreview,
  parseCsv,
  printableStrings,
  sniff,
  spreadsheetMlSheets,
  toIsoDate,
  truncate,
  unzip,
  xlsxPeek,
} from './lib/payload.ts';
import { type Fetched, type Json, KEY_NAMES, parseJson, type Probe, readEnv, SampleStore, SourceRun, taipeiNow } from './lib/probe.ts';
import { renderReport } from './lib/report.ts';
import { symbolFor, tickerById, TICKERS } from './lib/tickers.ts';
import type { Market, RunReport, SourceResult, TickerSpec } from './lib/types.ts';

const USER_AGENT = 'LongViewInvest-SourceCheck/0.1 (+https://github.com/GoatC/Invest)';

function tickersIn(market: Market): TickerSpec[] {
  return TICKERS.filter((ticker) => ticker.market === market);
}

// ---------------------------------------------------------------------------
// Probes, in PRD Section 6 order
// ---------------------------------------------------------------------------

const twse: Probe = {
  id: 'twse',
  name: 'TWSE OpenAPI 證交所開放 API',
  short: 'TWSE',
  row: 'Taiwan prices 台股價格',
  usedBy: 'F12, N1, N3, F18',
  documentedLimit: 'No published limit; no key 未公布限制，免金鑰',
  coverageMarkets: ['TW'],
  auth: () => 'none 免金鑰',
  async run(s) {
    const r = await s.get('Daily quotes for every listed security (STOCK_DAY_ALL)', 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
    const rows = r.json<Array<Record<string, string>>>();
    if (!Array.isArray(rows)) {
      if (r.ok) r.fail('expected a JSON array');
      s.coverFromListing(['TW'], undefined);
      return;
    }
    const code = (row: Record<string, string>) => String(row['Code'] ?? '').trim();
    s.coverFromListing(['TW'], new Map(rows.map((row) => [code(row), `close ${row['ClosingPrice'] ?? '?'}`])));
    const date = rows[0]?.['Date'];
    if (date) s.note(`Trading date in the payload 資料日期: ${toIsoDate(date)} (raw "${date}")`);
    s.note(`${rows.length} securities in one reply; fields: ${Object.keys(rows[0] ?? {}).join(', ')}`);
    s.note('One trading day per reply, no history: N4 needs 3 years of weekly returns, so history comes from FinMind or builds up nightly.');
    const ours = rows.filter((row) => tickersIn('TW').some((ticker) => ticker.id === code(row)));
    s.preview('Rows for our Taiwan tickers 本專案的台股標的', jsonPreview(ours, 10), 'json');
  },
};

interface FinMindReply {
  msg?: string;
  status?: number;
  data?: Json[];
}

/** FinMind explains refusals (e.g. HTTP 402 when the quota is used up) in the JSON body's `msg`. */
function finmindRows(r: Fetched): Json[] | undefined {
  if (!r.ok) {
    const reason = parseJson<FinMindReply>(r.text())?.msg;
    if (reason) r.fail(`FinMind: ${reason}`);
    return undefined;
  }
  const reply = r.json<FinMindReply>();
  if (!reply) return undefined;
  if (!Array.isArray(reply.data)) {
    r.fail(`FinMind: ${reply.msg ?? 'no data array'}`);
    return undefined;
  }
  return reply.data;
}

const finmind: Probe = {
  id: 'finmind',
  name: 'FinMind',
  short: 'FinMind',
  row: 'Taiwan prices and financials; US prices (backup) 台股價格與財報；美股價格備援',
  usedBy: 'F12, N1, N3, F18; backup for US prices',
  documentedLimit: '600 requests/hour with a token (PRD §6); 300/hour without (FinMind docs); HTTP 402 when used up',
  coverageMarkets: ['TW', 'US', 'UK'],
  auth: (env) => (env.FINMIND_TOKEN ? 'FINMIND_TOKEN (Authorization: Bearer)' : 'none: anonymous quota 未用金鑰'),
  async run(s, env) {
    const headers = env.FINMIND_TOKEN ? { Authorization: `Bearer ${env.FINMIND_TOKEN}` } : undefined;
    const options = { headers, minGapMs: 300 };
    const data = (params: Record<string, string>) => `https://api.finmindtrade.com/api/v4/data?${new URLSearchParams(params)}`;
    const since = isoDaysAgo(14);

    if (env.FINMIND_TOKEN) {
      // The reply also identifies the account, so only the two quota numbers are kept.
      const quota = await s.get('Quota for this token (user_info)', 'https://api.web.finmindtrade.com/v2/user_info', { headers, keepSample: false });
      const info = quota.json<{ user_count?: number; api_request_limit?: number }>();
      if (info?.api_request_limit !== undefined) s.observe(`user_info: ${info.user_count ?? '?'} of ${info.api_request_limit} requests used 已用／上限`);
      else if (quota.ok) quota.fail('no api_request_limit in reply');
    } else {
      s.skip('Quota check (user_info) needs FINMIND_TOKEN 需要 FINMIND_TOKEN');
    }

    const twList = finmindRows(await s.get('Taiwan securities list (TaiwanStockInfo)', data({ dataset: 'TaiwanStockInfo' }), options));
    const twDetail = (row: Json) => [row['type'], row['industry_category']].filter(Boolean).join(' · ');
    s.coverFromListing(['TW'], twList && new Map(twList.map((row) => [String(row['stock_id']), twDetail(row)])));
    if (twList) s.note(`TaiwanStockInfo: ${twList.length} rows`);

    const twPrices = finmindRows(
      await s.get('Taiwan daily prices for 00922 (TaiwanStockPrice)', data({ dataset: 'TaiwanStockPrice', data_id: '00922', start_date: since }), options),
    );
    if (twPrices) {
      s.preview(`TaiwanStockPrice 00922 since ${since}: ${twPrices.length} rows, latest ${String(twPrices.at(-1)?.['date'] ?? '—')}`, jsonPreview(twPrices.slice(-2)), 'json');
    }

    const statements = finmindRows(
      await s.get(
        'Taiwan income statements for 2330 (TaiwanStockFinancialStatements)',
        data({ dataset: 'TaiwanStockFinancialStatements', data_id: '2330', start_date: isoDaysAgo(400) }),
        options,
      ),
    );
    if (statements) {
      const quarters = [...new Set(statements.map((row) => String(row['date'])))];
      s.preview(`TaiwanStockFinancialStatements 2330: ${statements.length} rows for quarters ${quarters.join(', ')}`, jsonPreview(statements.slice(0, 3), 3), 'json');
    }

    const usList = finmindRows(await s.get('US securities list (USStockInfo)', data({ dataset: 'USStockInfo' }), options));
    s.coverFromListing(['US', 'UK'], usList && new Map(usList.map((row) => [String(row['stock_id']), String(row['stock_name'] ?? '')])));
    if (usList) s.note(`USStockInfo: ${usList.length} rows`);

    const usPrices = finmindRows(await s.get('US daily prices for VT (USStockPrice)', data({ dataset: 'USStockPrice', data_id: 'VT', start_date: since }), options));
    if (usPrices) {
      s.preview(`USStockPrice VT since ${since}: ${usPrices.length} rows, latest ${String(usPrices.at(-1)?.['date'] ?? '—')}`, jsonPreview(usPrices.slice(-2)), 'json');
    }
  },
};

const mops: Probe = {
  id: 'mops',
  name: 'MOPS 公開資訊觀測站',
  short: 'MOPS',
  row: 'Taiwan filings and material information 台股財報與重大訊息',
  usedBy: 'F12, N3',
  documentedLimit: 'No published limit; no key 未公布限制，免金鑰',
  coverageMarkets: ['TW'],
  coverageKinds: ['stock'],
  auth: () => 'none 免金鑰',
  async run(s) {
    const site = await s.get('MOPS website (reachability)', 'https://mops.twse.com.tw/mops/');
    if (site.ok) s.note(`MOPS website answered; page title: ${/<title>([^<]*)<\/title>/i.exec(site.text())?.[1]?.trim() || '(none)'}`);

    // MOPS publishes no documented API; TWSE OpenAPI serves its company profiles and daily material information.
    const registry = await s.get('Listed-company profiles from MOPS, via TWSE OpenAPI (t187ap03_L)', 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L');
    const companies = registry.json<Array<Record<string, string>>>();
    if (Array.isArray(companies)) {
      const codeKey = Object.keys(companies[0] ?? {}).find((key) => /代號|code/i.test(key));
      const codes = new Map(companies.map((row): [string, string] => [String(codeKey ? row[codeKey] : '').trim(), 'company profile 公司基本資料']));
      s.coverFromListing(['TW'], codes);
      s.note(`t187ap03_L: ${companies.length} companies; code field "${codeKey ?? 'not found'}"`);
    } else {
      if (registry.ok) registry.fail('expected a JSON array');
      s.coverFromListing(['TW'], undefined);
    }

    const news = await s.get('Material information in the latest batch, via TWSE OpenAPI (t187ap04_L)', 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L');
    const items = news.json<Json[]>();
    if (Array.isArray(items)) s.preview(`t187ap04_L: ${items.length} announcements`, jsonPreview(items), 'json');
    else if (news.ok) news.fail('expected a JSON array');
  },
};

interface SecTable {
  fields?: string[];
  data?: unknown[][];
}

const sec: Probe = {
  id: 'sec',
  name: 'SEC EDGAR',
  short: 'SEC',
  row: 'US filings 美股財報與 8-K',
  usedBy: 'F12, N3',
  documentedLimit: 'At most 10 requests/second; a User-Agent with contact details is required (SEC fair-access policy) 每秒最多 10 次，需註明聯絡方式',
  coverageMarkets: ['US'],
  coverageKinds: ['stock'],
  auth: (env) => (env.SEC_USER_AGENT ? 'SEC_USER_AGENT (declared contact)' : 'SEC_USER_AGENT not set 未設定'),
  async run(s, env) {
    if (!env.SEC_USER_AGENT) {
      s.skip('SEC asks every client to declare a contact: set SEC_USER_AGENT in .env.local, e.g. "LongViewInvest your-email@example.com". SEC 要求註明聯絡 email。');
      return;
    }
    const options = { headers: { 'User-Agent': env.SEC_USER_AGENT }, minGapMs: 150 };

    const tickers = await s.get('Company tickers with exchange (company_tickers_exchange.json)', 'https://www.sec.gov/files/company_tickers_exchange.json', options);
    const table = tickers.json<SecTable>();
    if (table?.fields && Array.isArray(table.data)) {
      const at = (name: string) => table.fields?.indexOf(name) ?? -1;
      const [cik, ticker, exchange] = [at('cik'), at('ticker'), at('exchange')];
      s.coverFromListing(['US'], new Map(table.data.map((row) => [String(row[ticker]), `CIK ${String(row[cik])} · ${String(row[exchange] ?? '')}`])));
      s.note(`company_tickers_exchange.json: ${table.data.length} tickers; fields ${table.fields.join(', ')}`);
    } else {
      if (tickers.ok) tickers.fail('expected {"fields": [...], "data": [...]}');
      s.coverFromListing(['US'], undefined);
    }

    const filings = await s.get('Recent filings for Apple, CIK 320193 (submissions API)', 'https://data.sec.gov/submissions/CIK0000320193.json', options);
    const recent = filings.json<{ filings?: { recent?: { form?: string[]; filingDate?: string[] } } }>()?.filings?.recent;
    if (recent?.form && recent.filingDate) {
      const dates = recent.filingDate;
      s.preview('Ten most recent filings 最近十筆申報', recent.form.slice(0, 10).map((form, i) => `${dates[i] ?? '?'}  ${form}`).join('\n'));
      const report = recent.form.findIndex((form) => form === '10-Q' || form === '10-K');
      if (report >= 0) s.note(`Latest 10-Q/10-K: ${recent.form[report]} filed ${dates[report] ?? '?'} (the F12 re-run trigger)`);
    } else if (filings.ok) {
      filings.fail('no filings.recent in reply');
    }
  },
};

type AlphaVantageReply = Json & { Information?: string; Note?: string; 'Error Message'?: string };

/** Alpha Vantage answers HTTP 200 even when it refuses; the reason sits in one of these keys. */
function alphaVantageRefusal(reply: AlphaVantageReply | undefined): string | undefined {
  return reply?.['Error Message'] ?? reply?.Information ?? reply?.Note;
}

/** A used-up quota (whose message also mentions "premium plans") says nothing about which symbols are served. */
function isQuotaRefusal(error: string | undefined): boolean {
  return /rate limit|requests per day|call frequency|sparingly/i.test(error ?? '');
}

function alphaVantageSeries(r: Fetched): { latest: string; weeks: number; reply: AlphaVantageReply } | undefined {
  const reply = r.json<AlphaVantageReply>();
  if (!reply) return undefined;
  const refusal = alphaVantageRefusal(reply);
  if (refusal) {
    r.fail(`Alpha Vantage: ${refusal}`);
    return undefined;
  }
  const seriesKey = Object.keys(reply).find((key) => /time series/i.test(key));
  const dates = seriesKey ? Object.keys(reply[seriesKey] as Json).sort() : [];
  if (dates.length === 0) {
    r.fail('no time series in reply');
    return undefined;
  }
  return { latest: dates.at(-1) ?? '?', weeks: dates.length, reply };
}

const alphaVantage: Probe = {
  id: 'alphavantage',
  name: 'Alpha Vantage',
  short: 'Alpha Vantage',
  row: 'US stock, ETF and index prices (primary) 美股、ETF 與指數價格（主要來源）',
  usedBy: 'All',
  documentedLimit: '25 requests/day on a free key (PRD §6); also commonly cited as 5/minute',
  coverageMarkets: ['US', 'UK'],
  auth: (env) => (env.ALPHAVANTAGE_API_KEY ? 'ALPHAVANTAGE_API_KEY' : 'public demo key: sample symbols only 公開 demo 金鑰，只限範例代號'),
  async run(s, env) {
    const key = env.ALPHAVANTAGE_API_KEY ?? 'demo';
    let used = 0;
    const query = (label: string, params: Record<string, string>, ext?: string) => {
      used++;
      return s.get(label, `https://www.alphavantage.co/query?${new URLSearchParams({ ...params, apikey: key })}`, { minGapMs: 2000, ext });
    };

    // LISTING_STATUS answers CSV; a JSON body is a refusal.
    const list = await query('Active US listings (LISTING_STATUS, CSV)', { function: 'LISTING_STATUS' }, 'csv');
    let listing: Map<string, string> | undefined;
    if (list.ok && list.text().trimStart().startsWith('{')) {
      list.fail(`Alpha Vantage: ${alphaVantageRefusal(parseJson<AlphaVantageReply>(list.text())) ?? 'JSON instead of CSV'}`);
    } else if (list.ok) {
      const [header = [], ...rows] = parseCsv(list.text()).filter((row) => row.length > 1);
      const [symbol, exchange, assetType] = ['symbol', 'exchange', 'assetType'].map((name) => header.indexOf(name));
      listing = new Map(rows.map((row) => [row[symbol ?? 0] ?? '', [row[exchange ?? 0], row[assetType ?? 0]].filter(Boolean).join(' ')]));
      s.note(`LISTING_STATUS: ${rows.length} active US listings; columns ${header.join(', ')}`);
    }
    s.coverFromListing(['US'], listing, (ticker) => symbolFor(ticker, 'alphaVantage'));

    const sample = env.ALPHAVANTAGE_API_KEY ? 'VT' : 'IBM';
    const weekly = await query(`Weekly adjusted prices for ${sample} (TIME_SERIES_WEEKLY_ADJUSTED)`, { function: 'TIME_SERIES_WEEKLY_ADJUSTED', symbol: sample });
    const series = alphaVantageSeries(weekly);
    if (series) s.preview(`TIME_SERIES_WEEKLY_ADJUSTED ${sample}: ${series.weeks} weeks, latest ${series.latest}`, jsonPreview(series.reply, 2, 4), 'json');
    // If adjusted series turn out to be premium, test AGGU with the plain weekly series instead.
    const weeklyFunction = /premium/i.test(weekly.call.error ?? '') ? 'TIME_SERIES_WEEKLY' : 'TIME_SERIES_WEEKLY_ADJUSTED';

    if (!env.ALPHAVANTAGE_API_KEY) {
      s.skip('AGGU.LON needs ALPHAVANTAGE_API_KEY: the demo key serves only sample symbols such as IBM 需要 ALPHAVANTAGE_API_KEY');
      s.cover('AGGU', 'skipped');
    } else {
      const search = await query('Symbol search "AGGU" (SYMBOL_SEARCH)', { function: 'SYMBOL_SEARCH', keywords: 'AGGU' });
      const found = search.json<AlphaVantageReply & { bestMatches?: Array<Record<string, string>> }>();
      const refusal = alphaVantageRefusal(found);
      if (refusal) search.fail(`Alpha Vantage: ${refusal}`);
      else if (found?.bestMatches) {
        const matches = found.bestMatches.map((m) => `${m['1. symbol']} (${m['4. region']}, ${m['8. currency']})`);
        s.note(`SYMBOL_SEARCH AGGU → ${matches.join('; ') || 'no matches'}`);
      }

      const aggu = await query(`${weeklyFunction} for AGGU.LON`, { function: weeklyFunction, symbol: symbolFor(tickerById('AGGU'), 'alphaVantage') });
      const agguSeries = alphaVantageSeries(aggu);
      if (agguSeries) s.cover('AGGU', 'yes', `AGGU.LON ${agguSeries.weeks} weeks, latest ${agguSeries.latest}`);
      else s.cover('AGGU', aggu.call.status === null || isQuotaRefusal(aggu.call.error) ? 'failed' : 'no', aggu.call.error);
    }
    s.observe(
      env.ALPHAVANTAGE_API_KEY
        ? `Requests used this run 本次用量: ${used} of the 25/day free quota`
        : `${used} requests with the public demo key; none of your own quota used 使用公開 demo 金鑰，未消耗你的額度`,
    );
  },
};

const fmp: Probe = {
  id: 'fmp',
  name: 'Financial Modeling Prep (FMP)',
  short: 'FMP',
  row: 'Optional price source from the §6 free-tier note; tested only for AGGU 選用來源，只測 AGGU',
  usedBy: 'AGGU candidate',
  documentedLimit: '250 requests/day on the free plan (PRD §6)',
  coverageMarkets: ['UK'],
  auth: (env) => (env.FMP_API_KEY ? 'FMP_API_KEY' : 'FMP_API_KEY not set 未設定'),
  async run(s, env) {
    const key = env.FMP_API_KEY;
    if (!key) {
      s.skip('FMP_API_KEY not set: optional, only needed if Alpha Vantage cannot price AGGU 選用金鑰');
      return;
    }
    const stable = (path: string, params: Record<string, string>) => `https://financialmodelingprep.com/stable/${path}?${new URLSearchParams({ ...params, apikey: key })}`;

    const search = await s.get('Symbol search "AGGU" (search-symbol)', stable('search-symbol', { query: 'AGGU' }));
    const matches = search.json<Json[]>();
    if (Array.isArray(matches)) {
      const shown = matches.map((m) => `${String(m['symbol'])} (${String(m['exchange'] ?? m['exchangeFullName'] ?? '?')}, ${String(m['currency'] ?? '?')})`);
      s.note(`search-symbol AGGU → ${shown.join('; ') || 'no matches'}`);
    }

    const quote = await s.get('Quote for AGGU.L (quote)', stable('quote', { symbol: symbolFor(tickerById('AGGU'), 'fmp') }));
    const rows = quote.json<Json[]>();
    const first = Array.isArray(rows) ? rows[0] : undefined;
    if (first) s.cover('AGGU', 'yes', `AGGU.L price ${String(first['price'] ?? '?')} ${String(first['exchange'] ?? '')}`.trim());
    else s.cover('AGGU', quote.call.status === null ? 'failed' : 'no', [quote.call.error, truncate(quote.text(), 160)].filter(Boolean).join(': '));
  },
};

const fred: Probe = {
  id: 'fred',
  name: 'FRED (St. Louis Fed)',
  short: 'FRED',
  row: 'US rates, TWD/USD 美國利率與匯率',
  usedBy: 'F11, F18, N2',
  documentedLimit: 'API: 120 requests/minute per key (commonly cited); keyless CSV download: no published limit',
  auth: (env) => (env.FRED_API_KEY ? 'FRED_API_KEY (official API)' : 'none: keyless fredgraph.csv 免金鑰 CSV'),
  async run(s, env) {
    const wanted = [
      { id: 'DGS10', name: 'US 10-year Treasury yield 美國 10 年期公債殖利率', unit: '%' },
      { id: 'DEXTAUS', name: 'TWD per USD 新台幣兌美元', unit: 'TWD per USD' },
    ];
    for (const { id, name, unit } of wanted) {
      let latest: { date: string; value: string } | undefined;
      if (env.FRED_API_KEY) {
        const params = new URLSearchParams({ series_id: id, api_key: env.FRED_API_KEY, file_type: 'json', sort_order: 'desc', limit: '10' });
        const r = await s.get(`${id} latest observations (API)`, `https://api.stlouisfed.org/fred/series/observations?${params}`);
        const observations = r.json<{ observations?: Array<{ date: string; value: string }> }>()?.observations;
        latest = observations?.find((o) => o.value !== '.');
        if (observations) s.preview(`${id}, newest first`, jsonPreview(observations.slice(0, 3), 3), 'json');
        if (r.ok && !latest) r.fail('no observations in reply');
      } else {
        const r = await s.get(`${id} recent observations (keyless CSV)`, `https://fred.stlouisfed.org/graph/fredgraph.csv?${new URLSearchParams({ id, cosd: isoDaysAgo(45) })}`, {
          ext: 'csv',
        });
        if (r.ok) {
          const rows = parseCsv(r.text()).filter((row) => row.length >= 2);
          const last = rows.slice(1).filter(([, value]) => value && value !== '.').at(-1);
          if (last) latest = { date: last[0] ?? '', value: last[1] ?? '' };
          else r.fail('no values in the CSV');
          s.preview(`${id}, keyless CSV`, headTail(rows.map((row) => row.join(',')), 3, 3), 'csv');
        }
      }
      s.series({ name: `${name} (${id})`, latestDate: latest?.date, latestValue: latest?.value, unit });
    }
    s.note('DEXTAUS converts every USD-priced holding to TWD: VOO, VT, BNDW, GLDM, BIL, and AGGU, whose LSE line trades in USD.');
  },
};

const cbc: Probe = {
  id: 'cbc',
  name: 'Central Bank of the ROC 中央銀行 (data.gov.tw dataset 10840)',
  short: 'CBC',
  row: 'Taiwan 10-year government bond yield 台灣 10 年期公債殖利率',
  usedBy: 'F11',
  documentedLimit: 'Open-data file updated monthly; no published limit 每月更新的開放資料，未公布限制',
  auth: () => 'none 免金鑰',
  async run(s) {
    const meta = await s.get('Dataset 10840 資本市場利率: metadata (data.gov.tw API)', 'https://data.gov.tw/api/v2/rest/dataset/10840');
    const fallback = 'Fallback: CBC 金融統計月報 table 29 G 資本市場利率 (CSV), whose page URL changes every month.';
    if (!meta.ok) {
      s.note(fallback);
      return;
    }
    const csvLinks = findUrls(meta.text()).filter((url) => /csv/i.test(url) && !/data\.gov\.tw\/(?:api|dataset)/i.test(url));
    s.note(`CSV links in the metadata: ${csvLinks.join(' , ') || 'none'}`);
    const target = csvLinks[0];
    if (!target) {
      meta.fail('no CSV download link in the dataset metadata');
      s.note(fallback);
      return;
    }

    const csv = await s.get('Capital-market rates, monthly (CSV)', target, { ext: 'csv' });
    if (!csv.ok) return;
    const rows = parseCsv(csv.text()).filter((row) => row.some((value) => value.trim() !== ''));
    const isTenYear = (label: string) => /十年|10\s*年|10-?year/i.test(label);
    const headerAt = rows.findIndex((row) => row.some(isTenYear));
    const header = rows[headerAt];
    // The file also has "政府公債-10年期", which is only filled in months with an auction; the
    // secondary-market column ("十年期政府公債次級市場利率") is the market yield F11 needs.
    const secondary = header?.findIndex((label) => isTenYear(label) && label.includes('次級市場')) ?? -1;
    const column = secondary >= 0 ? secondary : (header?.findIndex(isTenYear) ?? -1);
    if (!header || column < 0) {
      csv.fail('no 10-year column found');
      s.preview('First rows', headTail(rows.map((row) => row.join(',')), 5, 2), 'csv');
      return;
    }
    const data = rows.slice(headerAt + 1).filter((row) => /\d/.test(row[column] ?? ''));
    const newest = data.reduce<string[] | undefined>(
      (best, row) => (!best || (row[0] ?? '').localeCompare(best[0] ?? '', undefined, { numeric: true }) > 0 ? row : best),
      undefined,
    );
    s.series({ name: `Taiwan 10-year government bond yield 台灣 10 年期公債殖利率 (${header[column]})`, latestDate: newest?.[0], latestValue: newest?.[column], unit: '%' });
    s.preview(`Header and last rows; 10-year column "${header[column]}"`, [header.join(','), ...data.slice(-3).map((row) => row.join(','))].join('\n'), 'csv');
  },
};

const shiller: Probe = {
  id: 'shiller',
  name: 'Robert Shiller online data (shillerdata.com)',
  short: 'Shiller',
  row: 'US CAPE 週期調整本益比',
  usedBy: 'F3',
  documentedLimit: 'Static spreadsheet; no published limit. Its link rotates, so it is read from the page each time 下載連結會變，每次從網頁讀取',
  auth: () => 'none 免金鑰',
  async run(s) {
    const pageUrl = 'https://shillerdata.com/';
    const page = await s.get('Data page (find the current ie_data.xls link)', pageUrl);
    if (!page.ok) return;
    const link = extractLinks(page.text(), pageUrl).find((url) => /ie_data\.xls/i.test(url));
    if (!link) {
      page.fail('no ie_data.xls link on the page');
      return;
    }
    s.note(`Current download link 目前下載連結: ${link}`);

    const file = await s.get('ie_data.xls: monthly S&P 500 price, dividends, earnings, CPI, CAPE', link, { ext: 'xls' });
    if (!file.ok) return;
    // A legacy .xls is binary; its text runs are enough to confirm the expected columns are there.
    const texts = printableStrings(file.bytes).map((text) => text.trim());
    const expected = ['Date', 'CPI', 'Earnings', 'Dividend', 'CAPE', 'TR CAPE', 'Excess CAPE Yield'];
    const found = expected.filter((label) => texts.some((text) => text.includes(label)));
    const hasCape = found.includes('CAPE');
    s.series({
      name: 'S&P 500 CAPE workbook (ie_data.xls)',
      latestDate: file.call.lastModified ? `file modified ${file.call.lastModified}` : undefined,
      latestValue: hasCape ? 'CAPE column present; values are parsed with F3 in Phase 2' : 'CAPE label not found',
    });
    const capeLabels = [...new Set(texts.filter((text) => /CAPE/.test(text) && text.length <= 80))].slice(0, 8);
    s.preview(
      `${sniff(file.bytes) === 'ole2' ? 'Legacy .xls (OLE2)' : 'Workbook'}: expected column labels found 找到的欄位標籤`,
      [`found: ${found.join(', ') || 'none'}`, `missing: ${expected.filter((label) => !found.includes(label)).join(', ') || 'none'}`, ...capeLabels].join('\n'),
    );
    if (!hasCape) file.fail('CAPE label not found in the workbook');
  },
};

const french: Probe = {
  id: 'french',
  name: 'Kenneth French Data Library',
  short: 'French',
  row: 'Factor returns 因子報酬',
  usedBy: 'N1',
  documentedLimit: 'Static zip files; no published limit 靜態檔案，未公布限制',
  auth: () => 'none 免金鑰',
  async run(s) {
    const r = await s.get(
      'Fama/French 5 factors (2x3), monthly, CSV in a zip',
      'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_CSV.zip',
      { ext: 'zip' },
    );
    if (!r.ok) return;
    if (sniff(r.bytes) !== 'zip') {
      r.fail('reply is not a zip file');
      return;
    }
    const entry = Object.entries(unzip(r.bytes, (name) => /\.csv$/i.test(name)))[0];
    if (!entry) {
      r.fail('no CSV inside the zip');
      return;
    }
    const lines = decodeText(entry[1]).split(/\r?\n/);
    const headerAt = lines.findIndex((line) => line.includes('Mkt-RF'));
    if (headerAt < 0) {
      r.fail('no Mkt-RF header in the CSV');
      return;
    }
    // Monthly rows ("202608,  1.23, ...") come first; the annual block follows them.
    const monthly: string[] = [];
    for (const line of lines.slice(headerAt + 1)) {
      if (/^\s*\d{6}\s*,/.test(line)) monthly.push(line.trim());
      else if (monthly.length > 0) break;
    }
    const last = monthly.at(-1)?.split(',').map((value) => value.trim());
    if (!last?.[0]) {
      r.fail('no monthly rows found');
      return;
    }
    const columns = (lines[headerAt] ?? '').split(',').map((value) => value.trim());
    s.series({
      name: 'Fama–French 5 factors, monthly 五因子（月）',
      latestDate: `${last[0].slice(0, 4)}-${last[0].slice(4)}`,
      latestValue: columns.slice(1).map((column, i) => `${column} ${last[i + 1] ?? '?'}`).join(', '),
      unit: '% per month',
    });
    s.preview(`${entry[0]}: ${monthly.length} monthly rows`, [lines[headerAt] ?? '', ...monthly.slice(0, 2), '…', ...monthly.slice(-2)].join('\n'), 'csv');
  },
};

const damodaran: Probe = {
  id: 'damodaran',
  name: 'Damodaran Online',
  short: 'Damodaran',
  row: 'Equity risk premium 股票風險溢酬',
  usedBy: 'F11',
  documentedLimit: 'Static pages; implied ERP updated monthly (PRD F11); no published limit',
  auth: () => 'none 免金鑰',
  async run(s) {
    // The site root is a frameset around this page.
    const pageUrl = 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/home.htm';
    const page = await s.get('Home page with the current implied ERP (New_Home_Page/home.htm)', pageUrl);
    if (!page.ok) return;
    const text = htmlToText(page.text());
    const match = /Implied ERP (?:on|for) ([A-Z][a-z]+\.? \d{1,2},? \d{4})\s*(?:=|:|is)\s*(\d+(?:\.\d+)?)\s*%/i.exec(text);
    if (!match) {
      page.fail('no "Implied ERP on <date> = x%" line found');
      return;
    }
    s.series({ name: 'S&P 500 implied ERP (Damodaran, trailing 12 m, adjusted payout) 隱含股票風險溢酬', latestDate: match[1], latestValue: `${match[2]}%` });
    s.preview('Text around the ERP line', truncate(text.slice(Math.max(0, match.index - 60), match.index + 420), 520));
    const files = extractLinks(page.text(), pageUrl).filter((url) => /implpr|histimpl|ERP/i.test(url));
    if (files.length > 0) s.note(`ERP files linked 相關檔案: ${files.slice(0, 6).join(' , ')}`);
  },
};

function safeDecodeUri(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

const twseGovernance: Probe = {
  id: 'twse_cg',
  name: 'TWSE corporate governance evaluation 公司治理評鑑',
  short: 'TWSE CG',
  row: 'Governance rating 公司治理評鑑',
  usedBy: 'N3',
  documentedLimit: 'Published once a year; no published limit 每年公布一次',
  coverageMarkets: ['TW'],
  coverageKinds: ['stock'],
  auth: () => 'none 免金鑰',
  async run(s) {
    const pageUrl = 'https://cgc.twse.com.tw/evaluationCorp/listCh';
    const page = await s.get('Latest evaluation results page', pageUrl);
    if (!page.ok) return;
    const html = page.text();
    const text = htmlToText(html);
    // The site's firewall answers HTTP 200 with a short refusal page instead of the results.
    if (/FOR SECURITY REASONS, THIS PAGE CAN ?NOT BE ACCESSED|因為安全性考量/i.test(text)) {
      page.fail('security block page instead of the results: the site firewall refused this request 網站防火牆擋下這次請求');
      s.note('If this persists, governance tiers need another route before N3 (Phase 2): re-run later or from your own connection, or download the yearly results file by hand.');
      s.preview('Block page text 阻擋頁文字', truncate(text, 800));
      return;
    }
    const edition = /第\s*\d+\s*屆[^\n]{0,40}/.exec(text)?.[0];
    if (edition) s.note(`Edition on the page 屆別: ${edition.trim()}`);
    const files = extractLinks(html, pageUrl).filter((url) => /\.(?:pdf|xlsx?|csv|ods)(?:\?|$)/i.test(safeDecodeUri(url)));
    s.note(`Downloadable files 可下載檔案: ${files.length > 0 ? files.slice(0, 8).join(' , ') : 'none in the HTML'}`);
    // The tier lists usually sit in a linked PDF, so absence from the page text proves nothing.
    for (const ticker of tickersIn('TW').filter((t) => t.kind === 'stock')) {
      const listed = new RegExp(`(^|\\D)${ticker.id}(\\D|$)`).test(text);
      s.cover(ticker.id, listed ? 'yes' : 'unchecked', listed ? 'on the results page' : 'tier lists are in the linked results PDF; read with N3 in Phase 2');
    }
    s.preview('Page text (start) 頁面文字', truncate(text, 800));
  },
};

const echo: Probe = {
  id: 'echo',
  name: 'EPA ECHO',
  short: 'EPA ECHO',
  row: 'US environmental penalties 美國環境裁罰',
  usedBy: 'N3',
  documentedLimit: 'No published limit; EPA may throttle heavy use 未公布限制',
  coverageMarkets: ['US'],
  coverageKinds: ['stock'],
  auth: () => 'none 免金鑰',
  async run(s) {
    const params = new URLSearchParams({ output: 'JSON', p_fn: 'APPLE' });
    const r = await s.get('Facility search by name "APPLE" (get_facilities)', `https://echodata.epa.gov/echo/echo_rest_services.get_facilities?${params}`);
    const results = r.json<{ Results?: Json }>()?.Results;
    if (!results) {
      if (r.ok) r.fail('no Results object in reply');
      s.cover('AAPL', 'failed');
      return;
    }
    const rows = results['QueryRows'];
    s.note(`Facilities matching "APPLE": ${String(rows ?? '?')}; rows are paged with get_qid (QueryID ${String(results['QueryID'] ?? '?')})`);
    s.cover('AAPL', Number(rows) > 0 ? 'yes' : 'no', 'matched by facility name, not ticker: N3 needs a company-to-facility map');
    s.preview('get_facilities reply', jsonPreview(results, 3, 10), 'json');
  },
};

const moenv: Probe = {
  id: 'moenv',
  name: 'Ministry of Environment open data 環境部 (ems_p_46)',
  short: 'MOENV',
  row: 'Taiwan environmental penalties 台灣環境裁罰',
  usedBy: 'N3',
  documentedLimit: 'Free member API key required; no limit stated in the docs found 需免費會員金鑰',
  coverageMarkets: ['TW'],
  coverageKinds: ['stock'],
  auth: (env) => (env.MOENV_API_KEY ? 'MOENV_API_KEY' : 'MOENV_API_KEY not set 未設定'),
  async run(s, env) {
    if (!env.MOENV_API_KEY) {
      s.skip('MOENV_API_KEY not set: register free at https://data.moenv.gov.tw/ 請到環境部資料開放平臺免費註冊');
      return;
    }
    const params = new URLSearchParams({ api_key: env.MOENV_API_KEY, format: 'JSON', limit: '5', offset: '0' });
    const r = await s.get('First five penalty records (ems_p_46)', `https://data.moenv.gov.tw/api/v2/ems_p_46?${params}`);
    // The v2 API now answers a bare array of records; older replies wrapped them as { fields, records, total }.
    const reply = r.json<Json[] | { records?: Json[]; fields?: Array<{ id?: string; info?: { label?: string } }>; total?: unknown }>();
    const wrapped = Array.isArray(reply) ? undefined : reply;
    const records = Array.isArray(reply) ? reply : reply?.records;
    if (!Array.isArray(records)) {
      if (r.ok) r.fail('no records in reply');
      return;
    }
    const fieldNames = wrapped?.fields?.map((field) => [field.id, field.info?.label].filter(Boolean).join(' ')) ?? Object.keys(records[0] ?? {});
    s.note(`${records.length} records in this reply${wrapped?.total === undefined ? '' : `, ${String(wrapped.total)} in total 總筆數`}; fields: ${fieldNames.join(', ')}`);
    // Records arrive in no particular order, so the date range shows how fresh the data is.
    const dates = records.map((record) => String(record['penalty_date'] ?? '')).filter(Boolean).sort();
    if (dates.length > 0) s.note(`Penalty dates in these records 裁處日期: ${dates[0]} to ${dates.at(-1)}`);
    const hasBusinessId = fieldNames.some((name) => /統一編號|統編|ban|uniform/i.test(name));
    s.note(
      hasBusinessId
        ? 'Records carry a business ID 統一編號, so they can be matched to listed companies.'
        : 'No business-ID 統一編號 field: matching to listed companies needs the company name 需以公司名稱比對.',
    );
    const matchBy = hasBusinessId ? 'business ID 統一編號' : 'company name 公司名稱';
    for (const ticker of tickersIn('TW').filter((t) => t.kind === 'stock')) {
      s.cover(ticker.id, 'unchecked', `records carry no ticker; N3 matches them by ${matchBy} in Phase 2`);
    }
    s.preview('First records in the reply 回傳的前幾筆', jsonPreview(records), 'json');
  },
};

/** BlackRock's document API, as the AGGU product page links it; used only if the page no longer shows the link. */
const ISHARES_FUND_DOWNLOAD =
  'https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v1/get-fund-document' +
  '?appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=ishares-uk&locale=en_GB&portfolioId=291772&component=fundDownloadV2&userType=individual';

async function checkIShares(s: SourceRun): Promise<void> {
  const productUrl = 'https://www.ishares.com/uk/individual/en/products/291772/ishares-core-global-aggregate-bond-ucits-etf';
  const page = await s.get('iShares AGGU product page (find the fund download link)', productUrl);
  const fromPage = page.ok ? extractLinks(page.text(), productUrl).find((url) => url.includes('get-fund-document') && url.includes('fundDownload')) : undefined;
  s.note(`Fund download link taken ${fromPage ? 'from the product page' : 'from the known BlackRock pattern'}`);

  // One SpreadsheetML workbook (about 25 MB) holds both the holdings and the daily NAV history.
  const file = await s.get('iShares AGGU fund download: holdings and NAV history (SpreadsheetML)', fromPage ?? ISHARES_FUND_DOWNLOAD, { ext: 'xml' });
  if (!file.ok) {
    s.cover('AGGU', 'failed', file.call.error);
    return;
  }
  const sheets = spreadsheetMlSheets(file.text());
  if (sheets.size === 0) {
    file.fail('no worksheets in the download');
    s.cover('AGGU', 'no', 'download has no worksheets');
    return;
  }
  s.note(`Worksheets 工作表: ${[...sheets.keys()].join(', ')}`);

  const holdingsRows = sheets.get('Holdings')?.length ?? 0;
  const count = sheets.get('Portfolio Characteristics')?.find((row) => row[0] === 'Number of Holdings');
  if (holdingsRows > 0) s.cover('AGGU', 'yes', `${count?.[1] ?? '?'} holdings ${count?.[2] ?? ''} (Holdings sheet, ${holdingsRows} rows)`.replace(/\s+\(/, ' ('));
  else s.cover('AGGU', 'no', 'no Holdings sheet in the download');

  const navs = (sheets.get('Historical NAVs') ?? [])
    .map(([date = '', nav = '']) => ({ date: dayMonthYearToIso(date), nav }))
    .filter((row): row is { date: string; nav: string } => row.date !== undefined && /^\d/.test(row.nav))
    .sort((a, b) => b.date.localeCompare(a.date));
  const newest = navs[0];
  if (!newest) {
    s.note('No Historical NAVs sheet in the download.');
    return;
  }
  s.series({ name: 'AGGU NAV per share (iShares) 每單位淨值', latestDate: newest.date, latestValue: newest.nav, unit: 'USD' });
  s.note(`Historical NAVs 歷史淨值: ${navs.length} daily values, ${navs.at(-1)?.date} to ${newest.date}`);
  s.preview('Historical NAVs, newest first', navs.slice(0, 3).map((row) => `${row.date}  ${row.nav}`).join('\n'));
}

async function checkSsga(s: SourceRun): Promise<void> {
  const r = await s.get('SSGA BIL daily holdings (xlsx)', 'https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-bil.xlsx', {
    ext: 'xlsx',
  });
  if (!r.ok) {
    s.cover('BIL', 'failed', r.call.error);
    return;
  }
  if (sniff(r.bytes) !== 'zip') {
    r.fail('reply is not an xlsx file');
    s.cover('BIL', 'no', 'reply is not an xlsx file');
    return;
  }
  const peek = xlsxPeek(r.bytes);
  const asOf = peek.strings.find((text) => /^as of\b/i.test(text));
  s.cover('BIL', peek.firstSheetRows > 0 ? 'yes' : 'no', `xlsx sheet "${peek.sheets[0] ?? '?'}", ${peek.firstSheetRows} rows${asOf ? `, ${asOf}` : ''}`);
  s.preview('BIL holdings workbook: first short text cells', peek.strings.join(' | '));
}

async function checkVanguard(s: SourceRun): Promise<void> {
  for (const [ticker, assetType] of [
    ['VT', 'stock'],
    ['VOO', 'stock'],
    ['BNDW', 'bond'],
  ] as const) {
    const r = await s.get(`Vanguard ${ticker} holdings (JSON, first page)`, `https://investor.vanguard.com/vmf/api/${ticker}/portfolio-holding/${assetType}.json`);
    const reply = r.json<{ fund?: { entity?: unknown[] } }>();
    const count = reply?.fund?.entity?.length ?? 0;
    if (count > 0) s.cover(ticker, 'yes', `${count} holdings on the first page`);
    else s.cover(ticker, r.call.status === null ? 'failed' : 'no', r.call.error ?? 'no holdings in reply');
    if (count > 0 && ticker === 'VT') s.preview('VT holdings JSON', jsonPreview(reply, 2, 8), 'json');
  }
  s.note('BNDW is a fund of two Vanguard bond ETFs (BND, BNDX), so its look-through may need their holdings too.');
}

async function checkCathay(s: SourceRun): Promise<void> {
  const r = await s.get('Cathay 00922 PCF page 申購買回清單 (HTML)', 'https://www.cathaysite.com.tw/ETF/purchase?code=DO');
  if (!r.ok) {
    s.cover('00922', 'failed', r.call.error);
    return;
  }
  const text = htmlToText(r.text());
  const listsHoldings = /(^|\D)2330(\D|$)/.test(text) || text.includes('台積電');
  s.cover('00922', listsHoldings ? 'yes' : 'no', listsHoldings ? 'PCF page lists constituents (HTML, not a file)' : 'no constituents in the HTML; the page may load them by script');
  s.preview('00922 PCF page text (start)', truncate(text, 600));
}

const issuers: Probe = {
  id: 'issuers',
  name: 'ETF issuer holdings files ETF 發行商持股檔',
  short: 'Issuer file',
  row: 'ETF holdings ETF 成分股',
  usedBy: 'F14',
  documentedLimit: 'Public website downloads; no published limits 官網公開下載，未公布限制',
  coverageMarkets: ['US', 'UK', 'TW'],
  coverageKinds: ['etf'],
  auth: () => 'none 免金鑰',
  async run(s) {
    await checkIShares(s);
    await checkSsga(s);
    await checkVanguard(s);
    s.cover('GLDM', 'na', 'holds physical gold; nothing to look through');
    await checkCathay(s);
    for (const id of ['00692', '009816']) s.cover(id, 'unchecked', 'no verified machine-readable issuer file yet 尚無已確認的官方檔案');
    for (const ticker of TICKERS.filter((t) => t.group === 'supporting')) s.cover(ticker.id, 'na');
  },
};

const botGold: Probe = {
  id: 'bot_gold',
  name: 'Bank of Taiwan gold price 臺灣銀行黃金牌價',
  short: 'BoT gold',
  row: 'Gold price in TWD 台幣金價',
  usedBy: 'N5, N4, N6',
  documentedLimit: 'Public web page; no published limit 公開網頁，未公布限制',
  coverageMarkets: ['unlisted'],
  auth: () => 'none 免金鑰',
  async run(s) {
    s.cover('MMF', 'na');
    s.cover('SAVINGS', 'na');
    const pageUrl = 'https://rate.bot.com.tw/gold/chart/ltm/TWD?Lang=zh-TW';
    const page = await s.get('Gold passbook prices, last 12 months, NT$ per gram (HTML)', pageUrl);
    if (!page.ok) {
      s.cover('GOLD', 'failed', page.call.error);
      return;
    }
    const html = page.text();
    if (/<title>\s*Challenge Validation/i.test(html) || html.includes('cp_clge_done')) {
      page.fail('bot challenge page instead of prices: the site asks for a browser to solve a challenge');
      s.cover('GOLD', 'failed', 'Bank of Taiwan answered with a bot challenge that only a real browser can pass 臺銀回傳機器人驗證頁');
      s.note('Physical gold needs another route before N5: a browser-based fetch, or the gold price in USD times TWD/USD.');
      return;
    }
    const table = htmlTableRows(html);
    const dated = table.filter((cells) => /^\d{4}\/\d{2}\/\d{2}$/.test(cells[0] ?? ''));
    const newest = dated.reduce<string[] | undefined>((best, row) => (!best || (row[0] ?? '') > (best[0] ?? '') ? row : best), undefined);
    if (newest) {
      // Label the two prices from the header row when its layout matches the data rows.
      const header = table.find((cells) => cells.some((c) => c.includes('買入')) && cells.some((c) => c.includes('賣出')));
      const labelled = header?.length === newest.length;
      const price = (cells: string[], index: number) => cells[index]?.replace(/,/g, '');
      const numbers = newest.slice(1).map((c) => c.replace(/,/g, '')).filter((c) => /^\d+(?:\.\d+)?$/.test(c));
      const value =
        labelled && header
          ? `buys ${price(newest, header.findIndex((c) => c.includes('買入')))} / sells ${price(newest, header.findIndex((c) => c.includes('賣出')))}`
          : numbers.join(' / ');
      s.series({ name: 'Gold passbook price 黃金存摺牌價 (Bank of Taiwan)', latestDate: newest[0], latestValue: value, unit: 'NT$ per gram' });
      s.cover('GOLD', 'yes', `${dated.length} daily rows, latest ${newest[0]}`);
      s.preview('Newest table rows 最新幾列', dated.slice(0, 3).map((row) => row.join(' | ')).join('\n'));
    } else {
      page.fail('no dated price rows in the HTML table');
      s.cover('GOLD', 'no', 'no price table in the HTML');
    }

    const csvLinks = extractLinks(html, pageUrl).filter((url) => /csv/i.test(url));
    if (csvLinks.length === 0) {
      s.note('No CSV link in the HTML.');
      return;
    }
    s.note(`CSV links on the page 頁面上的 CSV 連結: ${csvLinks.join(' , ')}`);
    const csv = await s.get('Same prices as CSV', csvLinks[0] ?? '', { ext: 'csv' });
    if (csv.ok) s.preview('CSV download (first lines)', headTail(csv.text().split(/\r?\n/), 5, 2), 'csv');
  },
};

const PROBES: readonly Probe[] = [twse, finmind, mops, sec, alphaVantage, fmp, fred, cbc, shiller, french, damodaran, twseGovernance, echo, moenv, issuers, botGold];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function readPrevious(path: string): SourceResult[] {
  if (!existsSync(path)) return [];
  const previous = parseJson<Partial<RunReport>>(readFileSync(path, 'utf8'));
  return previous?.schemaVersion === 1 && Array.isArray(previous.sources) ? previous.sources : [];
}

function idList(value: string | undefined): string[] {
  const ids = (value ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !PROBES.some((probe) => probe.id === id));
  if (unknown.length > 0) throw new Error(`Unknown source id: ${unknown.join(', ')}. Known: ${PROBES.map((probe) => probe.id).join(', ')}`);
  return ids;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { only: { type: 'string' }, skip: { type: 'string' }, out: { type: 'string' } } });
  const only = idList(values.only);
  const skip = idList(values.skip);
  const outDir = values.out ?? join('reports', 'source-check');

  const envFile = existsSync('.env.local');
  if (envFile) process.loadEnvFile('.env.local');
  if ((process.env['HTTPS_PROXY'] ?? process.env['https_proxy']) && !process.env['NODE_USE_ENV_PROXY']) {
    console.warn('HTTPS_PROXY is set, but Node fetch ignores it unless NODE_USE_ENV_PROXY=1 (Node 22.21+). If every request fails, re-run with NODE_USE_ENV_PROXY=1.');
  }
  const env = readEnv();
  const redact = makeRedactor(Object.values(env));
  const http = new Http({ userAgent: USER_AGENT, timeoutMs: 45_000, redact, minGapMs: 500 });
  const samples = new SampleStore(outDir, redact);
  const selected = PROBES.filter((probe) => (only.length === 0 || only.includes(probe.id)) && !skip.includes(probe.id));

  console.log(`Data source check: ${selected.length} sources, keys from ${envFile ? '.env.local' : 'the environment only (no .env.local)'}`);
  const fresh: SourceResult[] = [];
  for (const probe of selected) {
    process.stdout.write(`  ${probe.id.padEnd(13)}`);
    const run = new SourceRun(probe, env, http, samples);
    try {
      await probe.run(run, env);
    } catch (err) {
      run.note(`Probe stopped early (unexpected reply or script bug): ${describeError(err)}`);
    }
    const result = run.finish(redact);
    fresh.push(result);
    console.log(`${result.status.padEnd(8)} ${result.calls.filter((call) => call.ok).length}/${result.calls.length} requests ok`);
  }

  const jsonPath = join(outDir, 'report.json');
  const previous = readPrevious(jsonPath);
  const report: RunReport = {
    schemaVersion: 1,
    generatedAt: taipeiNow(),
    node: process.version,
    runner: process.env['GITHUB_ACTIONS'] === 'true' ? 'GitHub Actions' : 'local run 本機執行',
    keys: Object.fromEntries(KEY_NAMES.map((name) => [name, Boolean(env[name])])),
    sources: PROBES.flatMap((probe) => fresh.find((r) => r.id === probe.id) ?? previous.find((r) => r.id === probe.id) ?? []),
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, 'report.md'), renderReport(report));
  console.log(`\nReport: ${join(outDir, 'report.md')}`);

  if (fresh.length > 0 && fresh.every((result) => result.calls.every((call) => !call.ok))) {
    console.error('No request succeeded: check the network connection. 所有請求都失敗，請檢查網路連線。');
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  console.error(describeError(err));
  process.exitCode = 1;
}
