import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  autoCmaValue,
  basketReturns,
  bestFit,
  capmReturn,
  estimateClass,
  estimateRow,
  marketLines,
  mergeAssumptions,
  readAutoCmaSettings,
  readEstimateRow,
  readUnscoredRow,
  unscoredRow,
  yearlyVolatility,
  type LineInput,
  type MarketLine,
} from './auto-cma';
import type { CapmSettings, MonthValue } from './capm';
import type { Point } from './regression';

const close = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

const SETTINGS = { enabled: true, premium: 'cma' as const, anchors: { US: 'us_global_equity', TW: 'tw_market_cap' }, lookbackYears: 5, minMonths: 24 };

const CAPM: Pick<CapmSettings, 'markets' | 'erp'> = {
  erp: { source: 'manual', manual: 0.05 },
  markets: {
    US: { benchmark: 'SPX', riskFreeSeries: 'us_treasury_10y', riskFree: 0.05, countryPremium: 0 },
    TW: { benchmark: 'TAIEX', riskFreeSeries: 'tw_govt_10y', riskFree: 0.018, countryPremium: 0.0078 },
  },
};
/** The US 10-year at 4.0% in its newest month; Taiwan's not loaded, so its setting (1.8%) stands. */
const SERIES = new Map<string, MonthValue[]>([['us_treasury_10y', [{ month: '2026-09', value: 0.039 }, { month: '2026-10', value: 0.04 }]]]);
const OWN = { us_global_equity: { expectedReturn: 0.065, volatility: 0.16, source: 'Demo' } };

/** `count` month ends from 2022-01 on, the values cycling through `values`. */
function months(count: number, values: readonly number[], first = 2022): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const year = first + Math.floor(i / 12);
    const month = (i % 12) + 1;
    return { date: `${year}-${String(month).padStart(2, '0')}-28`, value: values[i % values.length] as number };
  });
}

describe('readAutoCmaSettings', () => {
  it('reads the stored shape and writes it back', () => {
    const stored = { enabled: true, premium: 'cma', anchors: { US: 'us_global_equity', TW: 'tw_market_cap' }, lookback_years: 5, min_months: 36 };
    const read = readAutoCmaSettings(stored);
    assert.deepEqual(read, { enabled: true, premium: 'cma', anchors: { US: 'us_global_equity', TW: 'tw_market_cap' }, lookbackYears: 5, minMonths: 36 });
    assert.deepEqual(read && autoCmaValue(read), stored);
  });

  it('refuses a part missing or out of range', () => {
    const base = { enabled: true, premium: 'cma', anchors: {}, lookback_years: 5, min_months: 36 };
    assert.equal(readAutoCmaSettings({ ...base, premium: 'capm' }), undefined);
    assert.equal(readAutoCmaSettings({ ...base, enabled: 'yes' }), undefined);
    assert.equal(readAutoCmaSettings({ ...base, min_months: 61 }), undefined);
    assert.equal(readAutoCmaSettings({ ...base, lookback_years: 0 }), undefined);
    assert.equal(readAutoCmaSettings({ ...base, anchors: { US: 3 } }), undefined);
    assert.equal(readAutoCmaSettings(null), undefined);
  });
});

describe('marketLines and capmReturn', () => {
  it('takes the premium from your assumption for the market’s anchor class, less its 10-year yield', () => {
    const [us, tw] = marketLines(SETTINGS, CAPM, SERIES, OWN);
    // US: 6.5% − 4.0% = 2.5%, so β 1.2 expects 4.0% + 1.2 × 2.5% = 7.0% and β 1 the anchor's 6.5%.
    assert.deepEqual({ ...us, premium: Number(us?.premium.toFixed(12)) }, { market: 'US', benchmark: 'SPX', riskFree: 0.04, premium: 0.025, source: 'cma', anchor: 'us_global_equity' });
    close(capmReturn(us as MarketLine, 1.2), 0.07);
    close(capmReturn(us as MarketLine, 1), 0.065);
    // TW: no assumption for tw_market_cap, so F11's ERP 5.0% + CRP 0.78% over the 1.8% setting.
    assert.equal(tw?.source, 'erp');
    assert.equal(tw?.anchor, null);
    close(tw?.premium ?? 0, 0.0578);
    close(capmReturn(tw as MarketLine, 0.8), 0.06424);
  });

  it('uses F11’s ERP for every market when premium is erp', () => {
    const [us] = marketLines({ ...SETTINGS, premium: 'erp' }, CAPM, SERIES, OWN);
    assert.equal(us?.source, 'erp');
    close(us?.premium ?? 0, 0.05);
  });
});

