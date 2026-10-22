import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  allocate,
  dcaDate,
  dueContribution,
  evaluate,
  firstSaturday,
  maxBuyClasses,
  orderTotals,
  readOrders,
  resized,
  type DraftOrder,
  type EngineClass,
  type EngineInput,
  type EngineQuote,
  type EngineRule,
  type ProposalRecord,
  type TradeOrder,
} from './engine';
import { ASSET_CLASSES, holding } from './test-helpers';
import type { Holding } from './valuation';

const BENCHMARKS: Record<string, string> = {
  us_global_equity: 'VT',
  tw_market_cap: '0050',
  global_bonds: 'BNDW',
  real_assets: 'GLDM',
  strategic_cash: 'BIL',
  us_stocks: 'VOO',
  tw_stocks: '0050',
  tactical_themes: 'VT',
};
const CLASSES: EngineClass[] = ASSET_CLASSES.map((assetClass) => ({ ...assetClass, benchmarkTicker: BENCHMARKS[assetClass.id] ?? null }));

/** Every price NT$100 a share in TWD, so share counts read straight from the amounts. */
function twdQuote(price = 100): EngineQuote {
  return { price, currency: 'TWD', fxRate: 1, decimals: 0 };
}

const QUOTES = new Map<string, EngineQuote>(
  ['VT', '0050', '00692', 'BNDW', 'GLDM', 'BIL', 'VOO', 'AAPL', '2330', 'NVDA', 'THEME', 'MSFT'].map((ticker) => [ticker, twdQuote()]),
);

/** The PRD seed rules as the engine reads them. */
const RULES: EngineRule[] = [
  { id: 'R1', condition: 'single_stock_weight_above', threshold: { max_weight: 0.05, pool: 'regular' }, enabled: true, cooldownDays: 7 },
  { id: 'R2', condition: 'satellite_weight_above', threshold: { trigger_weight: 0.25, target_weight: 0.2, pool: 'regular' }, enabled: true, cooldownDays: 7 },
  { id: 'F8_DRIFT', condition: 'class_drift_exceeds', threshold: { abs_drift: 0.05, rel_drift: 0.25 }, enabled: true, cooldownDays: 7 },
  { id: 'ANNUAL_REVIEW', condition: 'first_weekend_of_month', threshold: { month: 1 }, enabled: true, cooldownDays: 7 },
  { id: 'MONTHLY_CONTRIBUTION', condition: 'day_after_dca', threshold: { max_classes: 2, satellite_share_with_buy_alert: 0.2 }, enabled: true, cooldownDays: 7 },
  { id: 'BUY_ZONE', condition: 'price_at_or_below_value_multiple', threshold: { multiple: 0.75 }, enabled: false, cooldownDays: 7 },
];

/** A listed regular-pool holding worth `value` at NT$100 a share. */
function listed(ticker: string, assetClassId: string, value: number, overrides: Partial<Holding> = {}): Holding {
  const sleeve = ['us_stocks', 'tw_stocks', 'tactical_themes'].includes(assetClassId) ? 'satellite' : 'core';
  return holding({ key: `regular:${ticker}`, ticker, label: ticker, assetClassId, sleeve, qty: value / 100, valueTwd: value, currency: 'TWD', ...overrides });
}

/** A regular pool exactly on its core targets, with `satellite` holdings filling the rest. */
function onTarget(total: number, satellite: Holding[] = []): Holding[] {
  const satelliteTwd = satellite.reduce((sum, row) => sum + (row.valueTwd ?? 0), 0);
  const core = total - satelliteTwd;
  return [
    listed('VT', 'us_global_equity', (0.28 / 0.8) * core),
    listed('00692', 'tw_market_cap', (0.12 / 0.8) * core),
    listed('BNDW', 'global_bonds', (0.22 / 0.8) * core),
    listed('GLDM', 'real_assets', (0.1 / 0.8) * core),
    listed('BIL', 'strategic_cash', (0.08 / 0.8) * core),
    ...satellite,
  ];
}

