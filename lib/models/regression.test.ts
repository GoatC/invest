import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adjacentDay,
  align,
  betaFigures,
  excessReturns,
  inTwd,
  lastYears,
  ols,
  periodReturns,
  rateOn,
  readRegressionSettings,
  regress,
  rollingBeta,
  studentQuantile,
  type Close,
  type Observation,
  type RegressionSettings,
} from './regression';

/** The seeded config regression. */
const SETTINGS = readRegressionSettings({
  benchmarks: {
    SPX: { name_en: 'S&P 500', name_zh: '標普 500', market: 'US', currency: 'USD' },
    TAIEX: { name_en: 'TAIEX total return', name_zh: '加權報酬指數', market: 'TW', currency: 'TWD' },
  },
  defaults: { freq: 'weekly', window_years: 2, currency: 'local' },
  windows: [1, 2, 3, 5],
  confidence: 0.95,
  blume: { weight: 0.67, prior: 1 },
  rolling_weeks: 52,
  min_observations: 12,
  compare_max: 5,
  risk_free: { TWD: 0.017, USD: 0.04, last_verified: '2026-10-28' },
}) as RegressionSettings;

const close = (a: number, b: number, digits = 3) => assert.ok(Math.abs(a - b) < 10 ** -digits / 2, `${a} ≈ ${b}`);
const obs = (x: number[], y: number[]): Observation[] => x.map((value, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, x: [value], y: y[i] as number }));

describe('PRD Section 11 acceptance: N1', () => {
  it('OLS: x 1…5, y 2, 4, 5, 4, 5 gives β 0.6, α 2.2, R² 0.6, standard error 0.283 and a 95% interval of −0.300 to 1.500', () => {
    const fit = ols(obs([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]));
    assert.ok(fit);
    const figures = betaFigures(fit, 'weekly', SETTINGS);
    close(figures.beta, 0.6, 9);
    close(figures.alpha, 2.2, 9);
    close(figures.r2, 0.6, 9);
    close(figures.stdErr, Math.sqrt(0.08), 9);
    // t(0.975, 3 degrees of freedom) = 3.182.
    close(figures.ci[0], -0.3, 3);
    close(figures.ci[1], 1.5, 3);
  });

  it("Blume: a raw β of 1.2 adjusts to 0.67 × 1.2 + 0.33 = 1.134", () => {
    const fit = ols(obs([1, 2, 3, 4, 5, 6], [1.2, 2.4, 3.6, 4.8, 6.0, 7.2]));
    assert.ok(fit);
    const figures = betaFigures(fit, 'weekly', SETTINGS);
    close(figures.beta, 1.2, 9);
    close(figures.adjusted, 1.134, 9);
  });

  it('Dimson: a Taiwan series moving 0.7 × the S&P 500 that day and 0.5 × the day before has a summed β of 1.2', () => {
    const market = [0.01, -0.02, 0.015, 0.003, -0.007, 0.012, -0.004, 0.009, -0.011, 0.006].map((value, i) => ({ date: `2026-03-${String(i + 2).padStart(2, '0')}`, value }));
    const series = market.slice(1).map((point, i) => ({ date: point.date, value: 0.7 * point.value + 0.5 * (market[i] as { value: number }).value }));
    const fit = ols(align(series, market, 'previous'));
    assert.ok(fit);
    const figures = betaFigures(fit, 'daily', SETTINGS);
    close(figures.slopes[0] as number, 0.7, 9);
    close(figures.slopes[1] as number, 0.5, 9);
    close(figures.beta, 1.2, 9);
    close(figures.r2, 1, 9);
  });

  it('annualised α: 0.1% a week is 5.2% a year, 0.5% a month 6%', () => {
    const weekly = ols(obs([0.01, -0.02, 0.03, 0, 0.01], [0.011, -0.019, 0.031, 0.001, 0.011]));
    assert.ok(weekly);
    close(betaFigures(weekly, 'weekly', SETTINGS).alphaAnnual, 0.052, 9);
    close(betaFigures(weekly, 'monthly', { ...SETTINGS }).alphaAnnual, 0.012, 9);
  });
});

