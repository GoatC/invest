import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PriceRow } from './market';
import { buildSeries, type PerformanceInput } from './performance';
import { SECURITIES, trade } from './test-helpers';
import { linePath, sample, valueLine } from './value-line';

function close(ticker: string, date: string, price: number): PriceRow {
  return { ticker, date, close: price, adjClose: price };
}

function input(overrides: Partial<PerformanceInput>): PerformanceInput {
  return { end: '2026-01-03', trades: [], cashFlows: [], manualAssets: [], securities: SECURITIES, benchmark: [], prices: [], rates: [], ...overrides };
}

function near(actual: number | null | undefined, expected: number, tolerance = 1e-9): void {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);
}

describe('sample', () => {
  it('keeps every row when there are no more than asked for', () => {
    assert.deepEqual(sample([1, 2, 3], 5), [1, 2, 3]);
    assert.deepEqual(sample([1, 2, 3], 3), [1, 2, 3]);
  });

  it('keeps the first and the last, evenly spaced in between', () => {
    const rows = Array.from({ length: 101 }, (_, index) => index);
    assert.deepEqual(sample(rows, 5), [0, 25, 50, 75, 100]);
    assert.equal(sample(rows, 60).length, 60);
  });
});

describe('valueLine', () => {
  // The F18 case: 1 share at 100, +20% to 120, then 9 more at 120 just before a 10% fall.
  const days = buildSeries(
    input({
      trades: [
        trade({ tradeDate: '2026-01-01', ticker: '0050', qty: 1, price: 100, fee: 1, currency: 'TWD', fxRate: 1 }),
        trade({ tradeDate: '2026-04-01', ticker: '0050', qty: 9, price: 120, currency: 'TWD', fxRate: 1, pool: 'windfall' }),
      ],
      prices: [close('0050', '2026-01-01', 100), close('0050', '2026-04-01', 120), close('0050', '2026-06-27', 120), close('0050', '2026-07-01', 108)],
      end: '2026-07-01',
    }),
  );

  it('draws the time-weighted return of both pools, so money put in does not move the line', () => {
    const line = valueLine(days, 1000);
    assert.ok(line);
    assert.equal(line.points[0]?.date, '2026-01-01');
    assert.equal(line.points[0]?.change, 0);
    // The windfall buy of 1,080 on 1 April leaves the line at +20%.
    near(line.points.find((point) => point.date === '2026-04-01')?.change, 0.2);
    near(line.points.find((point) => point.date === '2026-04-02')?.change, 0.2);
    assert.equal(line.to, '2026-07-01');
    near(line.points[line.points.length - 1]?.change, 1.2 * 0.9 - 1);
  });

  it('reports the gain since the start net of the money put in, fees counted', () => {
    const line = valueLine(days);
    // 101 and 1,080 went in, 1,080 is left.
    assert.equal(line?.total.gain, -101);
    near(line?.total.change, 1.2 * 0.9 - 1);
    assert.equal(line?.total.from, '2026-01-01');
  });

  it('reports the last seven days on their own', () => {
    const line = valueLine(days);
    // Worth 1,200 at the close of 24 June, 1,080 on 1 July.
    assert.equal(line?.week?.from, '2026-06-24');
    assert.equal(line?.week?.gain, -120);
    near(line?.week?.change, -0.1);
  });

  it('keeps no more points than asked for, the newest day among them', () => {
    const line = valueLine(days, 30);
    assert.equal(line?.points.length, 30);
    assert.equal(line?.points[29]?.date, '2026-07-01');
  });

  it('has no week before the series is seven days old, and no line before the second close', () => {
    const young = buildSeries(
      input({
        trades: [trade({ tradeDate: '2026-01-01', ticker: '0050', qty: 1, price: 100, currency: 'TWD', fxRate: 1 })],
        prices: [close('0050', '2026-01-01', 100), close('0050', '2026-01-03', 110)],
        end: '2026-01-03',
      }),
    );
    const line = valueLine(young);
    assert.equal(line?.week, null);
    near(line?.total.change, 0.1);
    assert.equal(line?.total.gain, 10);
    assert.equal(valueLine(young.slice(0, 1)), null);
    assert.equal(valueLine([]), null);
  });
});

describe('linePath', () => {
  it('spans the box edge to edge, the highest point at the top pad and the lowest at the bottom', () => {
    const drawn = linePath([0, 0.1, -0.1], 200, 100, 10);
    assert.ok(drawn);
    assert.ok(drawn.path.startsWith('M0 50.0 C'), drawn.path);
    assert.ok(drawn.path.endsWith(' 200.0 90.0'), drawn.path);
    assert.ok(drawn.path.includes(' 100.0 10.0 C'), drawn.path);
    assert.equal(drawn.zero, 50);
    assert.deepEqual(drawn.end, { x: 200, y: 90 });
  });

  it('never swings past a peak: the curve is flat where the direction turns', () => {
    const drawn = linePath([0, 1, 0], 200, 100, 0);
    // Both control points beside the peak sit at the peak's own height.
    assert.ok(drawn?.path.includes('66.7 0.0 100.0 0.0 C133.3 0.0'), drawn?.path);
  });

  it('draws a flat series through the middle, and nothing from fewer than two points', () => {
    assert.equal(linePath([0, 0, 0], 100, 40, 5)?.zero, 20);
    assert.equal(linePath([0.2], 100, 40, 5), null);
  });
});
