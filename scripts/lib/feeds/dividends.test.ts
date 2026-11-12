import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { avDividends, avDividendUrl, dividendsFromAdjusted, finmindDividends, nasdaqDividends, nasdaqDividendUrl } from './dividends.ts';
import { FeedError, type DailyPrice } from './types.ts';

describe('FinMind TaiwanStockDividend', () => {
  it('reads the cash a share with its ex-dividend and payment dates, earnings and surplus added', () => {
    // 0050's first distribution of 2025 as FinMind returned it on 2026-11-12, cut to the fields read.
    const rows = [
      { date: '2025-01-25', stock_id: '0050', CashEarningsDistribution: 2.7, CashStatutorySurplus: 0, CashExDividendTradingDate: '2025-01-17', CashDividendPaymentDate: '2025-02-20', StockEarningsDistribution: 0 },
      { date: '2026-06-10', stock_id: '2330', CashEarningsDistribution: 5.5, CashStatutorySurplus: 0.5, CashExDividendTradingDate: '2026-06-11', CashDividendPaymentDate: '2026-07-09' },
    ];
    assert.deepEqual(finmindDividends(rows, '0050'), [
      { ticker: '0050', exDate: '2025-01-17', payDate: '2025-02-20', amount: 2.7, currency: 'TWD', source: 'finmind' },
      { ticker: '0050', exDate: '2026-06-11', payDate: '2026-07-09', amount: 6, currency: 'TWD', source: 'finmind' },
    ]);
  });

  it('leaves out a stock-only distribution and one whose ex-dividend date is not set yet', () => {
    const rows = [
      { CashEarningsDistribution: 0, StockEarningsDistribution: 1, CashExDividendTradingDate: '', StockExDividendTradingDate: '2026-08-01' },
      { CashEarningsDistribution: 3, CashExDividendTradingDate: '', CashDividendPaymentDate: '' },
      { CashEarningsDistribution: 3, CashExDividendTradingDate: '2026-09-16', CashDividendPaymentDate: '' },
    ];
    assert.deepEqual(finmindDividends(rows, '2330'), [{ ticker: '2330', exDate: '2026-09-16', payDate: null, amount: 3, currency: 'TWD', source: 'finmind' }]);
  });
});

describe('Nasdaq dividend history', () => {
  it('asks by asset class and reads the dates and the amount', () => {
    assert.equal(nasdaqDividendUrl('AAPL', false), 'https://api.nasdaq.com/api/quote/AAPL/dividends?assetclass=stocks');
    assert.equal(nasdaqDividendUrl('BND', true), 'https://api.nasdaq.com/api/quote/BND/dividends?assetclass=etf');
    // AAPL as Nasdaq returned it on 2026-11-12.
    const reply = JSON.stringify({
      data: { dividends: { rows: [
        { exOrEffDate: '11/12/2026', type: 'Cash', amount: '$0.27', declarationDate: '11/02/2026', recordDate: '11/12/2026', paymentDate: '11/16/2026', currency: 'USD' },
        { exOrEffDate: '08/10/2026', type: 'Cash', amount: '$0.27', declarationDate: '07/30/2026', recordDate: '08/10/2026', paymentDate: 'N/A', currency: 'USD' },
        { exOrEffDate: 'N/A', type: 'Cash', amount: '$0.27', paymentDate: '05/14/2026' },
      ] } },
      message: null,
      status: { rCode: 200 },
    });
    assert.deepEqual(nasdaqDividends(reply, 'AAPL', 'USD'), [
      { ticker: 'AAPL', exDate: '2026-11-12', payDate: '2026-11-16', amount: 0.27, currency: 'USD', source: 'nasdaq' },
      { ticker: 'AAPL', exDate: '2026-08-10', payDate: null, amount: 0.27, currency: 'USD', source: 'nasdaq' },
    ]);
  });

  it('answers undefined for a symbol listed elsewhere, so the next source is tried', () => {
    // VT (NYSE Arca) as Nasdaq returned it on 2026-11-12.
    const reply = JSON.stringify({ data: { exDividendDate: 'N/A', dividends: { asOf: null, headers: null, rows: null } }, message: 'Dividend History for Non-Nasdaq symbols is not available', status: { rCode: 200 } });
    assert.equal(nasdaqDividends(reply, 'VT', 'USD'), undefined);
    assert.throws(() => nasdaqDividends('<html>blocked</html>', 'VT', 'USD'), FeedError);
  });
});

