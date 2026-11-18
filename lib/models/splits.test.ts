import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSeries, type PerformanceInput } from './performance';
import { buildPortfolio, type PortfolioData } from './portfolio';
import { restateCloses, restateTrades, splitFactor, type Split } from './splits';
import { ASSET_CLASSES, SECURITIES, trade } from './test-helpers';

const AAPL_4_FOR_1: Split = { ticker: 'AAPL', exDate: '2026-06-10', ratio: 4 };

function portfolio(overrides: Partial<PortfolioData>): PortfolioData {
  return {
    trades: [],
    securities: SECURITIES,
    assetClasses: ASSET_CLASSES,
    prices: [{ ticker: 'AAPL', date: '2026-10-20', close: 25 }],
    fx: [{ pair: 'USD/TWD', date: '2026-10-20', rate: 32 }],
    manualAssets: [],
    ...overrides,
  };
}

describe('splitFactor', () => {
  it('multiplies every split of the ticker after the day; a trade on the ex-date is already in new shares', () => {
    const splits: Split[] = [AAPL_4_FOR_1, { ticker: 'AAPL', exDate: '2026-08-01', ratio: 2 }, { ticker: 'VT', exDate: '2026-07-01', ratio: 3 }];
    assert.equal(splitFactor(splits, 'AAPL', '2026-06-09'), 8);
    assert.equal(splitFactor(splits, 'AAPL', '2026-06-10'), 2);
    assert.equal(splitFactor(splits, 'AAPL', '2026-08-01'), 1);
    assert.equal(splitFactor(splits, '2330', '2026-01-01'), 1);
  });

  it('takes a reverse split as a ratio below 1', () => {
    assert.equal(splitFactor([{ ticker: 'AAPL', exDate: '2026-06-10', ratio: 0.1 }], 'AAPL', '2026-06-01'), 0.1);
  });
});

describe('restateTrades', () => {
  it('reads a trade before a split in new shares: quantity × ratio, price ÷ ratio, the amount, fee and tax unchanged', () => {
    const before = trade({ ticker: 'AAPL', tradeDate: '2026-06-01', qty: 10, price: 100, fee: 1, tax: 0.5 });
    const after = trade({ ticker: 'AAPL', tradeDate: '2026-06-10', qty: 4, price: 25 });
    const [restated, untouched] = restateTrades([before, after], [AAPL_4_FOR_1]);
    assert.deepEqual(restated, { ...before, qty: 40, price: 25 });
    assert.equal(untouched, after);
    assert.equal((restated?.qty ?? 0) * (restated?.price ?? 0), before.qty * before.price);
  });

  it('returns the trades as they are without splits', () => {
    const trades = [trade()];
    assert.deepEqual(restateTrades(trades, undefined), trades);
    assert.deepEqual(restateTrades(trades, []), trades);
  });
});

describe('a split in the portfolio (N5, R1 / R2)', () => {
  const bought = trade({ ticker: 'AAPL', tradeDate: '2026-06-01', qty: 10, price: 100, fxRate: 30 });

  it('values the holding in new shares at the post-split close', () => {
    const without = buildPortfolio(portfolio({ trades: [bought] }));
    const withSplit = buildPortfolio(portfolio({ trades: [bought], splits: [AAPL_4_FOR_1] }));
    const holding = (built: typeof without) => built.holdings.find((one) => one.ticker === 'AAPL');
    // Without the split, 10 old shares at the new close of 25: a quarter of what is held.
    assert.equal(holding(without)?.qty, 10);
    assert.equal(holding(without)?.valueTwd, 10 * 25 * 32);
    assert.equal(holding(withSplit)?.qty, 40);
    assert.equal(holding(withSplit)?.valueTwd, 40 * 25 * 32);
    // The cost basis is the same money: 10 × 100 at 30, now spread over 40 shares.
    assert.equal(holding(withSplit)?.costTwd, 1000 * 30);
  });

  it('lets a sale of the new shares go through, where it would be larger than the old holding', () => {
    const sold = trade({ ticker: 'AAPL', tradeDate: '2026-07-01', side: 'sell', qty: 30, price: 26, fxRate: 31 });
    assert.equal(buildPortfolio(portfolio({ trades: [bought, sold] })).shortfalls.length, 1);
    const built = buildPortfolio(portfolio({ trades: [bought, sold], splits: [AAPL_4_FOR_1] }));
    assert.deepEqual(built.shortfalls, []);
    assert.equal(built.holdings.find((one) => one.ticker === 'AAPL')?.qty, 10);
  });
});

describe('a split in the day-by-day replay (F18)', () => {
  it('moves no value on the ex-date once trades and quoted closes are both in new shares', () => {
    const splits = [AAPL_4_FOR_1];
    const input: PerformanceInput = {
      end: '2026-06-11',
      trades: restateTrades([trade({ ticker: 'AAPL', tradeDate: '2026-06-08', qty: 10, price: 100, fxRate: 32 })], splits),
      cashFlows: [],
      manualAssets: [],
      securities: SECURITIES,
      benchmark: [],
      // Quoted closes as traded: 100 before the split, 25 after; adjusted closes already in new shares.
      prices: restateCloses(
        [
          { ticker: 'AAPL', date: '2026-06-08', close: 100, adjClose: 25 },
          { ticker: 'AAPL', date: '2026-06-09', close: 100, adjClose: 25 },
          { ticker: 'AAPL', date: '2026-06-10', close: 25, adjClose: 25 },
          { ticker: 'AAPL', date: '2026-06-11', close: 25, adjClose: 25 },
        ],
        splits,
      ),
      rates: ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11'].map((date) => ({ pair: 'USD/TWD', date, rate: 32 })),
    };
    const days = buildSeries(input);
    for (const day of days) assert.equal(day.value.all, 1000 * 32, day.date);
    const exDate = days.find((day) => day.date === '2026-06-10');
    assert.equal(exDate?.ret.all, 0);
  });

  it('leaves adjusted closes as they are', () => {
    const [price] = restateCloses([{ ticker: 'AAPL', date: '2026-06-01', close: 100, adjClose: 25 }], [AAPL_4_FOR_1]);
    assert.deepEqual(price, { ticker: 'AAPL', date: '2026-06-01', close: 25, adjClose: 25 });
  });
});
