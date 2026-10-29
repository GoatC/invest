/**
 * iShares daily NAV for London-listed funds the free price feeds do not cover. AGGU is the USD
 * Hedged (Acc) class: it accumulates its income, so its NAV is already a total-return series.
 */
import { dayMonthYearToIso, extractLinks, htmlToText, spreadsheetMlSheets } from '../payload.ts';
import { positive, type DailyPrice } from './types.ts';

export const SOURCE = 'ishares_nav';

/** Funds priced from iShares, by their ticker in the securities table. */
export const ISHARES_FUNDS: Record<string, { productPage: string; download: string }> = {
  AGGU: fund(291772, 'ishares-core-global-aggregate-bond-ucits-etf'),
  // The Irish-domiciled swaps the US estate-tax check suggests (F15), each in USD, accumulating.
  CSPX: fund(253743, 'ishares-sp-500-b-ucits-etf-acc-fund'),
  IB01: fund(307243, 'ishares-treasury-bond-0-1yr-ucits-etf'),
  // One fund, listed as IGLN in USD and SGLN in GBP; the product page and its NAVs are in USD.
  IGLN: fund(258441, 'ishares-physical-gold-etc-fund'),
};

function fund(portfolioId: number, slug: string): { productPage: string; download: string } {
  return {
    productPage: `https://www.ishares.com/uk/individual/en/products/${portfolioId}/${slug}`,
    // BlackRock's document API, as the product page links it; used when the page no longer shows the link.
    download:
      'https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v1/get-fund-document' +
      `?appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=ishares-uk&locale=en_GB&portfolioId=${portfolioId}&component=fundDownloadV2&userType=individual`,
  };
}

function nav(ticker: string, date: string | undefined, value: number | undefined): DailyPrice[] {
  return date && value ? [{ ticker, date, close: value, adjClose: value, source: SOURCE }] : [];
}

/**
 * The latest NAV the product page shows. First from the page's own data, in full precision
 * ("navAmount":{…"asOfDate":20261028,…"value":5.786162…}); else from its text, where the page
 * (since October 2026) runs the figure into the 52-week range: "NAV as of28/Oct/2026 USD 5.7952 WK".
 */
export function navFromProductPage(html: string, ticker: string): DailyPrice | undefined {
  const block = /"navAmount":\{([^{}]*)\}/.exec(html.replace(/&quot;/g, '"'))?.[1] ?? '';
  const day = /"asOfDate":(\d{4})(\d{2})(\d{2})\b/.exec(block);
  const amount = /"value":([\d.]+)/.exec(block)?.[1];
  const fromData = nav(ticker, day ? `${day[1]}-${day[2]}-${day[3]}` : undefined, positive(amount ?? ''))[0];
  if (fromData) return fromData;
  const match = /NAV as of\s*(\d{1,2}\/[A-Za-z]{3,5}\/\d{4})\s*[A-Z]{3}\s+([\d,]+(?:\.\d+?)?)(?=\s*52\s*WK|\s|$)/.exec(htmlToText(html));
  return nav(ticker, dayMonthYearToIso(match?.[1] ?? ''), positive((match?.[2] ?? '').replace(/,/g, '')))[0];
}

/** The fund download link on the product page, if it still shows one. */
export function downloadLink(html: string, pageUrl: string): string | undefined {
  return extractLinks(html, pageUrl).find((url) => url.includes('get-fund-document') && url.includes('fundDownload'));
}

/** How far a NAV may stray from a whole multiple of the one before and still count as a split or consolidation. */
const SPLIT_TOLERANCE = 0.03;

/** n when `ratio` is within the tolerance of a whole n ≥ 2, else undefined. */
function wholeMultiple(ratio: number): number | undefined {
  const n = Math.round(ratio);
  return n >= 2 && Math.abs(ratio - n) / n < SPLIT_TOLERANCE ? n : undefined;
}

/**
 * Adjusted NAVs in today's units: a fund's NAV never doubles or halves in a day, so a day on
 * which it moves to about n times the one before (or 1 / n) is a consolidation (or split) of its
 * shares, and the NAVs before it are scaled by that ratio. IB01 consolidated about 20 into 1 on
 * 2021-07-26 (5.15 to 102.11), and the download does not adjust for it. Quoted NAVs stay as they were.
 */
export function adjustForSplits(prices: readonly DailyPrice[]): DailyPrice[] {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const factors: number[] = new Array(sorted.length).fill(1);
  for (let i = sorted.length - 1, factor = 1; i >= 0; i--) {
    factors[i] = factor;
    const before = sorted[i - 1];
    const now = sorted[i];
    if (!before || !now) continue;
    const up = wholeMultiple(now.close / before.close);
    const down = wholeMultiple(before.close / now.close);
    if (up) factor *= up;
    else if (down) factor /= down;
  }
  return sorted.map((price, i) => {
    const factor = factors[i] ?? 1;
    return factor === 1 ? price : { ...price, adjClose: price.close * factor };
  });
}

/** Every daily NAV in the fund download's "Historical NAVs" sheet (a SpreadsheetML workbook, up to about 25 MB), oldest first. */
export function navHistory(xml: string, ticker: string): DailyPrice[] {
  const rows = spreadsheetMlSheets(xml).get('Historical NAVs') ?? [];
  return adjustForSplits(rows.flatMap(([date = '', value = '']) => nav(ticker, dayMonthYearToIso(date), positive(value.replace(/,/g, '')))));
}
