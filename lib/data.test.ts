import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dcaAmount, diffRows, fxMaxAgeDays, fxMaxGap, orderSettings, toTransaction } from './data';

describe('diffRows', () => {
  it('lists only the columns that changed, skipping bookkeeping columns', () => {
    const before = { id: 7, qty: 4, price: 68, note: null, updated_at: '2026-10-20T01:00:00Z' };
    const after = { id: 7, qty: 5, price: 68, note: 'fixed', updated_at: '2026-10-21T01:00:00Z' };
    assert.deepEqual(diffRows(before, after), [
      { column: 'qty', before: 4, after: 5 },
      { column: 'note', before: null, after: 'fixed' },
    ]);
  });

  it('shows every value going away when a row is deleted', () => {
    assert.deepEqual(diffRows({ id: 7, qty: 4 }, null), [{ column: 'qty', before: 4, after: null }]);
  });

  it('names the part of a JSON setting that changed', () => {
    const before = { key: 'cma', value: { us_global_equity: { expected_return: 0.065 } }, last_verified: null };
    const after = { key: 'cma', value: { us_global_equity: { expected_return: 0.065 }, global_bonds: { expected_return: 0.035 } }, last_verified: '2026-10-22' };
    assert.deepEqual(diffRows(before, after), [
      { column: 'value.global_bonds', before: null, after: { expected_return: 0.035 } },
      { column: 'last_verified', before: null, after: '2026-10-22' },
    ]);
  });
});

describe('toTransaction', () => {
  it('turns numeric strings from the database into numbers', () => {
    const trade = toTransaction({
      id: 1,
      trade_date: '2026-10-07',
      ticker: 'VT',
      side: 'buy',
      qty: '2' as unknown as number,
      price: '150.00' as unknown as number,
      currency: 'USD',
      fee: '1.00' as unknown as number,
      tax: 0,
      fx_rate: '31.80' as unknown as number,
      pool: 'regular',
      source: 'manual',
      note: null,
    });
    assert.deepEqual([trade.qty, trade.price, trade.fee, trade.fxRate], [2, 150, 1, 31.8]);
  });
});

describe('fxMaxGap', () => {
  it('reads the margin from the fx_rate_check setting', () => {
    assert.equal(fxMaxGap({ max_gap: 0.2 }), 0.2);
  });

  it('turns the check off when the setting is missing or malformed', () => {
    for (const value of [undefined, null, 0.2, {}, { max_gap: '0.2' }, { max_gap: 0 }, { max_gap: -1 }]) {
      assert.equal(fxMaxGap(value), null);
    }
  });
});

describe('fxMaxAgeDays', () => {
  it('reads how old a filled-in rate may be from the fx_rate_check setting', () => {
    assert.equal(fxMaxAgeDays({ max_gap: 0.2, max_age_days: 10 }), 10);
    assert.equal(fxMaxAgeDays({ max_age_days: 0 }), 0);
  });

  it('fills in no rate when the setting is missing or malformed', () => {
    for (const value of [undefined, { max_gap: 0.2 }, { max_age_days: '10' }, { max_age_days: 2.5 }, { max_age_days: -1 }]) {
      assert.equal(fxMaxAgeDays(value), null);
    }
  });
});

describe('dcaAmount', () => {
  it('reads the monthly contribution from the dca setting, and nothing from a malformed one', () => {
    assert.equal(dcaAmount({ amount_twd: 10000, day_of_month: null }), 10000);
    for (const value of [undefined, null, {}, { amount_twd: '10000' }, { amount_twd: -1 }]) {
      assert.equal(dcaAmount(value), null);
    }
  });
});

describe('orderSettings', () => {
  it('reads the markets traded in fractions and the decimals', () => {
    assert.deepEqual(orderSettings({ fractional_markets: ['US'], share_decimals: 4 }), { fractionalMarkets: ['US'], shareDecimals: 4 });
  });

  it('falls back to whole shares when the setting is missing or malformed', () => {
    assert.deepEqual(orderSettings(undefined), { fractionalMarkets: [], shareDecimals: 0 });
    assert.deepEqual(orderSettings({ fractional_markets: ['US', 'XX', 3], share_decimals: 9 }), { fractionalMarkets: ['US'], shareDecimals: 0 });
  });
});
