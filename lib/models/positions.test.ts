import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPositions, chronological } from './positions';
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
