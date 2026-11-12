import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { filterLedger, flowTotals, ledger, ledgerTotals } from './cash-flows';
import { trade } from './test-helpers';
import type { CashFlow } from './types';

const flow = (overrides: Partial<CashFlow>): CashFlow => ({
  flowDate: '2026-10-06',
  type: 'contribution',
  amount: 10000,
  currency: 'TWD',
  fxRate: 1,
  pool: 'regular',
  ticker: null,
  note: null,
  ...overrides,
});

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

describe('flowTotals', () => {
  it('adds each type in TWD, a foreign dividend at its own rate', () => {
    const totals = flowTotals([
      ...Array.from({ length: 6 }, () => flow({})),
      flow({ type: 'dividend', amount: 0.62, currency: 'USD', fxRate: 32.2, ticker: 'VT' }),
      flow({ type: 'windfall', amount: 5_500_000, pool: 'windfall' }),
      flow({ type: 'withdrawal', amount: 3000 }),
    ]);
    assert.deepEqual({ ...totals, dividend: Math.round(totals.dividend * 1e4) / 1e4 }, { contribution: 60000, windfall: 5_500_000, dividend: 19.964, withdrawal: 3000 });
  });
});

describe('the cash-flow book', () => {
  it('counts a buy by itself: qty × price + fee, at the trade rate (PRD Section 11)', () => {
    // 2 VT at US$150 with a US$1 fee at 31.80: (300 + 1) × 31.80 = NT$9,571.80 put in.
    const [line] = ledger([trade({ id: 1, tradeDate: '2026-05-07', qty: 2, price: 150, fee: 1, fxRate: 31.8 })], undefined, []);
    assert.equal(line?.kind, 'buy');
    assert.equal(line?.source, 'trade');
    near(line?.amount ?? 0, 301);
    near(line?.amountTwd ?? 0, 9571.8);
    near(ledgerTotals(ledger([trade({ id: 1, qty: 2, price: 150, fee: 1, fxRate: 31.8 })], undefined, [])).regular.netTwd, 9571.8);
  });

  it('counts a sell as what it frees, after its fee and tax, and nets it off what was bought', () => {
    // 100 at NT$88 + NT$20 = NT$8,820 in; 20 sold at NT$92 − 20 − 1.84 = NT$1,818.16 back.
    const lines = ledger(
      [
        trade({ id: 1, tradeDate: '2026-06-08', ticker: '00692', qty: 100, price: 88, currency: 'TWD', fee: 20, fxRate: 1 }),
        trade({ id: 2, tradeDate: '2026-10-15', ticker: '00692', side: 'sell', qty: 20, price: 92, currency: 'TWD', fee: 20, tax: 1.84, fxRate: 1 }),
      ],
      undefined,
      [],
    );
    assert.deepEqual(lines.map((line) => [line.date, line.kind]), [['2026-10-15', 'sell'], ['2026-06-08', 'buy']]);
    const totals = ledgerTotals(lines);
    near(totals.regular.boughtTwd, 8820);
    near(totals.regular.soldTwd, 1818.16);
    near(totals.regular.netTwd, 7001.84);
    assert.deepEqual([totals.regular.buys, totals.regular.sells], [1, 1]);
  });

  it('counts only own money of a leveraged buy, and a short as the margin it puts up', () => {
    // A 2× long of 10 at 100: 500 own money + 5 fee. A 2× short of 10 at 100: 500 margin, the fee out of the proceeds.
    const lines = ledger(
      [
        trade({ id: 1, qty: 10, price: 100, fee: 5, fxRate: 30, leverage: 2 }),
        trade({ id: 2, ticker: 'AAPL', side: 'sell', direction: 'short', qty: 10, price: 100, fee: 5, fxRate: 30, leverage: 2 }),
      ],
      undefined,
      [],
    );
    const byId = new Map(lines.map((line) => [line.id, line]));
    near(byId.get(1)?.amountTwd ?? 0, 505 * 30);
    assert.equal(byId.get(2)?.kind, 'buy');
    near(byId.get(2)?.amountTwd ?? 0, 500 * 30);
  });

  it('keeps the windfall apart: its pool’s buys are money deployed, against what arrived', () => {
    const lines = ledger(
      [trade({ id: 1, tradeDate: '2026-11-02', pool: 'windfall', qty: 10, price: 100, fxRate: 32 }), trade({ id: 2, tradeDate: '2026-11-03', qty: 1, price: 100, fxRate: 32 })],
      undefined,
      [flow({ id: 1, flowDate: '2026-11-01', type: 'windfall', amount: 400_000, pool: 'windfall' })],
    );
    const totals = ledgerTotals(lines);
    assert.deepEqual(totals.windfall, { arrivedTwd: 400_000, deployedTwd: 32_000, waitingTwd: 368_000, share: 0.08 });
    near(totals.regular.netTwd, 3200);
    assert.deepEqual(filterLedger(lines, 'windfall').map((line) => line.key), ['t1', 'f1']);
    assert.deepEqual(filterLedger(lines, 'trades').map((line) => line.key), ['t2']);
  });

  it('lists a contribution typed in by hand without adding it: its buy is already counted', () => {
    const lines = ledger([trade({ id: 1, qty: 1, price: 100, fxRate: 32 })], undefined, [flow({ id: 7 }), flow({ id: 8, type: 'dividend', amount: 0.62, currency: 'USD', fxRate: 32.2, ticker: 'VT' })]);
    const totals = ledgerTotals(lines);
    assert.deepEqual(totals.uncounted, { twd: 10000, lines: 1 });
    assert.equal(lines.find((line) => line.key === 'f7')?.counted, false);
    near(totals.regular.netTwd, 3200);
    near(totals.dividendTwd, 19.964);
    assert.deepEqual(filterLedger(lines, 'dividends').map((line) => line.key), ['f8']);
  });

  it('shows a trade as traded when a split followed it, with the same money', () => {
    // 1 share at 400 before a 1-into-4 split, 2 of the new shares sold at 110: half the position.
    const lines = ledger(
      [trade({ id: 1, tradeDate: '2026-01-05', qty: 1, price: 400, fxRate: 30 }), trade({ id: 2, tradeDate: '2026-03-02', side: 'sell', qty: 2, price: 110, fxRate: 30 })],
      [{ ticker: 'VT', exDate: '2026-02-02', ratio: 4 }],
      [],
    );
    const buy = lines.find((line) => line.key === 't1');
    assert.deepEqual(buy?.trade, { qty: 1, price: 400, direction: 'long', leverage: 1 });
    near(buy?.amountTwd ?? 0, 12_000);
    near(lines.find((line) => line.key === 't2')?.amountTwd ?? 0, 6600);
  });
});
