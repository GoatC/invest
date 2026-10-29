import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addDays } from '../dates';
import type { DayPoint } from './performance';
import {
  againstPlan,
  futureValue,
  gap,
  inTodaysMoney,
  monthEnds,
  monthlyReturn,
  monthlyStepUp,
  planValue,
  project,
  readPlanSettings,
  realReturn,
  savedPlan,
  simulate,
  type Plan,
} from './projection';

function near(actual: number | undefined, expected: number, tolerance = 1e-9): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);
}

const PLAN: Plan = { pv: 0, pmt: 10_000, stepUp: 0, expectedReturn: 0.06, inflation: 0.02, years: 30 };

describe('F2 acceptance (PRD Section 11)', () => {
  it('PV 0, PMT NT$10,000, 6% a year compounded monthly, 30 years, no step-up: ≈ NT$10,045,000, annuity factor ≈ 1,004.5', () => {
    const closed = futureValue({ pv: 0, pmt: 10_000, g: 0, months: 360, r: monthlyReturn(0.06) });
    assert.equal(Math.round(closed / 1000) * 1000, 10_045_000);
    assert.equal(Number((closed / 10_000).toFixed(1)), 1004.5);
    // The month-by-month path the calculator draws ends at the same value.
    const { final } = project(PLAN);
    assert.equal(final.year, 30);
    near(final.value, closed, 1e-6);
    near(final.contributed, 3_600_000);
    near(final.growth, closed - 3_600_000, 1e-6);
  });

  it('growing contributions: for any r ≠ g the closed form equals a month-by-month loop within NT$1', () => {
    const cases = [
      { pv: 0, pmt: 10_000, r: 0.005, g: monthlyStepUp(0.03), months: 360 },
      { pv: 250_000, pmt: 10_000, r: 0.07 / 12, g: monthlyStepUp(0.05), months: 480 },
      { pv: 1_000_000, pmt: 20_000, r: 0.002, g: monthlyStepUp(0.1), months: 240 },
      { pv: 500_000, pmt: 5_000, r: -0.01 / 12, g: monthlyStepUp(0.02), months: 120 },
      { pv: 0, pmt: 10_000, r: 0.004, g: -0.001, months: 360 },
    ];
    for (const { r, ...path } of cases) {
      const loop = simulate(path, () => r).at(-1)?.value;
      const closed = futureValue({ ...path, r });
      assert.ok(loop !== undefined && Math.abs(loop - closed) < 1, `r ${r}, g ${path.g}: loop ${loop}, closed ${closed}`);
    }
  });

  it('uses the limit where r equals g, which the loop agrees with', () => {
    const path = { pv: 0, pmt: 10_000, g: 0.005, months: 360 };
    const loop = simulate(path, () => 0.005).at(-1)?.value;
    const closed = futureValue({ ...path, r: 0.005 });
    near(closed, 10_000 * 360 * 1.005 ** 359, 1e-6);
    assert.ok(loop !== undefined && Math.abs(loop - closed) < 1);
  });
});

describe('simulate', () => {
  it('earns the month’s return, then adds the contribution, which grows by g', () => {
    const path = simulate({ pv: 1000, pmt: 100, g: 0.1, months: 2 }, (month) => (month === 1 ? 0.1 : -0.5));
    assert.deepEqual(
      path.map((point) => ({ ...point, value: Number(point.value.toFixed(6)), contributed: Number(point.contributed.toFixed(6)) })),
      [
        { month: 0, value: 1000, contributed: 1000 },
        { month: 1, value: 1200, contributed: 1100 },
        { month: 2, value: 710, contributed: 1210 },
      ],
    );
  });
});