function input(overrides: Partial<EngineInput>): EngineInput {
  return {
    today: '2026-10-22',
    now: '2026-10-22T13:00:00.000Z',
    holdings: [],
    assetClasses: CLASSES,
    quotes: QUOTES,
    rules: RULES,
    dca: { amountTwd: 10_000, dayOfMonth: null },
    expiryDays: 14,
    proposals: [],
    ...overrides,
  };
}

function trades(orders: readonly DraftOrder[]): Array<[string, string, number]> {
  return orders.filter((order): order is TradeOrder => order.kind === 'trade').map((order) => [order.side, order.ticker, order.qty]);
}

function draftOf(outcome: ReturnType<typeof evaluate>, ruleId: string) {
  return outcome.create.find((draft) => draft.ruleId === ruleId);
}

function checkOf(outcome: ReturnType<typeof evaluate>, ruleId: string) {
  const check = outcome.checks.find((candidate) => candidate.ruleId === ruleId);
  assert.ok(check, `no check for ${ruleId}`);
  return check;
}

describe('PRD Section 11 acceptance', () => {
  it('R1: pool NT$200,000 with one stock at NT$11,000 (5.5%) gives a trim proposal back to the cap', () => {
    // The stock is in the satellite; the rest of the satellite is a theme ETF, so R2 stays quiet.
    const holdings = onTarget(200_000, [listed('AAPL', 'us_stocks', 11_000, { productType: 'stock' }), listed('THEME', 'tactical_themes', 29_000, { productType: 'theme_etf' })]);
    const outcome = evaluate(input({ holdings }));
    const draft = draftOf(outcome, 'R1');
    assert.ok(draft, 'R1 drafts a proposal');
    assert.equal(draft.state, 'AAPL');
    const stock = draft.detail.stocks?.[0];
    assert.ok(stock && Math.abs(stock.weight - 0.055) < 1e-12 && Math.abs(stock.trimTwd - 1_000) < 1e-9 && stock.soldTwd === 1_000);
    // Sell 10 shares (NT$1,000); the proceeds buy the most underweight core classes.
    assert.deepEqual(trades(draft.orders).filter(([side]) => side === 'sell'), [['sell', 'AAPL', 10]]);
    const { sold, bought } = orderTotals(draft.orders);
    assert.equal(sold, 1_000);
    assert.ok(bought <= sold && sold - bought < 100, `proceeds reinvested in whole shares: ${bought}`);
    assert.equal(checkOf(outcome, 'R2').outcome, 'quiet');
  });

  it('R2: satellite NT$51,000 of NT$200,000 (25.5%) gives a trim back to 20%, selling ≈ NT$11,000', () => {
    const satellite = [
      listed('THEME', 'tactical_themes', 30_000, { productType: 'theme_etf' }),
      listed('AAPL', 'us_stocks', 9_000, { productType: 'stock' }),
      listed('2330', 'tw_stocks', 9_000, { productType: 'stock' }),
      listed('VOO', 'us_stocks', 3_000, { productType: 'equity_etf' }),
    ];
    const outcome = evaluate(input({ holdings: onTarget(200_000, satellite) }));
    const draft = draftOf(outcome, 'R2');
    assert.ok(draft);
    assert.equal(draft.detail.trimTwd, 11_000);
    assert.ok(Math.abs((draft.detail.weight ?? 0) - 0.255) < 1e-12);
    // Pro rata: 30/51, 9/51, 9/51 and 3/51 of NT$11,000, each rounded up to a whole share.
    assert.deepEqual(trades(draft.orders).filter(([side]) => side === 'sell'), [
      ['sell', 'THEME', 65],
      ['sell', 'AAPL', 20],
      ['sell', '2330', 20],
      ['sell', 'VOO', 7],
    ]);
    const { sold } = orderTotals(draft.orders);
    assert.ok(sold >= 11_000 && sold - 11_000 < 4 * 100, `≈ NT$11,000 sold, got ${sold}`);
    assert.equal(checkOf(outcome, 'R1').outcome, 'quiet');
  });

  it('pool tagging: a windfall buy of a satellite-sleeve stock is left out of R1 and R2', () => {
    const windfall = listed('AAPL', 'us_stocks', 80_000, { key: 'windfall:AAPL', pool: 'windfall', productType: 'stock' });
    const outcome = evaluate(input({ holdings: [...onTarget(200_000, [listed('THEME', 'tactical_themes', 40_000, { productType: 'theme_etf' })]), windfall] }));
    assert.equal(checkOf(outcome, 'R1').outcome, 'quiet');
    assert.equal(checkOf(outcome, 'R2').outcome, 'quiet');
    assert.equal(checkOf(outcome, 'F8_DRIFT').outcome, 'quiet');
    assert.deepEqual(outcome.create, []);
  });
});

