import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { daysBetween, rateHistory, rateOn, suggestedRate } from './fx';

const RATES = [
  { pair: 'USD/TWD', date: '2026-10-20', rate: 32.63 },
  { pair: 'USD/TWD', date: '2026-10-16', rate: 32.34 },
  { pair: 'USD/TWD', date: '2026-10-21', rate: 32.485 },
  { pair: 'XAU/TWD', date: '2026-10-21', rate: 133785.8992 },
  { pair: 'EUR/USD', date: '2026-10-21', rate: 1.1 },
];

describe('rateHistory', () => {
  it('keeps the currencies quoted in TWD, oldest first, and leaves gold out', () => {
    const history = rateHistory(RATES);
    assert.deepEqual([...history.keys()], ['USD']);
    assert.deepEqual(
      history.get('USD')?.map((rate) => rate.date),
      ['2026-10-16', '2026-10-20', '2026-10-21'],
    );
  });
});

describe('daysBetween', () => {
  it('counts calendar days, across a month end', () => {
    assert.equal(daysBetween('2026-10-16', '2026-10-21'), 5);
    assert.equal(daysBetween('2026-09-30', '2026-10-01'), 1);
  });
});

describe('rateOn', () => {
  const history = rateHistory(RATES);

  it("takes the trade date's own rate", () => {
    assert.equal(rateOn(history, 'USD', '2026-10-20', 10)?.rate, 32.63);
  });

  it('takes the newest rate before a weekend or holiday trade', () => {
    // Saturday 2026-10-17 and Sunday 2026-10-18 have no Bank of Taiwan rate.
    assert.deepEqual(rateOn(history, 'USD', '2026-10-18', 10), { pair: 'USD/TWD', date: '2026-10-16', rate: 32.34 });
  });

  it('gives none when the newest rate is older than the allowed age, or the trade predates the history', () => {
    assert.equal(rateOn(history, 'USD', '2026-11-05', 10), undefined);
    assert.equal(rateOn(history, 'USD', '2026-10-31', 10)?.date, '2026-10-21');
    assert.equal(rateOn(history, 'USD', '2026-10-15', 10), undefined);
    assert.equal(rateOn(history, 'GBP', '2026-10-21', 10), undefined);
  });
});

describe('suggestedRate', () => {
  const history = rateHistory(RATES);
  const newest = new Map([['USD', { value: 32.485 }]]);

  it("starts a trade on its date's rate, and TWD on 1", () => {
    assert.equal(suggestedRate('USD', '2026-10-18', history, 10, newest), 32.34);
    assert.equal(suggestedRate('TWD', '2026-10-18', history, 10, newest), 1);
  });

  it('suggests nothing for a date without a recent rate, or a date still being typed', () => {
    assert.equal(suggestedRate('USD', '2021-03-01', history, 10, newest), undefined);
    assert.equal(suggestedRate('USD', '2026-10-3', history, 10, newest), undefined);
  });

  it('falls back to the newest known rate when no max age is configured', () => {
    assert.equal(suggestedRate('USD', '2021-03-01', history, null, newest), 32.485);
  });
});
