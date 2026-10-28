import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { quarterFigures } from '../../../lib/models/fundamentals.ts';
import { companyFactsUrl, secCiks, secFacts } from './sec.ts';
import { finmindStatements } from './statements.ts';
import { FeedError } from './types.ts';

const usd = (rows: Array<[string | null, string, number, string, string]>) => ({
  units: { USD: rows.map(([start, end, val, form, filed]) => ({ ...(start ? { start } : {}), end, val, form, filed, fy: 2026, fp: 'Q3' })) },
});

/** Apple-shaped company facts: a September year, quarters and years to date, restated comparatives. */
const FACTS = JSON.stringify({
  cik: 320193,
  entityName: 'Apple Inc.',
  facts: {
    'us-gaap': {
      NetIncomeLoss: usd([
        ['2024-09-29', '2025-09-27', 400, '10-K', '2025-10-31'],
        ['2024-09-29', '2025-06-28', 290, '10-Q', '2025-08-01'],
        ['2025-09-28', '2025-12-27', 120, '10-Q', '2026-01-30'],
        ['2025-09-28', '2026-03-28', 215, '10-Q', '2026-05-01'],
        ['2025-09-28', '2026-06-27', 310, '10-Q', '2026-07-31'],
        ['2024-09-29', '2024-12-28', 110, '10-Q', '2025-01-31'],
        ['2024-09-29', '2025-03-29', 200, '10-Q', '2025-05-02'],
        // An 8-K's figure does not count.
        ['2025-09-28', '2026-06-27', 999, '8-K', '2026-07-31'],
      ]),
      Revenues: usd([['2024-09-29', '2025-09-27', 2000, '10-K', '2025-10-31']]),
      RevenueFromContractWithCustomerExcludingAssessedTax: usd([['2024-09-29', '2025-09-27', 2100, '10-K', '2025-10-31']]),
      PaymentsToAcquirePropertyPlantAndEquipment: usd([['2024-09-29', '2025-09-27', 50, '10-K', '2025-10-31']]),
      StockholdersEquity: usd([
        [null, '2026-06-27', 1075, '10-Q', '2026-07-31'],
        [null, '2025-09-27', 737, '10-K', '2025-10-31'],
      ]),
      LongTermDebt: usd([[null, '2026-06-27', 823, '10-Q', '2026-07-31']]),
      LongTermDebtCurrent: usd([[null, '2026-06-27', 110, '10-Q', '2026-07-31']]),
      CommercialPaper: usd([[null, '2026-06-27', 20, '10-Q', '2026-07-31']]),
      WeightedAverageNumberOfDilutedSharesOutstanding: {
        units: {
          shares: [
            { start: '2025-09-28', end: '2026-06-27', val: 14750, form: '10-Q', filed: '2026-07-31' },
            { start: '2026-03-29', end: '2026-06-27', val: 14715, form: '10-Q', filed: '2026-07-31' },
          ],
        },
      },
      CommonStockDividendsPerShareDeclared: { units: { 'USD/shares': [{ start: '2026-03-29', end: '2026-06-27', val: 0.27, form: '10-Q', filed: '2026-07-31' }] } },
    },
  },
});

