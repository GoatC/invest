import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DraftOrder } from './models/engine';
import { checkText, howLines, orderLine, proposalTitle, whyLines } from './proposal-text';

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
      en: 'AAPL: 5.5% of the regular pool (NT$11,000 of NT$200,000) > 5% cap · sell ≈ NT$1,000',
      zh: 'AAPL：占一般投入資金池 5.5%（NT$200,000 中的 NT$11,000）> 5% 上限 · 賣出約 NT$1,000',
    });
    assert.ok(howLines({ id: 'R1', condition: 'single_stock_weight_above' }, { poolTwd: 1, cashTwd: 0, leftTwd: 0 })[0]?.en.startsWith("Trim = the stock's value − the cap × the regular pool."));
  });

  it('explains the US estate-tax check in dollars, holding by holding', () => {
    const [first, second] = whyLines(
      { id: 'US_ESTATE_TAX', condition: 'us_situs_value_above' },
      {
        poolTwd: 5_482_500,
        situs: [
          { ticker: 'VT', valueTwd: 1_300_000, valueUsd: 40_000 },
          { ticker: 'BNDW', valueTwd: 682_500, valueUsd: 21_000 },
        ],
        situsUsd: 61_000,
        limitUsd: 60_000,
        usdTwd: 32.5,
        cashTwd: 0,
        leftTwd: 0,
      },
      NAMES,
    );
    assert.equal(
      first?.en,
      'US-situs assets: 61,000 USD > 60,000 USD exempt (NT$32.5 a dollar): VT 40,000 USD, BNDW 21,000 USD',
    );
    assert.ok(second?.zh.includes('愛爾蘭註冊'));
    assert.ok(howLines({ id: 'US_ESTATE_TAX', condition: 'us_situs_value_above' }, { poolTwd: 1, cashTwd: 0, leftTwd: 0 })[0]?.en.includes("A non-US resident's estate is exempt only up to the limit"));
  });

  it('explains a windfall tranche and an acceleration with their figures', () => {
    const [tranche, kept] = whyLines(
      { id: 'WINDFALL_TRANCHE_DUE', condition: 'tranche_due' },
      { poolTwd: 5_500_000, waitingTwd: 5_500_000, tranchesLeft: 24, dueDate: '2026-11-02', keptTwd: 22_917, cashTwd: 229_167, leftTwd: 100 },
      NAMES,
    );
    // NT$5,500,000 ÷ 24 = NT$229,167.
    assert.equal(tranche?.en, 'Tranche due 2026-11-02: NT$5,500,000 ÷ 24 tranches = NT$229,167, by the core targets');
    assert.equal(kept?.en, "Strategic cash's share, NT$22,917, stays in the balance");
    const [fall, deploy] = whyLines(
      { id: 'WINDFALL_ACCELERATION', condition: 'index_drawdown_tier' },
      { poolTwd: 1, waitingTwd: 5_000_000, drawdown: 0.26, peak: { date: '2026-03-02', close: 100 }, latest: { date: '2026-10-21', close: 74 }, tier: 0.25, share: 0.5, cashTwd: 2_500_000, leftTwd: 0 },
      NAMES,
    );
    assert.equal(fall?.en, 'ACWI −26.0% from its 52-week high (100 on 2026-03-02 → 74 on 2026-10-21) · tier 25%');
    assert.equal(deploy?.en, '50% of the cash now: NT$2,500,000 of NT$5,000,000 waiting');
    assert.equal(checkText({ ruleId: 'WINDFALL_TRANCHE_DUE', outcome: 'waiting', why: 'plan' }).zh, '尚無大額資金計畫');
  });

  it('explains the buy and trim zones and a valuation a filing moved (F12)', () => {
    const buy = whyLines(
      { id: 'BUY_ZONE', condition: 'price_at_or_below_value_multiple' },
      { poolTwd: 100_000, zone: [{ ticker: 'AAPL', price: 150, currency: 'USD', value: 210, multiple: 0.75, roomTwd: 2_000, boughtTwd: 1_950 }], satelliteShareTwd: 2_000, cashTwd: 2_000, leftTwd: 50 },
      NAMES,
    );
    assert.equal(buy[0]?.en, 'AAPL: 150.00 USD ≤ 75% of its 210.00 USD value (157.50 USD)');
    assert.equal(buy[1]?.zh, '來自本月投入：最多 NT$2,000');
    const trim = whyLines(
      { id: 'TRIM_ZONE', condition: 'price_at_or_above_value_multiple' },
      { poolTwd: 100_000, zone: [{ ticker: '2330', price: 1500, currency: 'TWD', value: 1000, multiple: 1.25, heldTwd: 6_000, soldTwd: 3_000 }], sellShare: 0.5, cashTwd: 3_000, leftTwd: 0 },
      NAMES,
    );
    assert.equal(trim[0]?.en, '2330: 1,500.00 TWD ≥ 125% of its 1,000.00 TWD value · sell 50% of NT$6,000');
    const moved = whyLines(
      { id: 'VALUATION_UPDATED', condition: 'value_change_exceeds' },
      { poolTwd: 100_000, changes: [{ ticker: 'AAPL', value: 230, previous: 200, valuedOn: '2026-10-31', previousOn: '2026-08-01', change: 0.15 }], cashTwd: 0, leftTwd: 0 },
      NAMES,
    );
    assert.equal(moved[0]?.en, 'AAPL: 200.00 (2026-08-01) → 230.00 (2026-10-31), +15.0%');
    assert.deepEqual(proposalTitle({ id: 'BUY_ZONE', condition: 'price_at_or_below_value_multiple' }), { en: 'BUY_ZONE · Buy zone', zh: 'BUY_ZONE · 進入買入區' });
    assert.deepEqual(checkText({ ruleId: 'BUY_ZONE', outcome: 'waiting', why: 'valuation' }), { en: 'Waiting for a saved valuation', zh: '尚無已儲存的估值' });
  });

  it('says when a whole share sells much more than the trim', () => {
    const lines = whyLines(
      { id: 'R1', condition: 'single_stock_weight_above' },
      { poolTwd: 97_501, stocks: [{ ticker: 'NVDA', valueTwd: 5_832, weight: 0.0598, trimTwd: 957, soldTwd: 5_832 }], limit: 0.05, cashTwd: 5_832, leftTwd: 0 },
      NAMES,
    );
    assert.equal(lines[1]?.en, 'Whole shares: NT$5,832 of NVDA, more than needed');
    const close = whyLines({ id: 'R1', condition: 'single_stock_weight_above' }, { poolTwd: 200_000, stocks: [{ ticker: 'AAPL', valueTwd: 11_000, weight: 0.055, trimTwd: 1_000, soldTwd: 1_000 }], limit: 0.05, cashTwd: 1_000, leftTwd: 0 }, NAMES);
    assert.ok(!close.some((line) => line.en.startsWith('Whole shares')));
  });

  it('explains R2 with the PRD figures, and what R1 already sells of it', () => {
    const lines = whyLines(
      { id: 'R2', condition: 'satellite_weight_above' },
      { poolTwd: 200_000, satelliteTwd: 51_000, weight: 0.255, trigger: 0.25, target: 0.2, trimTwd: 11_000, countedTwd: 1_000, cashTwd: 10_000, leftTwd: 40 },
      NAMES,
    );
    assert.equal(lines[0]?.en, 'Satellite: 25.5% of the regular pool (NT$51,000 of NT$200,000) > 25% · trim ≈ NT$11,000 → 20%');
    assert.equal(lines[1]?.en, 'R1 already sells NT$1,000 of it');
    assert.equal(lines.at(-1)?.en, 'NT$10,000 to invest · NT$40 stays as cash (whole shares)');
  });

  it('lists each class past its band, and the value no order can sell', () => {
    const lines = whyLines(
      { id: 'F8_DRIFT', condition: 'class_drift_exceeds' },
      { poolTwd: 100_000, classes: [{ id: 'real_assets', weight: 0.2, target: 0.1, band: 0.025 }], cashTwd: 0, leftTwd: 0, untradedTwd: 10_000, noFund: ['global_bonds'] },
      NAMES,
    );
    assert.equal(lines[0]?.en, 'Real assets: 20.0% / 10% target (+10.0 pp; band ±2.5 pp)');
    assert.equal(lines[0]?.zh, '實體資產：20.0% / 目標 10%（+10.0 pp；門檻 ±2.5 pp）');
    assert.ok(lines.some((line) => line.en.startsWith('NT$10,000 of it is gold in grams')));
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
    assert.equal(checkText({ ruleId: 'R1', outcome: 'fires', cooldownUntil: '2026-10-27' }).en, 'Fires · held back until 2026-10-27 (cooldown)');
    assert.equal(checkText({ ruleId: 'R2', outcome: 'covered', why: 'R1' }).en, "Covered by R1's trims");
    assert.equal(checkText({ ruleId: 'F8_DRIFT', outcome: 'covered', why: 'contribution' }).zh, '下次每月投入可補足');
    assert.equal(checkText({ ruleId: 'MONTHLY_CONTRIBUTION', outcome: 'waiting', why: 'dca_day' }).en, 'Waiting for the DCA debit day');
    assert.equal(checkText({ ruleId: 'US_ESTATE_TAX', outcome: 'waiting', why: 'usd' }).en, 'Waiting for a USD/TWD rate');
    assert.equal(checkText({ ruleId: 'BUY_ZONE', outcome: 'later' }).en, 'Comes with a later step');
    assert.ok(checkText({ ruleId: 'DATA_FAILURE', outcome: 'later' }, 'job_failed_consecutively').en.startsWith('Watched by the data status check'));
  });
});
