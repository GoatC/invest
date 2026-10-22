import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { overseasIncome, supplementaryPremiums, usSitusExposure, type TaxSecurity } from './tax';
import { holding, trade } from './test-helpers';
import type { CashFlow } from './types';

const SECURITIES = new Map<string, TaxSecurity>([
  ['VT', { ticker: 'VT', market: 'US', domicile: 'US' }],
  ['AAPL', { ticker: 'AAPL', market: 'US', domicile: 'US' }],
  ['AGGU', { ticker: 'AGGU', market: 'UK', domicile: 'IE' }],
  ['0050', { ticker: '0050', market: 'TW', domicile: 'TW' }],
  ['00692', { ticker: '00692', market: 'TW', domicile: 'TW' }],
]);
const domicile = (ticker: string) => SECURITIES.get(ticker)?.domicile;

function dividend(overrides: Partial<CashFlow>): CashFlow {
  return { flowDate: '2026-07-15', type: 'dividend', amount: 1, currency: 'TWD', fxRate: 1, pool: 'regular', ticker: '0050', note: null, ...overrides };
}

const NHI = { rate: 0.0211, singlePaymentTwd: 20_000, maxPaymentTwd: 10_000_000 };

describe('usSitusExposure', () => {
  it("adds up both pools' US-domiciled holdings in dollars, and names the ones not priced yet", () => {
    const exposure = usSitusExposure(
      [
        holding({ valueTwd: 100_000 }),
        holding({ key: 'windfall:VT', pool: 'windfall', valueTwd: 1_900_000 }),
        holding({ key: 'regular:AGGU', ticker: 'AGGU', market: 'UK', valueTwd: 500_000 }),
        holding({ key: 'regular:0050', ticker: '0050', market: 'TW', valueTwd: 80_000 }),
        holding({ key: 'regular:AAPL', ticker: 'AAPL', productType: 'stock', valueTwd: null }),
        holding({ key: 'manual:2', ticker: null, market: null, productType: 'cash_mmf', valueTwd: 20_000 }),
      ],
      domicile,
      32.5,
    );
    assert.deepEqual(exposure?.rows.map((row) => [row.ticker, row.valueTwd]), [['VT', 2_000_000]]);
    assert.ok(Math.abs((exposure?.totalUsd ?? 0) - 2_000_000 / 32.5) < 1e-9);
    assert.deepEqual(exposure?.unpriced, ['AAPL']);
  });

  it('needs a USD rate', () => {
    assert.equal(usSitusExposure([holding({ valueTwd: 1 })], domicile, null), null);
  });
});

describe('overseasIncome', () => {
  const trades = [
    trade({ tradeDate: '2025-03-03', qty: 10, price: 100, fxRate: 32 }),
    trade({ tradeDate: '2025-12-01', side: 'sell', qty: 2, price: 110, fxRate: 32 }),
    trade({ tradeDate: '2026-06-01', side: 'sell', qty: 5, price: 120, fee: 1, fxRate: 33 }),
    trade({ tradeDate: '2026-02-01', ticker: '00692', qty: 100, price: 80, currency: 'TWD', fxRate: 1 }),
    trade({ tradeDate: '2026-09-01', ticker: '00692', side: 'sell', qty: 100, price: 90, currency: 'TWD', fxRate: 1 }),
  ];

  it("counts this year's gains on sales abroad and the dividends from them, not Taiwan-listed funds", () => {
    const flows = [dividend({ ticker: 'VT', amount: 0.62, currency: 'USD', fxRate: 32.2, flowDate: '2026-09-15' }), dividend({ amount: 3000 })];
    const income = overseasIncome(trades, flows, SECURITIES, '2026', 1_000_000);
    // 5 of 8 VT left at NT$3,200 each: proceeds (600 − 1) × 33 = 19,767 less a cost of 16,000.
    assert.deepEqual(income.sales, [{ date: '2026-06-01', ticker: 'VT', gainTwd: 3767 }]);
    assert.ok(Math.abs(income.dividendsTwd - 0.62 * 32.2) < 1e-9);
    assert.ok(Math.abs(income.totalTwd - (3767 + 0.62 * 32.2)) < 1e-9);
    assert.equal(income.counts, false);
  });

  it('counts a net loss as nothing, and all of it once it reaches the floor', () => {
    const loss = overseasIncome([trade({ tradeDate: '2026-01-02', qty: 1, price: 100 }), trade({ tradeDate: '2026-05-02', side: 'sell', qty: 1, price: 50 })], [], SECURITIES, '2026', 1_000_000);
    assert.equal(loss.gainsTwd, -1600);
    assert.equal(loss.totalTwd, 0);
    const big = overseasIncome([trade({ tradeDate: '2026-01-02', qty: 100, price: 100 }), trade({ tradeDate: '2026-05-02', side: 'sell', qty: 100, price: 420 })], [], SECURITIES, '2026', 1_000_000);
    assert.equal(big.totalTwd, 1_024_000);
    assert.equal(big.counts, true);
  });
});

describe('supplementaryPremiums', () => {
  it('charges the rate on each Taiwan payment that reaches the threshold, up to the cap', () => {
    const premiums = supplementaryPremiums(
      [
        dividend({ amount: 25_000, flowDate: '2026-07-20' }),
        dividend({ ticker: '00692', amount: 15_000, flowDate: '2026-08-10' }),
        dividend({ ticker: 'VT', amount: 1000, currency: 'USD', fxRate: 32 }),
        dividend({ amount: 12_000_000, flowDate: '2026-01-20' }),
        dividend({ amount: 30_000, flowDate: '2025-07-20' }),
      ],
      SECURITIES,
      '2026',
      NHI,
    );
    assert.deepEqual(
      premiums.rows.map((row) => [row.date, row.ticker, row.premiumTwd]),
      [
        ['2026-01-20', '0050', 211_000],
        ['2026-07-20', '0050', 528],
        ['2026-08-10', '00692', 0],
      ],
    );
    assert.equal(premiums.totalTwd, 211_528);
    assert.equal(premiums.largestTwd, 12_000_000);
  });
});