describe('R1 and R2 together', () => {
  // A stock at 8% and a satellite at 28% of NT$100,000: R1 sells NT$3,000 of it, R2 the other
  // NT$5,000 the satellite is over 20%, pro rata over what R1 leaves.
  const satellite = [listed('AAPL', 'us_stocks', 8_000, { productType: 'stock' }), listed('THEME', 'tactical_themes', 20_000, { productType: 'theme_etf' })];
  const holdings = onTarget(100_000, satellite);

  it('R2 counts what R1 sells, so both proposals together bring the satellite to 20%', () => {
    const outcome = evaluate(input({ holdings }));
    const r1 = draftOf(outcome, 'R1');
    const r2 = draftOf(outcome, 'R2');
    assert.ok(r1 && r2);
    assert.deepEqual(trades(r1.orders).filter(([side]) => side === 'sell'), [['sell', 'AAPL', 30]]);
    assert.equal(r2.detail.countedTwd, 3_000);
    // NT$5,000 over AAPL's NT$5,000 and THEME's NT$20,000: NT$1,000 and NT$4,000.
    assert.deepEqual(trades(r2.orders).filter(([side]) => side === 'sell'), [
      ['sell', 'AAPL', 10],
      ['sell', 'THEME', 40],
    ]);
  });

  it('R2 does not count R1 while R1 is held back by its cooldown after a dismissal', () => {
    const dismissed: ProposalRecord = { id: 1, ruleId: 'R1', state: 'AAPL', status: 'dismissed', createdAt: '2026-10-20T01:00:00.000Z', expiresAt: null };
    const outcome = evaluate(input({ holdings, proposals: [dismissed] }));
    assert.equal(draftOf(outcome, 'R1'), undefined);
    assert.equal(checkOf(outcome, 'R1').cooldownUntil, '2026-10-27');
    const r2 = draftOf(outcome, 'R2');
    assert.ok(r2 && r2.detail.countedTwd === undefined);
    // The whole NT$8,000 pro rata over NT$8,000 and NT$20,000.
    assert.deepEqual(trades(r2.orders).filter(([side]) => side === 'sell'), [
      ['sell', 'AAPL', 23],
      ['sell', 'THEME', 58],
    ]);
  });

  it('R2 is covered when R1 alone brings the satellite back to its target', () => {
    const outcome = evaluate(input({ holdings: onTarget(100_000, [listed('AAPL', 'us_stocks', 26_000, { productType: 'stock' })]) }));
    assert.ok(draftOf(outcome, 'R1'));
    assert.deepEqual(checkOf(outcome, 'R2'), { ruleId: 'R2', outcome: 'covered', why: 'R1' });
  });
});

