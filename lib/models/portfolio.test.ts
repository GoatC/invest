import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addedShortfalls, buildPortfolio, previewImport, previewTrade, type PortfolioData } from './portfolio';
import { ASSET_CLASSES, CAPS, SECURITIES, trade } from './test-helpers';

/** NT$200,000 of 0050 and nothing else, priced at NT$100. */
function data(overrides: Partial<PortfolioData> = {}): PortfolioData {
  return {
    trades: [trade({ id: 1, ticker: '0050', qty: 2_000, price: 100, currency: 'TWD', fxRate: 1 })],
    securities: SECURITIES,
    assetClasses: ASSET_CLASSES,
    prices: [{ ticker: '0050', date: '2026-10-20', close: 100 }],
    fx: [{ pair: 'USD/TWD', date: '2026-10-20', rate: 32 }],
    manualAssets: [],
    ...overrides,
  };
}

describe('buildPortfolio', () => {
  it('values the regular pool from trades, prices and FX rates', () => {
    const portfolio = buildPortfolio(data());
    assert.equal(portfolio.pool.totalTwd, 200_000);
    assert.equal(portfolio.classes.find((c) => c.assetClass.id === 'tw_market_cap')?.weight, 1);
  });

  it('keeps a windfall buy of a satellite ticker out of the regular pool (pool tagging)', () => {
    const windfall = trade({ id: 2, ticker: '2330', qty: 100, price: 2_400, currency: 'TWD', fxRate: 1, pool: 'windfall' });
    const portfolio = buildPortfolio(data({ trades: [...data().trades, windfall] }));
    assert.equal(portfolio.pool.totalTwd, 200_000);
    assert.equal(portfolio.holdings.find((h) => h.pool === 'windfall')?.valueTwd, 240_000);
  });
});

describe('previewTrade', () => {
  it('warns that a stock buy would take one stock above 5% (R1), marking the breach as new', () => {
    // 2330 at NT$2,500 × 5 = NT$12,500 of a NT$212,500 pool: 5.9%.
    const buy = trade({ ticker: '2330', qty: 5, price: 2_500, currency: 'TWD', fxRate: 1 });
    const preview = previewTrade(data(), buy, CAPS);
    assert.deepEqual(
      preview.breaches.map((b) => [b.rule, b.subject, b.isNew]),
      [['R1', '2330', true]],
    );
    assert.deepEqual(preview.shortfalls, []);
  });

  it('marks a breach that already existed as not new', () => {
    const owned = trade({ id: 2, ticker: '2330', qty: 5, price: 2_500, currency: 'TWD', fxRate: 1 });
    const more = trade({ ticker: '2330', qty: 1, price: 2_500, currency: 'TWD', fxRate: 1 });
    const preview = previewTrade(data({ trades: [...data().trades, owned] }), more, CAPS);
    assert.equal(preview.breaches[0]?.isNew, false);
  });

  it('replaces the saved trade with the same id when editing, and reports a sell beyond the holding', () => {
    const edited = trade({ id: 1, ticker: '0050', qty: 500, price: 100, currency: 'TWD', fxRate: 1 });
    const sell = trade({ id: 3, tradeDate: '2026-10-05', ticker: '0050', side: 'sell', qty: 1_000, price: 100, currency: 'TWD', fxRate: 1 });
    const preview = previewTrade(data({ trades: [...data().trades, sell] }), edited, CAPS);
    assert.deepEqual(
      preview.shortfalls.map((s) => [s.ticker, s.missingQty]),
      [['0050', 500]],
    );
  });

  it('leaves a windfall buy of a satellite ticker without warnings', () => {
    const windfall = trade({ ticker: '2330', qty: 100, price: 2_500, currency: 'TWD', fxRate: 1, pool: 'windfall' });
    assert.deepEqual(previewTrade(data(), windfall, CAPS).breaches, []);
  });
});

describe('previewTrade and shortfalls', () => {
  it('does not blame a trade for a shortfall that was already there', () => {
    // A sell of 2330 that was never bought exists already; buying more 0050 is unrelated.
    const orphan = trade({ id: 2, ticker: '2330', side: 'sell', qty: 1, price: 2_500, currency: 'TWD', fxRate: 1 });
    const buy = trade({ ticker: '0050', qty: 10, price: 100, currency: 'TWD', fxRate: 1 });
    assert.deepEqual(previewTrade(data({ trades: [...data().trades, orphan] }), buy, CAPS).shortfalls, []);
  });

  it('counts a shortfall that grows as new', () => {
    const before = [{ ticker: 'VT', pool: 'regular' as const, tradeDate: '2026-10-05', missingQty: 1 }];
    assert.deepEqual(addedShortfalls(before, before), []);
    assert.deepEqual(addedShortfalls(before, [{ ...before[0]!, missingQty: 3 }]).map((s) => s.missingQty), [3]);
  });
});

describe('previewImport', () => {
  it('checks many new trades at once: a later sell can use an earlier imported buy', () => {
    const buy = trade({ tradeDate: '2026-10-01', ticker: '2330', qty: 5, price: 2_500, currency: 'TWD', fxRate: 1 });
    const sell = trade({ tradeDate: '2026-10-02', ticker: '2330', side: 'sell', qty: 2, price: 2_600, currency: 'TWD', fxRate: 1 });
    const preview = previewImport(data(), [buy, sell], CAPS);
    assert.deepEqual(preview.shortfalls, []);
    // 3 shares left at the newest trade price, NT$2,600: NT$7,800 of NT$207,800 is 3.8%, within R1.
    assert.deepEqual(preview.breaches, []);
  });

  it('reports an imported sell larger than the holding', () => {
    const sell = trade({ tradeDate: '2026-10-02', ticker: '2330', side: 'sell', qty: 2, price: 2_600, currency: 'TWD', fxRate: 1 });
    assert.deepEqual(
      previewImport(data(), [sell], CAPS).shortfalls.map((s) => [s.ticker, s.missingQty]),
      [['2330', 2]],
    );
  });
});
