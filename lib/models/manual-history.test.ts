import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { manualHistories, stateOn, type ManualAssetRow, type ManualAuditRow } from './manual-history';

const GOLD_BAR: ManualAssetRow = {
  id: 1,
  name: 'Gold bar',
  assetClassId: 'real_assets',
  productType: 'gold',
  unit: 'grams',
  quantity: 15,
  lastValueTwd: 45000,
  valuedOn: '2026-10-10',
  pool: 'regular',
  createdAt: '2026-10-01T02:00:00Z',
};

/** A manual_assets row as the audit log stores it. */
function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    name: 'Gold bar',
    asset_class_id: 'real_assets',
    product_type: 'gold',
    unit: 'grams',
    quantity: 10,
    last_value_twd: 30000,
    pool: 'regular',
    created_at: '2026-10-01T02:00:00Z',
    ...overrides,
  };
}

function update(changedAt: string, before: Record<string, unknown>, after: Record<string, unknown>): ManualAuditRow {
  return { rowKey: '1', action: 'update', changedAt, oldRow: row(before), newRow: row(after) };
}

describe('manualHistories', () => {
  it('starts an asset that was never edited on the Taipei date it was saved, as it is now', () => {
    const [history] = manualHistories([{ ...GOLD_BAR, createdAt: '2026-10-01T18:00:00Z' }], []);
    assert.equal(history?.states.length, 1);
    assert.equal(history?.states[0]?.from, '2026-10-02');
    assert.equal(history?.states[0]?.quantity, 15);
    assert.equal(history?.deletedOn, null);
  });

  it('replays the edits: the first one shows how it started, each later day starts a new state', () => {
    const [history] = manualHistories(
      [GOLD_BAR],
      [
        // Out of order on purpose; two edits on 5 October in Taipei leave the second.
        update('2026-10-08T17:30:00Z', { quantity: 13 }, { quantity: 15 }),
        update('2026-10-05T03:00:00Z', { quantity: 10 }, { quantity: 12 }),
        update('2026-10-05T09:00:00Z', { quantity: 12 }, { quantity: 13 }),
      ],
    );
    assert.ok(history);
    assert.deepEqual(
      history.states.map((state) => [state.from, state.quantity]),
      [
        ['2026-10-01', 10],
        ['2026-10-05', 13],
        ['2026-10-09', 15],
      ],
    );
    assert.equal(stateOn(history, '2026-09-30'), undefined);
    assert.equal(stateOn(history, '2026-10-04')?.quantity, 10);
    assert.equal(stateOn(history, '2026-10-05')?.quantity, 13);
    assert.equal(stateOn(history, '2026-10-20')?.quantity, 15);
    assert.equal(stateOn(history, '2026-10-20')?.lastValueTwd, 30000);
  });

  it('lets an edit on the day of creation replace the first state', () => {
    const [history] = manualHistories([GOLD_BAR], [update('2026-10-01T05:00:00Z', { quantity: 10 }, { quantity: 15 })]);
    assert.deepEqual(
      history?.states.map((state) => [state.from, state.quantity]),
      [['2026-10-01', 15]],
    );
  });

  it('rebuilds a deleted asset from the log, holding nothing from the day it was deleted', () => {
    const deleted: ManualAuditRow = {
      rowKey: '2',
      action: 'delete',
      changedAt: '2026-10-07T01:00:00Z',
      oldRow: row({ id: 2, name: 'Savings', asset_class_id: 'strategic_cash', product_type: 'cash_mmf', unit: 'TWD', quantity: 50000, last_value_twd: null, pool: 'windfall', created_at: '2026-10-02T00:00:00Z' }),
      newRow: null,
    };
    const [, history] = manualHistories([GOLD_BAR], [deleted]);
    assert.ok(history);
    assert.equal(history.id, 2);
    assert.equal(history.deletedOn, '2026-10-07');
    assert.deepEqual(stateOn(history, '2026-10-06'), {
      from: '2026-10-02',
      name: 'Savings',
      assetClassId: 'strategic_cash',
      productType: 'cash_mmf',
      unit: 'TWD',
      quantity: 50000,
      lastValueTwd: null,
      pool: 'windfall',
    });
    assert.equal(stateOn(history, '2026-10-07'), undefined);
  });

  it('skips logged rows it cannot read', () => {
    const histories = manualHistories([], [{ rowKey: '3', action: 'delete', changedAt: '2026-10-07T01:00:00Z', oldRow: { id: 3 }, newRow: null }]);
    assert.deepEqual(histories, []);
  });
});