describe('F8 drift rebalance', () => {
  it('sells a class past its band back to target and buys the classes furthest under', () => {
    // NT$100,000: bonds NT$30,000 (+8 pp, past the 5 pp band), the rest of the core short pro rata.
    const holdings = [
      listed('VT', 'us_global_equity', 25_000),
      listed('00692', 'tw_market_cap', 10_000),
      listed('BNDW', 'global_bonds', 30_000),
      listed('GLDM', 'real_assets', 8_000),
      listed('BIL', 'strategic_cash', 7_000),
      listed('THEME', 'tactical_themes', 20_000, { productType: 'theme_etf' }),
    ];
    const outcome = evaluate(input({ holdings }));
    const draft = draftOf(outcome, 'F8_DRIFT');
    assert.ok(draft);
    assert.equal(draft.state, 'global_bonds:over');
    assert.deepEqual(draft.detail.classes?.map((row) => row.id), ['global_bonds']);
    // Sell NT$8,000 of BNDW; buy the two classes furthest under target: VT (NT$3,000 short) and
    // 00692 or GLDM (NT$2,000 each), with the rest by target.
    const orders = trades(draft.orders);
    assert.deepEqual(orders[0], ['sell', 'BNDW', 80]);
    assert.equal(orders.filter(([side]) => side === 'buy').length, 2);
    assert.equal(orders.find(([, ticker]) => ticker === 'VT')?.[0], 'buy');
    const { sold, bought } = orderTotals(draft.orders);
    assert.equal(sold, 8_000);
    assert.equal(bought + draft.detail.leftTwd, sold);
  });

  it('is quiet within the band, and its state names each class and side', () => {
    assert.equal(checkOf(evaluate(input({ holdings: onTarget(100_000, [listed('THEME', 'tactical_themes', 20_000, { productType: 'theme_etf' })]) })), 'F8_DRIFT').outcome, 'quiet');
    // Gold at 4% (band 2.5 pp under a 10% target) and cash at 14%: both out.
    const holdings = [
      listed('VT', 'us_global_equity', 28_000),
      listed('00692', 'tw_market_cap', 12_000),
      listed('BNDW', 'global_bonds', 22_000),
      listed('GLDM', 'real_assets', 4_000),
      listed('BIL', 'strategic_cash', 14_000),
      listed('THEME', 'tactical_themes', 20_000, { productType: 'theme_etf' }),
    ];
    const draft = draftOf(evaluate(input({ holdings })), 'F8_DRIFT');
    assert.equal(draft?.state, 'real_assets:under,strategic_cash:over');
    assert.deepEqual(trades(draft?.orders ?? []), [
      ['sell', 'BIL', 60],
      ['buy', 'GLDM', 60],
    ]);
  });

  it('cash first: a class under its band that the next contribution covers is left to it, with no sale', () => {
    // Gold NT$4,000 of NT$100,000 (target 10%, band 2.5 pp): NT$7,000 short with the NT$10,000 counted in.
    const holdings = [
      listed('VT', 'us_global_equity', 30_000),
      listed('00692', 'tw_market_cap', 13_000),
      listed('BNDW', 'global_bonds', 24_000),
      listed('GLDM', 'real_assets', 4_000),
      listed('BIL', 'strategic_cash', 9_000),
      listed('THEME', 'tactical_themes', 20_000, { productType: 'theme_etf' }),
    ];
    const withDay = evaluate(input({ holdings, dca: { amountTwd: 10_000, dayOfMonth: 5 } }));
    assert.deepEqual(checkOf(withDay, 'F8_DRIFT'), { ruleId: 'F8_DRIFT', outcome: 'covered', why: 'contribution' });
    // Without a DCA day the contribution rule cannot act, so the drift list sells to fund it.
    const draft = draftOf(evaluate(input({ holdings })), 'F8_DRIFT');
    assert.ok(draft && orderTotals(draft.orders).sold > 0);
    assert.equal(trades(draft.orders).find(([side]) => side === 'buy')?.[1], 'GLDM');
  });

  it('reports value held as gold in grams, which no order can sell', () => {
    const gold = holding({ key: 'manual:4', ticker: null, label: 'Gold bar', assetClassId: 'real_assets', productType: 'gold', market: null, qty: 100, currency: 'TWD', valueTwd: 20_000 });
    const holdings = [
      listed('VT', 'us_global_equity', 28_000),
      listed('00692', 'tw_market_cap', 12_000),
      listed('BNDW', 'global_bonds', 12_000),
      gold,
      listed('BIL', 'strategic_cash', 8_000),
      listed('THEME', 'tactical_themes', 20_000, { productType: 'theme_etf' }),
    ];
    const draft = draftOf(evaluate(input({ holdings })), 'F8_DRIFT');
    assert.ok(draft);
    // Gold 10 pp over, bonds 10 pp under; gold cannot be sold by order and nothing else is over.
    assert.equal(draft.state, 'global_bonds:under,real_assets:over');
    assert.ok(Math.abs((draft.detail.untradedTwd ?? 0) - 10_000) < 1e-6);
    assert.deepEqual(draft.orders, []);
  });

  it('moves a TWD balance as an amount', () => {
    const savings = holding({ key: 'manual:5', ticker: null, label: 'Savings', assetClassId: 'strategic_cash', productType: 'cash_mmf', market: null, qty: 13_000, currency: 'TWD', valueTwd: 13_000 });
    const holdings = [
      listed('VT', 'us_global_equity', 28_000),
      listed('00692', 'tw_market_cap', 12_000),
      listed('BNDW', 'global_bonds', 17_000),
      listed('GLDM', 'real_assets', 10_000),
      savings,
      listed('THEME', 'tactical_themes', 20_000, { productType: 'theme_etf' }),
    ];
    const draft = draftOf(evaluate(input({ holdings })), 'F8_DRIFT');
    assert.ok(draft);
    // Cash 5 pp over (band 2 pp): NT$5,000 out of savings buys the bonds, the one class under target.
    assert.equal(draft.state, 'strategic_cash:over');
    assert.deepEqual(draft.orders[0], { kind: 'balance', assetId: 5, label: 'Savings', side: 'withdraw', amountTwd: 5_000, assetClassId: 'strategic_cash' });
    assert.deepEqual(trades(draft.orders), [['buy', 'BNDW', 50]]);
  });
});

