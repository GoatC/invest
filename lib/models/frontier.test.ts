import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  build,
  correlationMatrix,
  covarianceMatrix,
  expectedReturn,
  frontier,
  highestReturn,
  marketLine,
  readFrontierSettings,
  sharpe,
  solve,
  tangent,
  volatility,
  weightsFor,
  type Built,
  type Problem,
} from './frontier';

function near(actual: number | null | undefined, expected: number, tolerance = 1e-7): void {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);
}

/** Two uncorrelated classes: 10% and 20% volatility, 8% and 12% expected return. */
const TWO: Problem = { mu: [0.08, 0.12], sigma: [[0.01, 0], [0, 0.04]], lo: [0, 0], hi: [1, 1] };

describe('F7 acceptance (PRD Section 11)', () => {
  it('the minimum-variance mix of two uncorrelated classes of 10% and 20% volatility is 80 / 20, with a volatility of 8.944%', () => {
    const w = solve(TWO, 0);
    near(w[0], 0.8);
    near(w[1], 0.2);
    near(volatility(w, TWO.sigma), Math.sqrt(0.008));
  });

  it('the tangent portfolio at a 2% risk-free rate puts weights in proportion to Σ⁻¹(μ − Rf): 70.59 / 29.41, Sharpe 0.7810', () => {
    const curve = frontier(TWO, 60);
    const best = tangent(TWO, curve, 0.02);
    assert.ok(best);
    near(best.weights[0], 6 / 8.5, 1e-5);
    near(best.weights[1], 2.5 / 8.5, 1e-5);
    near(best.sharpe, Math.sqrt(0.61), 1e-6);
  });

  it('Sharpe = (E[Rp] − Rf) ÷ σp: 10% with a 2% rate and 16% volatility is 0.5', () => {
    near(sharpe(0.1, 0.16, 0.02), 0.5);
    assert.equal(sharpe(0.1, 0, 0.02), null);
  });

  it('the capital market line runs from (0, Rf) through the tangent portfolio', () => {
    const point = { ret: 0.0814, vol: 0.0783 };
    near(marketLine(point, 0.02, 0), 0.02);
    near(marketLine(point, 0.02, point.vol), point.ret);
    near(marketLine(point, 0.02, 2 * point.vol), 0.02 + 2 * (point.ret - 0.02));
  });
});

describe('solve', () => {
  it('keeps weights within the bounds and summing to 1: a 50% cap on the better class binds', () => {
    const capped: Problem = { ...TWO, hi: [1, 0.5] };
    const w = solve(capped, 1000);
    near(w[1], 0.5);
    near(w[0], 0.5);
    near(w.reduce((a, b) => a + b, 0), 1, 1e-12);
  });

  it('holds a class at its minimum when the bounds say so', () => {
    const w = solve({ ...TWO, lo: [0.3, 0] }, 1000);
    near(w[0], 0.3);
    near(w[1], 0.7);
  });

  it('splits across perfectly correlated classes of equal variance without stalling', () => {
    const same: Problem = { mu: [0.05, 0.06], sigma: [[0.04, 0.04], [0.04, 0.04]], lo: [0, 0], hi: [1, 1] };
    const w = solve(same, 1);
    near(w[1], 1);
  });

  it('refuses bounds that cannot sum to 1', () => {
    assert.throws(() => solve({ ...TWO, hi: [0.3, 0.3] }, 0), /bounds cannot sum to 1/);
    assert.throws(() => solve({ ...TWO, lo: [0.6, 0.6] }, 0), /bounds cannot sum to 1/);
  });
});

describe('frontier', () => {
  const four: Problem = {
    mu: [0.07, 0.05, 0.03, 0.01],
    sigma: [
      [0.04, 0.006, 0.001, 0],
      [0.006, 0.0225, 0.001, 0],
      [0.001, 0.001, 0.0016, 0.0001],
      [0, 0, 0.0001, 0.0001],
    ],
    lo: [0, 0, 0, 0],
    hi: [0.6, 0.5, 0.6, 0.3],
  };

  it('runs from the minimum-variance portfolio to the highest return the bounds allow, volatility rising with return', () => {
    const curve = frontier(four, 30);
    assert.equal(curve.length, 30);
    const top = highestReturn(four);
    assert.ok(top);
    near(curve[curve.length - 1]?.ret, top.ret, 1e-6);
    near(top.ret, 0.6 * 0.07 + 0.4 * 0.05, 1e-12);
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1];
      const b = curve[i];
      assert.ok(a && b && b.ret > a.ret - 1e-9 && b.vol > a.vol - 1e-9, `point ${i}`);
    }
  });

  it('every point sums to 1 within the bounds and reports its own return and volatility', () => {
    for (const point of frontier(four, 20)) {
      near(point.weights.reduce((a, b) => a + b, 0), 1, 1e-9);
      point.weights.forEach((weight, i) => assert.ok(weight >= (four.lo[i] as number) - 1e-9 && weight <= (four.hi[i] as number) + 1e-9));
      near(point.ret, expectedReturn(point.weights, four.mu), 1e-12);
      near(point.vol, volatility(point.weights, four.sigma), 1e-12);
    }
  });

  it('is one point when every class earns the same', () => {
    const flat: Problem = { ...TWO, mu: [0.05, 0.05] };
    assert.equal(frontier(flat, 20).length, 1);
  });

  it('has no tangent portfolio when nothing beats the risk-free rate', () => {
    assert.equal(tangent(four, frontier(four, 20), 0.08), null);
  });

  it('puts the tangent portfolio on the frontier with the best Sharpe ratio of its points', () => {
    const curve = frontier(four, 40);
    const best = tangent(four, curve, 0.015);
    assert.ok(best);
    for (const point of curve) assert.ok((sharpe(point.ret, point.vol, 0.015) ?? 0) <= best.sharpe + 1e-9);
  });
});

