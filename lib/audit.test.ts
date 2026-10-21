import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeRow, TABLE_LABELS } from './audit';

describe('describeRow', () => {
  it('names a deleted trade by its date, side, quantity, ticker and price, in both languages', () => {
    const row = { id: 7, trade_date: '2026-10-07', ticker: 'VT', side: 'buy', qty: 2, price: 150, currency: 'USD' };
    assert.deepEqual(describeRow('transactions', row, '7'), {
      en: '2026-10-07 buy 2 VT at 150 USD',
      zh: '2026-10-07 買進 VT 2 單位，價格 150 USD',
    });
  });

  it('names a cash flow by its date, type, security and amount, in both languages', () => {
    const row = { id: 3, flow_date: '2026-09-15', type: 'dividend', amount: 0.62, currency: 'USD', ticker: 'VT' };
    assert.deepEqual(describeRow('cash_flows', row, '3'), { en: '2026-09-15 dividend VT 0.62 USD', zh: '2026-09-15 股利 VT 0.62 USD' });
    assert.deepEqual(describeRow('cash_flows', { flow_date: '2026-10-06', type: 'contribution', amount: 10000, currency: 'TWD', ticker: null }, '1'), {
      en: '2026-10-06 contribution 10000 TWD',
      zh: '2026-10-06 投入資金 10000 TWD',
    });
  });

  it('names other entries by what a person would recognise', () => {
    assert.deepEqual(describeRow('securities', { ticker: 'NVDA', name: 'NVIDIA Corp.' }, 'NVDA'), { en: 'NVDA NVIDIA Corp.', zh: 'NVDA NVIDIA Corp.' });
    assert.deepEqual(describeRow('manual_assets', { name: 'Gold bar' }, '3'), { en: 'Gold bar', zh: 'Gold bar' });
    assert.deepEqual(describeRow('asset_classes', { name_en: 'Global bonds', name_zh: '全球債券' }, 'global_bonds'), { en: 'Global bonds', zh: '全球債券' });
    assert.deepEqual(describeRow('config', { key: 'fx_rate_check' }, 'fx_rate_check'), { en: 'fx_rate_check', zh: 'fx_rate_check' });
  });

  it('falls back to the row key', () => {
    assert.deepEqual(describeRow('transactions', null, '7'), { en: '7', zh: '7' });
    assert.deepEqual(describeRow('unknown_table', {}, 'k'), { en: 'k', zh: 'k' });
  });

  it('labels every table the database logs', () => {
    for (const table of ['transactions', 'cash_flows', 'manual_assets', 'securities', 'asset_classes', 'config', 'watchlist']) {
      assert.ok(TABLE_LABELS[table], table);
    }
  });
});
