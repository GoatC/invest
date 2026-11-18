import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { YearFigures } from './monte-carlo';
import type { MonthEnd } from './projection';
import { actuals, chanceAt, phases, projectedAt, readTimelineSettings, timelineSettingsValue, yearEnd, yearsBetween } from './timeline';

function near(actual: number | null | undefined, expected: number, tolerance = 1e-9): void {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);
}

function figures(year: number, median: number): YearFigures {
  return { year, low: median / 2, median, high: median * 2, realLow: 0, realMedian: 0, realHigh: 0, expected: median * 1.1, putIn: 0, reaching: null, split: null };
}

const FAN = [figures(0, 0), figures(1, 100), figures(2, 200), figures(3, 400)];

describe('F1 acceptance (PRD Section 11)', () => {
  it('reads the band between the two year ends around a month: 100 at year 1 and 200 at year 2 gives 150 half way', () => {
    // The plan starts in 2026-05: its year 1 ends 2027-04, so 2027-10 is month 18, half way to year 2.
    const at = projectedAt(FAN, '2026-05', '2027-10');
    near(at?.median, 150);
    near(at?.low, 75);
    near(at?.high, 300);
    near(at?.expected, 165);
  });

  it('ends a year on the last day of its twelfth month, year 0 the month before the plan', () => {
    assert.equal(yearEnd('2026-05', 0), '2026-04-30');
    assert.equal(yearEnd('2026-05', 1), '2027-04-30');
    assert.equal(yearEnd('2026-05', 30), '2056-04-30');
    assert.equal(yearEnd('2027-01', 1), '2027-12-31');
  });

  it('chooses the phases: accumulation for the plan, the windfall from its first tranche’s month to its last’s', () => {
    assert.deepEqual(phases('2026-05', 30, []), [{ kind: 'accumulation', from: '2026-05-01', to: '2056-04-30' }]);
    assert.deepEqual(phases('2026-05', 30, [{ dueDate: '2028-08-15' }, { dueDate: '2027-09-15' }, { dueDate: '2028-02-15' }]), [
      { kind: 'accumulation', from: '2026-05-01', to: '2056-04-30' },
      { kind: 'windfall', from: '2027-09-01', to: '2028-08-31' },
    ]);
  });
});

describe('projectedAt', () => {
  it('is the year end itself on the year end, and null outside the plan', () => {
    near(projectedAt(FAN, '2026-05', '2027-04')?.median, 100);
    near(projectedAt(FAN, '2026-05', '2029-04')?.median, 400);
    near(projectedAt(FAN, '2026-05', '2026-04')?.median, 0);
    assert.equal(projectedAt(FAN, '2026-05', '2026-03'), null);
    assert.equal(projectedAt(FAN, '2026-05', '2029-05'), null);
    assert.equal(projectedAt([], '2026-05', '2027-04'), null);
  });
});

describe('chanceAt', () => {
  // Year 2's values 100, 200, …, 1000 over ten paths; no inflation.
  const column = Float64Array.from({ length: 10 }, (_, i) => (i + 1) * 100);
  const result = { years: 2, columns: [column, column, column] };

  it('is the share of paths at or above the goal at the nearest year end', () => {
    near(chanceAt(result, '2026-05', '2028-04', 600, 0), 0.5);
    near(chanceAt(result, '2026-05', '2028-04', 1001, 0), 0);
    near(chanceAt(result, '2026-05', '2028-04', 100, 0), 1);
  });

  it('turns today’s money into nominal with inflation, and is null past the plan', () => {
    near(chanceAt(result, '2026-05', '2028-04', 500, 0.2), 0.3);
    near(chanceAt(result, '2026-05', '2028-04', 500 / 1.2 ** 2, 0.2), 0.6);
    assert.equal(chanceAt(result, '2026-05', '2028-05', 100, 0), null);
  });
});

describe('settings', () => {
  it('reads goals in date order, dropping any without a month or a name, and writes them back', () => {
    const settings = readTimelineSettings({
      goals: [
        { month: '2045-06', amount_twd: 3_000_000, name: ' House ' },
        { month: '2040-01', amount_twd: null, name: 'Children’s university' },
        { month: '2050-13', amount_twd: 1, name: 'bad month' },
        { month: '2051-01', amount_twd: -5, name: 'No amount' },
        { month: '2052-01', name: '' },
      ],
    });
    assert.deepEqual(settings, {
      goals: [
        { month: '2040-01', amountTwd: null, name: 'Children’s university' },
        { month: '2045-06', amountTwd: 3_000_000, name: 'House' },
        { month: '2051-01', amountTwd: null, name: 'No amount' },
      ],
    });
    assert.deepEqual(readTimelineSettings(timelineSettingsValue(settings as NonNullable<typeof settings>)), settings);
  });

  it('is undefined when the row is missing', () => {
    assert.equal(readTimelineSettings(undefined), undefined);
    assert.equal(readTimelineSettings({ goals: 'none' }), undefined);
  });
});

describe('actuals and lengths', () => {
  it('lists each month end that has passed and the month still running as the last point', () => {
    const ends: MonthEnd[] = [
      { month: '2026-08', date: '2026-08-31', value: 100, putIn: 0, complete: true },
      { month: '2026-09', date: '2026-09-30', value: 110, putIn: 0, complete: true },
      { month: '2026-10', date: '2026-10-20', value: 120, putIn: 0, complete: false },
    ];
    assert.deepEqual(actuals(ends), [
      { date: '2026-08-31', value: 100 },
      { date: '2026-09-30', value: 110 },
      { date: '2026-10-20', value: 120 },
    ]);
  });

  it('counts a phase’s length in years', () => {
    assert.equal(yearsBetween('2027-09-01', '2028-08-31'), 1);
    assert.equal(yearsBetween('2026-05-01', '2056-04-30'), 30);
  });
});