describe('covariance and correlation', () => {
  it('is the sample covariance times 12: two columns of monthly returns', () => {
    const a = [0.01, 0.03, 0.02, 0.04];
    const b = [0.02, 0.06, 0.04, 0.08];
    const cov = covarianceMatrix([a, b]);
    // var(a) = 1.6667e-4 (sample); b is 2 × a: var(b) = 4 var(a), cov = 2 var(a).
    near(cov[0]?.[0], (0.0005 / 3) * 12, 1e-12);
    near(cov[1]?.[1], 4 * (0.0005 / 3) * 12, 1e-12);
    near(cov[0]?.[1], 2 * (0.0005 / 3) * 12, 1e-12);
    const corr = correlationMatrix(cov);
    near(corr[0]?.[1], 1, 1e-12);
    near(corr[1]?.[1], 1);
  });

  it('gives a class with no variance a correlation of 0 with the others', () => {
    const corr = correlationMatrix(covarianceMatrix([[0.01, 0.02, 0.03], [0.01, 0.01, 0.01]]));
    assert.equal(corr[0]?.[1], 0);
    assert.equal(corr[1]?.[1], 1);
  });
});

describe('build', () => {
  const months = Array.from({ length: 48 }, (_, i) => `${2022 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  const series = (f: (i: number) => number) => months.map((month, i) => ({ date: `${month}-28`, value: f(i) }));
  const bounds = { a: [0, 1], b: [0, 1], c: [0, 1] } as Record<string, [number, number]>;
  const classes = [
    { id: 'a', expected: 0.07, returns: series((i) => Math.sin(i) * 0.04) },
    { id: 'b', expected: 0.03, returns: series((i) => Math.cos(i * 1.3) * 0.01) },
    { id: 'c', expected: null, returns: series(() => 0) },
  ];

  it('builds the problem on the common months and names a class left out', () => {
    const built = build(classes, bounds, { minMonths: 36 }) as Built;
    assert.deepEqual(built.ids, ['a', 'b']);
    assert.deepEqual(built.left, [{ id: 'c', reason: 'assumption' }]);
    assert.equal(built.months, 48);
    assert.equal(built.from, '2022-01');
    assert.deepEqual(built.model.mu, [0.07, 0.03]);
    near(built.correlation[0]?.[0], 1);
    assert.equal((build(classes, bounds, { minMonths: 36 }, 40) as Built).months, 40);
  });

  it('asks for more history, or says nothing can be built', () => {
    assert.deepEqual(build(classes, bounds, { minMonths: 60 }), { problem: 'history', months: 48, need: 60 });
    assert.deepEqual(build([], bounds, { minMonths: 36 }), { problem: 'classes' });
    assert.deepEqual(build(classes, { a: [0, 0.3], b: [0, 0.3] }, { minMonths: 36 }), { problem: 'bounds' });
    const unbounded = build(classes, { a: [0, 1] }, { minMonths: 36 }) as Built;
    assert.deepEqual(unbounded.left, [{ id: 'b', reason: 'bounds' }, { id: 'c', reason: 'assumption' }]);
  });

  it('re-weights a mix to the classes used', () => {
    const w = weightsFor(['a', 'b'], { a: 0.3, b: 0.1, c: 0.6 });
    near(w?.[0], 0.75, 1e-12);
    near(w?.[1], 0.25, 1e-12);
    assert.equal(weightsFor(['a'], { b: 1 }), null);
  });
});

describe('readFrontierSettings', () => {
  const valid = { lookback_years: 10, min_months: 36, points: 40, risk_free: 0.017, bounds: { a: [0, 0.5], b: [0.1, 0.4] } };

  it('reads the row with its bounds', () => {
    const settings = readFrontierSettings(valid, '2026-10-29');
    assert.deepEqual(settings?.bounds, { a: [0, 0.5], b: [0.1, 0.4] });
    assert.equal(settings?.riskFree, 0.017);
    assert.equal(settings?.lastVerified, '2026-10-29');
  });

  it('refuses a row that is missing or out of range', () => {
    assert.equal(readFrontierSettings(undefined), undefined);
    assert.equal(readFrontierSettings({ ...valid, points: 2 }), undefined);
    assert.equal(readFrontierSettings({ ...valid, risk_free: 0.5 }), undefined);
    assert.equal(readFrontierSettings({ ...valid, bounds: { a: [0.6, 0.5] } }), undefined);
    assert.equal(readFrontierSettings({ ...valid, bounds: {} }), undefined);
  });
});
