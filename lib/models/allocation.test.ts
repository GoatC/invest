import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allocation, classDrifts, driftBands, satelliteCheck, sleeveTargets, sliceOf, type DriftBands } from './allocation';
import { classWeights, regularPool, type RuleRow } from './rules';
import { ASSET_CLASSES, CAPS, holding } from './test-helpers';

const F8_DRIFT: RuleRow = { id: 'F8_DRIFT', threshold: { abs_drift: 0.05, rel_drift: 0.25 }, enabled: true };
const BANDS: DriftBands = { absDrift: 0.05, relDrift: 0.25, warnShare: 0.5 };

/** A regular pool of NT$100,000 split by class as given, in NT$. */
function pool(byClass: Record<string, number>) {
  return regularPool(
    Object.entries(byClass).map(([assetClassId, valueTwd]) =>
      holding({ key: `regular:${assetClassId}`, ticker: assetClassId, assetClassId, sleeve: ['us_stocks', 'tw_stocks', 'tactical_themes'].includes(assetClassId) ? 'satellite' : 'core', valueTwd }),
    ),
  );
}

describe('driftBands', () => {
  it('reads the 5/25 rule and the amber share', () => {
    assert.deepEqual(driftBands(F8_DRIFT, { warn_share: 0.5 }), BANDS);
  });

  it('has no amber without the setting, and no band while the rule is off or malformed', () => {
    assert.equal(driftBands(F8_DRIFT, null)?.warnShare, 1);
    assert.equal(driftBands(F8_DRIFT, { warn_share: 1.5 })?.warnShare, 1);
    assert.equal(driftBands({ ...F8_DRIFT, enabled: false }, { warn_share: 0.5 }), undefined);
    assert.equal(driftBands({ ...F8_DRIFT, threshold: { abs_drift: '5%' } }, {}), undefined);
    assert.equal(driftBands(undefined, {}), undefined);
  });
});

describe('classDrifts', () => {
  it('turns a core class red past 5 pp or a quarter of its target, amber past half of that', () => {
    // Targets: US/global 28%, Taiwan 12%, bonds 22%, real assets 10%, cash 8%, satellite 20%.
    const weights = pool({
      us_global_equity: 33_100, // +5.1 pp: past the 5 pp band
      tw_market_cap: 13_600, // +1.6 pp: band min(5, 12 × 25% = 3) pp, amber past 1.5
      global_bonds: 21_000, // −1.0 pp: within half of 5 pp
      real_assets: 7_400, // −2.6 pp: past a quarter of 10%
      strategic_cash: 4_900, // −3.1 pp: past a quarter of 8%
      us_stocks: 20_000, // satellite: left to R2
    });
    const drifts = classDrifts(classWeights(weights, ASSET_CLASSES), BANDS, weights.totalTwd);
    const byId = Object.fromEntries(drifts.map((row) => [row.assetClass.id, row]));
    assert.equal(byId['us_global_equity']?.status, 'rebalance');
    assert.equal(byId['tw_market_cap']?.status, 'watch');
    assert.ok(Math.abs((byId['tw_market_cap']?.band ?? 0) - 0.03) < 1e-12);
    assert.equal(byId['global_bonds']?.status, 'ok');
    assert.equal(byId['global_bonds']?.band, 0.05);
    assert.equal(byId['real_assets']?.status, 'rebalance');
    assert.equal(byId['strategic_cash']?.status, 'rebalance');
    assert.deepEqual([byId['us_stocks']?.status, byId['us_stocks']?.band], ['unchecked', null]);
  });

  it('is green exactly at the edge of each band', () => {
    const atEdges = pool({ us_global_equity: 30_500, tw_market_cap: 15_000, global_bonds: 22_000, real_assets: 10_000, strategic_cash: 2_500, us_stocks: 20_000 });
    const drifts = classDrifts(classWeights(atEdges, ASSET_CLASSES), BANDS, atEdges.totalTwd);
    // +2.5 pp is half of 5 pp (amber starts after it); +3 pp is the Taiwan band itself (red starts after it).
    assert.equal(drifts.find((row) => row.assetClass.id === 'us_global_equity')?.status, 'ok');
    assert.equal(drifts.find((row) => row.assetClass.id === 'tw_market_cap')?.status, 'watch');
  });

  it('checks nothing with the rule off or nothing held', () => {
    const empty = regularPool([]);
    assert.ok(classDrifts(classWeights(empty, ASSET_CLASSES), BANDS, 0).every((row) => row.status === 'unchecked'));
    const some = pool({ us_global_equity: 100_000 });
    assert.ok(classDrifts(classWeights(some, ASSET_CLASSES), undefined, some.totalTwd).every((row) => row.status === 'unchecked' && row.band === null));
  });
});