describe('bestFit', () => {
  const lines = marketLines(SETTINGS, CAPM, SERIES, OWN);

  it('reads the index that explains the holding best', () => {
    // A Taiwan-listed fund of US stocks: R² 0.55 on the S&P 500, 0.20 on TAIEX.
    const found = bestFit([{ benchmark: 'TAIEX', beta: 0.5, r2: 0.2 }, { benchmark: 'SPX', beta: 0.9, r2: 0.55 }], lines, 'TW');
    assert.equal(found?.line.market, 'US');
    assert.equal(found?.fit.beta, 0.9);
  });

  it('falls to the listing market on a tie or without R², and skips an index with no market', () => {
    assert.equal(bestFit([{ benchmark: 'SPX', beta: 1, r2: null }, { benchmark: 'TAIEX', beta: 0.7, r2: null }], lines, 'TW')?.line.market, 'TW');
    assert.equal(bestFit([{ benchmark: 'SPX', beta: 1, r2: 0.4 }, { benchmark: 'TAIEX', beta: 0.7, r2: 0.4 }], lines, 'TW')?.line.market, 'TW');
    assert.equal(bestFit([{ benchmark: 'NIKKEI', beta: 1, r2: 0.9 }], lines, 'US'), undefined);
    assert.equal(bestFit([], lines, 'US'), undefined);
  });
});

describe('yearlyVolatility and basketReturns', () => {
  it('scales the sample standard deviation of monthly returns by √12', () => {
    // ±1% in turn over 36 months: SD 0.01 × √(36 ÷ 35) = 1.0142%; × √12 = 3.5133%.
    close(yearlyVolatility(months(36, [0.01, -0.01]).map((point) => point.value)), 0.01 * Math.sqrt(36 / 35) * Math.sqrt(12));
    assert.equal(yearlyVolatility([0.02]), 0);
  });

  it('re-weights each month over the lines that have it', () => {
    const a = months(3, [0.02, 0.04, -0.02]);
    const b = months(3, [0, 0.08, 0.02]).slice(1);
    const basket = basketReturns([{ ticker: 'A', weight: 0.75 }, { ticker: 'B', weight: 0.25 }], new Map([['A', a], ['B', b]]));
    // Month 1 A alone 2%; month 2 0.75 × 4% + 0.25 × 8% = 5%; month 3 0.75 × −2% + 0.25 × 2% = −1%.
    assert.deepEqual(basket.map((point) => point.date), ['2022-01-28', '2022-02-28', '2022-03-28']);
    basket.forEach((point, i) => close(point.value, [0.02, 0.05, -0.01][i] as number));
  });
});

describe('estimateClass', () => {
  const lines = marketLines(SETTINGS, CAPM, SERIES, OWN);
  const inputs: LineInput[] = [
    // NT$30,000 of a US stock at β 1.2, ±3% a month; NT$10,000 of a Taiwan stock at β 0.8, ∓3%.
    { ticker: 'AAPL', market: 'US', exposure: 30_000, fits: [{ benchmark: 'SPX', beta: 1.2, r2: 0.5 }, { benchmark: 'TAIEX', beta: 0.6, r2: 0.2 }], returns: months(36, [0.03, -0.03]) },
    { ticker: '2330', market: 'TW', exposure: 10_000, fits: [{ benchmark: 'TAIEX', beta: 0.8, r2: 0.6 }, { benchmark: 'SPX', beta: 0.9, r2: 0.3 }], returns: months(36, [-0.03, 0.03]) },
    // Twelve months only, then no β at all: both left out and named.
    { ticker: 'NEWCO', market: 'US', exposure: 6_000, fits: [{ benchmark: 'SPX', beta: 1.5, r2: 0.4 }], returns: months(12, [0.05, -0.05], 2024) },
    { ticker: '00999', market: 'TW', exposure: 5_000, fits: [], returns: months(36, [0.01]) },
  ];

  it('weights each line’s CAPM return by exposure and reads the basket’s volatility', () => {
    const outcome = estimateClass('tactical_themes', inputs, lines, SETTINGS);
    assert.ok(outcome.ok);
    const { estimate } = outcome;
    // 0.75 × 7.0% + 0.25 × 6.424% = 6.856%.
    close(estimate.expectedReturn, 0.06856);
    assert.deepEqual(
      estimate.lines.map((line) => [line.ticker, line.benchmark, line.weight]),
      [['AAPL', 'SPX', 0.75], ['2330', 'TAIEX', 0.25]],
    );
    close(estimate.lines[0]?.expectedReturn ?? 0, 0.07);
    close(estimate.lines[1]?.expectedReturn ?? 0, 0.06424);
    // Each alone ±3%: 10.54% a year; the basket ±1.5% (0.75 × 3% − 0.25 × 3%): 5.27%.
    const alone = 0.03 * Math.sqrt(36 / 35) * Math.sqrt(12);
    close(estimate.lines[0]?.volatility ?? 0, alone);
    close(estimate.volatility, alone / 2);
    assert.deepEqual([estimate.months, estimate.from, estimate.to], [36, '2022-01', '2024-12']);
    assert.deepEqual(estimate.left, [{ ticker: 'NEWCO', reason: 'history' }, { ticker: '00999', reason: 'beta' }]);
  });

  it('reads only the last lookback_years of a longer history', () => {
    const outcome = estimateClass('us_stocks', [{ ticker: 'AAPL', market: 'US', exposure: 1, fits: [{ benchmark: 'SPX', beta: 1, r2: 0.5 }], returns: months(80, [0.02, -0.02]) }], lines, SETTINGS);
    assert.ok(outcome.ok);
    assert.equal(outcome.estimate.months, 60);
    assert.equal(outcome.estimate.lines[0]?.months, 60);
    assert.equal(outcome.estimate.from, '2023-09');
  });

  it('has no estimate when no line can be scored', () => {
    const outcome = estimateClass('tw_stocks', inputs.slice(2), lines, SETTINGS);
    assert.deepEqual(outcome, { ok: false, classId: 'tw_stocks', left: [{ ticker: 'NEWCO', reason: 'history' }, { ticker: '00999', reason: 'beta' }] });
    assert.equal(estimateClass('tw_stocks', [], lines, SETTINGS).ok, false);
  });
});

