import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assumed,
  discountedCashFlow,
  fcff,
  gordon,
  impliedPrices,
  marginOfSafety,
  multiplesAt,
  peerMedians,
  ranges,
  readAssumptions,
  readValuationSettings,
  valueStock,
  wacc,
  zoneOf,
  type ValuationInput,
  type ValuationSettings,
} from './intrinsic';

const close = (a: number, b: number, digits = 6) => assert.ok(Math.abs(a - b) < 10 ** -digits / 2, `${a} ≈ ${b}`);

/** The seeded config valuation. */
const SEEDED = {
  model: 'dcf',
  years: 5,
  growth: { bear: 0.02, base: 0.06, bull: 0.1 },
  terminal: { bear: 0.015, base: 0.025, bull: 0.03 },
  debt_spread: 0.015,
  tax_rate: { US: 0.21, TW: 0.2 },
  history_years: 5,
  min_quarters: 8,
  last_verified: null,
};
const SETTINGS = readValuationSettings(SEEDED) as ValuationSettings;

describe('PRD Section 11 acceptance: F12', () => {
  it('FCFF: EBIT 100 at 20% tax, D&A 30, CapEx 40, ΔNWC 10 give 60', () => {
    close(fcff({ ebit: 100, taxRate: 0.2, da: 30, capex: 40, deltaNwc: 10 }), 60);
  });

  it('WACC: E 600 at 10%, D 400 at 5% with 20% tax give 7.6%', () => {
    close(wacc({ equity: 600, debt: 400, costOfEquity: 0.1, costOfDebt: 0.05, taxRate: 0.2 }), 0.076);
  });

  it('DCF: FCFF 100 growing 5% for 5 years at 9%, then 2.5%, give EV ≈ 1,755.62 and 155.56 a share', () => {
    const run = discountedCashFlow({ fcff: 100, growth: 0.05, years: 5, terminalGrowth: 0.025, discount: 0.09 });
    assert.ok(run);
    close(run.flows[4]?.fcff ?? 0, 127.62815625);
    close(run.flows.reduce((sum, row) => sum + row.pv, 0), 447.5745, 4);
    close(run.terminal.value, 2012.5978, 4);
    close(run.terminal.pv, 1308.0505, 4);
    close(run.enterprise, 1755.625, 3);
    // Net debt 200 over 10 shares.
    close((run.enterprise - 200) / 10, 155.5625, 4);
  });

  it('Gordon: D_0 2.00 growing 3% at R_e 8% gives 41.20', () => {
    close(gordon({ dividend: 2, growth: 0.03, costOfEquity: 0.08 }) ?? 0, 41.2);
  });

  it('Margin of safety and zones: value 100, price 70 is 30% and in the buy zone; 125 is the trim zone', () => {
    close(marginOfSafety(100, 70), 0.3);
    assert.equal(zoneOf(70, 100, { buy: 0.75, trim: 1.25 }).zone, 'buy');
    assert.equal(zoneOf(75, 100, { buy: 0.75, trim: 1.25 }).zone, 'buy');
    assert.equal(zoneOf(100, 100, { buy: 0.75, trim: 1.25 }).zone, 'between');
    assert.equal(zoneOf(125, 100, { buy: 0.75, trim: 1.25 }).zone, 'trim');
  });
});

describe('F12 formulas', () => {
  it('refuses a terminal rate at or above the discount rate', () => {
    assert.equal(discountedCashFlow({ fcff: 100, growth: 0.05, years: 5, terminalGrowth: 0.09, discount: 0.09 }), undefined);
    assert.equal(gordon({ dividend: 1, growth: 0.08, costOfEquity: 0.08 }), undefined);
  });

  it('says how far the price is from each zone', () => {
    const check = zoneOf(100, 100, { buy: 0.75, trim: 1.25 });
    close(check.buyPrice, 75);
    close(check.toBuy, 0.25);
    close(check.toTrim, 0.25);
  });

  it('works out multiples and the prices they imply', () => {
    const figures = { netIncome: 50, shares: 10, equity: 200, ebit: 80, da: 20, debt: 150, cash: 50 };
    const at = multiplesAt(60, figures);
    close(at.pe ?? 0, 12);
    close(at.pb ?? 0, 3);
    // EV = 600 + 100 net debt = 700 over EBITDA 100.
    close(at.evEbitda ?? 0, 7);
    const implied = impliedPrices(figures, { pe: 15, pb: 2, evEbitda: 8 });
    close(implied.pe ?? 0, 75);
    close(implied.pb ?? 0, 40);
    close(implied.evEbitda ?? 0, 70);
    assert.deepEqual(impliedPrices({ netIncome: -5, shares: 10 }, { pe: 15 }), {});
  });

  it('takes medians and ranges, leaving out a multiple seen too seldom', () => {
    assert.deepEqual(peerMedians([{ pe: 10, pb: 2 }, { pe: 20 }, { pe: 30, pb: 4 }]), { pe: 20, pb: 3 });
    const own = ranges([{ pe: 10 }, { pe: 14, pb: 1 }, { pe: 12 }], 3);
    assert.deepEqual(own, { pe: { low: 10, median: 12, high: 14, n: 3 } });
  });
});

