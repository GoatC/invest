import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { flowTotals } from './cash-flows';
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
