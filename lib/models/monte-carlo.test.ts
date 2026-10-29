import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calibrate,
  expectedWindfall,
  mcSettingsValue,
  monteCarlo,
  monthSeed,
  valueBins,
  quantile,
  readMcSettings,
  seededRandom,
  windfallFromPlan,
  type Calibration,
  type ClassHistory,
  type McInput,
} from './monte-carlo';
import { futureValue, monthlyReturn, type Plan } from './projection';

function near(actual: number | undefined, expected: number, tolerance = 1e-9): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);
}

const SETTINGS = { paths: 500, blockMonths: 3, band: [0.1, 0.9] as [number, number], markYears: [10, 20, 30], targetTwd: null as number | null };
const PLAN: Plan = { pv: 0, pmt: 10_000, stepUp: 0, expectedReturn: 0.06, inflation: 0.02, years: 30 };

/** `n` months, one class, a return of `values[i % values.length]` each month. */
function history(id: string, weight: number, core: boolean, values: readonly number[], n = 60): ClassHistory {
  return {
    id,
    weight,
    core,
    returns: Array.from({ length: n }, (_, i) => {
      const month = `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
      return { date: `${month}-28`, value: values[i % values.length] as number };
    }),
  };
}

function flat(rows: number, perMonth: number): Calibration {
  return {
    from: '2021-01',
    to: '2025-12',
    months: rows,
    classes: [],
    regular: new Float64Array(rows).fill(perMonth),
    core: new Float64Array(rows).fill(perMonth),
    regularMean: perMonth,
    coreMean: perMonth,
    left: [],
    leftShare: 0,
  };
}

function run(overrides: Partial<McInput> = {}) {
  return monteCarlo({ plan: PLAN, start: '2026-11', calibration: flat(36, monthlyReturn(0.06)), windfall: null, settings: SETTINGS, seed: 1, ...overrides });
}

describe('F5 acceptance (PRD Section 11)', () => {
  it('with no volatility every path is F2: PMT NT$10,000, 6% a year, 30 years gives ≈ NT$10,045,000 at the median and both edges', () => {
    const result = run();
    const closed = futureValue({ pv: 0, pmt: 10_000, g: 0, months: 360, r: monthlyReturn(0.06) });
    assert.equal(Math.round(closed / 1000) * 1000, 10_045_000);
    const last = result.fan[30];
    near(last?.median, closed, 1e-5);
    near(last?.low, closed, 1e-5);
    near(last?.high, closed, 1e-5);
    near(last?.expected, closed, 1e-5);
    near(last?.realMedian, closed / 1.02 ** 30, 1e-5);
    assert.deepEqual(
      result.marks.map((mark) => mark.year),
      [10, 20, 30],
    );
  });

  it('with no return and no inflation the value is the money put in, and every path ends alike', () => {
    const result = run({ plan: { pv: 50_000, pmt: 1_000, stepUp: 0, expectedReturn: 0, inflation: 0, years: 2 }, calibration: flat(36, 0) });
    near(result.fan[2]?.median, 50_000 + 24_000);
    near(result.fan[2]?.putIn, 74_000);
    assert.equal(result.belowPutIn, 0);
  });

  it('reaches a target in today’s money in every path or none, when the paths are alike', () => {
    const reachable = run({ settings: { ...SETTINGS, targetTwd: 5_000_000 } });
    assert.equal(reachable.fan[30]?.reaching, 1);
    const closed = futureValue({ pv: 0, pmt: 10_000, g: 0, months: 360, r: monthlyReturn(0.06) });
    const out = run({ settings: { ...SETTINGS, targetTwd: closed / 1.02 ** 30 + 1 } });
    assert.equal(out.fan[30]?.reaching, 0);
    assert.equal(run().fan[30]?.reaching, null);
  });
});

describe('the band', () => {
  const rows = [0.06, -0.05, 0.02, 0.01, -0.02, 0.03];
  const wide: Calibration = { ...flat(36, 0), regular: Float64Array.from({ length: 36 }, (_, i) => rows[i % rows.length] as number), core: new Float64Array(36), regularMean: 0.005 };

  it('opens with the years and holds the median between its edges', () => {
    const result = run({ calibration: wide });
    for (const point of result.fan) {
      assert.ok(point.low <= point.median && point.median <= point.high, `year ${point.year}`);
    }
    const [first, tenth, last] = [result.fan[1], result.fan[10], result.fan[30]];
    assert.ok(first && tenth && last);
    assert.ok(last.high - last.low > tenth.high - tenth.low);
    assert.ok(tenth.high - tenth.low > first.high - first.low);
    assert.equal(result.fan[0]?.low, 0);
  });

  it('is the same on every run with a seed, and moves with another', () => {
    const a = run({ calibration: wide, seed: 7 });
    const b = run({ calibration: wide, seed: 7 });
    const c = run({ calibration: wide, seed: 8 });
    assert.equal(a.fan[30]?.median, b.fan[30]?.median);
    assert.notEqual(a.fan[30]?.median, c.fan[30]?.median);
  });

  it('keeps the historical rows whole: a month never mixes two months’ classes', () => {
    // One class always returns the negative of another; any bootstrap of whole rows keeps the sum 0.
    const up = history('a', 0.5, true, [0.04, -0.03, 0.01]);
    const down = history('b', 0.5, true, [-0.04, 0.03, -0.01]);
    const out = calibrate([up, down], { a: { expectedReturn: 0, volatility: 0.1 }, b: { expectedReturn: 0, volatility: 0.1 } }, { scaleToCma: false, minMonths: 36 });
    assert.ok('regular' in out);
    for (const value of (out as Calibration).regular) near(value, 0, 1e-12);
  });
});

describe('quantile and the generator', () => {
  it('interpolates between neighbours', () => {
    const sorted = [1, 2, 3, 4, 5];
    assert.equal(quantile(sorted, 0), 1);
    assert.equal(quantile(sorted, 0.5), 3);
    assert.equal(quantile(sorted, 1), 5);
    near(quantile(sorted, 0.1), 1.4);
    near(quantile([10, 20], 0.25), 12.5);
  });

  it('draws evenly from [0, 1)', () => {
    const random = seededRandom(1);
    const draws = Array.from({ length: 20_000 }, random);
    assert.ok(draws.every((value) => value >= 0 && value < 1));
    near(draws.reduce((a, b) => a + b, 0) / draws.length, 0.5, 0.01);
    assert.deepEqual(Array.from({ length: 3 }, seededRandom(5)), Array.from({ length: 3 }, seededRandom(5)));
  });

  it('seeds a run by its month', () => {
    assert.equal(monthSeed('2026-11'), 202611);
  });
});

describe('calibrate', () => {
  const a = history('a', 0.6, true, [0.05, -0.04, 0.02, 0.01, -0.01, 0.03]);
  const b = history('b', 0.3, false, [0.02, 0.01, -0.02, 0.03, -0.01, 0.0]);
  const c = history('c', 0.1, false, [0.01]);

  it('centres a class on its expected return ÷ 12 (F2’s monthly return) and scales it to its volatility', () => {
    const out = calibrate([a, b], { a: { expectedReturn: 0.08, volatility: 0.15 }, b: { expectedReturn: 0.04, volatility: 0.1 } }, { scaleToCma: true, minMonths: 36 }) as Calibration;
    const first = out.classes[0];
    near(first?.mean, 0.08 / 12);
    near(first?.vol, 0.15 / Math.sqrt(12), 1e-12);
    // Re-weighted to 100% of the two simulated classes.
    near(out.classes[0]?.weight, 0.6 / 0.9);
    near(out.classes[1]?.weight, 0.3 / 0.9);
    near(out.regularMean, (0.6 / 0.9) * (0.08 / 12) + (0.3 / 0.9) * (0.04 / 12));
    // The calibrated history averages to that mean.
    const average = out.regular.reduce((sum, value) => sum + value, 0) / out.regular.length;
    near(average, out.regularMean, 1e-12);
    // Only class a is core: the core mix is a alone.
    near(out.coreMean, 0.08 / 12);
    assert.equal(out.months, 60);
  });

  it('keeps the historical volatility when it is not scaled', () => {
    const out = calibrate([a], { a: { expectedReturn: 0.08, volatility: 0.5 } }, { scaleToCma: false, minMonths: 36 }) as Calibration;
    near(out.classes[0]?.vol, out.classes[0]?.historyVol ?? NaN);
  });

  it('leaves out a class with no assumption or no history, and says how much of the targets that is', () => {
    const empty: ClassHistory = { id: 'e', weight: 0.1, core: false, returns: [] };
    const out = calibrate([{ ...a, weight: 0.5 }, b, empty, c], { a: { expectedReturn: 0.08, volatility: 0.15 }, c: { expectedReturn: 0.03, volatility: 0.05 }, e: { expectedReturn: 0.03, volatility: 0.05 } }, { scaleToCma: true, minMonths: 36 }) as Calibration;
    assert.deepEqual(out.left, [
      { id: 'b', reason: 'assumption' },
      { id: 'e', reason: 'history' },
    ]);
    near(out.leftShare, 0.4);
    assert.deepEqual(
      out.classes.map((entry) => entry.id),
      ['a', 'c'],
    );
  });

  it('uses only the months every class has, and asks for more when there are too few', () => {
    const short = history('s', 0.4, true, [0.01], 24);
    const out = calibrate([a, short], { a: { expectedReturn: 0.08, volatility: 0.15 }, s: { expectedReturn: 0.03, volatility: 0.05 } }, { scaleToCma: true, minMonths: 36 });
    assert.deepEqual(out, { problem: 'history', months: 24, need: 36 });
    assert.deepEqual(calibrate([a], {}, { scaleToCma: true, minMonths: 36 }), { problem: 'classes' });
    const lately = calibrate([a], { a: { expectedReturn: 0.08, volatility: 0.15 } }, { scaleToCma: true, minMonths: 36 }, 40) as Calibration;
    assert.equal(lately.months, 40);
    assert.equal(lately.to, '2025-12');
  });
});

describe('the windfall', () => {
  const flatPlan: Plan = { pv: 0, pmt: 0, stepUp: 0, expectedReturn: 0, inflation: 0, years: 2 };

  it('is counted from its saved tranches: what waits stays cash, what is deployed earns the core mix', () => {
    const money = windfallFromPlan(
      {
        tranches: [
          { dueDate: '2026-09-01', amountTwd: 100_000, status: 'done' },
          { dueDate: '2026-12-01', amountTwd: 100_000, status: 'scheduled' },
          { dueDate: '2027-01-01', amountTwd: 100_000, status: 'scheduled' },
        ],
      },
      400_000,
      '2026-11',
      0,
    );
    assert.equal(money.waiting, 200_000);
    assert.equal(money.deployed, 200_000);
    assert.deepEqual(money.deployments, [
      { month: 2, amount: 100_000 },
      { month: 3, amount: 100_000 },
    ]);
    // The core mix returns 1% a month, cash nothing.
    const result = run({ plan: flatPlan, calibration: flat(36, 0.01), windfall: money, settings: { ...SETTINGS, markYears: [1, 2] } });
    // Month 12: the deployed 200,000 earns 12 months; the tranches earn 11 and 10 months.
    near(result.fan[1]?.median, 200_000 * 1.01 ** 12 + 100_000 * 1.01 ** 10 + 100_000 * 1.01 ** 9, 1e-6);
    near(result.fan[0]?.median, 400_000);
  });

  it('keeps all the money when nothing earns: an expected windfall appears at its month, then the total holds', () => {
    const money = expectedWindfall({ amountTwd: 1_200_000, month: '2027-01', tranches: 12 }, '2026-11', 0, 0);
    assert.ok(money);
    assert.deepEqual(money.arrivals, [{ month: 3, amount: 1_200_000 }]);
    assert.equal(money.deployments.length, 12);
    const result = run({ plan: { ...flatPlan, years: 2 }, calibration: flat(36, 0), windfall: money });
    near(result.fan[0]?.median, 0);
    near(result.fan[1]?.median, 1_200_000);
    near(result.fan[1]?.putIn, 1_200_000);
    near(result.fan[2]?.median, 1_200_000);
  });

  it('is nothing until an amount and a month are set', () => {
    assert.equal(expectedWindfall({ amountTwd: null, month: '2027-01', tranches: 12 }, '2026-11', 0, 0), null);
    assert.equal(expectedWindfall({ amountTwd: 1, month: null, tranches: 12 }, '2026-11', 0, 0), null);
  });
});

describe('settings', () => {
  const valid = {
    paths: 10000,
    lookback_years: 5,
    block_months: 3,
    min_months: 36,
    scale_to_cma: true,
    band: [0.1, 0.9],
    mark_years: [30, 10, 20],
    target_twd: 20_000_000,
    windfall: { amount_twd: null, month: null, tranches: 12 },
  };

  it('reads the config row, sorting the marks, and writes it back', () => {
    const settings = readMcSettings(valid);
    assert.ok(settings);
    assert.deepEqual(settings.markYears, [10, 20, 30]);
    assert.equal(settings.targetTwd, 20_000_000);
    assert.equal(settings.windfall.amountTwd, null);
    assert.deepEqual(readMcSettings(mcSettingsValue(settings)), settings);
  });

  it('refuses a row that is missing or out of range', () => {
    assert.equal(readMcSettings(undefined), undefined);
    assert.equal(readMcSettings({ ...valid, paths: 5 }), undefined);
    assert.equal(readMcSettings({ ...valid, band: [0.6, 0.9] }), undefined);
    assert.equal(readMcSettings({ ...valid, mark_years: [] }), undefined);
    assert.equal(readMcSettings({ ...valid, scale_to_cma: 'yes' }), undefined);
    assert.equal(readMcSettings({ ...valid, windfall: { tranches: 0 } }), undefined);
  });

  it('treats a bad target or windfall as unset', () => {
    const settings = readMcSettings({ ...valid, target_twd: -1, windfall: { amount_twd: 5_500_000, month: 'soon', tranches: 6 } });
    assert.equal(settings?.targetTwd, null);
    assert.equal(settings?.windfall.amountTwd, 5_500_000);
    assert.equal(settings?.windfall.month, null);
  });
});

describe('valueBins', () => {
  it('counts every value once, in round-width bins that touch', () => {
    const values = Float64Array.from({ length: 1000 }, (_, i) => 1_000_000 + i * 7_300);
    const { width, bins } = valueBins(values, 1, 30);
    assert.ok([1, 2, 5].includes(Number((width / 10 ** Math.floor(Math.log10(width))).toFixed(6))), `${width} is 1, 2 or 5 × a power of ten`);
    assert.ok(bins.length <= 31);
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 1000);
    for (let i = 1; i < bins.length; i++) near(bins[i]?.from, bins[i - 1]?.to ?? NaN, 1e-6);
  });

  it('divides by the inflation factor to show today’s money, and copes with no spread', () => {
    const { bins } = valueBins([2_000_000, 2_000_000], 2, 30);
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 2);
    const only = bins.find((bin) => bin.count === 2);
    assert.ok(only && only.from <= 1_000_000 && only.to > 1_000_000);
    assert.deepEqual(valueBins([], 1), { width: 0, bins: [] });
  });
});
