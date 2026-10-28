import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as XLSX from 'xlsx';

import { FeedError } from './types.ts';
import { cbcTenYear, damodaranErp, fredTenYear, monthEnds, treasuryTenYear } from './yields.ts';

describe('10-year yields (F11)', () => {
  it("keeps each month's last day", () => {
    const points = monthEnds(
      [
        { date: '2026-09-29', value: 0.051 },
        { date: '2026-09-30', value: 0.0529 },
        { date: '2026-10-26', value: 0.05 },
        { date: '2026-10-23', value: 0.05 },
      ],
      'us_treasury_10y',
      'fred',
    );
    assert.deepEqual(points, [
      { series: 'us_treasury_10y', month: '2026-09', value: 0.0529, source: 'fred' },
      { series: 'us_treasury_10y', month: '2026-10', value: 0.05, source: 'fred' },
    ]);
  });

  it("reads FRED's DGS10 in percent, leaving out holidays", () => {
    const csv = 'observation_date,DGS10\n2026-09-30,5.29\n2026-10-12,.\n2026-10-26,5.00\n';
    assert.deepEqual(
      fredTenYear(csv).map((point) => [point.month, point.value, point.source]),
      [
        ['2026-09', 0.0529, 'fred'],
        ['2026-10', 0.05, 'fred'],
      ],
    );
  });

  it("reads the Treasury's yield curve by its 10 Yr column, newest row first", () => {
    const csv = 'Date,"1 Mo","3 Mo","10 Yr","30 Yr"\n10/27/2026,4.10,4.22,4.99,5.30\n10/26/2026,4.11,4.22,5.00,5.31\n09/30/2026,4.20,4.30,5.29,5.50\n';
    assert.deepEqual(
      treasuryTenYear(csv).map((point) => [point.month, point.value, point.source]),
      [
        ['2026-09', 0.0529, 'treasury'],
        ['2026-10', 0.0499, 'treasury'],
      ],
    );
    assert.throws(() => treasuryTenYear('Date,"1 Mo"\n10/27/2026,4.10\n'), FeedError);
  });

  it("reads the Central Bank's capital-market rates: 2026M08, its BOM, and \"-\" for months without a figure", () => {
    const csv =
      '﻿"月","政府公債-10年期(%)","公司債-1年期(%)","十年期政府公債次級市場利率(%)"\n' +
      '"2026M06","1.790","-","1.77460"\n' +
      '"2026M07","-","-","1.90030"\n' +
      '"2026M08","1.969","-","1.95500"\n' +
      '"2026M09","-","-","-"\n';
    assert.deepEqual(
      cbcTenYear(csv).map((point) => [point.series, point.month, point.value, point.source]),
      [
        ['tw_govt_10y', '2026-06', 0.017746, 'cbc'],
        ['tw_govt_10y', '2026-07', 0.019003, 'cbc'],
        ['tw_govt_10y', '2026-08', 0.01955, 'cbc'],
      ],
    );
    assert.throws(() => cbcTenYear('"月","政府公債-10年期(%)"\n"2026M08","1.969"\n'), FeedError);
  });
});

/** A workbook laid out as Damodaran's, dated in Excel's 1904 system as his are. */
function erpWorkbook(rows: unknown[][], sheet = 'Historical ERP'): Uint8Array {
  const book = XLSX.utils.book_new();
  book.Workbook = { WBProps: { date1904: true } };
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet);
  return new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
}

describe("Damodaran's implied ERP (F11)", () => {
  const HEADER = ['Start of month', 'S&P 500', 'T.Bond Rate', '$ Riskfree Rate', 'ERP (T12m with sustainable payout)', 'ERP (T12m)', 'Expected Return'];

  it("reads the trailing-12-month ERP by month, 44834 being 1 October 2026 in the 1904 system", () => {
    const bytes = erpWorkbook([HEADER, [44804, 7686.14, 0.0475, 0.0453, 0.0414, 0.0409, 0.0884], [44834, 7652, 0.0529, 0.0507, 0.042, 0.037, 0.0899], [], [null, 0.1487]]);
    assert.deepEqual(damodaranErp(bytes), [
      { series: 'us_implied_erp', month: '2026-09', value: 0.0409, source: 'damodaran' },
      { series: 'us_implied_erp', month: '2026-10', value: 0.037, source: 'damodaran' },
    ]);
  });

  it('says what is wrong with a workbook it cannot read', () => {
    assert.throws(() => damodaranErp(erpWorkbook([HEADER], 'Sheet1')), /no Historical ERP sheet/);
    assert.throws(() => damodaranErp(erpWorkbook([['Date', 'ERP']])), /no header row/);
  });
});
