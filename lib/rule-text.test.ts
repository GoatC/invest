import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classDrifts, type DriftBands } from './models/allocation';
import { classWeights, regularPool, type Caps } from './models/rules';
import { ASSET_CLASSES, CAPS, holding } from './models/test-helpers';
import { breachAlert, ruleBoard, ruleMath } from './rule-text';

describe('breachAlert', () => {
  it('puts the R1 acceptance case on a tile: the weight against the cap and the sale back to it', () => {
    const tile = breachAlert({ rule: 'R1', subject: 'AAPL', valueTwd: 11_000, weight: 0.055, limit: 0.05, trimTwd: 1_000 }, CAPS);
    assert.deepEqual(
      [tile.code, tile.title.zh, tile.value, tile.gauge, tile.chips?.map((chip) => `${chip.label.zh} ${chip.value}`)],
      ['R1', 'AAPL', '5.5%', { value: 0.055, limit: 0.05 }, ['上限 5%', '賣出 ≈NT$1,000']],
    );
  });

  it('puts the R2 acceptance case on a tile with the trim back to the 20% target', () => {
    const tile = breachAlert({ rule: 'R2', subject: 'satellite', valueTwd: 51_000, weight: 0.255, limit: 0.25, trimTwd: 11_000 }, CAPS, 'info');
    assert.equal(tile.tone, 'info');
    assert.deepEqual(tile.gauge, { value: 0.255, limit: 0.25, target: 0.2 });
    assert.deepEqual(tile.chips?.map((chip) => `${chip.label.zh} ${chip.value}`), ['觸發 25%', '減碼 ≈NT$11,000 → 20%']);
  });
});

describe('ruleMath', () => {
  it('works the R1 and R2 acceptance cases through with their inputs', () => {
    const lines = ruleMath(CAPS, { totalTwd: 200_000, satelliteTwd: 51_000 });
    assert.equal(lines[0]?.en, 'Regular pool = the TWD market value of every regular-pool holding: NT$200,000. Windfall money and holdings without a value yet are left out.');
    assert.equal(
      lines[1]?.en,
      "R1: a stock's weight = its value ÷ regular pool; above 5%, trim = its value − 5% × regular pool. One stock may hold up to NT$10,000.",
    );
    assert.equal(
      lines[2]?.en,
      'R2: satellite weight = satellite value ÷ regular pool = NT$51,000 ÷ NT$200,000 = 25.5%; above 25%, trim = satellite value − 20% × regular pool, back to 20%.',
    );
    assert.equal(lines[2]?.zh, 'R2：衛星部位權重 = 衛星部位市值 ÷ 一般投入資金池 = NT$51,000 ÷ NT$200,000 = 25.5%；超過 25% 時，減碼金額 = 衛星部位市值 − 20% × 一般投入資金池，回到 20%。');
  });

  it('states the formulas alone without figures, and skips a rule that is off', () => {
    const lines = ruleMath({ singleStock: CAPS.singleStock });
    assert.equal(lines.length, 3);
    assert.ok(!lines.some((line) => line.en.startsWith('R2')));
    assert.ok(!lines[1]?.en.includes('may hold up to'));
  });
});

describe('ruleBoard', () => {
  const BANDS: DriftBands = { absDrift: 0.05, relDrift: 0.25, warnShare: 0.5 };
  const stock = (ticker: string, valueTwd: number) =>
    holding({ key: `regular:${ticker}`, ticker, label: ticker, sleeve: 'satellite', assetClassId: 'us_stocks', productType: 'stock', valueTwd });
  /** A NT$200,000 regular pool: the core ETF holds what the others leave. */
  const pool = (...others: ReturnType<typeof holding>[]) => [holding({ valueTwd: 200_000 - others.reduce((sum, h) => sum + (h.valueTwd ?? 0), 0) }), ...others];
  /** `bands` null: F8 is off. */
  const board = (holdings: ReturnType<typeof holding>[], caps: Caps = CAPS, bands: DriftBands | null = BANDS) => {
    const view = regularPool(holdings);
    return ruleBoard(holdings, caps, classDrifts(classWeights(view, ASSET_CLASSES), bands ?? undefined, view.totalTwd));
  };
  const line = (item: ReturnType<typeof ruleBoard>[number]) => `${item.tone} ${item.code} ${item.title.zh} ${item.value} ${item.chips?.map((chip) => `${chip.label.zh} ${chip.value}`).join(', ') ?? ''}`.trim();

  it('shows R1\'s acceptance breach (AAPL 5.5% of NT$200,000) as its warning, R2 and F8 with their standing', () => {
    const items = board(pool(stock('AAPL', 11_000)));
    assert.deepEqual(items.map((item) => item.code), ['R1', 'R2', 'F8']);
    assert.equal(line(items[0]!), 'alert R1 AAPL 5.5% 上限 5%, 賣出 ≈NT$1,000');
    assert.equal(items[0]!.href, '/holdings#rules-status');
    assert.equal(line(items[1]!), 'ok R2 衛星部位 5.5% 觸發 25%');
    assert.deepEqual(items[1]!.gauge, { value: 0.055, limit: 0.25, target: 0.2 });
    assert.equal(items[2]!.href, '/allocation');
  });

  it('shows R2\'s acceptance breach (a NT$51,000 satellite, 25.5%) as its warning with the trim back to 20%', () => {
    const items = board(pool(stock('AAPL', 9_000), stock('MSFT', 9_500), stock('2330', 9_800), holding({ key: 'regular:QQQM', ticker: 'QQQM', sleeve: 'satellite', assetClassId: 'tactical_themes', productType: 'theme_etf', valueTwd: 22_700 })));
    assert.equal(line(items[0]!), 'ok R1 2330 4.9% 上限 5%');
    assert.equal(line(items[1]!), 'alert R2 衛星部位 25.5% 觸發 25%, 減碼 ≈NT$11,000 → 20%');
  });

  it('marks the satellite between its 20% target and 25% trigger as one to watch', () => {
    const items = board(pool(holding({ key: 'regular:QQQM', ticker: 'QQQM', sleeve: 'satellite', assetClassId: 'tactical_themes', productType: 'theme_etf', valueTwd: 44_000 })));
    assert.equal(items[1]!.tone, 'watch');
    assert.equal(items[1]!.value, '22.0%');
  });

  it('names the core class furthest into its F8 band, with its drift and the band', () => {
    const items = board(pool());
    const f8 = items.find((item) => item.code === 'F8')!;
    assert.equal(f8.tone, 'alert', 'all in one class: far past its band');
    assert.match(f8.value ?? '', /^\+\d+\.\d pp$/);
    assert.match(f8.chips?.[0]?.value ?? '', /^\d+\.\d pp$/);
  });

  it('keeps a row for a rule that is off, with the word for it', () => {
    const items = board(pool(stock('AAPL', 11_000)), { satellite: CAPS.satellite }, null);
    assert.deepEqual(items.map((item) => `${item.code} ${item.value}`), ['R1 停用', 'R2 5.5%', 'F8 停用']);
  });
});
