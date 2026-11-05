import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPositions, chronological, equityLocal } from './positions';
import { trade } from './test-helpers';

describe('buildPositions', () => {
  it('averages the cost of two buys, fees included, in the trade currency and in TWD', () => {
    const { positions } = buildPositions([
      trade({ qty: 10, price: 100, fee: 1, fxRate: 30 }),
      trade({ tradeDate: '2026-10-02', qty: 10, price: 110, fee: 1, fxRate: 32 }),
    ]);
    assert.equal(positions.length, 1);
    const [vt] = positions;
    assert.equal(vt?.qty, 20);
    assert.equal(vt?.costLocal, 1001 + 1101);
    assert.equal(vt?.costTwd, 1001 * 30 + 1101 * 32);
  });

  it('removes average cost on a sell and books the gain net of fee and tax', () => {
    const { positions } = buildPositions([
      trade({ qty: 10, price: 100, fee: 1, fxRate: 30 }),
      trade({ tradeDate: '2026-10-02', qty: 10, price: 110, fee: 1, fxRate: 32 }),
      trade({ tradeDate: '2026-10-03', side: 'sell', qty: 5, price: 120, fee: 1, tax: 0.5, fxRate: 33 }),
    ]);
    const [vt] = positions;
    const costOut = (1001 * 30 + 1101 * 32) / 4;
    assert.equal(vt?.qty, 15);
    assert.ok(Math.abs((vt?.costTwd ?? 0) - (1001 * 30 + 1101 * 32 - costOut)) < 1e-6);
    assert.ok(Math.abs((vt?.realizedTwd ?? 0) - ((600 - 1.5) * 33 - costOut)) < 1e-6);
  });

  it('replays trades by date, then by id, with unsaved trades last on their day', () => {
    const order = chronological([
      trade({ id: 3, tradeDate: '2026-10-02' }),
      trade({ tradeDate: '2026-10-01' }),
      trade({ id: 2, tradeDate: '2026-10-01' }),
      trade({ id: 1, tradeDate: '2026-10-02' }),
    ]).map((t) => `${t.tradeDate}#${t.id ?? 'new'}`);
    assert.deepEqual(order, ['2026-10-01#2', '2026-10-01#new', '2026-10-02#1', '2026-10-02#3']);
  });

  it('keeps the regular and windfall pools apart', () => {
    const { positions } = buildPositions([trade({ qty: 2 }), trade({ qty: 5, pool: 'windfall' })]);
    assert.deepEqual(
      positions.map((p) => [p.pool, p.qty]),
      [
        ['regular', 2],
        ['windfall', 5],
      ],
    );
  });

  it('flags a sell larger than the holding and closes the position', () => {
    const { positions, shortfalls } = buildPositions([trade({ qty: 5 }), trade({ tradeDate: '2026-10-05', side: 'sell', qty: 8 })]);
    assert.deepEqual(shortfalls, [{ ticker: 'VT', pool: 'regular', tradeDate: '2026-10-05', missingQty: 3 }]);
    assert.equal(positions[0]?.qty, 0);
    assert.equal(positions[0]?.costTwd, 0);
  });
});

describe('buildPositions: shorts and leverage', () => {
  it('keeps a 1x long exactly as before: own money equals cost', () => {
    const { positions } = buildPositions([trade({ qty: 2, price: 100, fee: 1 })]);
    const [position] = positions;
    assert.equal(position?.direction, 'long');
    assert.equal(position?.costLocal, 201);
    assert.equal(position?.marginLocal, 201);
    assert.equal(position?.marginTwd, 201 * 32);
    assert.equal(position?.leverage, 1);
    assert.equal(equityLocal(position!, 110), 220);
  });

  it('puts in only qty × price ÷ leverage of own money, plus the fee', () => {
    const { positions } = buildPositions([trade({ qty: 10, price: 100, fee: 2, leverage: 2.5 })]);
    const [position] = positions;
    assert.equal(position?.marginLocal, 402);
    assert.equal(position?.leverage, 2.5);
    // At 110: own money 402 + (1100 − 1002) = 500. A 40% fall (1 ÷ 2.5) uses it all up, and more goes below 0.
    assert.equal(equityLocal(position!, 110), 500);
    assert.equal(equityLocal(position!, 60), 0);
    assert.equal(equityLocal(position!, 59), -10);
  });

  it('books a leveraged long sell against the own money it releases', () => {
    const { positions, sales } = buildPositions([
      trade({ tradeDate: '2026-10-01', qty: 10, price: 100, leverage: 2, fxRate: 30 }),
      trade({ tradeDate: '2026-10-02', side: 'sell', qty: 5, price: 120, leverage: 2, fxRate: 30 }),
    ]);
    // Half of 500 own money released, plus 5 × (120 − 100) = 100 gained: 350 USD freed.
    assert.equal(sales[0]?.gainTwd, 100 * 30);
    assert.equal(positions[0]?.qty, 5);
    assert.equal(positions[0]?.marginLocal, 250);
  });

  it('opens a short with a sell and closes it with a buy, gaining when the price falls', () => {
    const { positions, sales, shortfalls } = buildPositions([
      trade({ tradeDate: '2026-10-01', side: 'sell', direction: 'short', qty: 4, price: 50, fee: 1 }),
      trade({ tradeDate: '2026-10-03', side: 'buy', direction: 'short', qty: 4, price: 40, fee: 1 }),
    ]);
    assert.deepEqual(shortfalls, []);
    // Proceeds 199, covered for 161: 38 USD at 32.
    assert.equal(sales[0]?.direction, 'short');
    assert.equal(sales[0]?.gainTwd, 38 * 32);
    assert.equal(positions[0]?.qty, 0);
  });

  it('values an open short as margin + (proceeds − cost to cover)', () => {
    const { positions } = buildPositions([trade({ side: 'sell', direction: 'short', qty: 4, price: 50 })]);
    const [position] = positions;
    assert.equal(position?.marginLocal, 200);
    assert.equal(equityLocal(position!, 60), 160);
    assert.equal(equityLocal(position!, 40), 240);
  });

  it('never nets a short against a long, and flags a cover larger than the short', () => {
    const { positions, shortfalls } = buildPositions([
      trade({ tradeDate: '2026-10-01', qty: 3 }),
      trade({ tradeDate: '2026-10-02', side: 'sell', direction: 'short', qty: 1 }),
      trade({ tradeDate: '2026-10-03', side: 'buy', direction: 'short', qty: 2 }),
    ]);
    assert.equal(positions.find((position) => position.direction === 'long')?.qty, 3);
    assert.deepEqual(shortfalls, [{ ticker: 'VT', pool: 'regular', tradeDate: '2026-10-03', missingQty: 1, direction: 'short' }]);
  });

  it('a plain sell above the holding is still a shortfall, never a short', () => {
    const { shortfalls } = buildPositions([trade({ side: 'sell', qty: 1 })]);
    assert.equal(shortfalls.length, 1);
    assert.equal(shortfalls[0]?.direction, undefined);
  });
});
