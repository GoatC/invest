/**
 * iShares daily NAV for London-listed funds the free price feeds do not cover. AGGU is the USD
 * Hedged (Acc) class: it accumulates its income, so its NAV is already a total-return series.
 */
import { dayMonthYearToIso, extractLinks, htmlToText, spreadsheetMlSheets } from '../payload.ts';
import { positive, type DailyPrice } from './types.ts';

export const SOURCE = 'ishares_nav';

/** Funds priced from iShares, by their ticker in the securities table. */
export const ISHARES_FUNDS: Record<string, { productPage: string; download: string }> = {
  AGGU: {
    productPage: 'https://www.ishares.com/uk/individual/en/products/291772/ishares-core-global-aggregate-bond-ucits-etf',
    // BlackRock's document API, as the product page links it; used when the page no longer shows the link.
    download:
      'https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v1/get-fund-document' +
      '?appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=ishares-uk&locale=en_GB&portfolioId=291772&component=fundDownloadV2&userType=individual',
  },
};

function nav(ticker: string, date: string | undefined, value: number | undefined): DailyPrice[] {
  return date && value ? [{ ticker, date, close: value, adjClose: value, source: SOURCE }] : [];
}

/** The latest NAV the product page shows: "NAV as of 20/Oct/2026 USD 5.77". */
export function navFromProductPage(html: string, ticker: string): DailyPrice | undefined {
  const match = /NAV as of (\d{1,2}\/[A-Za-z]{3,5}\/\d{4}) [A-Z]{3} ([\d.,]+)/.exec(htmlToText(html));
  return nav(ticker, dayMonthYearToIso(match?.[1] ?? ''), positive((match?.[2] ?? '').replace(/,/g, '')))[0];
}

/** The fund download link on the product page, if it still shows one. */
export function downloadLink(html: string, pageUrl: string): string | undefined {
  return extractLinks(html, pageUrl).find((url) => url.includes('get-fund-document') && url.includes('fundDownload'));
}

/** Every daily NAV in the fund download's "Historical NAVs" sheet (a SpreadsheetML workbook of about 25 MB). */
export function navHistory(xml: string, ticker: string): DailyPrice[] {
  const rows = spreadsheetMlSheets(xml).get('Historical NAVs') ?? [];
  return rows.flatMap(([date = '', value = '']) => nav(ticker, dayMonthYearToIso(date), positive(value.replace(/,/g, ''))));
}
