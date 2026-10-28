import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { latestQuarter, quarterFigures, quartersOf, trailingTwelve, workingCapital, yearBefore, type Fact } from './fundamentals';

describe('F12 fundamentals: twelve months from any span', () => {
  // A September fiscal year, as Apple's: a 10-K year, then 10-Q quarters and years to date.
  const spans = [
    { start: '2024-09-29', end: '2025-09-27', value: 400 },
    { start: '2024-09-29', end: '2025-06-28', value: 290 },
    { start: '2025-09-28', end: '2025-12-27', value: 120 },
    { start: '2025-09-28', end: '2026-03-28', value: 215 },
    { start: '2025-09-28', end: '2026-06-27', value: 310 },
    { start: '2024-09-29', end: '2024-12-28', value: 110 },
    { start: '2024-09-29', end: '2025-03-29', value: 200 },
  ];

  it('turns years to date into quarters, the year less nine months into the fourth', () => {
    const quarters = quartersOf(spans);
    assert.deepEqual(
      quarters.map((quarter) => [quarter.end, quarter.value]),
      [
        ['2024-12-28', 110],
        ['2025-03-29', 90],
        ['2025-06-28', 90],
        ['2025-09-27', 110],
        ['2025-12-27', 120],
        ['2026-03-28', 95],
        ['2026-06-27', 95],
      ],
    );
  });

  it('takes a reported year as it is, else chains four quarters back', () => {
    assert.equal(trailingTwelve(spans, '2025-09-27'), 400);
    // 110 (Q4) + 120 + 95 + 95.
    assert.equal(trailingTwelve(spans, '2026-06-27'), 420);
    assert.equal(trailingTwelve(spans, '2025-06-28'), undefined);
  });

  it('chains calendar quarters as FinMind dates them, and a Taiwan cash flow from the year to date', () => {
    const quarter = (end: string, start: string, value: number): Fact => ({ item: 'revenue', start, end, value });
    const cumulative = (end: string, value: number): Fact => ({ item: 'ocf', start: `${end.slice(0, 4)}-01-01`, end, value });
    const facts: Fact[] = [
      quarter('2025-09-30', '2025-07-01', 30),
      quarter('2025-12-31', '2025-10-01', 40),
      quarter('2026-03-31', '2026-01-01', 50),
      quarter('2026-06-30', '2026-04-01', 60),
      cumulative('2025-06-30', 45),
      cumulative('2025-09-30', 75),
      cumulative('2025-12-31', 100),
      cumulative('2026-03-31', 30),
      cumulative('2026-06-30', 55),
      { item: 'equity', start: null, end: '2026-06-30', value: 500 },
      { item: 'shares', start: null, end: '2026-06-30', value: 10 },
    ];
    const quarters = quarterFigures(facts);
    const june = quarters.find((row) => row.periodEnd === '2026-06-30');
    assert.equal(june?.figures.revenue, 180);
    // 2025's year (100) less its first half (45), plus 2026's first half (55).
    assert.equal(june?.figures.ocf, 110);
    assert.equal(quarters.find((row) => row.periodEnd === '2025-12-31')?.figures.ocf, 100);
    assert.equal(june?.figures.equity, 500);
    // No net income: nothing a valuation can start from.
    assert.equal(latestQuarter(quarters)?.periodEnd, undefined);
  });

  it('keeps the first report of a figure restated later, and notes the filing that first reported the quarter', () => {
    const facts: Fact[] = [
      { item: 'shares', start: null, end: '2026-06-27', value: 100, filed: '2026-07-31' },
      { item: 'shares', start: null, end: '2026-06-27', value: 400, filed: '2027-07-30' },
      { item: 'netIncome', start: '2025-06-29', end: '2026-06-27', value: 50, filed: '2026-07-31' },
    ];
    const [row] = quarterFigures(facts);
    assert.equal(row?.figures.shares, 100);
    assert.equal(row?.filed, '2026-07-31');
    assert.equal(latestQuarter(quarterFigures(facts))?.periodEnd, '2026-06-27');
  });

  it('measures working capital net of cash and short-term debt, and finds the quarter a year before', () => {
    assert.equal(workingCapital({ currentAssets: 300, cash: 100, currentLiabilities: 150, shortDebt: 20 }), 70);
    assert.equal(workingCapital({ currentAssets: 300 }), undefined);
    const quarters = [
      { periodEnd: '2025-06-28', figures: {}, filed: null },
      { periodEnd: '2025-09-27', figures: {}, filed: null },
      { periodEnd: '2026-06-27', figures: {}, filed: null },
    ];
    assert.equal(yearBefore(quarters, quarters[2] as (typeof quarters)[number])?.periodEnd, '2025-06-28');
  });
});
