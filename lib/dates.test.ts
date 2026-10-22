import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addDays, addMonths, isIsoDate, isMonth, lastDayOf, monthsBetween, taipeiToday } from './dates';

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

describe('months', () => {
  it('reads YYYY-MM only', () => {
    assert.equal(isMonth('2026-10'), true);
    assert.equal(isMonth('2026-13'), false);
    assert.equal(isMonth('2026-1'), false);
    assert.equal(isMonth('2026-10-01'), false);
  });

  it('steps across years both ways and counts the months between', () => {
    assert.equal(addMonths('2026-11', 2), '2027-01');
    assert.equal(addMonths('2026-01', -1), '2025-12');
    assert.equal(addMonths('2026-05', 360), '2056-05');
    assert.equal(monthsBetween('2026-05', '2027-04'), 11);
    assert.equal(monthsBetween('2027-04', '2026-05'), -11);
  });

  it('finds the last day, leap years included', () => {
    assert.equal(lastDayOf('2026-10'), '2026-10-31');
    assert.equal(lastDayOf('2028-02'), '2028-02-29');
    assert.equal(lastDayOf('2026-12'), '2026-12-31');
  });
});