describe('monthly contribution', () => {
  const holdings = onTarget(100_000, [listed('THEME', 'tactical_themes', 20_000, { productType: 'theme_etf' })]);

  it('waits for the DCA day, then fires from the day after it, in the month of the debit', () => {
    assert.deepEqual(checkOf(evaluate(input({ holdings })), 'MONTHLY_CONTRIBUTION'), { ruleId: 'MONTHLY_CONTRIBUTION', outcome: 'waiting', why: 'dca_day' });
    const before = evaluate(input({ holdings, today: '2026-10-06', dca: { amountTwd: 10_000, dayOfMonth: 6 } }));
    // The September debit is past its 14-day window by October 6.
    assert.equal(checkOf(before, 'MONTHLY_CONTRIBUTION').outcome, 'quiet');
    const draft = draftOf(evaluate(input({ holdings, today: '2026-10-07', dca: { amountTwd: 10_000, dayOfMonth: 6 } })), 'MONTHLY_CONTRIBUTION');
    assert.ok(draft);
    assert.equal(draft.state, '2026-10');
    assert.equal(draft.detail.dcaDate, '2026-10-06');
  });

  it('puts the contribution into at most two core classes, the ones furthest below target, in whole shares', () => {
    const draft = draftOf(evaluate(input({ holdings, dca: { amountTwd: 10_000, dayOfMonth: 10 } })), 'MONTHLY_CONTRIBUTION');
    assert.ok(draft);
    // On target, the NT$10,000 makes each class short by its target × NT$10,000: VT NT$2,800 and BNDW NT$2,200 most.
    // The cash goes pro rata: VT NT$5,600 and BNDW NT$4,400.
    assert.deepEqual(trades(draft.orders), [
      ['buy', 'VT', 56],
      ['buy', 'BNDW', 44],
    ]);
    assert.equal(draft.detail.leftTwd, 0);
    assert.equal(maxBuyClasses(RULES), 2);
  });

  it('buys a fund not held yet through the class benchmark, and leaves what whole shares cannot use', () => {
    const quotes = new Map(QUOTES);
    quotes.set('VT', { price: 158, currency: 'USD', fxRate: 32.4, decimals: 0 });
    quotes.set('BNDW', { price: 68, currency: 'USD', fxRate: 32.4, decimals: 0 });
    const draft = draftOf(evaluate(input({ holdings: [], quotes, dca: { amountTwd: 10_000, dayOfMonth: 10 } })), 'MONTHLY_CONTRIBUTION');
    assert.ok(draft);
    // One VT (NT$5,119.20) and two BNDW (NT$4,406.40); NT$474.40 left as cash.
    assert.deepEqual(trades(draft.orders), [
      ['buy', 'VT', 1],
      ['buy', 'BNDW', 2],
    ]);
    assert.ok(Math.abs(draft.detail.leftTwd - 474.4) < 1e-6);
  });

  it('buys US funds in fractions where the broker takes them, so almost all the cash is used', () => {
    const quotes = new Map(QUOTES);
    quotes.set('VT', { price: 158, currency: 'USD', fxRate: 32.4, decimals: 4 });
    quotes.set('BNDW', { price: 68, currency: 'USD', fxRate: 32.4, decimals: 4 });
    const draft = draftOf(evaluate(input({ holdings: [], quotes, dca: { amountTwd: 10_000, dayOfMonth: 10 } })), 'MONTHLY_CONTRIBUTION');
    assert.ok(draft);
    // NT$5,600 of VT at NT$5,119.20 a share is 1.0939 shares; NT$4,400 of BNDW at NT$2,203.20 is 1.9970, then what is left.
    const [vt, bndw] = draft.orders as TradeOrder[];
    assert.deepEqual([vt?.ticker, vt?.qty, vt?.decimals], ['VT', 1.0939, 4]);
    assert.equal(bndw?.ticker, 'BNDW');
    assert.ok((bndw?.qty ?? 0) >= 1.997 && draft.detail.leftTwd < 2.2032, `left ${draft.detail.leftTwd}`);
  });

  it('sells a costly US share in a fraction, so a trim takes no more than it needs', () => {
    const quotes = new Map(QUOTES);
    quotes.set('NVDA', { price: 180, currency: 'USD', fxRate: 32.4, decimals: 4 });
    const nvda = listed('NVDA', 'us_stocks', 5_832, { productType: 'stock', qty: 1 });
    const holdings = onTarget(97_500, [nvda, listed('THEME', 'tactical_themes', 13_000, { productType: 'theme_etf' })]);
    const draft = draftOf(evaluate(input({ holdings, quotes })), 'R1');
    const sell = draft?.orders.find((order): order is TradeOrder => order.kind === 'trade' && order.side === 'sell');
    // NT$5,832 − 5% × NT$97,500 = NT$957, at NT$5,832 a share: 0.1641 shares, rounded up.
    assert.deepEqual([sell?.ticker, sell?.qty], ['NVDA', 0.1641]);
  });

  it('is not proposed again for a month already dismissed, and dates the debit on a short month', () => {
    const dismissed: ProposalRecord = { id: 7, ruleId: 'MONTHLY_CONTRIBUTION', state: '2026-10', status: 'dismissed', createdAt: '2026-10-11T01:00:00.000Z', expiresAt: null };
    const outcome = evaluate(input({ holdings, today: '2026-10-20', dca: { amountTwd: 10_000, dayOfMonth: 10 }, proposals: [dismissed] }));
    assert.deepEqual(outcome.create, []);
    assert.equal(dcaDate('2027-02', 31), '2027-02-28');
    assert.equal(dueContribution('2027-03-01', 31, 14), '2027-02-28');
    assert.equal(dueContribution('2027-03-01', 30, 14), '2027-02-28');
    assert.equal(dueContribution('2027-01-01', 31, 14), '2026-12-31');
    assert.equal(dueContribution('2026-10-25', 10, 14), undefined);
  });
});

