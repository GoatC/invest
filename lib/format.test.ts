import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { money, percent, points, quantity, signedPercent, signedTwd, taipeiDateTime, twd } from './format';

describe('format', () => {
  it('writes TWD rounded to the dollar, with a dash for unknown values', () => {
    assert.equal(twd(1_234_567.6), 'NT$1,234,568');
    assert.equal(twd(-11_000), '−NT$11,000');
    assert.equal(twd(null), '—');
  });

  it('writes amounts, quantities, percentages and percentage points', () => {
    assert.equal(money(1234.5, 'USD'), '1,234.50 USD');
    assert.equal(quantity(2.50001), '2.5');
    assert.equal(quantity(1000), '1,000');
    assert.equal(percent(0.055), '5.5%');
    assert.equal(points(0.032), '+3.2 pp');
    assert.equal(points(-0.0049), '−0.5 pp');
    assert.equal(points(0.00001), '0.0 pp');
  });

  it('writes returns with their sign, and none on a return that rounds to zero', () => {
    assert.equal(signedPercent(0.055), '+5.5%');
    assert.equal(signedPercent(-0.02), '−2.0%');
    assert.equal(signedPercent(-0.00001), '0.0%');
    assert.equal(signedPercent(0.12345, 2), '+12.35%');
    assert.equal(signedPercent(null), '—');
  });

  it('writes a timestamp in Taipei time, a day ahead of UTC late in the evening', () => {
    assert.equal(taipeiDateTime('2026-10-21T14:24:10Z'), '2026-10-21, 22:24');
    assert.equal(taipeiDateTime('2026-10-21T16:30:00+00:00'), '2026-10-22, 00:30');
  });
});

describe('signedTwd', () => {
  it('signs a TWD difference, rounded to the dollar', () => {
    assert.equal(signedTwd(1_234.4), '+NT$1,234');
    assert.equal(signedTwd(-350.6), '−NT$351');
    assert.equal(signedTwd(-0.4), 'NT$0');
    assert.equal(signedTwd(null), '—');
  });
});
