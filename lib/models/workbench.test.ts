import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Quarter } from './fundamentals';
import { assumed, readValuationSettings, valueStock, type ValuationSettings } from './intrinsic';
import { closeOn, currentMultiples, filedSince, nextFiling, historyMultiples, readSaved, valuationInput, valuationRows, watchInputs, type SavedValuation, type StockSeries } from './workbench';

const SETTINGS = readValuationSettings({
  model: 'dcf',
  years: 5,
  growth: { bear: 0.02, base: 0.06, bull: 0.1 },
  terminal: { bear: 0.015, base: 0.025, bull: 0.03 },
  debt_spread: 0.015,
  tax_rate: { US: 0.21, TW: 0.2 },
  history_years: 5,
  min_quarters: 2,
  last_verified: null,
}) as ValuationSettings;

const quarter = (periodEnd: string, netIncome: number, filed: string | null = null): Quarter => ({
  periodEnd,
  filed,
  figures: { netIncome, shares: 10, equity: 500, ebit: 120, da: 30, capex: 40, pretax: 115, tax: 23, debt: 100, cash: 50 },
});

const STOCK: StockSeries = {
  ticker: 'AAPL',
  market: 'US',
  currency: 'USD',
  reportCurrency: 'USD',
  quarters: [quarter('2020-06-27', 50), quarter('2025-12-27', 90), quarter('2026-03-28', 95), quarter('2026-06-27', 100, '2026-07-31')],
  closes: [
    { date: '2020-06-26', close: 90 },
    { date: '2025-12-26', close: 180 },
    { date: '2026-03-27', close: 190 },
    { date: '2026-06-26', close: 200 },
    { date: '2026-10-27', close: 210 },
  ],
};

describe('F12 workbench', () => {
  it('finds the close on a date, or the newest within ten days before it', () => {
    assert.equal(closeOn(STOCK.closes, '2026-06-27'), 200);
    assert.equal(closeOn(STOCK.closes, '2026-06-25'), undefined);
    assert.equal(closeOn(STOCK.closes, '2026-10-30'), 210);
  });

  it("measures the company's own range over five years of quarter ends, and its multiples today", () => {
    // The 2020 quarter is more than five years before the newest one.
    assert.deepEqual(historyMultiples(STOCK, 5).map((set) => set.pe), [20, 20, 20]);
    assert.equal(currentMultiples(STOCK)?.pe, 21);
    assert.equal(currentMultiples({ ...STOCK, reportCurrency: 'TWD' }), undefined);
  });

  it('builds the input from the newest quarter and close, and says what is missing', () => {
    const built = valuationInput(STOCK, [STOCK], { costOfEquity: 0.1, riskFree: 0.04 }, assumed(SETTINGS, {}), SETTINGS);
    assert.ok(built.ok);
    assert.equal(built.quarter.periodEnd, '2026-06-27');
    assert.equal(built.input.price, 210);
    assert.equal(built.input.peers.length, 1);
    assert.deepEqual(valuationInput({ ...STOCK, closes: [] }, [], undefined, assumed(SETTINGS, {}), SETTINGS), { ok: false, problem: 'price' });
    assert.deepEqual(valuationInput({ ...STOCK, quarters: [] }, [], undefined, assumed(SETTINGS, {}), SETTINGS), { ok: false, problem: 'filings' });
    assert.deepEqual(valuationInput({ ...STOCK, reportCurrency: 'TWD' }, [], undefined, assumed(SETTINGS, {}), SETTINGS), { ok: false, problem: 'currency' });
    // Typed FCFF and shares value a company with no filings loaded.
    assert.ok(valuationInput({ ...STOCK, quarters: [] }, [], undefined, assumed(SETTINGS, { overrides: { fcff: 100, shares: 10 } }), SETTINGS).ok);
  });

  it('saves one row per model that gave values, and reads it back', () => {
    const built = valuationInput(STOCK, [STOCK], { costOfEquity: 0.1, riskFree: 0.04 }, assumed(SETTINGS, {}), SETTINGS);
    assert.ok(built.ok);
    const rows = valuationRows('AAPL', '2026-10-28', valueStock(built.input), { trigger: 'filing', periodEnd: '2026-06-27', filed: '2026-07-31', price: 210, currency: 'USD', costOfEquity: 0.1, assumptions: assumed(SETTINGS, {}) });
    assert.deepEqual(rows.map((row) => row['model']), ['dcf_fcff', 'multiples']);
    const back = readSaved(rows[0] as Parameters<typeof readSaved>[0]);
    assert.equal(back?.model, 'dcf');
    assert.equal(back?.trigger, 'filing');
    assert.equal(back?.periodEnd, '2026-06-27');
    assert.equal(readSaved({ ticker: 'X', valuation_date: '2026-10-28', model: 'capm', iv_bear: 1, iv_base: 2, iv_bull: 3, inputs: {} }), undefined);
  });

  it('gives the rules the newest base value of the chosen model, the one before it, and the own multiples', () => {
    const saved: SavedValuation[] = [
      { ticker: 'AAPL', date: '2026-08-01', model: 'dcf', bear: 150, base: 200, bull: 250, trigger: 'edit', periodEnd: '2026-03-28', currency: 'USD' },
      { ticker: 'AAPL', date: '2026-10-28', model: 'dcf', bear: 170, base: 230, bull: 280, trigger: 'filing', periodEnd: '2026-06-27', currency: 'USD' },
      { ticker: 'AAPL', date: '2026-10-28', model: 'ddm', bear: 60, base: 70, bull: 80, trigger: 'filing', periodEnd: '2026-06-27', currency: 'USD' },
    ];
    const entry = { ticker: 'AAPL', active: true, model: 'dcf' as const, buy: null, trim: 1.3, assetClassId: 'us_stocks', currency: 'USD' };
    assert.deepEqual(watchInputs([entry], saved), [{ ticker: 'AAPL', assetClassId: 'us_stocks', value: 230, valuedOn: '2026-10-28', trigger: 'filing', previous: { value: 200, valuedOn: '2026-08-01' }, trim: 1.3 }]);
    assert.deepEqual(watchInputs([{ ...entry, active: false }], saved), []);
    assert.deepEqual(watchInputs([{ ...entry, currency: 'TWD' }], saved), []);
    assert.equal(filedSince(STOCK.quarters, saved, 'AAPL'), false);
    assert.equal(filedSince(STOCK.quarters, saved.slice(0, 1), 'AAPL'), true);
    assert.equal(filedSince(STOCK.quarters, [], 'AAPL'), true);
  });

  it("dates the next report: Taiwan's deadline, a US company's from the same quarter's filing a year before", () => {
    const tw = [quarter('2026-06-30', 100)];
    assert.deepEqual(nextFiling('TW', tw), { date: '2026-11-14', kind: 'deadline' });
    assert.deepEqual(nextFiling('TW', [quarter('2026-09-30', 100)]), { date: '2027-03-31', kind: 'deadline' });
    const us = [quarter('2025-09-27', 90, '2025-10-31'), quarter('2026-06-27', 100, '2026-07-31')];
    assert.deepEqual(nextFiling('US', us), { date: '2026-10-31', kind: 'estimate' });
    assert.equal(nextFiling('US', [quarter('2026-06-27', 100, '2026-07-31')]), undefined);
  });
});
