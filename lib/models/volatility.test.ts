import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addDays } from '../dates';
import {
  COMPONENTS,
  drawdownAt,
  fallAt,
  figureAt,
  indexAt,
  meanAt,
  readVolatilitySettings,
  scoreHistory,
  scoreOf,
  subScore,
  volatilityScore,
  volatilitySettingsValue,
  type Close,
  type VolatilitySettings,
} from './volatility';

const near = (a: number, b: number, digits = 4) => assert.ok(Math.abs(a - b) < 10 ** -digits / 2, `${a} ≈ ${b}`);

/** config volatility as the migration seeds it. */
const DEFAULT = {
  components: {
    vix: { calm: 12, panic: 40, weight: 2 },
    vix_term: { calm: 0.85, panic: 1.15, weight: 2 },
    tw_vix: { calm: 15, panic: 45, weight: 2 },
    spx_drawdown: { calm: 0.02, panic: 0.2, weight: 1 },
    taiex_drawdown: { calm: 0.03, panic: 0.25, weight: 1 },
    taiex_fall: { calm: 0, panic: 0.1, weight: 1 },
    hy_spread: { calm: 3, panic: 7, weight: 1 },
    epu: { calm: 100, panic: 500, weight: 0.5 },
  },
  max_age_days: 5,
  min_coverage: 0.5,
  drawdown_days: 365,
  fall_sessions: 5,
  epu_days: 7,
  history_days: 400,
  events: { lead_days: 2, remind: ['fomc', 'cpi', 'payrolls', 'cbc', 'other'] },
  last_verified: null,
};

const settings = readVolatilitySettings(DEFAULT) as VolatilitySettings;

/** Daily closes ending on `end`, one a day. */
function daily(end: string, values: readonly number[]): Close[] {
  return values.map((close, i) => ({ date: addDays(end, i - values.length + 1), close }));
}

/** Every series at one value on `day`, enough for each component. */
function flat(day: string, values: Partial<Record<string, number[]>>): Map<string, Close[]> {
  return new Map(Object.entries(values).map(([id, list]) => [id, daily(day, list ?? [])]));
}

describe('PRD Section 11 acceptance: N8 volatility score', () => {
  it('Sub-score: calm 12, panic 40 → VIX 26 is 5.0, 50 is 10, 10 is 0', () => {
    assert.equal(subScore(26, 12, 40), 5);
    assert.equal(subScore(50, 12, 40), 10);
    assert.equal(subScore(10, 12, 40), 0);
  });

  it('Term structure: VIX 28.18 over VIX3M 25.55 (2026-11-05) is 1.1029, sub-score 8.43 on 0.85 / 1.15', () => {
    const series = new Map([
      ['VIX', [{ date: '2026-11-05', close: 28.18 }]],
      ['VIX3M', [{ date: '2026-11-05', close: 25.55 }]],
    ]);
    const figure = figureAt('vix_term', series, settings, '2026-11-06');
    assert.ok(figure);
    near(figure.value, 1.1029);
    near(subScore(figure.value, 0.85, 1.15), 8.43, 2);
    assert.equal(figure.date, '2026-11-05');
  });

  it('Score: sub-scores 10 (weight 2), 0 (weight 2) and 5 (weight 1) → mean 5 → 1 + 0.9 × 5 = 5.5; all calm 1.0, all at panic 10.0', () => {
    assert.equal(scoreOf((2 * 10 + 2 * 0 + 1 * 5) / 5), 5.5);
    assert.equal(scoreOf(0), 1);
    assert.equal(scoreOf(10), 10);
  });

  it('Drawdown: 100, then a high of 120, now 90 → 25%, sub-score 10 on 3% / 25%; a high older than 365 days is not counted', () => {
    const closes = [
      { date: '2025-01-02', close: 200 },
      { date: '2026-03-01', close: 100 },
      { date: '2026-06-01', close: 120 },
      { date: '2026-11-05', close: 90 },
    ];
    const value = drawdownAt(closes, 3, 365);
    near(value, 0.25);
    assert.equal(subScore(value, 0.03, 0.25), 10);
  });

  it('Short fall: 100, 99, 98, 97, 95, 90 → 10% over 5 sessions, sub-score 10 on 0 / 10%; a rise reads 0', () => {
    const closes = daily('2026-11-06', [100, 99, 98, 97, 95, 90]);
    near(fallAt(closes, 5, 5) as number, 0.1);
    assert.equal(fallAt(daily('2026-11-06', [90, 95, 97, 98, 99, 100]), 5, 5), 0);
    assert.equal(fallAt(closes, 4, 5), undefined);
  });

  it('Coverage: Taiwan VIX missing (weight 2 of 10.5) counts 8.5 ÷ 10.5 = 80.95% and re-weights the rest; a figure 6 days old is stale', () => {
    const day = '2026-11-06';
    const series = flat(day, {
      VIX: [40],
      VIX3M: [40 / 1.15],
      SPX: [100, 80],
      TAIEX: [100, 100, 100, 100, 100, 75],
      HY_OAS: [7],
      EPU: [500],
    });
    const result = volatilityScore(series, settings, day);
    near(result.coverage, 8.5 / 10.5);
    assert.equal(result.components.find((row) => row.id === 'tw_vix')?.status, 'missing');
    // Every counted component at panic: the score is 10.
    assert.equal(result.score, 10);

    const old = new Map(series);
    old.set('HY_OAS', [{ date: addDays(day, -6), close: 7 }]);
    const stale = volatilityScore(old, settings, day);
    assert.equal(stale.components.find((row) => row.id === 'hy_spread')?.status, 'stale');
    near(stale.coverage, 7.5 / 10.5);
  });

  it('No score below the coverage needed: only the VIX (2 of 10.5, 19%) under 50%', () => {
    const result = volatilityScore(flat('2026-11-06', { VIX: [26] }), settings, '2026-11-06');
    assert.equal(result.score, null);
    assert.equal(result.mean, null);
    near(result.coverage, 2 / 10.5);
  });

  it('Policy uncertainty: the mean of the last 7 days (two days of 100, then a week of 400 → 400; six days of 100, then 700 → 185.7)', () => {
    const closes = daily('2026-11-06', [100, 100, 400, 400, 400, 400, 400, 400, 400]);
    near(meanAt(closes, closes.length - 1, 7), 400);
    const spike = daily('2026-11-06', [100, 100, 100, 100, 100, 100, 700]);
    near(meanAt(spike, spike.length - 1, 7), 1300 / 7);
  });
});

