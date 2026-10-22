import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DraftOrder } from './models/engine';
import { checkText, orderLine, proposalTitle, whyLines } from './proposal-text';

const NAMES = new Map([
  ['global_bonds', { en: 'Global bonds', zh: '全球債券' }],
  ['real_assets', { en: 'Real assets', zh: '實體資產' }],
]);

describe('proposal text', () => {
  it('titles a proposal by its rule', () => {
    assert.deepEqual(proposalTitle({ id: 'R1', condition: 'single_stock_weight_above' }), { en: 'R1 · Single-stock trim', zh: 'R1 · 單一個股減碼' });
    assert.deepEqual(proposalTitle({ id: 'X', condition: 'something_new' }), { en: 'X · something_new', zh: 'X · something_new' });
  });

  it('explains R1 with the PRD figures: NT$11,000 of NT$200,000 is 5.5%, NT$1,000 over the cap', () => {
    const [first] = whyLines(
      { id: 'R1', condition: 'single_stock_weight_above' },
      { poolTwd: 200_000, stocks: [{ ticker: 'AAPL', valueTwd: 11_000, weight: 0.055, trimTwd: 1_000 }], limit: 0.05, cashTwd: 1_000, leftTwd: 0 },
      NAMES,
    );
    assert.deepEqual(first, {
      en: 'AAPL is 5.5% of the regular pool (NT$11,000 of NT$200,000), above the 5% single-stock cap. Selling about NT$1,000 brings it back to the cap.',
      zh: 'AAPL 占一般投入資金池的 5.5%（NT$200,000 中的 NT$11,000），超過單一個股 5% 上限；賣出約 NT$1,000 可回到上限。',
    });
  });

  it('says when a whole share sells much more than the trim', () => {
    const lines = whyLines(
      { id: 'R1', condition: 'single_stock_weight_above' },
      { poolTwd: 97_501, stocks: [{ ticker: 'NVDA', valueTwd: 5_832, weight: 0.0598, trimTwd: 957, soldTwd: 5_832 }], limit: 0.05, cashTwd: 5_832, leftTwd: 0 },
      NAMES,
    );
    assert.equal(lines[1]?.en, 'In whole shares that is NT$5,832 of NVDA, more than needed, as one share costs more than the trim; edit the order to sell less and stay a little over the cap, or let its market trade in fractions on the Rules page.');
    const close = whyLines({ id: 'R1', condition: 'single_stock_weight_above' }, { poolTwd: 200_000, stocks: [{ ticker: 'AAPL', valueTwd: 11_000, weight: 0.055, trimTwd: 1_000, soldTwd: 1_000 }], limit: 0.05, cashTwd: 1_000, leftTwd: 0 }, NAMES);
    assert.ok(!close.some((line) => line.en.startsWith('In whole shares')));
  });

  it('explains R2 with the PRD figures, and what R1 already sells of it', () => {
    const lines = whyLines(
      { id: 'R2', condition: 'satellite_weight_above' },
      { poolTwd: 200_000, satelliteTwd: 51_000, weight: 0.255, trigger: 0.25, target: 0.2, trimTwd: 11_000, countedTwd: 1_000, cashTwd: 10_000, leftTwd: 40 },
      NAMES,
    );
    assert.ok(lines[0]?.en.startsWith('The satellite is 25.5% of the regular pool (NT$51,000 of NT$200,000), above the 25% trigger. Trimming about NT$11,000 brings it back to 20%'));
    assert.equal(lines[1]?.en, "R1's proposal already sells NT$1,000 of it, so this one sells the rest.");
    assert.equal(lines.at(-1)?.en, 'NT$10,000 to invest; NT$40 stays as cash, as share counts are rounded.');
  });

  it('lists each class past its band, and the value no order can sell', () => {
    const lines = whyLines(
      { id: 'F8_DRIFT', condition: 'class_drift_exceeds' },
      { poolTwd: 100_000, classes: [{ id: 'real_assets', weight: 0.2, target: 0.1, band: 0.025 }], cashTwd: 0, leftTwd: 0, untradedTwd: 10_000, noFund: ['global_bonds'] },
      NAMES,
    );
    assert.equal(lines[0]?.en, 'Real assets: 20.0% against a 10% target (+10.0 pp; F8 rebalances past ±2.5 pp).');
    assert.equal(lines[0]?.zh, '實體資產：20.0%，目標 10%（+10.0 pp；超過 ±2.5 pp 即再平衡）。');
    assert.ok(lines.some((line) => line.en.startsWith('NT$10,000 of it is held as gold in grams')));
    assert.ok(lines.some((line) => line.en.startsWith('No fund to buy for Global bonds')));
  });

  it('writes each order as a line', () => {
    const sell: DraftOrder = { kind: 'trade', ticker: 'AAPL', side: 'sell', qty: 3, price: 236, currency: 'USD', fxRate: 32.4, amountTwd: 22_939.2, assetClassId: 'us_stocks' };
    assert.deepEqual(orderLine(sell), { en: 'Sell 3 AAPL at about 236.00 USD, about NT$22,939', zh: '賣出 AAPL 3 股，約 236.00 USD，約 NT$22,939' });
    assert.equal(orderLine({ ...sell, side: 'buy' }).en, 'Buy 3 AAPL at about 236.00 USD, about NT$22,939');
    const withdraw: DraftOrder = { kind: 'balance', assetId: 5, label: 'Savings', side: 'withdraw', amountTwd: 5_000, assetClassId: 'strategic_cash' };
    assert.deepEqual(orderLine(withdraw), { en: 'Take NT$5,000 out of Savings', zh: '自「Savings」轉出 NT$5,000' });
    assert.equal(orderLine({ ...withdraw, side: 'deposit' }).en, 'Put NT$5,000 into Savings');
  });

  it("says what the engine found for each rule", () => {
    assert.equal(checkText({ ruleId: 'R1', outcome: 'fires', cooldownUntil: '2026-10-27' }).en, 'Fires, but this state was proposed lately: held back until 2026-10-27 (cooldown).');
    assert.equal(checkText({ ruleId: 'R2', outcome: 'covered', why: 'R1' }).en, "Over its trigger, but R1's trims bring it back.");
    assert.equal(checkText({ ruleId: 'F8_DRIFT', outcome: 'covered', why: 'contribution' }).zh, '有類別低於門檻，但下一次每月投入即可補足，因此不提出賣出（現金流優先）。');
    assert.equal(checkText({ ruleId: 'MONTHLY_CONTRIBUTION', outcome: 'waiting', why: 'dca_day' }).en, 'Waiting for the DCA debit day: set it below.');
    assert.equal(checkText({ ruleId: 'BUY_ZONE', outcome: 'later' }).en, 'Evaluated once its feature is built (a later step).');
    assert.ok(checkText({ ruleId: 'DATA_FAILURE', outcome: 'later' }, 'job_failed_consecutively').en.startsWith('Watched by the data status check'));
  });
});
