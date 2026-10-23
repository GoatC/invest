import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as XLSX from 'xlsx';

import { multplMonthly, multplUrl } from './multpl.ts';
import { shillerLink, shillerMonth, shillerSeries } from './shiller.ts';
import { FeedError } from './types.ts';

/** A workbook laid out as Shiller's: notes above the header row, "1871.1" for October, NA before CAPE has ten years. */
function workbook(rows: unknown[][], sheet = 'Data'): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet);
  return new Uint8Array(XLSX.write(book, { bookType: 'xls', type: 'array' }) as ArrayBuffer);
}

const HEADER = ['Date', 'P', 'D', 'E', 'CPI', 'Fraction', 'Rate GS10', 'Price', 'Dividend', 'Price', 'Earnings', 'Earnings', 'CAPE'];

describe('Shiller', () => {
  it('finds the current workbook link on the data page', () => {
    const html = '<a href="/about">About</a> <a href="https://img1.wsimg.com/blobby/go/abc/downloads/ie_data.xls?ver=1760000000">Download</a>';
    assert.equal(shillerLink(html), 'https://img1.wsimg.com/blobby/go/abc/downloads/ie_data.xls?ver=1760000000');
    assert.equal(shillerLink('<a href="/x.pdf">x</a>'), undefined);
  });

  it('reads the month from its decimals: .01 is January, .1 October', () => {
    assert.equal(shillerMonth(1871.01), '1871-01');
    assert.equal(shillerMonth(1871.1), '1871-10');
    assert.equal(shillerMonth(2026.12), '2026-12');
    assert.equal(shillerMonth('Date'), undefined);
  });

  it('reads CAPE, the price and the dividend yield, by the header labels, leaving out NA', () => {
    const bytes = workbook([
      ['Stock Market Data Used in "Irrational Exuberance"'],
      [],
      HEADER,
      [1871.01, 4.44, 0.26, 0.4, 12.46, 1871.04, 5.32, 109.05, 6.39, 109.05, 9.82, 9.82, 'NA'],
      [1881.01, 6.19, 0.27, 0.48, 10.22, 1881.04, 3.7, 0, 0, 0, 0, 0, 18.47],
      [2026.1, 7766.95, 82.4, 230.1, 330.2, 2026.79, 4.1, 0, 0, 0, 0, 0, 40.81],
    ]);
    const points = shillerSeries(bytes);
    assert.deepEqual(
      points.filter((point) => point.series === 'us_cape').map((point) => [point.month, point.value]),
      [
        ['1881-01', 18.47],
        ['2026-10', 40.81],
      ],
    );
    const january = points.filter((point) => point.month === '1871-01');
    assert.deepEqual(
      january.map((point) => [point.series, Math.round(point.value * 1e4) / 1e4, point.source]),
      [
        ['sp500_price', 4.44, 'shiller'],
        ['sp500_yield', 0.0586, 'shiller'],
      ],
    );
  });

  it('says what is wrong with a workbook it cannot read', () => {
    assert.throws(() => shillerSeries(workbook([HEADER], 'Other')), (err: unknown) => err instanceof FeedError && /no Data sheet/.test(err.message));
    assert.throws(() => shillerSeries(workbook([['Date', 'P', 'D']])), (err: unknown) => err instanceof FeedError && /no header row/.test(err.message));
  });
});

describe('multpl', () => {
  const table = (rows: Array<[string, string]>) =>
    `<table id="datatable"><tr><th>Date</th><th>Value</th></tr>${rows.map(([date, value]) => `<tr class="odd"><td>${date}</td><td>\n&#x2002;\n${value}\n</td></tr>`).join('')}</table>`;

  it("keeps each month's own row, not today's, newest last", () => {
    const cape = multplMonthly(
      table([
        ['Oct 22, 2026', '40.58'],
        ['Oct 1, 2026', '40.81'],
        ['Sep 1, 2026', '40.42'],
      ]),
      'us_cape',
    );
    assert.deepEqual(
      cape.map((point) => [point.month, point.value, point.source]),
      [
        ['2026-09', 40.42, 'multpl'],
        ['2026-10', 40.81, 'multpl'],
      ],
    );
  });

  it('reads the dividend yield, dated at month ends, as a fraction, and prices with thousands separators', () => {
    const yields = multplMonthly(
      table([
        ['Oct 22, 2026', '<abbr>†</abbr>\n1.06%'],
        ['Oct 31, 2026', '<abbr>†</abbr>\n1.05%'],
        ['Feb 28, 1871', '5.78%'],
      ]),
      'sp500_yield',
    );
    assert.deepEqual(
      yields.map((point) => [point.month, point.value]),
      [
        ['1871-02', 0.0578],
        ['2026-10', 0.0105],
      ],
    );
    assert.equal(multplMonthly(table([['Oct 1, 2026', '7,766.95']]), 'sp500_price')[0]?.value, 7766.95);
    assert.equal(multplUrl('sp500_yield'), 'https://www.multpl.com/s-p-500-dividend-yield/table/by-month');
  });
});