describe('annual review', () => {
  it('fires from the first Saturday of January, once a year, with a full rebalance of the core', () => {
    assert.equal(firstSaturday('2027-01'), '2027-01-02');
    assert.equal(firstSaturday('2028-01'), '2028-01-01');
    const holdings = [
      listed('VT', 'us_global_equity', 30_000),
      listed('00692', 'tw_market_cap', 12_000),
      listed('BNDW', 'global_bonds', 20_000),
      listed('GLDM', 'real_assets', 10_000),
      listed('BIL', 'strategic_cash', 8_000),
      listed('THEME', 'tactical_themes', 20_000, { productType: 'theme_etf' }),
    ];
    assert.equal(checkOf(evaluate(input({ holdings, today: '2027-01-01' })), 'ANNUAL_REVIEW').outcome, 'quiet');
    const draft = draftOf(evaluate(input({ holdings, today: '2027-01-02', now: '2027-01-02T01:00:00.000Z' })), 'ANNUAL_REVIEW');
    assert.ok(draft);
    assert.equal(draft.state, '2027');
    // VT 2 pp over, bonds 2 pp under: inside F8's band, but the yearly review squares them.
    assert.deepEqual(trades(draft.orders), [
      ['sell', 'VT', 20],
      ['buy', 'BNDW', 20],
    ]);
    assert.equal(draft.detail.classes?.length, 5);
    assert.equal(checkOf(evaluate(input({ holdings, today: '2027-02-06' })), 'ANNUAL_REVIEW').outcome, 'quiet');
  });
});