describe('project', () => {
  it('steps the contribution up by the yearly rate each twelve months', () => {
    const g = monthlyStepUp(0.03);
    near((1 + g) ** 12, 1.03);
    const projection = project({ ...PLAN, stepUp: 0.03, years: 2 });
    // Months 1–12 at NT$10,000 × (1+g)^(k−1); month 13 pays NT$10,300.
    const first = projection.months[1];
    const thirteenth = projection.months[13];
    const twelfth = projection.months[12];
    assert.ok(first && twelfth && thirteenth);
    near(first.contributed, 10_000);
    near(thirteenth.contributed - twelfth.contributed, 10_300, 1e-6);
    near(projection.lastPayment, 10_000 * (1 + g) ** 23, 1e-6);
  });

  it('gives the start and each year end, with the value in today’s money', () => {
    const projection = project({ ...PLAN, pv: 100_000, years: 3 });
    assert.deepEqual(
      projection.years.map((point) => point.year),
      [0, 1, 2, 3],
    );
    const [start, , , last] = projection.years;
    assert.ok(start && last);
    assert.deepEqual(start, { year: 0, value: 100_000, contributed: 100_000, growth: 0, real: 100_000 });
    near(last.contributed, 100_000 + 36 * 10_000);
    near(last.real, last.value / 1.02 ** 3, 1e-6);
    assert.equal(projection.final, last);
  });

  it('reports the real return as (1 + nominal) ÷ (1 + inflation) − 1', () => {
    near(realReturn(0.06, 0.02), 1.06 / 1.02 - 1);
    near(project(PLAN).realReturn, 0.0392156862745098);
    near(inTodaysMoney(1.02 ** 10, 0.02, 120), 1);
  });

  it('has no contributions over zero years', () => {
    const projection = project({ ...PLAN, pv: 5000, years: 0 });
    assert.equal(projection.final.value, 5000);
    assert.equal(projection.lastPayment, 0);
  });
});

/** A day of the regular pool: its value at the close and the money put in that day. */
function dayPoint(date: string, value: number, putIn = 0): DayPoint {
  const perScope = (amount: number) => ({ all: amount, regular: amount, windfall: 0 });
  return { date, value: perScope(value), flow: perScope(-putIn), classValue: {}, held: {}, ret: { all: null, regular: null, windfall: null }, local: { all: null, regular: null, windfall: null }, classDay: {}, benchmark: null, estimated: false };
}

/** Every day from `from` to `to`, worth `value(date)`, with money put in on the given dates. */
function series(from: string, to: string, value: (date: string) => number, putIn: Record<string, number>): DayPoint[] {
  const days: DayPoint[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) days.push(dayPoint(date, value(date), putIn[date] ?? 0));
  return days;
}

describe('monthEnds', () => {
  it('keeps each month’s last close and the money put in during it, net of money taken out', () => {
    const days = series('2026-05-07', '2026-07-10', (date) => (date < '2026-06-01' ? 9_500 : date < '2026-07-01' ? 20_000 : 31_000), {
      '2026-05-07': 9_540,
      '2026-06-08': 10_000,
      '2026-06-20': -1_000,
      '2026-07-07': 10_000,
    });
    assert.deepEqual(monthEnds(days), [
      { month: '2026-05', date: '2026-05-31', value: 9_500, putIn: 9_540, complete: true },
      { month: '2026-06', date: '2026-06-30', value: 20_000, putIn: 9_000, complete: true },
      { month: '2026-07', date: '2026-07-10', value: 31_000, putIn: 10_000, complete: false },
    ]);
  });
});