describe('the t distribution', () => {
  it('matches the t table', () => {
    close(studentQuantile(0.975, 3), 3.182, 3);
    close(studentQuantile(0.975, 10), 2.228, 3);
    close(studentQuantile(0.975, 100), 1.984, 3);
    close(studentQuantile(0.95, 1), 6.314, 3);
    close(studentQuantile(0.025, 3), -3.182, 3);
  });
});

describe('returns', () => {
  const closes: Close[] = [
    { date: '2026-01-05', close: 100 }, // Monday
    { date: '2026-01-09', close: 102 }, // Friday
    { date: '2026-01-12', close: 101 },
    { date: '2026-01-14', close: 104 }, // Wednesday; the market is shut Thursday and Friday
    { date: '2026-01-30', close: 110 }, // a week with no close at all before it
    { date: '2026-02-03', close: 99 },
  ];

  it('daily: from one close to the next', () => {
    const daily = periodReturns(closes, 'daily');
    assert.equal(daily.length, 5);
    assert.equal(daily[0]?.date, '2026-01-09');
    close(daily[0]?.value ?? NaN, 0.02, 12);
  });

  it("weekly: the last close on or before each Friday, a week without one keeping the last", () => {
    const weekly = periodReturns(closes, 'weekly');
    assert.deepEqual(
      weekly.map((point) => point.date),
      ['2026-01-16', '2026-01-23', '2026-01-30', '2026-02-06'],
    );
    close(weekly[0]?.value ?? NaN, 104 / 102 - 1, 9);
    assert.equal(weekly[1]?.value, 0);
    close(weekly[2]?.value ?? NaN, 110 / 104 - 1, 9);
  });

  it('monthly: the last close of each month, labelled by its last day', () => {
    const monthly = periodReturns(closes, 'monthly');
    assert.deepEqual(monthly.map((point) => point.date), ['2026-02-28']);
    close(monthly[0]?.value ?? NaN, 99 / 110 - 1, 9);
  });

  it('converts to TWD at the rate on or before each day, leaving out days before the first rate', () => {
    const twd = inTwd(
      [
        { date: '2026-01-02', close: 10 },
        { date: '2026-01-05', close: 11 },
        { date: '2026-01-06', close: 12 },
      ],
      [
        { date: '2026-01-05', close: 32 },
        { date: '2026-01-06', close: 32.5 },
      ],
    );
    assert.deepEqual(twd, [
      { date: '2026-01-05', close: 352 },
      { date: '2026-01-06', close: 390 },
    ]);
  });

  it("takes off the period's share of the month's yearly rate, the newest month before it, or the fallback", () => {
    const rates = new Map([
      ['2026-01', 0.052],
      ['2026-03', 0.026],
    ]);
    assert.equal(rateOn(rates, '2026-02', 0.04), 0.052);
    assert.equal(rateOn(rates, '2025-12', 0.04), 0.04);
    const excess = excessReturns([{ date: '2026-03-06', value: 0.01 }], 'weekly', (month) => rateOn(rates, month, 0.04));
    close(excess[0]?.value ?? NaN, 0.01 - 0.026 / 52, 12);
  });
});

describe('aligning across markets', () => {
  it('adds the adjacent day only for daily returns across markets that close far apart', () => {
    assert.equal(adjacentDay('TW', 'US', 'daily'), 'previous');
    assert.equal(adjacentDay('US', 'TW', 'daily'), 'next');
    assert.equal(adjacentDay('UK', 'TW', 'daily'), 'next');
    assert.equal(adjacentDay('UK', 'US', 'daily'), 'none');
    assert.equal(adjacentDay('TW', 'TW', 'daily'), 'none');
    assert.equal(adjacentDay('TW', 'US', 'weekly'), 'none');
  });

  it("pairs each day with the market's same day, and its day after for a US series against TAIEX", () => {
    const market = [
      { date: '2026-03-02', value: 0.01 },
      { date: '2026-03-03', value: 0.02 },
      { date: '2026-03-04', value: 0.03 },
    ];
    const series = [
      { date: '2026-03-02', value: 0.1 },
      { date: '2026-03-03', value: 0.2 },
      { date: '2026-03-04', value: 0.3 },
      { date: '2026-03-05', value: 0.4 },
    ];
    assert.deepEqual(align(series, market, 'none').length, 3);
    assert.deepEqual(align(series, market, 'next'), [
      { date: '2026-03-02', y: 0.1, x: [0.01, 0.02] },
      { date: '2026-03-03', y: 0.2, x: [0.02, 0.03] },
    ]);
  });
});

