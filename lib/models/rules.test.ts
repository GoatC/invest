import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { capBreaches, capsFromRules, classWeights, regularPool } from './rules';
import { ASSET_CLASSES, CAPS, holding } from './test-helpers';

/** A regular pool of `total` TWD: one core ETF holds whatever the other holdings leave. */
function poolOf(total: number, ...others: ReturnType<typeof holding>[]) {
  const rest = others.filter((h) => h.pool === 'regular').reduce((sum, h) => sum + (h.valueTwd ?? 0), 0);
  return [holding({ valueTwd: total - rest }), ...others];
}

const stock = (ticker: string, valueTwd: number, pool: 'regular' | 'windfall' = 'regular') =>
  holding({ key: `${pool}:${ticker}`, ticker, label: ticker, pool, sleeve: 'satellite', assetClassId: 'us_stocks', productType: 'stock', valueTwd });

describe('R1 single-stock cap (PRD Section 11 acceptance)', () => {
  it('warns when one stock is NT$11,000 of a NT$200,000 pool (5.5%)', () => {
    const breaches = capBreaches(poolOf(200_000, stock('AAPL', 11_000)), CAPS);
    assert.equal(breaches.length, 1);
    const [r1] = breaches;
    assert.equal(r1?.rule, 'R1');
    assert.equal(r1?.subject, 'AAPL');
    assert.ok(Math.abs((r1?.weight ?? 0) - 0.055) < 1e-12);
    assert.ok(Math.abs((r1?.trimTwd ?? 0) - 1_000) < 1e-6);
  });

  it('stays quiet at exactly 5%, and never applies to ETFs', () => {
    assert.deepEqual(capBreaches(poolOf(200_000, stock('AAPL', 10_000)), CAPS), []);
    const etfHeavy = [holding({ valueTwd: 190_000 }), holding({ key: 'regular:0050', ticker: '0050', valueTwd: 10_000 })];
    assert.deepEqual(capBreaches(etfHeavy, CAPS), []);
  });
});

describe('R2 satellite 25% trigger (PRD Section 11 acceptance)', () => {
  it('proposes trimming a NT$51,000 satellite in a NT$200,000 pool (25.5%) back to 20% by selling about NT$11,000', () => {
    const satellite = [
      stock('AAPL', 9_000),
      stock('MSFT', 9_500),
      stock('2330', 9_800),
      holding({ key: 'regular:QQQM', ticker: 'QQQM', sleeve: 'satellite', assetClassId: 'tactical_themes', productType: 'theme_etf', valueTwd: 22_700 }),
    ];
    const r2 = capBreaches(poolOf(200_000, ...satellite), CAPS).find((b) => b.rule === 'R2');
    assert.ok(r2, 'R2 should fire');
    assert.ok(Math.abs(r2.weight - 0.255) < 1e-12);
    assert.ok(Math.abs(r2.trimTwd - 11_000) < 1e-6);
  });

  it('stays quiet at exactly 25%', () => {
    const quarter = [holding({ key: 'regular:QQQM', ticker: 'QQQM', sleeve: 'satellite', productType: 'theme_etf', valueTwd: 50_000 })];
    assert.equal(capBreaches(poolOf(200_000, ...quarter), CAPS).find((b) => b.rule === 'R2'), undefined);
  });
});

describe('pool tagging (PRD Section 11 acceptance)', () => {
  it('leaves a windfall buy of a satellite ticker out of the R1 / R2 maths', () => {
    const regular = poolOf(200_000, stock('AAPL', 9_000));
    const withWindfall = [...regular, stock('AAPL', 500_000, 'windfall')];
    assert.equal(regularPool(withWindfall).totalTwd, 200_000);
    assert.deepEqual(capBreaches(withWindfall, CAPS), []);
  });
});

describe('regularPool', () => {
  it('keeps holdings without a price out of the total and lists them', () => {
    const pool = regularPool([holding({ valueTwd: 1_000 }), holding({ key: 'regular:2330', ticker: '2330', valueTwd: null })]);
    assert.equal(pool.totalTwd, 1_000);
    assert.deepEqual(
      pool.unpriced.map((h) => h.ticker),
      ['2330'],
    );
  });
});

describe('capsFromRules', () => {
  it('reads R1 and R2 thresholds from the rules table', () => {
    const caps = capsFromRules([
      { id: 'R1', threshold: { max_weight: 0.05, pool: 'regular' }, enabled: true },
      { id: 'R2', threshold: { trigger_weight: 0.25, target_weight: 0.2, pool: 'regular' }, enabled: true },
      { id: 'F8_DRIFT', threshold: { abs_drift: 0.05 }, enabled: true },
    ]);
    assert.deepEqual(caps, CAPS);
  });

  it('skips a disabled or malformed rule', () => {
    assert.deepEqual(
      capsFromRules([
        { id: 'R1', threshold: { max_weight: 0.05 }, enabled: false },
        { id: 'R2', threshold: { trigger_weight: 'a lot' }, enabled: true },
      ]),
      {},
    );
  });
});

describe('classWeights', () => {
  it('gives actual against target weight per class in the regular pool', () => {
    const pool = regularPool([holding({ valueTwd: 60_000 }), holding({ key: 'regular:0050', ticker: '0050', assetClassId: 'tw_market_cap', valueTwd: 40_000 })]);
    const weights = classWeights(pool, ASSET_CLASSES);
    assert.equal(weights.length, 8);
    const usGlobal = weights.find((w) => w.assetClass.id === 'us_global_equity');
    assert.equal(usGlobal?.weight, 0.6);
    assert.ok(Math.abs((usGlobal?.drift ?? 0) - 0.32) < 1e-12);
    assert.equal(weights.find((w) => w.assetClass.id === 'global_bonds')?.weight, 0);
  });
});
