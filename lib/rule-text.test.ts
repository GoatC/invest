import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CAPS } from './models/test-helpers';
import { breachAlert, ruleMath } from './rule-text';

describe('breachAlert', () => {
  it('puts the R1 acceptance case on a tile: the weight against the cap and the sale back to it', () => {
    const tile = breachAlert({ rule: 'R1', subject: 'AAPL', valueTwd: 11_000, weight: 0.055, limit: 0.05, trimTwd: 1_000 }, CAPS);
    assert.deepEqual(
      [tile.code, tile.title.zh, tile.value, tile.gauge, tile.chips?.map((chip) => `${chip.label.zh} ${chip.value}`)],
      ['R1', 'AAPL', '5.5%', { value: 0.055, limit: 0.05 }, ['上限 5%', '賣出 ≈NT$1,000']],
    );
  });

  it('puts the R2 acceptance case on a tile with the trim back to the 20% target', () => {
    const tile = breachAlert({ rule: 'R2', subject: 'satellite', valueTwd: 51_000, weight: 0.255, limit: 0.25, trimTwd: 11_000 }, CAPS, 'info');
    assert.equal(tile.tone, 'info');
    assert.deepEqual(tile.gauge, { value: 0.255, limit: 0.25, target: 0.2 });
    assert.deepEqual(tile.chips?.map((chip) => `${chip.label.zh} ${chip.value}`), ['觸發 25%', '減碼 ≈NT$11,000 → 20%']);
  });
});

describe('ruleMath', () => {
  it('works the R1 and R2 acceptance cases through with their inputs', () => {
    const lines = ruleMath(CAPS, { totalTwd: 200_000, satelliteTwd: 51_000 });
    assert.equal(lines[0]?.en, 'Regular pool = the TWD market value of every regular-pool holding: NT$200,000. Windfall money and holdings without a value yet are left out.');
    assert.equal(
      lines[1]?.en,
      "R1: a stock's weight = its value ÷ regular pool; above 5%, trim = its value − 5% × regular pool. One stock may hold up to NT$10,000.",
    );
    assert.equal(
      lines[2]?.en,
      'R2: satellite weight = satellite value ÷ regular pool = NT$51,000 ÷ NT$200,000 = 25.5%; above 25%, trim = satellite value − 20% × regular pool, back to 20%.',
    );
    assert.equal(lines[2]?.zh, 'R2：衛星部位權重 = 衛星部位市值 ÷ 一般投入資金池 = NT$51,000 ÷ NT$200,000 = 25.5%；超過 25% 時，減碼金額 = 衛星部位市值 − 20% × 一般投入資金池，回到 20%。');
  });

  it('states the formulas alone without figures, and skips a rule that is off', () => {
    const lines = ruleMath({ singleStock: CAPS.singleStock });
    assert.equal(lines.length, 3);
    assert.ok(!lines.some((line) => line.en.startsWith('R2')));
    assert.ok(!lines[1]?.en.includes('may hold up to'));
  });
});
