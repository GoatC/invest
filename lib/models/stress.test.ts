import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { customReplay, readStressSettings, replay, type Scenario, type StressSettings } from './stress';
import type { Tier } from './windfall';

function near(actual: number | null | undefined, expected: number, tolerance = 1e-9): void {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);
}

const SETTINGS: Pick<StressSettings, 'map' | 'gauge'> = { map: { equity: 'stocks', bonds: 'bonds' }, gauge: 'stocks' };
const TIERS: Tier[] = [
  { drawdown: 0.15, deploy: { kind: 'next_tranche' } },
  { drawdown: 0.25, deploy: { kind: 'share', share: 0.5 } },
  { drawdown: 0.35, deploy: { kind: 'share', share: 1 } },
];

function scenario(stocks: number[], bonds: number[]): Scenario {
  return { id: 'test', nameEn: 'Test', nameZh: '測試', from: '2008-01', returns: { stocks, bonds } };
}

const MIX = [
  { id: 'equity', valueTwd: 60 },
  { id: 'bonds', valueTwd: 40 },
];

describe('F10 acceptance (PRD Section 11)', () => {
  it('replays a 60 / 40 mix buy-and-hold: stocks −10%, −20%, +30%, +30% with bonds +1% a month falls 15.996% by month 2 and is back in 2 more months', () => {
    const result = replay(scenario([-0.1, -0.2, 0.3, 0.3], [0.01, 0.01, 0.01, 0.01]), MIX, SETTINGS, TIERS, 52);
    near(result.months[1]?.value, 94.4);
    near(result.months[2]?.value, 84.004);
    near(result.months[3]?.value, 97.37204);
    assert.equal(result.troughMonth, '2008-02');
    near(result.maxDrawdown, 0.15996);
    near(result.maxDrawdownTwd, 15.996);
    assert.equal(result.recoveryMonths, 2);
    near(result.months[4]?.value, 73.008 + 41.21204 * 1.01, 1e-9);
  });

  it('does not recover when the scenario ends first', () => {
    const result = replay(scenario([-0.1, -0.2, 0.3], [0.01, 0.01, 0.01]), MIX, SETTINGS, TIERS, 52);
    assert.equal(result.recoveryMonths, null);
    assert.equal(result.troughMonth, '2008-02');
  });

  it('fires F3’s tiers by the gauge, each once: stocks −10% a month reach 19% and 27.1% below the high', () => {
    const result = replay(scenario([-0.1, -0.1, -0.1], [0, 0, 0]), MIX, SETTINGS, TIERS, 52);
    assert.deepEqual(
      result.tiers.map((fired) => [fired.tier, fired.month]),
      [
        [0.15, '2008-02'],
        [0.25, '2008-03'],
      ],
    );
    near(result.tiers[0]?.reached, 0.19);
    near(result.tiers[1]?.reached, 0.271);
  });

  it('counts a deeper tier as firing those above it, and fires them again only after a new high', () => {
    // A 30% fall in one month reaches the 15% and 25% tiers together.
    const crash = replay(scenario([-0.3], [0]), MIX, SETTINGS, TIERS, 52);
    assert.deepEqual(crash.tiers.map((fired) => fired.tier), [0.15, 0.25]);
    // Back to a new high (+50% takes 0.7 to 1.05), then another fall of 20% fires the 15% tier again.
    const again = replay(scenario([-0.3, 0.5, -0.2], [0, 0, 0]), MIX, SETTINGS, TIERS, 52);
    assert.deepEqual(again.tiers.map((fired) => [fired.tier, fired.month]), [[0.15, '2008-01'], [0.25, '2008-01'], [0.15, '2008-03']]);
  });

  it('holds a class with no series flat and says so', () => {
    const result = replay(scenario([-0.5], [0]), [...MIX, { id: 'mystery', valueTwd: 100 }], SETTINGS, TIERS, 52);
    assert.deepEqual(result.unmapped, ['mystery']);
    near(result.byClass.find((entry) => entry.id === 'mystery')?.end, 100);
    near(result.endValue, 60 * 0.5 + 40 + 100);
  });

  it('replays a custom shock then the expected returns: −30% on all stocks at 6% a year is back after 72 months', () => {
    const result = customReplay('2027-01', [{ id: 'equity', valueTwd: 100 }], { equity: -0.3 }, { equity: 0.06 }, 360);
    near(result.maxDrawdown, 0.3);
    assert.equal(result.troughMonth, '2027-01');
    // 0.7 × 1.005^n ≥ 1 first holds at n = 72 (ln(1 / 0.7) ÷ ln 1.005 = 71.5).
    assert.equal(result.recoveryMonths, 72);
    assert.equal(result.months.length, 1 + 1 + 72);
    assert.equal(customReplay('2027-01', [{ id: 'equity', valueTwd: 100 }], { equity: -0.3 }, { equity: 0.06 }, 24).recoveryMonths, null);
  });
});

describe('a replay without a fall', () => {
  it('needs no recovery and names no trough', () => {
    const result = replay(scenario([0.01, 0.02], [0.01, 0.01]), MIX, SETTINGS, TIERS, 52);
    assert.equal(result.maxDrawdown, 0);
    assert.equal(result.troughMonth, null);
    assert.equal(result.recoveryMonths, 0);
    assert.deepEqual(result.tiers, []);
  });
});

describe('readStressSettings', () => {
  const valid = {
    series: { stocks: { name_en: 'US stocks', name_zh: '美股' }, bonds: { name_en: 'Bonds', name_zh: '債券' } },
    scenarios: [{ id: 'gfc', name_en: '2008', name_zh: '金融海嘯', from: '2007-10', returns: { stocks: [-0.05, -0.1], bonds: [0.01, 0.02] } }],
    map: { equity: 'stocks', bonds: 'bonds', ghost: 'nothing' },
    gauge: 'stocks',
    custom: { max_months: 120, shocks: { equity: -0.3, odd: -5 } },
    source: 'FinMind, FRED',
  };

  it('reads the row, leaving out a class mapped to an unknown series and a shock that is not one', () => {
    const settings = readStressSettings(valid, '2026-10-29');
    assert.ok(settings);
    assert.deepEqual(settings.map, { equity: 'stocks', bonds: 'bonds' });
    assert.deepEqual(settings.customShocks, { equity: -0.3 });
    assert.equal(settings.scenarios[0]?.returns['stocks']?.length, 2);
    assert.equal(settings.lastVerified, '2026-10-29');
  });

  it('refuses a scenario whose series differ in length or miss, and a gauge that is not a series', () => {
    assert.equal(readStressSettings(undefined), undefined);
    assert.equal(readStressSettings({ ...valid, scenarios: [{ ...valid.scenarios[0], returns: { stocks: [-0.05], bonds: [0.01, 0.02] } }] }), undefined);
    assert.equal(readStressSettings({ ...valid, scenarios: [{ ...valid.scenarios[0], returns: { stocks: [-0.05, -1.5], bonds: [0.01, 0.02] } }] }), undefined);
    assert.equal(readStressSettings({ ...valid, gauge: 'nothing' }), undefined);
    assert.equal(readStressSettings({ ...valid, custom: { max_months: 3 } }), undefined);
  });
});
