import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluate, type DraftOrder, type EngineClass, type EngineInput, type EngineQuote, type EngineRule, type TradeOrder, type WatchInput } from './engine';
import { ASSET_CLASSES, holding } from './test-helpers';
import type { Holding } from './valuation';
import { runStart } from './volatility';

// N8 step 3: VOLATILITY_ALERT and VOLATILITY_HEDGE. Every price NT$100 a share in TWD.
const BENCHMARKS: Record<string, string> = { us_global_equity: 'VT', tw_market_cap: '0050', global_bonds: 'BNDW', real_assets: 'GLDM', strategic_cash: 'BIL', us_stocks: 'VOO', tw_stocks: '0050', tactical_themes: 'VT' };
const CLASSES: EngineClass[] = ASSET_CLASSES.map((assetClass) => ({ ...assetClass, benchmarkTicker: BENCHMARKS[assetClass.id] ?? null }));
const quote = (): EngineQuote => ({ price: 100, currency: 'TWD', fxRate: 1, decimals: 0 });
const QUOTES = new Map<string, EngineQuote>(['VT', '0050', '00692', 'BNDW', 'GLDM', 'BIL', 'VOO', 'AAPL', 'NVDA', 'MSFT', 'THEME', '00677U', 'VIXY'].map((ticker) => [ticker, quote()]));

const ALERT: EngineRule = {
  id: 'VOLATILITY_ALERT',
  condition: 'volatility_score_crosses',
  threshold: { tense: 6, panic: 8, reset_gap: 1, tense_share: 0.02, panic_share: 0.05, near_buy: 0.1, max_stocks: 2, from_class: 'strategic_cash', panic_classes: ['us_global_equity', 'tw_market_cap'], push_in_quiet_hours: true },
  enabled: true,
  cooldownDays: 7,
};
const HEDGE: EngineRule = {
  id: 'VOLATILITY_HEDGE',
  condition: 'volatility_score_calm',
  threshold: { calm: 4, reset_gap: 1, hedge_share: 0.01, vol_cap: 0.05, vehicle: '00677U', vix_products: ['00677U', 'VIXY'], from_class: 'strategic_cash' },
  enabled: true,
  cooldownDays: 7,
};
const RULES: EngineRule[] = [
  { id: 'R1', condition: 'single_stock_weight_above', threshold: { max_weight: 0.05, pool: 'regular' }, enabled: true, cooldownDays: 7 },
  { id: 'R2', condition: 'satellite_weight_above', threshold: { trigger_weight: 0.25, target_weight: 0.2, pool: 'regular' }, enabled: true, cooldownDays: 7 },
  { id: 'BUY_ZONE', condition: 'price_at_or_below_value_multiple', threshold: { multiple: 0.75 }, enabled: false, cooldownDays: 7 },
  ALERT,
  HEDGE,
];

function listed(ticker: string, assetClassId: string, value: number, overrides: Partial<Holding> = {}): Holding {
  const sleeve = ['us_stocks', 'tw_stocks', 'tactical_themes'].includes(assetClassId) ? 'satellite' : 'core';
  return holding({ key: `regular:${ticker}`, ticker, label: ticker, assetClassId, sleeve, qty: value / 100, valueTwd: value, currency: 'TWD', ...overrides });
}

/** A regular pool on its core targets with `satellite` filling the rest: NT$200,000 holds NT$17,000 of BIL with NT$30,000 of satellite. */
function onTarget(total: number, satellite: Holding[]): Holding[] {
  const core = total - satellite.reduce((sum, row) => sum + (row.valueTwd ?? 0), 0);
  return [
    listed('VT', 'us_global_equity', (0.28 / 0.8) * core),
    listed('00692', 'tw_market_cap', (0.12 / 0.8) * core),
    listed('BNDW', 'global_bonds', (0.22 / 0.8) * core),
    listed('GLDM', 'real_assets', (0.1 / 0.8) * core),
    listed('BIL', 'strategic_cash', (0.08 / 0.8) * core),
    ...satellite,
  ];
}

