import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PriceRow } from './market';
import { buildSeries, type PerformanceInput } from './performance';
import { SECURITIES, trade } from './test-helpers';
import { valueLine } from './value-line';
import { isStale, lastClose, WIDGET_POINTS, widgetFigures } from './widget';

function close(ticker: string, date: string, price: number): PriceRow {
  return { ticker, date, close: price, adjClose: price };
}

function input(overrides: Partial<PerformanceInput>): PerformanceInput {
  return { end: '2026-01-03', trades: [], cashFlows: [], manualAssets: [], securities: SECURITIES, benchmark: [], prices: [], rates: [], ...overrides };
}

function near(actual: number | null | undefined, expected: number, tolerance = 1e-9): void {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);
}

describe('widgetFigures', () => {
  // The F18 case, as on the poster (value-line.test.ts): 1 share at 100, +20% to 120, then 9 more at 120 just before a 10% fall.
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

  it("takes the last close of both pools, the poster's 7-day change and the colour convention", () => {
    const figures = widgetFigures(days, true);
    assert.equal(figures?.asOf, '2026-07-01');
    assert.equal(figures?.totalTwd, 1080);
    near(figures?.weekChange, 1080 / 1200 - 1);
    assert.equal(figures?.weekChange, valueLine(days)?.week?.change);
    assert.equal(figures?.redUp, true);
    assert.equal(widgetFigures(days, false)?.redUp, false);
  });

  it('keeps at most 40 points of the line, from 0 to the cumulative return, at 4 decimals', () => {
    const figures = widgetFigures(days, false);
    assert.ok(figures);
    assert.equal(WIDGET_POINTS, 40);
    assert.ok(figures.points.length > 2 && figures.points.length <= WIDGET_POINTS);
    assert.equal(figures.points[0], 0);
    assert.equal(figures.points[figures.points.length - 1], Math.round((1.2 * 0.9 - 1) * 1e4) / 1e4);
    assert.ok(figures.points.every((point) => Math.round(point * 1e4) / 1e4 === point));
  });

  it('is null until two closes hold a value', () => {
    assert.equal(widgetFigures([], true), null);
  });

  it('has no 7-day change while the series is younger than a week', () => {
    const young = buildSeries(
      input({
        trades: [trade({ tradeDate: '2026-01-01', ticker: '0050', qty: 1, price: 100, currency: 'TWD', fxRate: 1 })],
        prices: [close('0050', '2026-01-01', 100), close('0050', '2026-01-02', 101), close('0050', '2026-01-03', 102)],
      }),
    );
    const figures = widgetFigures(young, true);
    assert.equal(figures?.asOf, '2026-01-03');
    assert.equal(figures?.weekChange, null);
  });
});

describe('the close the widget names', () => {
  // A Friday close, the series run on to Sunday: the nightly job runs every day, and the series has a point for each.
  const prices = [close('0050', '2026-07-02', 100), close('0050', '2026-07-03', 101)];
  const weekend = buildSeries(
    input({
      trades: [trade({ tradeDate: '2026-07-02', ticker: '0050', qty: 1, price: 100, currency: 'TWD', fxRate: 1 })],
      prices,
      end: '2026-07-05',
    }),
  );

  it('is the newest close on or before the end, not the day the job ran', () => {
    assert.equal(weekend[weekend.length - 1]?.date, '2026-07-05');
    assert.equal(lastClose(prices, '2026-07-05'), '2026-07-03');
    assert.equal(widgetFigures(weekend, true, lastClose(prices, '2026-07-05'))?.asOf, '2026-07-03');
  });

  it('leaves out closes after the end, and has none without prices', () => {
    assert.equal(lastClose([...prices, close('0050', '2026-07-06', 102)], '2026-07-05'), '2026-07-03');
    assert.equal(lastClose([], '2026-07-05'), null);
  });

  it("falls back to the series' last day without a close (manual assets only)", () => {
    assert.equal(widgetFigures(weekend, true, null)?.asOf, '2026-07-05');
  });
});

describe('isStale', () => {
  it('reads a Friday close on Monday as fresh and on Tuesday as stale, at 3 days', () => {
    assert.equal(isStale('2026-11-13', '2026-11-16', 3), false);
    assert.equal(isStale('2026-11-13', '2026-11-17', 3), true);
  });

  it('reads a close five days back over a long holiday as stale', () => {
    assert.equal(isStale('2027-02-05', '2027-02-10', 3), true);
  });
});
