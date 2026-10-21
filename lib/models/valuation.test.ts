import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPositions } from './positions';
import { ASSET_CLASSES, SECURITIES, trade } from './test-helpers';
import { latestFx, latestPrices, valueHoldings } from './valuation';

describe('latestPrices', () => {
  it('prefers the newest quote, a nightly close over a trade price on the same day', () => {
    const quotes = latestPrices(
      [
        { ticker: 'VT', date: '2026-10-20', close: 157.8 },
        { ticker: 'VT', date: '2026-10-19', close: 157.1 },
        { ticker: '0050', date: '2026-10-20', close: 107.25 },
      ],
      [trade({ tradeDate: '2026-10-20', price: 158 }), trade({ ticker: '0050', tradeDate: '2026-10-21', price: 108, currency: 'TWD', fxRate: 1 })],
    );
    assert.deepEqual(quotes.get('VT'), { value: 157.8, date: '2026-10-20', estimated: false });
    assert.deepEqual(quotes.get('0050'), { value: 108, date: '2026-10-21', estimated: true });
  });

  it('falls back to the newest trade price before the nightly job has run', () => {
    const quotes = latestPrices([], [trade({ price: 150 }), trade({ tradeDate: '2026-10-08', price: 155 })]);
    assert.deepEqual(quotes.get('VT'), { value: 155, date: '2026-10-08', estimated: true });
  });
});

describe('latestFx', () => {
  it('reads USD/TWD from the rates, keeps TWD at 1 and ignores pairs not quoted in TWD', () => {
    const fx = latestFx(
      [
        { pair: 'USD/TWD', date: '2026-10-16', rate: 32.4 },
        { pair: 'USD/TWD', date: '2026-10-15', rate: 32.1 },
        { pair: 'EUR/USD', date: '2026-10-16', rate: 1.1 },
      ],
      [],
    );
    assert.equal(fx.get('USD')?.value, 32.4);
    assert.equal(fx.get('TWD')?.value, 1);
    assert.equal(fx.has('EUR'), false);
  });

  it('falls back to the newest trade rate in that currency', () => {
    const fx = latestFx([], [trade({ fxRate: 31.8 }), trade({ tradeDate: '2026-10-09', fxRate: 32.3 })]);
    assert.deepEqual(fx.get('USD'), { value: 32.3, date: '2026-10-09', estimated: true });
  });
});

describe('valueHoldings', () => {
  const securities = new Map(SECURITIES.map((s) => [s.ticker, s]));
  const assetClasses = new Map(ASSET_CLASSES.map((c) => [c.id, c]));

  it('values a position at quantity × price × FX, and leaves it unpriced without a quote', () => {
    const { positions } = buildPositions([trade({ qty: 2, price: 150, fxRate: 32 }), trade({ ticker: '2330', qty: 3, price: 2300, currency: 'TWD', fxRate: 1 })]);
    const holdings = valueHoldings({
      positions,
      securities,
      assetClasses,
      prices: new Map([['VT', { value: 157.8, date: '2026-10-20', estimated: false }]]),
      fx: new Map([['USD', { value: 32.4, date: '2026-10-16', estimated: false }]]),
      manualAssets: [],
    });
    const vt = holdings.find((h) => h.ticker === 'VT');
    assert.ok(Math.abs((vt?.valueTwd ?? 0) - 2 * 157.8 * 32.4) < 1e-9);
    assert.equal(vt?.sleeve, 'core');
    assert.equal(holdings.find((h) => h.ticker === '2330')?.valueTwd, null);
  });

  it('counts a TWD balance at face value and gold at its last entered value', () => {
    const holdings = valueHoldings({
      positions: [],
      securities,
      assetClasses,
      prices: new Map(),
      fx: new Map(),
      manualAssets: [
        { id: 1, name: 'Savings', assetClassId: 'strategic_cash', productType: 'cash_mmf', unit: 'TWD', quantity: 20000, lastValueTwd: 20000, valuedOn: '2026-10-20', pool: 'regular' },
        { id: 2, name: 'Gold bar', assetClassId: 'real_assets', productType: 'gold', unit: 'grams', quantity: 5, lastValueTwd: null, valuedOn: null, pool: 'regular' },
      ],
    });
    assert.deepEqual(
      holdings.map((h) => [h.label, h.valueTwd, h.estimated, h.priceDate]),
      [
        ['Savings', 20000, false, '2026-10-20'],
        ['Gold bar', null, true, null],
      ],
    );
  });

  it('values gold in grams at the loaded gold price, ahead of the value entered by hand', () => {
    const gold = { id: 2, name: 'Gold bar', assetClassId: 'real_assets', productType: 'gold' as const, unit: 'grams' as const, quantity: 5, lastValueTwd: 20000, valuedOn: '2026-09-01', pool: 'regular' as const };
    const fx = latestFx([{ pair: 'XAU/TWD', date: '2026-10-21', rate: 133785.8992 }], []);
    const [atPrice] = valueHoldings({ positions: [], securities, assetClasses, prices: new Map(), fx, manualAssets: [gold] });
    // 5 g × 133,785.8992 TWD per troy ounce ÷ 31.1034768 g per ounce.
    assert.equal(Math.round(atPrice?.valueTwd ?? 0), 21507);
    assert.deepEqual([atPrice?.estimated, atPrice?.priceDate], [false, '2026-10-21']);
    const [byHand] = valueHoldings({ positions: [], securities, assetClasses, prices: new Map(), fx: new Map(), manualAssets: [gold] });
    assert.deepEqual([byHand?.valueTwd, byHand?.estimated, byHand?.priceDate], [20000, true, '2026-09-01']);
  });

  it('dates a listed holding by its close', () => {
    const { positions } = buildPositions([trade({ qty: 2, price: 150, fxRate: 32 })]);
    const [vt] = valueHoldings({
      positions,
      securities,
      assetClasses,
      prices: new Map([['VT', { value: 157.8, date: '2026-10-20', estimated: false }]]),
      fx: new Map([['USD', { value: 32.4, date: '2026-10-21', estimated: false }]]),
      manualAssets: [],
    });
    assert.equal(vt?.priceDate, '2026-10-20');
  });
});
