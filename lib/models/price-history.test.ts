import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { change, periodOf, rangeStart, resample, tradeMarks, window, type ClosePoint } from './price-history';

/** Weekday closes from 2025-11-03 (a Monday) to 2026-11-06 (a Friday), rising by 0.1 a day from 100. */
function closes(): ClosePoint[] {
  const out: ClosePoint[] = [];
  const day = new Date('2025-11-03T00:00:00Z');
  let close = 100;
  while (day.toISOString().slice(0, 10) <= '2026-11-06') {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      out.push({ date: day.toISOString().slice(0, 10), close: Math.round(close * 10) / 10 });
      close += 0.1;
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}

describe('price history', () => {
  it('counts each range back from the newest close', () => {
    assert.equal(rangeStart('2026-11-06', '1W'), '2026-10-30');
    assert.equal(rangeStart('2026-11-06', '1M'), '2026-10-06');
    assert.equal(rangeStart('2026-11-06', '3M'), '2026-08-06');
    assert.equal(rangeStart('2026-11-06', '1Y'), '2025-11-06');
    assert.equal(rangeStart('2026-11-06', '5Y'), '2021-11-06');
    assert.equal(rangeStart('2026-11-06', 'ALL'), null);
  });

  it('puts a date in its day, ISO week (from Monday), month and year', () => {
    assert.equal(periodOf('2026-11-08', 'week'), '2026-11-02'); // a Sunday belongs to the week begun Monday
    assert.equal(periodOf('2026-11-02', 'week'), '2026-11-02');
    assert.equal(periodOf('2026-11-08', 'month'), '2026-11');
    assert.equal(periodOf('2026-11-08', 'year'), '2026');
  });

  it("keeps each period's last close, dated on its own day", () => {
    const week = window(closes(), '1M', 'week');
    assert.deepEqual(week.slice(-2), [
      { date: '2026-10-30', close: 125.9 },
      { date: '2026-11-06', close: 126.4 },
    ]);
    const months = resample(closes(), 'month');
    assert.equal(months.length, 13);
    assert.deepEqual(months[0], { date: '2025-11-28', close: 101.9 });
    assert.deepEqual(resample(closes(), 'year'), [
      { date: '2025-12-31', close: 104.2 },
      { date: '2026-11-06', close: 126.4 },
    ]);
  });

  it('cuts to the range and measures the change across it', () => {
    const week = window(closes(), '1W', 'day');
    assert.deepEqual(week.map((point) => point.date), ['2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    assert.ok(Math.abs((change(week) ?? 0) - (126.4 / 125.9 - 1)) < 1e-12);
    assert.equal(change(week.slice(0, 1)), null);
    assert.deepEqual(window([], 'ALL', 'day'), []);
  });

  it("marks only this ticker's trades in the range, oldest first, longs by default", () => {
    const trades = [
      { ticker: 'VOO', tradeDate: '2026-10-20', side: 'sell' as const, qty: 1, price: 600 },
      { ticker: 'VOO', tradeDate: '2026-01-05', side: 'buy' as const, qty: 3, price: 550 },
      { ticker: 'NVDA', tradeDate: '2026-10-21', side: 'buy' as const, qty: 2, price: 180 },
      { ticker: 'VOO', tradeDate: '2026-10-22', side: 'sell' as const, direction: 'short' as const, qty: 1, price: 610 },
    ];
    assert.deepEqual(tradeMarks(trades, 'VOO', '2026-10-01'), [
      { date: '2026-10-20', side: 'sell', direction: 'long', qty: 1, price: 600 },
      { date: '2026-10-22', side: 'sell', direction: 'short', qty: 1, price: 610 },
    ]);
    assert.equal(tradeMarks(trades, 'VOO', null).length, 3);
  });
});