const theme = (value: number) => listed('THEME', 'tactical_themes', value, { productType: 'theme_etf' });
const watched = (ticker: string, value: number): WatchInput => ({ ticker, assetClassId: 'us_stocks', value, valuedOn: '2026-10-20', trigger: 'edit' });
const scores = (...values: number[]) => values.map((score, i) => ({ date: `2026-11-0${i + 1}`, score }));

function input(overrides: Partial<EngineInput>): EngineInput {
  return {
    today: '2026-11-06',
    now: '2026-11-06T07:20:00.000Z',
    holdings: onTarget(200_000, [theme(30_000)]),
    assetClasses: CLASSES,
    quotes: QUOTES,
    rules: RULES,
    dca: { amountTwd: 10_000, dayOfMonth: null },
    expiryDays: 14,
    proposals: [],
    ...overrides,
  };
}

const trades = (orders: readonly DraftOrder[]) => orders.filter((order): order is TradeOrder => order.kind === 'trade').map((order) => `${order.side} ${order.qty} ${order.ticker}`);
const draftOf = (outcome: ReturnType<typeof evaluate>, id: string) => outcome.create.find((draft) => draft.ruleId === id);
const checkOf = (outcome: ReturnType<typeof evaluate>, id: string) => outcome.checks.find((check) => check.ruleId === id);

describe('PRD Section 11 acceptance: N8 alert and hedge', () => {
  it('Run: scores 4.9, 6.3, 5.6, 6.4 (lines 6, reset gap 1) are one tense run since the 6.3; a 4.8 between them ends it', () => {
    const above = (list: ReturnType<typeof scores>) => runStart(list, '2026-11-06', 5, (s) => s >= 6, (s) => s >= 5);
    assert.equal(above(scores(4.9, 6.3, 5.6, 6.4))?.since, '2026-11-02');
    assert.equal(above(scores(4.9, 6.3, 4.8, 6.4))?.since, '2026-11-04');
    assert.equal(above(scores(6.3, 5.9)), undefined);
    assert.equal(runStart(scores(6.5), '2026-11-20', 5, (s) => s >= 6, (s) => s >= 5), null);
    const outcome = evaluate(input({ volatility: { scores: scores(4.9, 6.3, 5.6, 6.4), maxAgeDays: 5 }, watch: [] }));
    assert.equal(draftOf(outcome, 'VOLATILITY_ALERT')?.state, 'tense:2026-11-02');
  });

  it('Tense: pool NT$200,000, budget 2% = NT$4,000 from BIL → AAPL (−4.8% to its buy price 105) and NVDA (+2.6%), 20 shares each; MSFT (+11.1%) left out', () => {
    const outcome = evaluate(input({ volatility: { scores: scores(5, 6.4), maxAgeDays: 5 }, watch: [watched('AAPL', 140), watched('MSFT', 120), watched('NVDA', 130)] }));
    const draft = draftOf(outcome, 'VOLATILITY_ALERT');
    assert.ok(draft);
    assert.deepEqual(trades(draft.orders), ['sell 40 BIL', 'buy 20 AAPL', 'buy 20 NVDA']);
    assert.deepEqual(draft.detail.picks?.map((pick) => [pick.ticker, Number((pick.distance * 100).toFixed(1))]), [['AAPL', -4.8], ['NVDA', 2.6]]);
    assert.equal(draft.detail.volatility?.budgetTwd, 4_000);
    assert.equal(draft.detail.volatility?.band, 'tense');
  });

  it('Panic: score 8.4 with NT$2,000 of 00677U held → sell it, add 5% = NT$10,000 of BIL, buy the core equity by targets 28 : 12 → VT 84, 00692 36', () => {
    const holdings = onTarget(200_000, [theme(28_000), listed('00677U', 'tactical_themes', 2_000, { productType: 'theme_etf' })]);
    const outcome = evaluate(input({ holdings, volatility: { scores: scores(5, 6.4, 8.4), maxAgeDays: 5 } }));
    const draft = draftOf(outcome, 'VOLATILITY_ALERT');
    assert.ok(draft);
    assert.equal(draft.state, 'panic:2026-11-03');
    assert.deepEqual(trades(draft.orders), ['sell 20 00677U', 'sell 100 BIL', 'buy 84 VT', 'buy 36 00692']);
    assert.equal(draft.detail.volatility?.vixSoldTwd, 2_000);
    assert.equal(draft.detail.cashTwd, 12_000);
  });

  it('Hedge: score 3.2, nothing held → 1% = NT$2,000 of BIL into 20 shares of 00677U; none while NT$2,000 is held; none past R2 (satellite already at 20%)', () => {
    const calm = { volatility: { scores: scores(4.5, 3.2), maxAgeDays: 5 } };
    const draft = draftOf(evaluate(input(calm)), 'VOLATILITY_HEDGE');
    assert.ok(draft);
    assert.equal(draft.state, 'calm:2026-11-02');
    assert.deepEqual(trades(draft.orders), ['sell 20 BIL', 'buy 20 00677U']);
    const held = evaluate(input({ ...calm, holdings: onTarget(200_000, [theme(28_000), listed('00677U', 'tactical_themes', 2_000, { productType: 'theme_etf' })]) }));
    assert.deepEqual(checkOf(held, 'VOLATILITY_HEDGE'), { ruleId: 'VOLATILITY_HEDGE', outcome: 'covered', why: 'hedge' });
    const full = draftOf(evaluate(input({ ...calm, holdings: onTarget(200_000, [theme(40_000)]) })), 'VOLATILITY_HEDGE');
    assert.deepEqual(full?.orders, []);
    assert.equal(full?.detail.volatility?.roomTwd, 0);
  });
});