describe('volatility score', () => {
  it('reads config volatility and writes it back unchanged', () => {
    assert.deepEqual(volatilitySettingsValue(settings), DEFAULT);
    assert.equal(settings.components.length, COMPONENTS.length);
  });

  it('refuses malformed settings: panic not above calm, a negative weight, no weight at all, a component missing', () => {
    const bad = (change: (value: typeof DEFAULT) => void) => {
      const copy = structuredClone(DEFAULT) as typeof DEFAULT;
      change(copy);
      return readVolatilitySettings(copy);
    };
    assert.equal(bad((v) => (v.components.vix.panic = 12)), undefined);
    assert.equal(bad((v) => (v.components.vix.weight = -1)), undefined);
    assert.equal(
      bad((v) => {
        for (const entry of Object.values(v.components)) entry.weight = 0;
      }),
      undefined,
    );
    assert.equal(bad((v) => delete (v.components as Record<string, unknown>)['epu']), undefined);
    assert.equal(bad((v) => (v.min_coverage = 0)), undefined);
    assert.equal(readVolatilitySettings(null), undefined);
  });

  it('finds the newest close on or before a day', () => {
    const closes = daily('2026-11-06', [1, 2, 3]);
    assert.equal(indexAt(closes, '2026-11-06'), 2);
    assert.equal(indexAt(closes, '2026-11-05'), 1);
    assert.equal(indexAt(closes, '2026-11-03'), -1);
    assert.equal(indexAt([], '2026-11-06'), -1);
  });

  it('pairs the VIX with the VIX3M on a day both closed', () => {
    const series = new Map([
      ['VIX', [{ date: '2026-11-04', close: 20 }]],
      ['VIX3M', [{ date: '2026-11-04', close: 25 }, { date: '2026-11-05', close: 26 }]],
    ]);
    const figure = figureAt('vix_term', series, settings, '2026-11-06');
    assert.deepEqual(figure, { value: 0.8, date: '2026-11-04' });
  });

  it('ignores a component with weight 0 and does not read the future', () => {
    const zero = readVolatilitySettings({ ...DEFAULT, components: { ...DEFAULT.components, epu: { calm: 100, panic: 500, weight: 0 } } }) as VolatilitySettings;
    const series = flat('2026-11-06', { VIX: [12], VIX3M: [20], TWVIX: [15], SPX: [100], TAIEX: [100, 100, 100, 100, 100, 100], HY_OAS: [3], EPU: [900] });
    const result = volatilityScore(series, zero, '2026-11-06');
    assert.equal(result.score, 1);
    near(result.coverage, 1);
    const before = volatilityScore(series, settings, '2026-10-31');
    assert.equal(before.components.every((row) => row.status === 'missing'), true);
    assert.equal(before.score, null);
  });

  it('scores each day any series closed, oldest first', () => {
    const series = flat('2026-11-06', { VIX: [12, 26, 40], VIX3M: [20, 26, 40 / 1.15], TWVIX: [15, 30, 45] });
    const narrow = readVolatilitySettings({ ...DEFAULT, min_coverage: 0.5 }) as VolatilitySettings;
    const history = scoreHistory(series, narrow, '2026-11-04', '2026-11-06');
    assert.deepEqual(
      history.map((row) => row.date),
      ['2026-11-04', '2026-11-05', '2026-11-06'],
    );
    assert.equal(history[0]?.score, 1);
    assert.equal(history[2]?.score, 10);
  });
});