describe('US estate tax', () => {
  const estate: EngineRule = { id: 'US_ESTATE_TAX', condition: 'us_situs_value_above', threshold: { usd: 60_000 }, enabled: true, cooldownDays: 30 };
  const domiciles = new Map([
    ['VT', 'US'],
    ['BNDW', 'US'],
    ['AGGU', 'IE'],
    ['00692', 'TW'],
  ]);
  // US$1 = NT$32.5: VT NT$1,300,000 (US$40,000) in the windfall pool, BNDW NT$650,000 (US$20,000).
  const holdings = [
    listed('VT', 'us_global_equity', 1_300_000, { key: 'windfall:VT', pool: 'windfall' }),
    listed('BNDW', 'global_bonds', 650_000),
    listed('AGGU', 'global_bonds', 3_000_000, { market: 'UK' }),
    listed('00692', 'tw_market_cap', 500_000, { market: 'TW' }),
  ];

  it("fires when both pools' US-domiciled holdings exceed the exemption, with no orders, and names them in dollars", () => {
    const quiet = evaluate(input({ rules: [estate], holdings, domiciles, usdTwd: 32.5 }));
    assert.equal(checkOf(quiet, 'US_ESTATE_TAX').outcome, 'quiet');
    const over = [...holdings, listed('BNDW', 'global_bonds', 32_500, { key: 'windfall:BNDW', pool: 'windfall' })];
    const draft = draftOf(evaluate(input({ rules: [estate], holdings: over, domiciles, usdTwd: 32.5 })), 'US_ESTATE_TAX');
    assert.ok(draft);
    assert.equal(draft.state, 'over');
    assert.deepEqual(draft.orders, []);
    assert.deepEqual(draft.detail.situs, [
      { ticker: 'VT', valueTwd: 1_300_000, valueUsd: 40_000 },
      { ticker: 'BNDW', valueTwd: 682_500, valueUsd: 21_000 },
    ]);
    assert.equal(draft.detail.situsUsd, 61_000);
    assert.equal(draft.detail.limitUsd, 60_000);
  });

  it('waits for the domiciles and a USD rate, and refuses a threshold it cannot read', () => {
    assert.deepEqual(checkOf(evaluate(input({ rules: [estate], holdings })), 'US_ESTATE_TAX'), { ruleId: 'US_ESTATE_TAX', outcome: 'waiting', why: 'usd' });
    assert.equal(checkOf(evaluate(input({ rules: [{ ...estate, threshold: { usd: 'lots' } }], holdings, domiciles, usdTwd: 32.5 })), 'US_ESTATE_TAX').outcome, 'unreadable');
  });
});

