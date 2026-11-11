import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cellSignal, closesSince, costStrip, holdingSignals, lastMove, nextBuyClasses, treemap } from './holding-view';

const closes = [
  { date: '2026-11-05', close: 100 },
  { date: '2026-11-06', close: 104 },
  { date: '2026-11-09', close: 101.4 },
];

const near = (actual: number | null | undefined, expected: number, tolerance = 1e-9) => assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);

describe('holdings overview (PRD Section 5, phone redesign step 3)', () => {
  it('reads the last session against the one before it', () => {
    const move = lastMove(closes);
    assert.equal(move?.date, '2026-11-09');
    assert.equal(move?.previous, '2026-11-06');
    near(move?.change, 101.4 / 104 - 1);
    assert.equal(lastMove(closes.slice(0, 1)), null);
    assert.equal(lastMove([{ date: '2026-11-05', close: 0 }, { date: '2026-11-06', close: 5 }]), null);
    assert.deepEqual(closesSince(closes, '2026-11-06').map((point) => point.date), ['2026-11-06', '2026-11-09']);
  });

  it('puts the buys, the price and the range on the average cost', () => {
    // Bought at 95 and 105 (average 100); 107 now; the year ran from 91 to 108.5.
    const strip = costStrip({ avgCost: 100, last: 107, closes: [{ date: 'a', close: 91 }, { date: 'b', close: 108.5 }], lots: [95, 105], buyPrice: 88, trimPrice: 119 });
    assert.ok(strip);
    near(strip.now, 0.07);
    near(strip.low, -0.09);
    near(strip.high, 0.085);
    assert.deepEqual(strip.lots.map((lot) => Number(lot.toFixed(4))), [-0.05, 0.05]);
    near(strip.buyZone, -0.12);
    near(strip.trimZone, 0.19);
    // The range always takes in the price now, and there are no zones without a saved value.
    const above = costStrip({ avgCost: 100, last: 120, closes: [{ date: 'a', close: 98 }], lots: [100] });
    near(above?.high, 0.2);
    assert.equal(above?.buyZone, null);
    assert.equal(costStrip({ avgCost: null, last: 120, closes: [], lots: [] }), null);
    assert.equal(costStrip({ avgCost: 100, last: null, closes: [], lots: [] }), null);
  });

  it('raises only what the rules say, the ones to act on first', () => {
    const signals = holdingSignals({
      ticker: 'AAPL',
      breach: { weight: 0.097, limit: 0.05 },
      light: 'amber',
      zone: { zone: 'between', toBuy: 0.14, toTrim: 0.3 },
      drift: { status: 'ok', drift: -0.003, nextBuy: false },
      filing: { date: '2026-11-14' },
    });
    assert.deepEqual(signals.map((signal) => `${signal.column}:${signal.kind}`), ['rule:act', 'flag:watch', 'event:wait', 'mix:ok', 'value:info']);
    assert.equal(signals[0]?.label.zh, '超過個股上限 9.7%／5%');
    assert.equal(signals[2]?.label.zh, '11/14 財報');
    assert.equal(signals[4]?.label.zh, '距買入區 14%');
    assert.equal(cellSignal(signals, 'rule')?.kind, 'act');
    assert.equal(cellSignal(signals, 'value')?.kind, 'info');
    assert.equal(cellSignal(holdingSignals({ ticker: 'VT' }), 'rule'), undefined);
  });

  it('marks a holding the next contribution buys, and a class past its band', () => {
    const next = holdingSignals({ ticker: 'VT', drift: { status: 'rebalance', drift: -0.151, nextBuy: true } });
    assert.deepEqual(next.map((signal) => signal.kind), ['buy', 'info']);
    assert.equal(next[1]?.label.zh, '類別低配 15.1 pp');
    assert.equal(cellSignal(next, 'mix')?.kind, 'buy');
    const over = holdingSignals({ ticker: 'BIL', drift: { status: 'rebalance', drift: 0.285, nextBuy: false } });
    assert.equal(over[0]?.kind, 'act');
    assert.equal(over[0]?.label.zh, '類別超配 28.5 pp');
    assert.equal(holdingSignals({ ticker: '2330', zone: { zone: 'buy', toBuy: 0, toTrim: 0.6 } })[0]?.kind, 'buy');
    assert.equal(holdingSignals({ ticker: '2330', light: 'red' })[0]?.kind, 'act');
    assert.equal(holdingSignals({ ticker: '2330', proposal: true })[0]?.label.zh, '提案待處理');
  });

  it('names the most underweight core classes, at most the limit, never the satellite', () => {
    const drifts = [
      { assetClass: { id: 'us', sleeve: 'core' }, drift: -0.151 },
      { assetClass: { id: 'tw', sleeve: 'core' }, drift: -0.027 },
      { assetClass: { id: 'bonds', sleeve: 'core' }, drift: -0.108 },
      { assetClass: { id: 'cash', sleeve: 'core' }, drift: 0.285 },
      { assetClass: { id: 'themes', sleeve: 'satellite' }, drift: -0.05 },
    ];
    assert.deepEqual(nextBuyClasses(drifts, 2), ['us', 'bonds']);
    assert.deepEqual(nextBuyClasses(drifts, 5), ['us', 'bonds', 'tw']);
    assert.deepEqual(nextBuyClasses(drifts, 0), []);
  });

  it('lays a treemap out by value, inside the box', () => {
    const tiles = treemap([{ item: 'a', value: 50 }, { item: 'b', value: 30 }, { item: 'c', value: 20 }, { item: 'none', value: 0 }], 300, 200);
    assert.deepEqual(tiles.map((tile) => tile.item), ['a', 'b', 'c']);
    for (const [index, share] of [0.5, 0.3, 0.2].entries()) near(tiles[index]!.width * tiles[index]!.height, 300 * 200 * share, 1e-6);
    for (const tile of tiles) assert.ok(tile.x >= -1e-9 && tile.y >= -1e-9 && tile.x + tile.width <= 300 + 1e-6 && tile.y + tile.height <= 200 + 1e-6);
    // The largest takes the left side whole; the other two share the rest.
    near(tiles[0]!.width, 150, 1e-6);
    near(tiles[0]!.height, 200, 1e-6);
    assert.deepEqual(treemap([], 300, 200), []);
  });
});
