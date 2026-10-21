import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { money, percent, points, quantity, twd } from './format';

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
});
