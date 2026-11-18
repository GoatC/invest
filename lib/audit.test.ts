import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeRow, TABLE_LABELS } from './audit';

describe('describeRow', () => {
  it("names an owner's red-flag entry by its stock, indicator, date and value", () => {
    assert.deepEqual(describeRow('red_flag_entries', { ticker: 'AAPL', indicator: 'environmental_penalties', as_of: '2026-10-28', value: 0 }, '3'), {
      en: 'AAPL Environmental penalties 2026-10-28: 0',
      zh: 'AAPL 環境裁罰 2026-10-28：0',
    });
  });

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

  it('names a proposal by its number, rule and what it fired on', () => {
    assert.deepEqual(describeRow('proposals', { id: 3, rule_id: 'R1', state: 'AAPL', status: 'expired' }, '3'), { en: '#3 R1 AAPL', zh: '第 3 號 R1 AAPL' });
    assert.ok(TABLE_LABELS['proposals']);
  });

  it('names a windfall plan by its amount and start, and a tranche by its date, amount and status (F3)', () => {
    assert.deepEqual(describeRow('windfall_plan', { total_twd: 1200000, received_on: '2026-10-28' }, '1'), { en: 'NT$1,200,000 from 2026-10-28', zh: 'NT$1,200,000，自 2026-10-28 起' });
    assert.deepEqual(describeRow('windfall_tranches', { due_date: '2026-11-28', amount_twd: 50000, status: 'done' }, '2'), { en: '2026-11-28 NT$50,000 done', zh: '2026-11-28 NT$50,000 已完成' });
    assert.ok(TABLE_LABELS['windfall_plan'] && TABLE_LABELS['windfall_tranches']);
  });

  it('names a split by its ticker, ratio and ex-date', () => {
    assert.deepEqual(describeRow('splits', { ticker: '0050', ex_date: '2025-06-18', ratio: 4 }, '1'), { en: '0050 split ×4 from 2025-06-18', zh: '0050 自 2025-06-18 起分割 ×4' });
    assert.ok(TABLE_LABELS['splits']);
  });
});
