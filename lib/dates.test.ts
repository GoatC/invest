import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addDays, isIsoDate, taipeiToday } from './dates';

describe('taipeiToday', () => {
  it('is already the next day in Taipei at 16:00 UTC', () => {
    assert.equal(taipeiToday(new Date('2026-10-20T15:59:00Z')), '2026-10-20');
    assert.equal(taipeiToday(new Date('2026-10-20T16:00:00Z')), '2026-10-21');
  });
});

describe('isIsoDate', () => {
  it('accepts real calendar dates only', () => {
    assert.equal(isIsoDate('2028-02-29'), true);
    assert.equal(isIsoDate('2026-02-29'), false);
    assert.equal(isIsoDate('2026-1-05'), false);
  });
});

describe('addDays', () => {
  it('crosses month, year and leap-day boundaries both ways', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-03-01', -1), '2028-02-29');
    assert.equal(addDays('2026-10-21', -14), '2026-10-07');
  });
});