describe('againstPlan', () => {
  // Bought on the 7th of each month; each month end worth 2% more than was put in so far.
  const putIn = { '2026-05-07': 10_000, '2026-06-08': 10_000, '2026-07-07': 10_000, '2026-08-07': 10_000 };
  const days = series('2026-05-07', '2026-08-20', (date) => 1.02 * Object.entries(putIn).reduce((sum, [on, amount]) => (on <= date ? sum + amount : sum), 0), putIn);
  const ends = monthEnds(days);

  it('compares each month end that has passed with the plan, from the end of the month before the start', () => {
    const rows = againstPlan(ends, '2026-05', PLAN);
    assert.deepEqual(
      rows.map((row) => [row.month, row.date, row.index]),
      [
        ['2026-04', '2026-04-30', 0],
        ['2026-05', '2026-05-31', 1],
        ['2026-06', '2026-06-30', 2],
        ['2026-07', '2026-07-31', 3],
      ],
    );
    const plan = project(PLAN).months;
    const july = rows[3];
    assert.ok(july);
    near(july.actual, 30_600, 1e-6);
    near(july.actualContributed, 30_000);
    near(july.planned, plan[3]?.value ?? Number.NaN);
    near(july.plannedContributed, 30_000);
    // NT$10,000 at month end grows 0.5% a month: 10,000 × (1 + 1.005 + 1.005²) = 30,150.25.
    near(july.planned, 30_150.25, 1e-6);
    const split = gap(july);
    near(split.total, 449.75, 1e-6);
    near(split.contributed, 0);
    near(split.growth, 449.75, 1e-6);
  });

  it('counts the months before the first trade as holding nothing', () => {
    const rows = againstPlan(ends, '2026-03', { ...PLAN, pv: 0 });
    assert.deepEqual(
      rows.map((row) => [row.month, row.actual, row.actualContributed]),
      [
        ['2026-02', 0, 0],
        ['2026-03', 0, 0],
        ['2026-04', 0, 0],
        ['2026-05', 10_200, 10_000],
        ['2026-06', 20_400, 20_000],
        ['2026-07', 30_600, 30_000],
      ],
    );
    const split = gap(rows[5] as (typeof rows)[number]);
    // Five contributions planned by July, three made.
    near(split.contributed, -20_000);
  });

  it('starts from the actual value at the start, so a different PV shows as money', () => {
    const rows = againstPlan(ends, '2026-06', { ...PLAN, pv: 15_000 });
    const [start, june] = rows;
    assert.ok(start && june);
    assert.deepEqual([start.month, start.actual, start.planned], ['2026-05', 10_200, 15_000]);
    near(gap(start).contributed, -4_800);
    near(gap(start).growth, 0);
    near(june.actualContributed, 20_200);
  });

  it('has nothing to compare before the month before the start has ended, or past the plan’s years', () => {
    assert.deepEqual(againstPlan(ends, '2026-09', PLAN), []);
    assert.deepEqual(againstPlan(ends, '2026-10', PLAN), []);
    assert.deepEqual(againstPlan([], '2026-05', PLAN), []);
    // A one-year plan from 2025-08 ends in 2026-07.
    assert.equal(againstPlan(ends, '2025-08', { ...PLAN, years: 1 }).at(-1)?.month, '2026-07');
    assert.equal(againstPlan(ends, '2025-07', { ...PLAN, years: 1 }).at(-1)?.month, '2026-06');
  });
});

describe('the saved plan', () => {
  it('reads the config row: nothing saved yet, then a whole plan, which writes back the stored shape', () => {
    const empty = readPlanSettings({ start: null, pv: null, pmt: null, step_up: 0, expected_return: null, inflation: 0.02, years: 30 });
    assert.deepEqual(empty, { start: null, pv: null, pmt: null, stepUp: 0, expectedReturn: null, inflation: 0.02, years: 30 });
    assert.equal(savedPlan(empty), null);
    const stored = { start: '2026-05', pv: 0, pmt: 10_000, step_up: 0.03, expected_return: 0.05, inflation: 0.02, years: 30 };
    const plan = savedPlan(readPlanSettings(stored));
    assert.deepEqual(plan, { start: '2026-05', pv: 0, pmt: 10_000, stepUp: 0.03, expectedReturn: 0.05, inflation: 0.02, years: 30 });
    assert.ok(plan);
    assert.deepEqual(planValue(plan), stored);
  });

  it('leaves out what is malformed', () => {
    assert.deepEqual(readPlanSettings({ start: '2026-13', pv: -1, pmt: '10000', step_up: null, expected_return: Number.NaN, inflation: -1, years: 2.5 }), {
      start: null,
      pv: null,
      pmt: null,
      stepUp: null,
      expectedReturn: null,
      inflation: null,
      years: null,
    });
    assert.deepEqual(readPlanSettings('x'), readPlanSettings({}));
  });
});
