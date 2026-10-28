import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CAPM_SERIES, costOfEquity, erpQuote, readCapmSettings, riskFreeQuote, stockCostOfEquity, type CapmSettings, type MonthValue } from './capm';

/** The seeded config capm. */
const SEEDED = {
  beta: 'adjusted',
  erp: { source: 'damodaran', manual: 0.0423 },
  markets: {
    US: { benchmark: 'SPX', risk_free_series: 'us_treasury_10y', risk_free: 0.045, country_premium: 0 },
    TW: { benchmark: 'TAIEX', risk_free_series: 'tw_govt_10y', risk_free: 0.0196, country_premium: 0.0078 },
  },
  last_verified: null,
};
const SETTINGS = readCapmSettings(SEEDED) as CapmSettings;

const close = (a: number, b: number, digits = 6) => assert.ok(Math.abs(a - b) < 10 ** -digits / 2, `${a} ≈ ${b}`);
const series = (entries: Record<string, MonthValue[]>) => new Map(Object.entries(entries));

describe('PRD Section 11 acceptance: F11', () => {
  it('US: R_f 4.0%, β 1.2 and ERP 5.0% give a cost of equity of 10.0%', () => {
    close(costOfEquity({ riskFree: 0.04, beta: 1.2, erp: 0.05, countryPremium: 0 }), 0.1);
  });

  it("Taiwan: R_f 1.8%, raw β 0.85 adjusted to 0.8995, ERP 4.23% + Taiwan's 0.78% give 6.31%", () => {
    const outcome = stockCostOfEquity(
      { ticker: '2330', market: 'TW' },
      { raw: 0.85, adjusted: 0.67 * 0.85 + 0.33, runDate: '2026-10-01' },
      { ...SETTINGS, erp: { source: 'manual', manual: 0.0423 } },
      series({ [CAPM_SERIES.twGovt10y]: [{ month: '2026-08', value: 0.018 }] }),
    );
    assert.ok(outcome.ok);
    close(outcome.result.beta, 0.8995);
    close(outcome.result.premium, 0.0501);
    close(outcome.result.rate, 0.018 + 0.8995 * 0.0501);
    assert.equal(outcome.result.rate.toFixed(4), '0.0631');
  });
});

describe('F11 settings', () => {
  it('reads the seeded config', () => {
    assert.deepEqual(SETTINGS, {
      beta: 'adjusted',
      erp: { source: 'damodaran', manual: 0.0423 },
      markets: {
        US: { benchmark: 'SPX', riskFreeSeries: 'us_treasury_10y', riskFree: 0.045, countryPremium: 0 },
        TW: { benchmark: 'TAIEX', riskFreeSeries: 'tw_govt_10y', riskFree: 0.0196, countryPremium: 0.0078 },
      },
      checked: null,
    });
  });

  it('refuses a malformed config', () => {
    assert.equal(readCapmSettings(null), undefined);
    assert.equal(readCapmSettings({ ...SEEDED, beta: 'blume' }), undefined);
    assert.equal(readCapmSettings({ ...SEEDED, erp: { source: 'damodaran', manual: 4.23 } }), undefined);
    assert.equal(readCapmSettings({ ...SEEDED, markets: {} }), undefined);
    assert.equal(readCapmSettings({ ...SEEDED, markets: { US: { benchmark: 'SPX', risk_free_series: 'us_treasury_10y', risk_free: '4.5%', country_premium: 0 } } }), undefined);
  });
});

describe('F11 inputs', () => {
  const loaded = series({
    [CAPM_SERIES.usTreasury10y]: [
      { month: '2026-09', value: 0.0499 },
      { month: '2026-10', value: 0.05 },
    ],
    [CAPM_SERIES.impliedErp]: [
      { month: '2026-10', value: 0.037 },
      { month: '2026-09', value: 0.0423 },
    ],
  });

  it("takes each rate from its series' newest month", () => {
    assert.deepEqual(riskFreeQuote(SETTINGS.markets['US'] as CapmSettings['markets'][string], loaded), { value: 0.05, month: '2026-10', from: 'series' });
    assert.deepEqual(erpQuote(SETTINGS, loaded), { value: 0.037, month: '2026-10', from: 'series' });
  });

  it('falls back to the setting until a series is loaded, and uses the typed ERP when manual is chosen', () => {
    assert.deepEqual(riskFreeQuote(SETTINGS.markets['TW'] as CapmSettings['markets'][string], loaded), { value: 0.0196, month: null, from: 'setting' });
    assert.deepEqual(erpQuote(SETTINGS, new Map()), { value: 0.0423, month: null, from: 'setting' });
    assert.deepEqual(erpQuote({ erp: { source: 'manual', manual: 0.05 } }, loaded), { value: 0.05, month: null, from: 'setting' });
  });

  it('uses the raw β when chosen, and says why there is no figure', () => {
    const beta = { raw: 1.3, adjusted: 1.201, runDate: null };
    const raw = stockCostOfEquity({ ticker: 'AAPL', market: 'US' }, beta, { ...SETTINGS, beta: 'raw' }, loaded);
    assert.ok(raw.ok);
    close(raw.result.rate, 0.05 + 1.3 * 0.037);
    assert.equal(raw.result.benchmark, 'SPX');
    assert.deepEqual(stockCostOfEquity({ ticker: 'X', market: 'UK' }, beta, SETTINGS, loaded), { ok: false, problem: 'market' });
    assert.deepEqual(stockCostOfEquity({ ticker: 'AAPL', market: 'US' }, undefined, SETTINGS, loaded), { ok: false, problem: 'beta' });
  });
});
