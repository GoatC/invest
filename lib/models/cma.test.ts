import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assumptionsValue, readAssumptions, targetReturn } from './cma';
import { ASSET_CLASSES } from './test-helpers';

describe('readAssumptions', () => {
  it('reads complete entries and leaves out the rest', () => {
    const read = readAssumptions({
      us_global_equity: { expected_return: 0.065, volatility: 0.16, source: 'Long-term outlook, 2026' },
      global_bonds: { expected_return: 0.04, volatility: 0.06 },
      real_assets: { expected_return: '4%', volatility: 0.15, source: 'x' },
      strategic_cash: { expected_return: 0.015, volatility: -0.01, source: 'x' },
    });
    assert.deepEqual(read, { us_global_equity: { expectedReturn: 0.065, volatility: 0.16, source: 'Long-term outlook, 2026' } });
    assert.deepEqual(readAssumptions(null), {});
    assert.deepEqual(readAssumptions([]), {});
  });

  it('writes back the stored shape', () => {
    const stored = { tw_market_cap: { expected_return: 0.06, volatility: 0.2, source: 'Demo' } };
    assert.deepEqual(assumptionsValue(readAssumptions(stored)), stored);
  });
});

describe('targetReturn', () => {
  const all = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass.id, { expectedReturn: 0.05, volatility: 0.1, source: 'Demo' }]));

  it('weights each class’s expected return by its target', () => {
    // 28% at 7% and the other 72% at 5%: 1.96% + 3.6% = 5.56%.
    const mix = targetReturn(ASSET_CLASSES, { ...all, us_global_equity: { expectedReturn: 0.07, volatility: 0.16, source: 'Demo' } });
    assert.ok(mix !== null && Math.abs(mix - 0.0556) < 1e-12, String(mix));
  });

  it('is unknown while a class with a target has no assumption', () => {
    const { tactical_themes: _skipped, ...missingOne } = all;
    assert.equal(targetReturn(ASSET_CLASSES, missingOne), null);
    assert.equal(targetReturn(ASSET_CLASSES.map((assetClass) => (assetClass.id === 'tactical_themes' ? { ...assetClass, targetWeight: 0 } : assetClass)), missingOne) !== null, true);
  });
});
