import type { Market, ProductType } from './models/types';

/**
 * A ticker the app does not know yet, looked up on the web as it is added (Liquid Glass proposal
 * G05, Hugo 2026-11-15: type the ticker and have its details brought in). Yahoo Finance's free
 * chart address, which needs no key, gives the kind of security, its currency and its name: a US
 * ticker as it is, a Taiwan one with ".TW" (".TWO" on the OTC market), a London one with ".L". A
 * Taiwan name comes in Chinese from TWSE's list of the day's trading, the nightly job's own source.
 * Hugo still checks every field and picks the class: a theme ETF cannot be told from its name.
 */
export interface LookedUp {
  name: string;
  market: Market;
  productType: ProductType;
  currency: string;
  domicile: string;
}

export const TWSE_DAY_ALL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';

export function chartUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
}

/** Where to look, in order: Taiwan's two markets for a code of digits, else the US and then London. */
export function lookupSymbols(ticker: string): Array<{ symbol: string; market: Market }> {
  const code = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(code)) return [];
  if (/^\d{4,6}[A-Z]?$/.test(code)) {
    return [
      { symbol: `${code}.TW`, market: 'TW' },
      { symbol: `${code}.TWO`, market: 'TW' },
    ];
  }
  return [
    { symbol: code, market: 'US' },
    { symbol: `${code}.L`, market: 'UK' },
  ];
}

/** The app's product type from Yahoo's kind of instrument and the fund's English name; null for a kind the app does not hold. */
export function productTypeOf(kind: string, name: string): ProductType | null {
  if (kind === 'EQUITY') return 'stock';
  if (kind !== 'ETF') return null;
  if (/gold/i.test(name)) return 'gold';
  if (/t-?bill|money market|[01]-3 month/i.test(name)) return 'cash_mmf';
  if (/bond|aggregate|treasur/i.test(name)) return 'bond_etf';
  return 'equity_etf';
}

/** The chart reply as a security; null when Yahoo knows no such ticker or it is not a kind the app holds. */
export function fromChart(json: unknown, market: Market, chineseName?: string): LookedUp | null {
  const meta = (json as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> | null } } | null)?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const english = String(meta['longName'] ?? meta['shortName'] ?? '').trim();
  const productType = productTypeOf(String(meta['instrumentType'] ?? ''), english);
  const quoted = String(meta['currency'] ?? '');
  // London quotes some funds in pence.
  const currency = quoted === 'GBp' ? 'GBP' : quoted.toUpperCase();
  const name = chineseName?.trim() || english;
  if (!name || !productType || !/^[A-Z]{3}$/.test(currency)) return null;
  // A London fund sold across Europe (UCITS) is almost always domiciled in Ireland, as AGGU is.
  const domicile = market === 'UK' ? (/ucits/i.test(english) ? 'IE' : 'GB') : market;
  return { name, market, productType, currency, domicile };
}

/** TWSE's list of the day's trading as code → Chinese name. */
export function twseNames(json: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(json)) return names;
  for (const row of json as Array<Record<string, unknown>>) {
    if (typeof row['Code'] === 'string' && typeof row['Name'] === 'string') names.set(row['Code'].trim(), row['Name'].trim());
  }
  return names;
}

export type GetJson = (url: string) => Promise<unknown>;

/** Yahoo answers a plain client and sends JSON even for a ticker it does not know; each reply is kept for a day. */
const getJson: GetJson = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(4000), next: { revalidate: 86_400 } } as RequestInit);
  return res.json();
};

/** The security behind `ticker`, from the first place that knows it; null when none does or the web cannot be reached. */
export async function lookupTicker(ticker: string, get: GetJson = getJson): Promise<LookedUp | null> {
  const code = ticker.trim().toUpperCase();
  for (const { symbol, market } of lookupSymbols(code)) {
    let chart: unknown;
    try {
      chart = await get(chartUrl(symbol));
    } catch {
      continue;
    }
    let chinese: string | undefined;
    if (market === 'TW') {
      try {
        chinese = twseNames(await get(TWSE_DAY_ALL)).get(code);
      } catch {
        chinese = undefined;
      }
    }
    const found = fromChart(chart, market, chinese);
    if (found) return found;
  }
  return null;
}