describe('windows and rolling β', () => {
  const weeks = (count: number, beta: (i: number) => number): Observation[] =>
    Array.from({ length: count }, (_, i) => {
      const date = new Date(Date.UTC(2021, 0, 1 + 7 * i)).toISOString().slice(0, 10);
      const x = Math.sin(i * 1.7) * 0.02;
      return { date, x: [x], y: beta(i) * x + 0.0005 };
    });

  it('keeps the last years up to the newest observation', () => {
    const all = weeks(260, () => 1);
    const two = lastYears(all, 2);
    assert.ok(two.length === 104 || two.length === 105, `got ${two.length}`);
  });

  it('measures β over the 52 weeks behind each week, once a whole window lies behind it', () => {
    const all = weeks(156, (i) => (i < 104 ? 0.8 : 1.4));
    const rolling = rollingBeta(all, 52, 12);
    assert.equal(rolling[0]?.date, all[52]?.date);
    close(rolling[0]?.value ?? NaN, 0.8, 9);
    close(rolling[rolling.length - 1]?.value ?? NaN, 1.4, 9);
  });
});

describe('a whole regression', () => {
  /** Two years of weekly closes: the index walks; the series moves 1.5 × it, plus a little of its own. */
  function history(): { series: Close[]; index: Close[] } {
    const series: Close[] = [];
    const index: Close[] = [];
    let [s, m] = [100, 1000];
    for (let i = 0; i < 160; i++) {
      const date = new Date(Date.UTC(2023, 9, 6 + 7 * i)).toISOString().slice(0, 10);
      const move = Math.sin(i * 2.3) * 0.02 + Math.cos(i * 0.7) * 0.01;
      m *= 1 + move;
      s *= 1 + 1.5 * move + Math.sin(i * 5.1) * 0.002;
      series.push({ date, close: s });
      index.push({ date, close: m });
    }
    return { series, index };
  }

  it('finds the series β against the index, its interval and its rolling line, in local currency', () => {
    const { series, index } = history();
    const outcome = regress(
      { series: { closes: series, market: 'US', currency: 'USD' }, index: { closes: index, market: 'US', currency: 'USD' }, freq: 'weekly', years: 2, basis: 'local', fx: new Map(), riskFree: new Map() },
      SETTINGS,
    );
    assert.ok(outcome.ok);
    const { result } = outcome;
    close(result.beta, 1.5, 1);
    assert.ok(result.ci[0] < result.beta && result.beta < result.ci[1]);
    assert.ok(result.r2 > 0.95);
    assert.equal(result.adjacent, 'none');
    assert.ok(result.n >= 103 && result.n <= 105, `n ${result.n}`);
    assert.ok(result.rolling.length > 40 && result.rolling.every((point) => point.date >= result.from));
  });

  it('says why when it cannot: no exchange rate for the TWD basis, or too few observations', () => {
    const { series, index } = history();
    const base = { series: { closes: series, market: 'US', currency: 'USD' }, index: { closes: index, market: 'TW', currency: 'TWD' }, freq: 'weekly' as const, years: 2, fx: new Map(), riskFree: new Map() };
    const noFx = regress({ ...base, basis: 'TWD' }, SETTINGS);
    assert.deepEqual(noFx, { ok: false, problem: 'fx', n: 0 });
    const short = regress({ ...base, basis: 'local', series: { ...base.series, closes: series.slice(-8) } }, SETTINGS);
    assert.equal(short.ok, false);
    assert.equal(!short.ok && short.problem, 'observations');
  });
});

describe('settings', () => {
  it('reads the seeded config and refuses a malformed one', () => {
    assert.deepEqual(SETTINGS.defaults, { freq: 'weekly', years: 2, currency: 'local' });
    assert.deepEqual(
      SETTINGS.benchmarks.map((benchmark) => benchmark.id),
      ['SPX', 'TAIEX'],
    );
    assert.equal(SETTINGS.riskFree['TWD'], 0.017);
    assert.equal(readRegressionSettings({}), undefined);
    assert.equal(readRegressionSettings({ ...SETTINGS, defaults: { freq: 'hourly', window_years: 2, currency: 'local' } }), undefined);
  });
});
