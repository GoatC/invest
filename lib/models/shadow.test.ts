import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DraftOrder, TradeOrder } from './engine';
import { closeAfter, hitRates, proposalReturn, shadowRows, type ShadowProposal } from './shadow';

const trade = (ticker: string, side: 'buy' | 'sell', amountTwd: number, price: number, assetClassId = 'us_global_equity'): TradeOrder => ({
  kind: 'trade',
  ticker,
  side,
  qty: amountTwd / price,
  price,
  currency: 'TWD',
  fxRate: 1,
  amountTwd,
  assetClassId,
});

/** Closes on the weekdays after 2026-11-06: one a day, from a list. */
function closes(values: readonly number[]) {
  return values.map((close, i) => ({ date: `2026-11-${String(9 + i).padStart(2, '0')}`, close }));
}

const proposal = (orders: DraftOrder[], date = '2026-11-06'): ShadowProposal => ({ id: 1, ruleId: 'VOLATILITY_ALERT', date, status: 'open', orders, detail: { poolTwd: 0, cashTwd: 0, leftTwd: 0 } });

describe('PRD Section 11 acceptance: N8 shadow log', () => {
  it('Return: buy NT$8,400 of VT at 100 and NT$3,600 of 00692 at 50, sell NT$2,000 of 00677U at 20; five sessions on VT 110, 00692 45, 00677U 15 → (840 − 360 + 500) ÷ 14,000 = +7.0%; the BIL funding sale left out', () => {
    const orders = [trade('00677U', 'sell', 2_000, 20, 'tactical_themes'), trade('BIL', 'sell', 10_000, 100, 'strategic_cash'), trade('VT', 'buy', 8_400, 100), trade('00692', 'buy', 3_600, 50, 'tw_market_cap')];
    const map = new Map([
      ['VT', closes([101, 102, 103, 104, 110])],
      ['00692', closes([50, 49, 48, 47, 45])],
      ['00677U', closes([19, 18, 17, 16, 15])],
    ]);
    const value = proposalReturn(proposal(orders), map, 5);
    assert.ok(value !== null);
    assert.equal(Number(value.toFixed(4)), 0.07);
    assert.equal(proposalReturn(proposal(orders), map, 20), null);
  });

  it('Hit rate: returns +7%, −2%, pending → 1 of 2 measured, 50%, mean +2.5%', () => {
    const summary = hitRates([
      { proposal: proposal([]), trades: [], returns: { 5: 0.07, 20: null, 60: null } },
      { proposal: proposal([]), trades: [], returns: { 5: -0.02, 20: null, 60: null } },
      { proposal: proposal([]), trades: [], returns: { 5: null, 20: null, 60: null } },
    ]);
    assert.deepEqual(summary[5], { measured: 2, hitRate: 0.5, mean: 0.025 });
    assert.deepEqual(summary[20], { measured: 0, hitRate: null, mean: null });
  });
});

describe('shadow log', () => {
  it('counts sessions after the day drafted, and measures nothing without a trade', () => {
    const list = closes([1, 2, 3]);
    assert.equal(closeAfter(list, '2026-11-06', 1)?.close, 1);
    assert.equal(closeAfter(list, '2026-11-09', 2)?.close, 3);
    assert.equal(closeAfter(list, '2026-11-09', 3), undefined);
    const rows = shadowRows([proposal([trade('BIL', 'sell', 1_000, 100, 'strategic_cash')])], new Map());
    assert.deepEqual(rows[0]?.trades, []);
    assert.deepEqual(rows[0]?.returns, { 5: null, 20: null, 60: null });
  });
});
