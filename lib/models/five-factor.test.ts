import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addMonths } from '../dates';
import { fiveFactor, inDollars, portfolioReturns, readFactorSettings, seriesName, type FactorMonth } from './five-factor';

function near(actual: number | null | undefined, expected: number, tolerance = 1e-8): void {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);
}

/** 36 months of invented factors, and a return built from them with a known set of loadings and a little noise. */
function fixture(): { factors: FactorMonth[]; returns: Array<{ date: string; value: number }> } {
  const factors: FactorMonth[] = [];
  const returns: Array<{ date: string; value: number }> = [];
  for (let t = 0; t < 36; t++) {
    const month = addMonths('2023-01', t);
    const x = [Math.sin(t * 0.9 + 0.3) * 0.04, Math.cos(t * 1.3) * 0.02, Math.sin(t * 0.5 + 1) * 0.015, Math.cos(t * 0.7 + 2) * 0.012, Math.sin(t * 1.9) * 0.01];
    const noise = Math.sin(t * 2.7 + 0.1) * 0.006 + Math.cos(t * 4.1) * 0.004;
    factors.push({ month, mkt: x[0] as number, smb: x[1] as number, hml: x[2] as number, rmw: x[3] as number, cma: x[4] as number, rf: 0.002 });
    returns.push({ date: `${month}-28`, value: 0.002 + 0.001 + 0.9 * (x[0] as number) + 0.3 * (x[1] as number) - 0.2 * (x[2] as number) + 0.1 * (x[3] as number) + 0.05 * (x[4] as number) + noise });
  }
  return { factors, returns };
}

const SETTINGS = { confidence: 0.95, minMonths: 24 };

describe('N1 five-factor acceptance (PRD Section 11)', () => {
  it('recovers a return built from market 0.9, size 0.3, value −0.2, profitability 0.1, investment 0.05 and an α of 0.1% a month, with the textbook standard errors and t-statistics', () => {
    const { factors, returns } = fixture();
    const fit = fiveFactor(returns, factors, SETTINGS);
    assert.ok(fit);
    assert.equal(fit.n, 36);
    // Reference values from numpy's least squares on the same data.
    const expected = [
      { beta: 0.90191918, stdErr: 0.0333144713, t: 27.072895 },
      { beta: 0.3067896942, stdErr: 0.0654370484, t: 4.688318 },
      { beta: -0.1928846117, stdErr: 0.0866674816, t: -2.225571 },
      { beta: 0.0982613883, stdErr: 0.110310113, t: 0.890774 },
      { beta: -0.0401256668, stdErr: 0.1318127609, t: -0.304414 },
    ];
    fit.loadings.forEach((loading, i) => {
      near(loading.beta, (expected[i] as { beta: number }).beta, 1e-7);
      near(loading.stdErr, (expected[i] as { stdErr: number }).stdErr, 1e-7);
      near(loading.t, (expected[i] as { t: number }).t, 1e-4);
    });
    near(fit.alpha, 0.0011542984, 1e-8);
    near(fit.alphaAnnual, 0.0011542984 * 12, 1e-7);
    near(fit.alphaT, 1.250137, 1e-4);
    near(fit.r2, 0.961696631, 1e-8);
    near(fit.adjR2, 0.9553127361, 1e-8);
    assert.deepEqual(fit.loadings.map((loading) => loading.factor), ['mkt', 'smb', 'hml', 'rmw', 'cma']);
  });

  it('puts the 95% interval at the loading ± t(0.975, 30) × its standard error', () => {
    const { factors, returns } = fixture();
    const fit = fiveFactor(returns, factors, SETTINGS);
    assert.ok(fit);
    const mkt = fit.loadings[0];
    // t(0.975, 30) = 2.042.
    near(mkt?.ci[0], (mkt?.beta ?? 0) - 2.0423 * (mkt?.stdErr ?? 0), 1e-4);
    near(mkt?.ci[1], (mkt?.beta ?? 0) + 2.0423 * (mkt?.stdErr ?? 0), 1e-4);
  });

  it('returns exactly the loadings, with R² of 1, when there is no noise', () => {
    const { factors } = fixture();
    const clean = factors.map((f) => ({ date: `${f.month}-28`, value: f.rf + 0.9 * f.mkt - 0.4 * f.cma }));
    const fit = fiveFactor(clean, factors, SETTINGS);
    assert.ok(fit);
    near(fit.loadings[0]?.beta, 0.9, 1e-9);
    near(fit.loadings[4]?.beta, -0.4, 1e-9);
    near(fit.loadings[1]?.beta, 0, 1e-9);
    near(fit.alpha, 0, 1e-12);
    near(fit.r2, 1, 1e-9);
  });
});

