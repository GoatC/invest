import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { backtest, capePercentile, drawdownOf, readAcceleration, readPace, schedule, tierAmount, tierToFire, trancheCount, type MarketMonth } from './windfall';

/** The seeded config windfall_pace and rule WINDFALL_ACCELERATION. */
const PACE = readPace({ gauge: 'sp500_cape_percentile', cutoffs: [30, 70], tranches: [6, 12, 24] });
const ACCELERATION = readAcceleration({
  index: 'ACWI',
  window_weeks: 52,
  tiers: [
    { drawdown: 0.15, deploy: 'next_tranche' },
    { drawdown: 0.25, deploy_share_of_remaining: 0.5 },
    { drawdown: 0.35, deploy_share_of_remaining: 1 },
  ],
});

describe('PRD Section 11 acceptance: F3', () => {
  it('pace: NT$5.5M at a CAPE percentile of 75 is 24 tranches of about NT$229,000', () => {
    assert.ok(PACE);
    const count = trancheCount(75, PACE);
    assert.equal(count, 24);
    const tranches = schedule(5_500_000, '2026-11-02', count);
    assert.equal(tranches.length, 24);
    assert.ok(tranches.every((tranche) => Math.abs(tranche.amountTwd - 229_000) < 500));
    assert.equal(
      tranches.reduce((sum, tranche) => sum + tranche.amountTwd, 0),
      5_500_000,
    );
    assert.deepEqual(
      [tranches[0]?.dueDate, tranches[1]?.dueDate, tranches[23]?.dueDate],
      ['2026-11-02', '2026-12-02', '2028-10-02'],
    );
  });

  it('acceleration: at −16% the next tranche is merged; at −26% half the rest goes in; each tier fires once', () => {
    assert.ok(ACCELERATION);
    const { tiers } = ACCELERATION;
    // One tranche done: NT$5,270,833 waits for 23 tranches.
    const first = tierToFire(tiers, 0.16, []);
    assert.deepEqual(first, { drawdown: 0.15, deploy: { kind: 'next_tranche' } });
    assert.equal(Math.round(tierAmount(first, 5_270_833, 23)), 229_167);
    const second = tierToFire(tiers, 0.26, [0.15]);
    assert.deepEqual(second, { drawdown: 0.25, deploy: { kind: 'share', share: 0.5 } });
    assert.equal(tierAmount(second, 4_812_500, 21), 2_406_250);
    assert.equal(tierToFire(tiers, 0.26, [0.15, 0.25]), undefined);
    // Back up to −16% in the same drawdown: nothing fires again.
    assert.equal(tierToFire(tiers, 0.16, [0.15, 0.25]), undefined);
  });
});

describe('the valuation gauge and the pace', () => {
  it("puts CAPE among every month up to it, itself included, and reads the newest month on or before the one asked", () => {
    const series = [
      { month: '2026-05', value: 30 },
      { month: '2026-06', value: 10 },
      { month: '2026-07', value: 20 },
      { month: '2026-08', value: 40 },
      { month: '2026-09', value: 25 },
    ];
    assert.deepEqual(capePercentile(series), { month: '2026-09', cape: 25, percentile: 60, months: 5 });
    assert.deepEqual(capePercentile(series, '2026-07-15'), { month: '2026-07', cape: 20, percentile: (100 * 2) / 3, months: 3 });
    assert.equal(capePercentile([], '2026-07'), null);
  });

  it('counts 6 tranches below the 30th percentile, 12 up to the 70th, 24 above it', () => {
    assert.ok(PACE);
    assert.deepEqual(
      [29.9, 30, 70, 70.1].map((percentile) => trancheCount(percentile, PACE)),
      [6, 12, 12, 24],
    );
    assert.equal(readPace({ cutoffs: [70, 30], tranches: [6, 12, 24] }), null);
    assert.equal(readPace({ cutoffs: [30, 70], tranches: [6, 12] }), null);
  });

  it('falls due on the same day each month, or the last day of a shorter month', () => {
    assert.deepEqual(
      schedule(300, '2026-01-31', 3).map((tranche) => [tranche.dueDate, tranche.amountTwd]),
      [
        ['2026-01-31', 100],
        ['2026-02-28', 100],
        ['2026-03-31', 100],
      ],
    );
  });
});