describe('SEC EDGAR company facts (F12)', () => {
  it('finds a CIK by ticker, a class share under a dot too', () => {
    const ciks = secCiks(JSON.stringify({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 1067983, ticker: 'BRK-B', title: 'Berkshire' } }));
    assert.equal(ciks.get('AAPL'), 320193);
    assert.equal(ciks.get('BRK.B'), 1067983);
    assert.equal(companyFactsUrl(320193), 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json');
    assert.throws(() => secCiks('<html>'), FeedError);
  });

  it("reads each figure from its preferred tag, debt summed, the quarter's diluted shares", () => {
    const { name, facts } = secFacts(FACTS);
    assert.equal(name, 'Apple Inc.');
    const quarters = quarterFigures(facts);
    const june = quarters.find((quarter) => quarter.periodEnd === '2026-06-27');
    // 110 (the fourth quarter, 400 − 290) + 120 + 95 + 95; the 8-K's 999 is left out.
    assert.equal(june?.figures.netIncome, 420);
    assert.equal(june?.figures.debt, 843);
    assert.equal(june?.figures.shortDebt, 130);
    assert.equal(june?.figures.shares, 14715);
    assert.equal(june?.figures.equity, 1075);
    assert.equal(june?.filed, '2026-07-31');
    const year = quarters.find((quarter) => quarter.periodEnd === '2025-09-27');
    assert.equal(year?.figures.revenue, 2100);
    assert.equal(year?.figures.capex, 50);
  });

  it('refuses a filer without us-gaap facts', () => {
    assert.throws(() => secFacts(JSON.stringify({ entityName: 'ASML', facts: { 'ifrs-full': {} } })), /IFRS/);
  });
});

describe('FinMind Taiwan statements (F12)', () => {
  const line = (date: string, type: string, origin: string, value: number) => ({ date, stock_id: '2330', type, origin_name: origin, value });
  const quarters = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'];
  const income = quarters.flatMap((date, i) => [
    line(date, 'Revenue', '營業收入', 1000 + i * 100),
    line(date, 'EquityAttributableToOwnersOfParent', '淨利（淨損）歸屬於母公司業主', 400 + i * 10),
    line(date, 'EPS', '基本每股盈餘', (400 + i * 10) / 25),
    line(date, 'EPS_per', '基本每股盈餘', 1),
  ]);
  const balance = [
    line('2026-06-30', 'CurrentAssets', '流動資產合計', 4500),
    line('2026-06-30', 'CashAndCashEquivalents', '現金及約當現金', 3100),
    line('2026-06-30', 'BondsPayable', '應付公司債', 800),
    line('2026-06-30', 'ShortTermBorrowings', '短期借款', 50),
    line('2026-06-30', 'EquityAttributableToOwnersOfParent', '歸屬於母公司業主之權益合計', 6400),
  ];
  // Year to date, as filed in Taiwan.
  const ytd = { '2025-06-30': 600, '2025-09-30': 900, '2025-12-31': 1270, '2026-03-31': 350, '2026-06-30': 850 };
  const cash = Object.entries(ytd).flatMap(([date, value]) => [
    line(date, 'PropertyAndPlantAndEquipment', '取得不動產、廠房及設備', -value),
    line(date, 'Depreciation', '折舊費用', value / 2),
    line(date, 'AmortizationExpense', '攤銷費用', 4),
  ]);
  const dividends = [
    { date: '2025-09-16', stock_and_cache_dividend: 5, stock_or_cache_dividend: '息' },
    { date: '2025-12-11', stock_and_cache_dividend: 5, stock_or_cache_dividend: '息' },
    { date: '2026-03-17', stock_and_cache_dividend: 6, stock_or_cache_dividend: '息' },
    { date: '2026-06-11', stock_and_cache_dividend: 6, stock_or_cache_dividend: '息' },
    { date: '2026-06-20', stock_and_cache_dividend: 1, stock_or_cache_dividend: '權息' },
  ];

  it('chains the quarters, takes the cash flows from the year to date and the shares from net income over EPS', () => {
    const figures = quarterFigures(finmindStatements({ income, balance, cash, dividends })).find((quarter) => quarter.periodEnd === '2026-06-30')?.figures;
    assert.equal(figures?.revenue, 4600);
    assert.equal(figures?.netIncome, 1660);
    // 2025's 1,270 less its first half's 600, plus 2026's first half's 850.
    assert.equal(figures?.capex, 1520);
    // Depreciation the same way (635 − 300 + 425), plus amortisation, 4 for each year to date.
    assert.equal(figures?.da, 760 + 4);
    assert.equal(figures?.debt, 850);
    assert.equal(figures?.shortDebt, 50);
    assert.equal(figures?.shares, 25);
    assert.equal(figures?.dps, 22);
  });
});