describe('F12 settings and assumptions', () => {
  it('reads the seeded config and refuses a malformed one', () => {
    assert.equal(SETTINGS.model, 'dcf');
    assert.deepEqual(SETTINGS.taxRate, { US: 0.21, TW: 0.2 });
    assert.equal(readValuationSettings({ ...SEEDED, growth: { bear: 0.1, base: 0.06, bull: 0.02 } }), undefined);
    assert.equal(readValuationSettings({ ...SEEDED, model: 'capm' }), undefined);
    assert.equal(readValuationSettings(null), undefined);
  });

  it("keeps a stock's well-formed assumptions and fills the rest from the defaults", () => {
    const read = readAssumptions({ model: 'ddm', growth: { base: 0.08 }, overrides: { shares: 0, fcff: 50 }, peers: ['MSFT', 3] });
    assert.deepEqual(read, { model: 'ddm', growth: { base: 0.08 }, overrides: { fcff: 50 }, peers: ['MSFT'] });
    const full = assumed(SETTINGS, read);
    assert.deepEqual(full.growth, { bear: 0.02, base: 0.08, bull: 0.1 });
    assert.equal(full.years, 5);
    // A base above the bull keeps the defaults.
    assert.deepEqual(assumed(SETTINGS, { growth: { base: 0.2 } }).growth, SETTINGS.growth);
  });
});

describe('F12 valuing a stock', () => {
  const figures = { revenue: 1000, ebit: 125, pretax: 120, tax: 24, netIncome: 96, da: 30, capex: 40, currentAssets: 300, cash: 100, currentLiabilities: 150, shortDebt: 20, debt: 300, equity: 500, shares: 10, interest: 15, dps: 3 };
  const input = (overrides: Partial<ValuationInput> = {}): ValuationInput => ({
    price: 150,
    market: 'US',
    figures,
    // Working capital a year before: 280 − 90 − (140 − 20) = 70; now 300 − 100 − 130 = 70: no change.
    yearAgo: { currentAssets: 280, cash: 90, currentLiabilities: 140, shortDebt: 20 },
    history: Array.from({ length: 8 }, (_, i) => ({ pe: 14 + i * 0.5 })),
    peers: [{ pe: 18, evEbitda: 12 }, { pe: 22, evEbitda: 14 }],
    costOfEquity: 0.1,
    riskFree: 0.04,
    assumptions: assumed(SETTINGS, {}),
    settings: SETTINGS,
    ...overrides,
  });

  it('values by DCF from the filings: tax 20%, FCFF 90, R_d 5%, WACC over market equity', () => {
    const outcome = valueStock(input()).dcf;
    assert.ok(outcome.ok);
    const { result } = outcome;
    close(result.taxRate.value, 0.2);
    assert.equal(result.taxRate.from, 'filings');
    close(result.fcff.value, 125 * 0.8 + 30 - 40);
    close(result.costOfDebt.value, 0.05);
    close(result.wacc, (1500 / 1800) * 0.1 + (300 / 1800) * 0.05 * 0.8);
    close(result.netDebt.value, 200);
    const base = result.scenarios.base;
    close(result.values.base, (base.enterprise - 200) / 10);
    assert.ok(result.values.bear < result.values.base && result.values.base < result.values.bull);
  });

  it('takes typed figures over the filings, and R_f + the spread when the filings give no R_d', () => {
    const outcome = valueStock(input({ figures: { ...figures, interest: undefined }, assumptions: assumed(SETTINGS, { overrides: { fcff: 50, netDebt: 0, shares: 20 } }) })).dcf;
    assert.ok(outcome.ok);
    assert.deepEqual([outcome.result.fcff.from, outcome.result.netDebt.from, outcome.result.shares.from], ['typed', 'typed', 'typed']);
    close(outcome.result.costOfDebt.value, 0.055);
    assert.equal(outcome.result.costOfDebt.from, 'default');
  });

  it('says why there is no DCF: no cost of equity, negative FCFF, a terminal rate past WACC', () => {
    assert.deepEqual(valueStock(input({ costOfEquity: undefined })).dcf, { ok: false, problem: 'cost_of_equity' });
    assert.deepEqual(valueStock(input({ figures: { ...figures, capex: 500 } })).dcf, { ok: false, problem: 'fcff' });
    assert.deepEqual(valueStock(input({ assumptions: assumed(SETTINGS, { terminal: { bear: 0.015, base: 0.025, bull: 0.2 } }) })).dcf, { ok: false, problem: 'growth' });
  });

  it('values by Gordon from the dividends a share, else the dividends paid over the shares', () => {
    const ddm = valueStock(input()).ddm;
    assert.ok(ddm.ok);
    close(ddm.result.values.base, (3 * 1.025) / (0.1 - 0.025));
    const paid = valueStock(input({ figures: { ...figures, dps: undefined, dividendsPaid: 20 } })).ddm;
    assert.ok(paid.ok);
    close(paid.result.dividend.value, 2);
    assert.deepEqual(valueStock(input({ figures: { ...figures, dps: undefined } })).ddm, { ok: false, problem: 'dividend' });
  });

  it('values by multiples: the lowest, median and highest of the prices the own range and the peers imply', () => {
    const outcome = valueStock(input()).multiples;
    assert.ok(outcome.ok);
    const eps = 9.6;
    // Own P/E median 15.75 → 151.2; peers P/E 20 → 192; peers EV/EBITDA 13 → (13 × 155 − 200) ÷ 10 = 181.5.
    close(outcome.result.implied.own.pe ?? 0, 15.75 * eps);
    close(outcome.result.implied.peers.pe ?? 0, 20 * eps);
    close(outcome.result.implied.peers.evEbitda ?? 0, 181.5);
    assert.deepEqual(outcome.result.values, { bear: 151.2, base: 181.5, bull: 192 });
    assert.deepEqual(valueStock(input({ history: [], peers: [] })).multiples, { ok: false, problem: 'none' });
  });
});
