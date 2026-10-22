import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assumptionsValue, mixReturn, readAssumptions, targetReturn } from './cma';
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

describe('mixReturn', () => {
  const demo = { expectedReturn: 0, volatility: 0.1, source: 'Demo' };

  it('re-weights the target mix over the classes with an assumption, and says how much of it that is', () => {
    // The five core classes (80% of the targets), as the step 6 end-to-end check enters them:
    // (0.28·6.5% + 0.12·6% + 0.22·3.5% + 0.10·4% + 0.08·1.5%) ÷ 0.80 = 3.83% ÷ 0.80 = 4.7875%.
    const core = {
      us_global_equity: { ...demo, expectedReturn: 0.065 },
      tw_market_cap: { ...demo, expectedReturn: 0.06 },
      global_bonds: { ...demo, expectedReturn: 0.035 },
      real_assets: { ...demo, expectedReturn: 0.04 },
      strategic_cash: { ...demo, expectedReturn: 0.015 },
    };
    const mix = mixReturn(ASSET_CLASSES, core);
    assert.ok(mix && Math.abs(mix.expectedReturn - 0.047875) < 1e-12 && Math.abs(mix.share - 0.8) < 1e-12, JSON.stringify(mix));
  });

  it('equals the target mix once every class with a target has one, and is unknown with none', () => {
    const all = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass.id, { ...demo, expectedReturn: assetClass.sleeve === 'core' ? 0.05 : 0.08 }]));
    const mix = mixReturn(ASSET_CLASSES, all);
    assert.ok(mix && Math.abs(mix.expectedReturn - (targetReturn(ASSET_CLASSES, all) ?? 0)) < 1e-12 && mix.share === 1);
    assert.equal(mixReturn(ASSET_CLASSES, {}), null);
  });
});