describe('the drawdown', () => {
  const closes = [
    { date: '2025-09-01', close: 120 },
    { date: '2025-11-03', close: 100 },
    { date: '2026-02-02', close: 100 },
    { date: '2026-10-20', close: 84 },
  ];

  it('measures the newest close from the highest of the 52 weeks before it, named by its first date', () => {
    const drawdown = drawdownOf(closes, '2026-10-21', 52);
    assert.deepEqual(drawdown?.peak, { date: '2025-11-03', close: 100 });
    assert.ok(Math.abs((drawdown?.drawdown ?? 0) - 0.16) < 1e-12);
    assert.equal(drawdownOf([], '2026-10-21', 52), null);
  });

  it('reads the tiers shallowest first, and refuses a malformed one', () => {
    assert.deepEqual(
      ACCELERATION?.tiers.map((tier) => tier.drawdown),
      [0.15, 0.25, 0.35],
    );
    assert.equal(readAcceleration({ window_weeks: 52, tiers: [{ drawdown: 1.5, deploy: 'next_tranche' }] }), null);
    assert.equal(readAcceleration({ window_weeks: 52, tiers: [{ drawdown: 0.2, deploy: 'everything' }] }), null);
  });

  it('counts a deeper tier as firing those above it, and starts over in a new drawdown', () => {
    assert.ok(ACCELERATION);
    assert.equal(tierToFire(ACCELERATION.tiers, 0.4, [])?.drawdown, 0.35);
    assert.equal(tierToFire(ACCELERATION.tiers, 0.2, [0.35]), undefined);
    assert.equal(tierToFire(ACCELERATION.tiers, 0.1, []), undefined);
  });
});

describe('backtest', () => {
  /** 120 flat months for the gauge's history, then the months given; CAPE rising, so each start is at the 100th percentile. */
  function market(prices: readonly number[]): MarketMonth[] {
    const all = [...Array.from({ length: 119 }, () => 100), ...prices];
    return all.map((price, index) => ({ month: `${1800 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`, price, yield: 0, cape: 10 + index }));
  }

  it('grows a lump sum and each tranche with the market, the waiting cash at its own rate', () => {
    assert.ok(PACE);
    const result = backtest(market([100, 110, 121]), { pace: { cutoffs: [30, 70], tranches: [2, 2, 2] }, acceleration: null, cashReturn: 0, horizonMonths: 2, fromYear: 1800 });
    assert.equal(result?.rows.length, 1);
    const [row] = result?.rows ?? [];
    // Lump: 1 × 1.1 × 1.1. Pace: half at the start (× 1.21), half a month on (× 1.1).
    assert.ok(Math.abs((row?.lump ?? 0) - 1.21) < 1e-12);
    assert.ok(Math.abs((row?.pace ?? 0) - 1.155) < 1e-12);
    assert.equal(row?.rule, row?.pace);
    assert.equal(result?.paceVsLump.wins, 0);
  });

  it('accelerates in a fall: at −16% the next tranche is bought there too, instead of later at a higher price', () => {
    assert.ok(ACCELERATION);
    const result = backtest(market([100, 84, 100, 110, 120]), { pace: { cutoffs: [30, 70], tranches: [4, 4, 4] }, acceleration: ACCELERATION, cashReturn: 0, horizonMonths: 4, fromYear: 1800 });
    const [row] = result?.rows ?? [];
    assert.ok(row);
    // Pace: a quarter at 100, 84, 100 and 110, all ending at 120; the rule buys the last quarter at 84 too.
    assert.ok(Math.abs(row.pace - (0.25 * 1.2 + 0.25 * (120 / 84) + 0.25 * 1.2 + 0.25 * (120 / 110))) < 1e-12);
    assert.ok(Math.abs(row.rule - (0.25 * 1.2 + 0.5 * (120 / 84) + 0.25 * 1.2)) < 1e-12);
    assert.equal(result?.ruleVsPace.wins, 1);
  });
});
