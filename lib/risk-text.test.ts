import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { confidenceText, riskHorizons } from './risk-text';

describe('riskHorizons', () => {
  it('words the card as the PRD does: 95% 1-week VaR, about 1 week in 20, and the 1-month toggle', () => {
    const [week, month] = riskHorizons({ confidence: 0.95, horizonWeeks: 1, monthWeeks: 4.33, lookbackYears: 3 });
    assert.deepEqual(week, {
      weeks: 1,
      tab: { en: '1 week', zh: '1 週' },
      label: { en: '95% 1-week VaR', zh: '95% 一週風險值' },
      note: { en: 'In about 1 week in 20, losses could exceed this.', zh: '每 20 週約有 1 週，損失可能超過此金額。' },
    });
    assert.equal(month?.weeks, 4.33);
    assert.deepEqual(month?.label, { en: '95% 1-month VaR', zh: '95% 一個月風險值' });
    assert.deepEqual(month?.note, { en: 'In about 1 month in 20, losses could exceed this.', zh: '每 20 個月約有 1 個月，損失可能超過此金額。' });
  });

  it('follows config var when its numbers change', () => {
    const [week] = riskHorizons({ confidence: 0.99, horizonWeeks: 2, monthWeeks: 4.33, lookbackYears: 3 });
    assert.deepEqual(week?.label, { en: '99% 2-week VaR', zh: '99% 兩週風險值' });
    assert.deepEqual(week?.note, { en: 'In about 1 in 100 such 2-week periods, losses could exceed this.', zh: '每 100 個 2 週期間約有 1 個，損失可能超過此金額。' });
    assert.equal(confidenceText(0.975), '97.5%');
  });
});