describe('volatility rules', () => {
  it('wait without a fresh score, stay quiet below the line', () => {
    assert.deepEqual(checkOf(evaluate(input({})), 'VOLATILITY_ALERT'), { ruleId: 'VOLATILITY_ALERT', outcome: 'waiting', why: 'volatility' });
    const stale = evaluate(input({ today: '2026-11-20', volatility: { scores: scores(7), maxAgeDays: 5 } }));
    assert.equal(checkOf(stale, 'VOLATILITY_ALERT')?.outcome, 'waiting');
    const normal = evaluate(input({ volatility: { scores: scores(5.2), maxAgeDays: 5 } }));
    assert.equal(checkOf(normal, 'VOLATILITY_ALERT')?.outcome, 'quiet');
    assert.equal(checkOf(normal, 'VOLATILITY_HEDGE')?.outcome, 'quiet');
  });

  it('propose a run once: dismissed, not again until a new run; the panic proposal supersedes the tense one', () => {
    const volatility = { scores: scores(5, 6.4), maxAgeDays: 5 };
    const dismissed = { id: 3, ruleId: 'VOLATILITY_ALERT', state: 'tense:2026-11-02', status: 'dismissed' as const, createdAt: '2026-11-02T08:00:00.000Z', expiresAt: null };
    assert.equal(draftOf(evaluate(input({ volatility, proposals: [dismissed], watch: [] })), 'VOLATILITY_ALERT'), undefined);
    const open = { ...dismissed, status: 'open' as const, expiresAt: '2026-11-16T08:00:00.000Z' };
    const panic = evaluate(input({ volatility: { scores: scores(5, 6.4, 8.1), maxAgeDays: 5 }, proposals: [open] }));
    assert.equal(draftOf(panic, 'VOLATILITY_ALERT')?.state, 'panic:2026-11-03');
    assert.deepEqual(panic.close, [{ id: 3, reason: 'superseded' }]);
  });

  it('fire with no orders when there is no strategic cash, and refuse a malformed threshold', () => {
    const holdings = onTarget(200_000, [theme(30_000)]).filter((row) => row.ticker !== 'BIL');
    const draft = draftOf(evaluate(input({ holdings, volatility: { scores: scores(5, 6.4), maxAgeDays: 5 }, watch: [watched('AAPL', 140)] })), 'VOLATILITY_ALERT');
    assert.deepEqual(draft?.orders, []);
    assert.equal(draft?.detail.volatility?.fundedTwd, 0);
    const bad = RULES.map((rule) => (rule.id === 'VOLATILITY_ALERT' ? { ...rule, threshold: { ...(rule.threshold as object), panic: 5 } } : rule));
    assert.equal(checkOf(evaluate(input({ rules: bad, volatility: { scores: scores(7), maxAgeDays: 5 } })), 'VOLATILITY_ALERT')?.outcome, 'unreadable');
  });
});
