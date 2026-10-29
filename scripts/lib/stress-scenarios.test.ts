import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { monthEnds, monthlyReturns } from './stress-scenarios.ts';

describe('stress scenario data', () => {
  it('takes the last close of each month, leaving out blanks', () => {
    const ends = monthEnds([
      { date: '2008-01-30', close: 10 },
      { date: '2008-01-31', close: 11 },
      { date: '2008-02-01', close: 12 },
      { date: '2008-02-29', close: 0 },
    ]);
    assert.deepEqual([...ends], [
      ['2008-01', 11],
      ['2008-02', 12],
    ]);
  });

  it('returns each month’s value over the month before’s, in TWD with the month-end rate', () => {
    const closes = new Map([
      ['2007-12', 100],
      ['2008-01', 90],
      ['2008-02', 99],
    ]);
    const rates = new Map([
      ['2007-12', 32],
      ['2008-01', 32],
      ['2008-02', 33],
    ]);
    // In TWD already: January 90 ÷ 100 − 1, February 99 ÷ 90 − 1. With the rate: February 99 × 33 ÷ (90 × 32) − 1 = 0.134375.
    assert.deepEqual(monthlyReturns(closes, null, '2008-01', 2), [-0.1, 0.1]);
    assert.deepEqual(monthlyReturns(closes, rates, '2008-01', 2), [-0.1, 0.1344]);
  });

  it('refuses a window with a month missing rather than call it flat', () => {
    assert.throws(() => monthlyReturns(new Map([['2008-01', 1]]), null, '2008-01', 1), /no close for 2007-12/);
    assert.throws(() => monthlyReturns(new Map([['2007-12', 1], ['2008-01', 1]]), new Map([['2008-01', 30]]), '2008-01', 1), /no rate for 2007-12/);
  });
});