describe('deciding what to save', () => {
  const holdings = onTarget(200_000, [listed('AAPL', 'us_stocks', 11_000, { productType: 'stock' }), listed('THEME', 'tactical_themes', 29_000, { productType: 'theme_etf' })]);
  const record = (overrides: Partial<ProposalRecord>): ProposalRecord => ({ id: 1, ruleId: 'R1', state: 'AAPL', status: 'open', createdAt: '2026-10-21T01:00:00.000Z', expiresAt: '2026-11-04T01:00:00.000Z', ...overrides });

  it('drafts a firing rule once, with its expiry 14 days on', () => {
    const outcome = evaluate(input({ holdings }));
    assert.equal(draftOf(outcome, 'R1')?.expiresAt, '2026-11-05T13:00:00.000Z');
    assert.deepEqual(evaluate(input({ holdings, proposals: [record({})] })).create, []);
    assert.deepEqual(evaluate(input({ holdings, proposals: [record({ status: 'approved' })] })).create, []);
  });

  it('supersedes an open proposal whose state changed, despite the cooldown', () => {
    const outcome = evaluate(input({ holdings, proposals: [record({ state: '2330' })] }));
    assert.deepEqual(outcome.close, [{ id: 1, reason: 'superseded' }]);
    assert.equal(draftOf(outcome, 'R1')?.state, 'AAPL');
  });

  it('holds a dismissed state back for cooldown_days, then proposes it again', () => {
    const dismissed = record({ status: 'dismissed', createdAt: '2026-10-16T01:00:00.000Z' });
    assert.deepEqual(evaluate(input({ holdings, proposals: [dismissed] })).create, []);
    assert.ok(draftOf(evaluate(input({ holdings, today: '2026-10-23', now: '2026-10-23T01:00:00.000Z', proposals: [dismissed] })), 'R1'));
  });

  it('times out an unactioned proposal and evaluates it afresh', () => {
    const old = record({ createdAt: '2026-10-01T01:00:00.000Z', expiresAt: '2026-10-15T01:00:00.000Z' });
    const outcome = evaluate(input({ holdings, proposals: [old] }));
    assert.deepEqual(outcome.close, [{ id: 1, reason: 'timed_out' }]);
    assert.ok(draftOf(outcome, 'R1'));
  });

  it('clears an open proposal once its rule stops firing or is turned off, and leaves later steps’ rules alone', () => {
    const cleared = evaluate(input({ holdings: onTarget(200_000, [listed('THEME', 'tactical_themes', 40_000, { productType: 'theme_etf' })]), proposals: [record({})] }));
    assert.deepEqual(cleared.close, [{ id: 1, reason: 'cleared' }]);
    const off = evaluate(input({ holdings, rules: RULES.map((rule) => (rule.id === 'R1' ? { ...rule, enabled: false } : rule)), proposals: [record({})] }));
    assert.equal(checkOf(off, 'R1').outcome, 'off');
    assert.deepEqual(off.close, [{ id: 1, reason: 'cleared' }]);
    assert.equal(checkOf(off, 'BUY_ZONE').outcome, 'later');
  });

  it('reports a malformed threshold instead of guessing one', () => {
    const rules = RULES.map((rule) => (rule.id === 'R1' ? { ...rule, threshold: { max_weight: 5 } } : rule));
    assert.equal(checkOf(evaluate(input({ holdings, rules })), 'R1').outcome, 'unreadable');
  });
});

describe('allocate', () => {
  it('splits by how far each class is below target, then by target once all are filled', () => {
    const chosen = [
      { id: 'a', gap: 3_000, target: 0.3 },
      { id: 'b', gap: 1_000, target: 0.1 },
    ];
    assert.deepEqual(Object.fromEntries(allocate(2_000, chosen)), { a: 1_500, b: 500 });
    assert.deepEqual(Object.fromEntries(allocate(8_000, chosen)), { a: 6_000, b: 2_000 });
    assert.deepEqual(Object.fromEntries(allocate(0, chosen)), {});
  });
});

describe('saved orders', () => {
  const sell: TradeOrder = { kind: 'trade', ticker: 'AAPL', side: 'sell', qty: 3, price: 236, currency: 'USD', fxRate: 32.4, amountTwd: 3 * 236 * 32.4, assetClassId: 'us_stocks' };

  it('read back what was saved and leave out malformed entries', () => {
    const balance = { kind: 'balance', assetId: 5, label: 'Savings', side: 'withdraw', amountTwd: 2_000, assetClassId: 'strategic_cash' };
    assert.deepEqual(readOrders(JSON.parse(JSON.stringify([sell, balance, { kind: 'trade', ticker: 'X' }, 'junk']))), [sell, balance]);
    assert.deepEqual(readOrders(null), []);
  });

  it('resize a trade by shares and a balance by amount; 0 drops the order', () => {
    assert.deepEqual(resized(sell, 2), { ...sell, qty: 2, amountTwd: 2 * 236 * 32.4 });
    assert.equal(resized(sell, 0), undefined);
    const balance: DraftOrder = { kind: 'balance', assetId: 5, label: 'Savings', side: 'deposit', amountTwd: 2_000, assetClassId: 'strategic_cash' };
    assert.deepEqual(resized(balance, 1_500), { ...balance, amountTwd: 1_500 });
  });
});
