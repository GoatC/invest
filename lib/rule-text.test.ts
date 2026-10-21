import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CAPS } from './models/test-helpers';
import { breachText } from './rule-text';

describe('breachText', () => {
  it('describes the R1 acceptance case with the trim back to the cap', () => {
    const text = breachText({ rule: 'R1', subject: 'AAPL', valueTwd: 11_000, weight: 0.055, limit: 0.05, trimTwd: 1_000 }, CAPS, 'now');
    assert.equal(text.en, 'R1: AAPL is 5.5% of the regular pool, above the 5% single-stock cap. Selling about NT$1,000 brings it back to the cap.');
    assert.equal(text.zh, 'R1：AAPL 目前占一般投入資金池的 5.5%，超過單一個股 5% 上限；賣出約 NT$1,000 可回到上限內。');
  });

  it('describes the R2 acceptance case with the trim back to the 20% target', () => {
    const text = breachText({ rule: 'R2', subject: 'satellite', valueTwd: 51_000, weight: 0.255, limit: 0.25, trimTwd: 11_000 }, CAPS, 'after');
    assert.equal(text.en, 'R2: the satellite would be 25.5% of the regular pool, above the 25% trigger. Trimming about NT$11,000 brings it back to 20%.');
    assert.equal(text.zh, 'R2：衛星部位將占一般投入資金池的 25.5%，超過 25% 觸發點；減碼約 NT$11,000 可回到 20%。');
  });
});