describe('Alpha Vantage DIVIDENDS', () => {
  it('reads each dividend and turns a refusal into an error', () => {
    assert.match(avDividendUrl('VT', 'k'), /function=DIVIDENDS&symbol=VT&apikey=k$/);
    // VT as Alpha Vantage returned it on 2026-11-12.
    const reply = JSON.stringify({ symbol: 'VT', data: [
      { ex_dividend_date: '2026-09-18', declaration_date: '2026-01-27', record_date: '2026-09-18', payment_date: '2026-09-22', amount: '0.4084' },
      { ex_dividend_date: '2026-06-18', declaration_date: '2026-01-27', record_date: '2026-06-18', payment_date: 'None', amount: '0.5627' },
    ] });
    assert.deepEqual(avDividends(reply, 'VT', 'USD'), [
      { ticker: 'VT', exDate: '2026-09-18', payDate: '2026-09-22', amount: 0.4084, currency: 'USD', source: 'alphavantage' },
      { ticker: 'VT', exDate: '2026-06-18', payDate: null, amount: 0.5627, currency: 'USD', source: 'alphavantage' },
    ]);
    assert.throws(() => avDividends(JSON.stringify({ Information: 'Our standard API rate limit is 25 requests per day.' }), 'VT', 'USD'), /refused/);
  });
});

describe('dividends read off the adjusted closes', () => {
  const day = (date: string, close: number, adjClose: number | null): DailyPrice => ({ ticker: 'VT', date, close, adjClose, source: 'finmind' });

  it('finds the ex-dividend date where the adjustment factor steps up, and the cash from the step (PRD Section 11)', () => {
    // VT around its ex-dividend date 2026-09-18 (US$0.4084), as FinMind's USStockPrice returned it on 2026-11-12.
    const prices = [day('2026-09-15', 158.03, 157.63), day('2026-09-16', 157.41, 157.01), day('2026-09-17', 159.22, 158.81), day('2026-09-18', 158.55, 158.55), day('2026-09-21', 160.89, 160.89)];
    // 159.22 × (1 − (158.81 ÷ 159.22) ÷ (158.55 ÷ 158.55)) = 0.41
    assert.deepEqual(dividendsFromAdjusted(prices, 'VT', 'USD', '2026-09-01'), [{ ticker: 'VT', exDate: '2026-09-18', payDate: null, amount: 0.41, currency: 'USD', source: 'adjusted_close' }]);
    assert.deepEqual(dividendsFromAdjusted(prices, 'VT', 'USD', '2026-09-19'), []);
  });

  it('ignores the closes’ rounding, a split-sized step, another ticker and days without an adjusted close', () => {
    // A cent of rounding either way: the factor moves by 0.006%, far under a dividend.
    assert.deepEqual(dividendsFromAdjusted([day('2026-09-15', 158.03, 157.63), day('2026-09-16', 157.41, 157.02)], 'VT', 'USD', '2026-09-01'), []);
    // A 1-into-2 split leaves the factor alone when both closes are adjusted; a feed that halves only one is not a dividend.
    assert.deepEqual(dividendsFromAdjusted([day('2026-09-15', 200, 100), day('2026-09-16', 101, 101)], 'VT', 'USD', '2026-09-01'), []);
    assert.deepEqual(dividendsFromAdjusted([day('2026-09-17', 159.22, 158.81), day('2026-09-18', 158.55, 158.55)], 'BND', 'USD', '2026-09-01'), []);
    assert.deepEqual(dividendsFromAdjusted([day('2026-09-17', 159.22, null), day('2026-09-18', 158.55, 158.55)], 'VT', 'USD', '2026-09-01'), []);
  });
});