describe('the saved estimate and the merged assumptions', () => {
  const lines = marketLines(SETTINGS, CAPM, SERIES, OWN);
  const outcome = estimateClass('tactical_themes', [{ ticker: 'SMH', market: 'US', exposure: 1, fits: [{ benchmark: 'SPX', beta: 1.4, r2: 0.7 }], returns: months(36, [0.04, -0.02]) }], lines, SETTINGS);
  assert.ok(outcome.ok);
  const row = estimateRow(outcome.estimate, lines, '2026-11-09');

  it('reads back what it stores, with only the markets used', () => {
    const read = readEstimateRow(row as Parameters<typeof readEstimateRow>[0]);
    assert.ok(read);
    assert.deepEqual({ ...read, markets: undefined }, { ...outcome.estimate, asOf: '2026-11-09', markets: undefined });
    assert.deepEqual(read.markets.map((line) => line.market), ['US']);
    assert.equal(readEstimateRow({ class_id: 'x', as_of: '2026-11-09', expected_return: 'n/a', volatility: 0.1, months: 36, detail: {} }), undefined);
    assert.equal(readUnscoredRow(row as Parameters<typeof readUnscoredRow>[0]), undefined);
  });

  it('keeps a class held with nothing scorable as a row with no figures that names the lines left out', () => {
    const empty = unscoredRow('us_stocks', [{ ticker: 'NVDA', reason: 'history' }], '2026-11-09') as Parameters<typeof readUnscoredRow>[0];
    assert.equal(empty.expected_return, null);
    // No figures: never read as a 0% assumption.
    assert.equal(readEstimateRow(empty), undefined);
    assert.deepEqual(readUnscoredRow(empty), { classId: 'us_stocks', asOf: '2026-11-09', left: [{ ticker: 'NVDA', reason: 'history' }] });
  });

  it('fills a blank satellite class only: yours always wins, and a core class is never scored', () => {
    const saved = readEstimateRow(row as Parameters<typeof readEstimateRow>[0]);
    assert.ok(saved);
    const satellite = new Set(['us_stocks', 'tw_stocks', 'tactical_themes']);
    const merged = mergeAssumptions(OWN, [saved, { ...saved, classId: 'us_stocks' }, { ...saved, classId: 'us_global_equity' }], new Set([...satellite]));
    assert.equal(merged['tactical_themes']?.auto?.asOf, '2026-11-09');
    close(merged['tactical_themes']?.expectedReturn ?? 0, 0.04 + 1.4 * 0.025);
    assert.equal(merged['us_global_equity'], OWN.us_global_equity);
    const typed = { ...OWN, us_stocks: { expectedReturn: 0.08, volatility: 0.25, source: 'Mine' } };
    assert.equal(mergeAssumptions(typed, [{ ...saved, classId: 'us_stocks' }], satellite)['us_stocks']?.source, 'Mine');
  });
});