describe('fiveFactor windows', () => {
  it('reads the newest months when given a window, and none with too few', () => {
    const { factors, returns } = fixture();
    assert.equal(fiveFactor(returns, factors, SETTINGS, 30)?.n, 30);
    assert.equal(fiveFactor(returns, factors, SETTINGS, 30)?.to, '2025-12');
    assert.equal(fiveFactor(returns, factors, SETTINGS, 30)?.from, '2023-07');
    assert.equal(fiveFactor(returns, factors, { ...SETTINGS, minMonths: 40 }), undefined);
    assert.equal(fiveFactor(returns, factors, SETTINGS, 20), undefined);
  });

  it('uses only the months both the return and the factors have, and refuses collinear factors', () => {
    const { factors, returns } = fixture();
    assert.equal(fiveFactor(returns.slice(0, 30), factors, SETTINGS)?.n, 30);
    const twin = factors.map((f) => ({ ...f, smb: f.mkt }));
    assert.equal(fiveFactor(returns, twin, SETTINGS), undefined);
  });
});

describe('dollars and the portfolio', () => {
  it('turns a TWD return into a dollar one with the dollar’s move: +2% in TWD while the dollar gains 1% is +0.99%', () => {
    const usd = inDollars([{ date: '2026-01-31', value: 0.02 }], () => 1.01);
    near(usd[0]?.value, 1.02 / 1.01 - 1, 1e-12);
    assert.deepEqual(inDollars([{ date: '2026-01-31', value: 0.02 }], () => undefined), []);
  });

  it('weights the holdings at today’s weights, re-weighted over the months every holding has', () => {
    const a = { weight: 0.75, returns: [{ date: '2026-01-31', value: 0.04 }, { date: '2026-02-28', value: -0.02 }] };
    const b = { weight: 0.25, returns: [{ date: '2026-01-31', value: 0.0 }] };
    const out = portfolioReturns([a, b]);
    assert.equal(out.length, 1);
    near(out[0]?.value, 0.75 * 0.04, 1e-12);
    assert.equal(out[0]?.date, '2026-01-01');
  });
});

describe('settings', () => {
  const valid = { regions: { US: 'us', TW: 'emerging', UK: 'developed', bogus: 'mars' }, portfolio: 'developed', windows: [5, 3, 1], default_window: 3, confidence: 0.95, min_months: 24, keep_years: 12 };

  it('reads the row, leaving out a market mapped to an unknown region, and names the series', () => {
    const settings = readFactorSettings(valid);
    assert.deepEqual(settings?.regions, { US: 'us', TW: 'emerging', UK: 'developed' });
    assert.deepEqual(settings?.windows, [1, 3, 5]);
    assert.equal(seriesName('us', 'mkt'), 'ff5_us_mkt');
    assert.equal(seriesName('emerging', 'rf'), 'ff5_emerging_rf');
  });

  it('refuses a row that is missing or out of range', () => {
    assert.equal(readFactorSettings(undefined), undefined);
    assert.equal(readFactorSettings({ ...valid, portfolio: 'mars' }), undefined);
    assert.equal(readFactorSettings({ ...valid, default_window: 2 }), undefined);
    assert.equal(readFactorSettings({ ...valid, confidence: 1 }), undefined);
    assert.equal(readFactorSettings({ ...valid, min_months: 3 }), undefined);
  });
});