describe('satelliteCheck', () => {
  it('is amber between R2’s 20% target and its 25% trigger, red above the trigger (PRD: NT$51,000 of NT$200,000)', () => {
    const red = regularPool([holding({ valueTwd: 149_000 }), holding({ key: 'regular:AAPL', ticker: 'AAPL', sleeve: 'satellite', valueTwd: 51_000 })]);
    assert.deepEqual(satelliteCheck(red, CAPS), { weight: 0.255, target: 0.2, trigger: 0.25, status: 'rebalance' });
    const amber = regularPool([holding({ valueTwd: 78_000 }), holding({ key: 'regular:AAPL', ticker: 'AAPL', sleeve: 'satellite', valueTwd: 22_000 })]);
    assert.equal(satelliteCheck(amber, CAPS)?.status, 'watch');
    const green = regularPool([holding({ valueTwd: 80_000 }), holding({ key: 'regular:AAPL', ticker: 'AAPL', sleeve: 'satellite', valueTwd: 20_000 })]);
    assert.equal(satelliteCheck(green, CAPS)?.status, 'ok');
    assert.equal(satelliteCheck(green, {}), undefined);
    assert.equal(satelliteCheck(regularPool([]), CAPS)?.status, 'unchecked');
  });
});

describe('allocation lenses', () => {
  const holdings = [
    holding({ key: 'regular:VT', valueTwd: 50_000 }),
    holding({ key: 'regular:AGGU', ticker: 'AGGU', label: 'iShares Core Global Aggregate Bond', productType: 'bond_etf', assetClassId: 'global_bonds', market: 'UK', valueTwd: 20_000 }),
    holding({ key: 'regular:GLDM', ticker: 'GLDM', label: 'SPDR Gold MiniShares Trust', productType: 'gold', assetClassId: 'real_assets', valueTwd: 6_000 }),
    holding({ key: 'manual:1', ticker: null, label: 'Gold bar', productType: 'gold', assetClassId: 'real_assets', market: null, valueTwd: 4_000 }),
    holding({ key: 'regular:2330', ticker: '2330', productType: 'stock', assetClassId: 'tw_stocks', sleeve: 'satellite', market: 'TW', valueTwd: 20_000 }),
    holding({ key: 'manual:2', ticker: null, label: 'Savings', productType: 'cash_mmf', assetClassId: 'strategic_cash', market: null, pool: 'windfall', valueTwd: 300_000 }),
    holding({ key: 'regular:AAPL', ticker: 'AAPL', productType: 'stock', sleeve: 'satellite', valueTwd: null }),
  ];

  it('puts physical gold with gold ETFs, and non-listed assets under "not listed"', () => {
    assert.equal(sliceOf(holdings[3]!, 'product'), 'gold');
    assert.equal(sliceOf(holdings[3]!, 'country'), 'unlisted');
    assert.equal(sliceOf(holdings[1]!, 'country'), 'UK');
  });

  it('splits the regular pool by product, listing country and sleeve, in a fixed order', () => {
    const regular = allocation(holdings, 'regular', sleeveTargets(ASSET_CLASSES));
    assert.equal(regular.totalTwd, 100_000);
    assert.deepEqual(
      regular.slices.product.map((slice) => [slice.key, slice.weight]),
      [
        ['equity_etf', 0.5],
        ['bond_etf', 0.2],
        ['gold', 0.1],
        ['stock', 0.2],
      ],
    );
    assert.deepEqual(
      regular.slices.country.map((slice) => [slice.key, slice.weight]),
      [
        ['US', 0.56],
        ['UK', 0.2],
        ['TW', 0.2],
        ['unlisted', 0.04],
      ],
    );
    // The gold slice lists its two holdings, largest first, each as a share of the pool.
    assert.deepEqual(
      regular.slices.product[2]?.holdings.map((member) => [member.label, member.weight]),
      [
        ['SPDR Gold MiniShares Trust', 0.06],
        ['Gold bar', 0.04],
      ],
    );
    assert.deepEqual(
      regular.unpriced.map((member) => member.ticker),
      ['AAPL'],
    );
  });

  it('draws the 80/20 target ring for the sleeve lens of the regular pool', () => {
    const sleeves = allocation(holdings, 'regular', sleeveTargets(ASSET_CLASSES)).slices.sleeve;
    assert.deepEqual(
      sleeves.map((slice) => [slice.key, slice.weight, Math.round((slice.target ?? 0) * 100) / 100]),
      [
        ['core', 0.8, 0.8],
        ['satellite', 0.2, 0.2],
      ],
    );
    assert.ok(allocation(holdings, 'all').slices.sleeve.every((slice) => slice.target === null));
  });

  it('keeps a slice with a target but nothing held, and leaves the windfall pool to its own scope', () => {
    const coreOnly = allocation([holding({ valueTwd: 10_000 })], 'regular', { core: 0.8, satellite: 0.2 });
    assert.deepEqual(
      coreOnly.slices.sleeve.map((slice) => [slice.key, slice.weight, slice.target]),
      [
        ['core', 1, 0.8],
        ['satellite', 0, 0.2],
      ],
    );
    const windfall = allocation(holdings, 'windfall');
    assert.equal(windfall.totalTwd, 300_000);
    assert.deepEqual(
      windfall.slices.product.map((slice) => slice.key),
      ['cash_mmf'],
    );
    assert.equal(allocation(holdings, 'all').totalTwd, 400_000);
  });
});
