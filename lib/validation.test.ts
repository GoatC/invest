import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isIsoDate, taipeiToday } from './dates';
import { ASSET_CLASSES, SECURITIES } from './models/test-helpers';
import { MESSAGES, parseAssumptionForm, parseCashFlow, parseManualAsset, parseNumber, fractionalShares, parseEngineSettings, parseOrderSizes, parsePlanForm, parseRuleForm, parseSecurity, parseTargets, parseTrade } from './validation';

const securities = new Map(SECURITIES.map((s) => [s.ticker, s]));
const classes = new Map(ASSET_CLASSES.map((c) => [c.id, c]));
const TODAY = '2026-10-21';

const usdBuy = { tradeDate: '2026-10-20', ticker: 'vt', side: 'buy', qty: '2', price: '157.80', currency: '', fee: '', tax: '', fxRate: '32.4', pool: 'regular' };

describe('parseTrade', () => {
  it('reads a USD buy, taking the currency from the security and treating empty fee and tax as 0', () => {
    const parsed = parseTrade(usdBuy, securities, TODAY);
    assert.deepEqual(parsed, {
      ok: true,
      value: { tradeDate: '2026-10-20', ticker: 'VT', side: 'buy', qty: 2, price: 157.8, currency: 'USD', fee: 0, tax: 0, fxRate: 32.4, pool: 'regular', note: null },
    });
  });

  it('sets the FX rate of a TWD trade to 1 whatever was typed', () => {
    const parsed = parseTrade({ ...usdBuy, ticker: '0050', currency: 'TWD', fxRate: '32' }, securities, TODAY);
    assert.equal(parsed.ok && parsed.value.fxRate, 1);
  });

  it('reports every problem at once', () => {
    const parsed = parseTrade({ ...usdBuy, tradeDate: '2026-10-22', ticker: 'NOPE', qty: '0', fee: '-1', fxRate: '' }, securities, TODAY);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.deepEqual(parsed.errors, {
      tradeDate: MESSAGES.future,
      ticker: MESSAGES.unknownTicker,
      qty: MESSAGES.positive,
      fee: MESSAGES.nonNegative,
      fxRate: MESSAGES.positive,
    });
  });

  it('accepts thousands separators', () => {
    assert.equal(parseNumber('1,234.5'), 1234.5);
    assert.equal(parseNumber(' 2 400 '), 2400);
    assert.equal(parseNumber('abc'), undefined);
    assert.equal(parseNumber(''), undefined);
  });
});

describe('parseSecurity', () => {
  const raw = { ticker: 'aapl', name: 'Apple Inc.', market: 'US', productType: 'stock', assetClassId: 'us_stocks', currency: 'usd', domicile: 'us' };

  it('reads a new security and upper-cases its codes', () => {
    const parsed = parseSecurity(raw, new Set(['VT']), classes);
    assert.deepEqual(parsed, {
      ok: true,
      value: { ticker: 'AAPL', name: 'Apple Inc.', market: 'US', productType: 'stock', assetClassId: 'us_stocks', currency: 'USD', domicile: 'US' },
    });
  });

  it('refuses a ticker that exists or is malformed', () => {
    const taken = parseSecurity(raw, new Set(['AAPL']), classes);
    assert.equal(!taken.ok && taken.errors.ticker, MESSAGES.tickerTaken);
    const bad = parseSecurity({ ...raw, ticker: 'AA PL' }, new Set(), classes);
    assert.equal(!bad.ok && bad.errors.ticker, MESSAGES.tickerFormat);
  });
});

describe('parseManualAsset', () => {
  it('treats a savings balance as its own value, dated today', () => {
    const parsed = parseManualAsset({ name: 'Savings', productType: 'cash_mmf', assetClassId: 'strategic_cash', quantity: '30,000', pool: 'regular' }, classes, TODAY);
    assert.deepEqual(parsed.ok && parsed.value, {
      name: 'Savings',
      assetClassId: 'strategic_cash',
      productType: 'cash_mmf',
      unit: 'TWD',
      quantity: 30000,
      valuationMethod: 'balance',
      lastValueTwd: 30000,
      valuedOn: TODAY,
      pool: 'regular',
    });
  });

  it('records gold in grams and leaves its value empty until one is entered', () => {
    const parsed = parseManualAsset({ name: 'Gold bar', productType: 'gold', assetClassId: 'real_assets', quantity: '5', lastValueTwd: '' }, classes, TODAY);
    assert.equal(parsed.ok && parsed.value.unit, 'grams');
    assert.equal(parsed.ok && parsed.value.lastValueTwd, null);
    assert.equal(parsed.ok && parsed.value.valuedOn, null);
  });
});

describe('dates', () => {
  it('accepts only real calendar dates', () => {
    assert.equal(isIsoDate('2028-02-29'), true);
    assert.equal(isIsoDate('2026-02-29'), false);
    assert.equal(isIsoDate('2026/10/21'), false);
  });

  it('gives the date in Taipei, eight hours ahead of UTC', () => {
    assert.equal(taipeiToday(new Date('2026-10-20T16:30:00Z')), '2026-10-21');
    assert.equal(taipeiToday(new Date('2026-10-20T15:30:00Z')), '2026-10-20');
  });
});

describe('parseCashFlow', () => {
  const contribution = { flowDate: '2026-10-06', type: 'contribution', amount: '10,000', currency: '', fxRate: '', pool: 'regular', ticker: 'VT', note: '' };

  it('reads a monthly contribution in TWD, dropping a ticker only dividends carry', () => {
    assert.deepEqual(parseCashFlow(contribution, securities, TODAY), {
      ok: true,
      value: { flowDate: '2026-10-06', type: 'contribution', amount: 10000, currency: 'TWD', fxRate: 1, pool: 'regular', ticker: null, note: null },
    });
  });

  it("takes a dividend's currency from its security and needs its FX rate", () => {
    const dividend = { ...contribution, type: 'dividend', amount: '0.62', ticker: 'vt', fxRate: '32.2' };
    assert.deepEqual(parseCashFlow(dividend, securities, TODAY), {
      ok: true,
      value: { flowDate: '2026-10-06', type: 'dividend', amount: 0.62, currency: 'USD', fxRate: 32.2, pool: 'regular', ticker: 'VT', note: null },
    });
    const parsed = parseCashFlow({ ...dividend, fxRate: '' }, securities, TODAY);
    assert.deepEqual(parsed.ok ? {} : parsed.errors, { fxRate: MESSAGES.positive });
  });

  it('asks which security paid a dividend, and refuses an unknown one', () => {
    const missing = parseCashFlow({ ...contribution, type: 'dividend', ticker: '' }, securities, TODAY);
    assert.deepEqual(missing.ok ? {} : missing.errors, { ticker: MESSAGES.dividendTicker });
    const unknown = parseCashFlow({ ...contribution, type: 'dividend', ticker: 'NOPE' }, securities, TODAY);
    assert.deepEqual(unknown.ok ? {} : unknown.errors, { ticker: MESSAGES.unknownTicker });
  });

  it('puts the windfall arriving in the windfall pool, whatever was picked', () => {
    const parsed = parseCashFlow({ ...contribution, type: 'windfall', amount: '5500000', pool: 'regular' }, securities, TODAY);
    assert.equal(parsed.ok && parsed.value.pool, 'windfall');
  });

  it('reports every problem at once', () => {
    const parsed = parseCashFlow({ flowDate: '2026-10-22', type: 'gift', amount: '0', currency: 'usd1', fxRate: '', pool: 'other' }, securities, TODAY);
    assert.deepEqual(Object.keys(parsed.ok ? {} : parsed.errors).sort(), ['amount', 'currency', 'flowDate', 'fxRate', 'pool', 'type']);
  });
});

describe('parseTargets', () => {
  const tickers = new Set(['VT', 'VOO', '0050', 'BNDW', 'GLDM', 'BIL']);
  /** The Investment Principles targets as typed, in percent. */
  const principles: Record<string, string> = Object.fromEntries(ASSET_CLASSES.map((c) => [`target_${c.id}`, String(Math.round(c.targetWeight * 100))]));

  it('reads percentages that add up to 100% and a known benchmark per class', () => {
    const parsed = parseTargets({ ...principles, target_us_global_equity: '27.5', target_tw_market_cap: '12.5', benchmark_us_global_equity: 'voo' }, ASSET_CLASSES, tickers);
    assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors));
    assert.deepEqual(parsed.value[0], { id: 'us_global_equity', targetWeight: 0.275, benchmarkTicker: 'VOO' });
    assert.deepEqual(parsed.value[1], { id: 'tw_market_cap', targetWeight: 0.125, benchmarkTicker: null });
    assert.ok(parseTargets({ ...principles, target_real_assets: '9.71', target_strategic_cash: '8.29' }, ASSET_CLASSES, tickers).ok, 'two decimals of a percent');
  });

  it('refuses targets that do not add up to 100%, saying what they add up to', () => {
    const parsed = parseTargets({ ...principles, target_global_bonds: '21.5' }, ASSET_CLASSES, tickers);
    assert.ok(!parsed.ok);
    assert.equal(parsed.errors['total']?.en, 'The targets add up to 99.5%; they must add up to 100%.');
  });

  it('refuses a blank, negative, over 100% or finer-than-0.01% target, and an unknown benchmark', () => {
    const parsed = parseTargets(
      { ...principles, target_us_global_equity: '', target_tw_market_cap: '-1', target_global_bonds: '101', target_real_assets: '10.001', benchmark_strategic_cash: 'XYZ' },
      ASSET_CLASSES,
      tickers,
    );
    assert.ok(!parsed.ok);
    assert.deepEqual(Object.keys(parsed.errors).sort(), ['benchmark_strategic_cash', 'target_global_bonds', 'target_real_assets', 'target_tw_market_cap', 'target_us_global_equity']);
  });
});

describe('parseAssumptionForm', () => {
  it('reads a class with all three filled in, and skips a blank class', () => {
    const parsed = parseAssumptionForm({ return_us_global_equity: '6.5', volatility_us_global_equity: '16', source_us_global_equity: ' Long-term outlook 2026 ' }, ASSET_CLASSES);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, [{ id: 'us_global_equity', expectedReturn: 0.065, volatility: 0.16, source: 'Long-term outlook 2026' }]);
  });

  it('allows a negative expected return but needs a volatility and a source with it', () => {
    const parsed = parseAssumptionForm({ return_strategic_cash: '-0.5' }, ASSET_CLASSES);
    assert.ok(!parsed.ok);
    assert.deepEqual(Object.keys(parsed.errors).sort(), ['source_strategic_cash', 'volatility_strategic_cash']);
  });

  it('refuses returns beyond ±50% and volatility beyond 100%', () => {
    const parsed = parseAssumptionForm({ return_global_bonds: '55', volatility_global_bonds: '120', source_global_bonds: 'x' }, ASSET_CLASSES);
    assert.ok(!parsed.ok);
    assert.deepEqual(parsed.errors['return_global_bonds'], MESSAGES.expectedReturn);
    assert.deepEqual(parsed.errors['volatility_global_bonds'], MESSAGES.volatility);
  });
});

describe('parsePlanForm', () => {
  const typed = { start: '2026-11', pv: '1,234,567', pmt: '10000', stepUp: '3', expectedReturn: '5.25', inflation: '2', years: '30' };

  it('reads amounts in TWD, rates in percent and whole years', () => {
    assert.deepEqual(parsePlanForm(typed), {
      ok: true,
      value: { start: '2026-11', pv: 1_234_567, pmt: 10_000, stepUp: 0.03, expectedReturn: 0.0525, inflation: 0.02, years: 30 },
    });
  });

  it('allows a negative return or inflation and a plan with no contributions', () => {
    const parsed = parsePlanForm({ ...typed, pmt: '0', expectedReturn: '-1', inflation: '-0.5' });
    assert.ok(parsed.ok);
    assert.deepEqual([parsed.value.pmt, parsed.value.expectedReturn, parsed.value.inflation], [0, -0.01, -0.005]);
  });

  it('reports every problem at once', () => {
    const parsed = parsePlanForm({ start: '2026-13', pv: '-1', pmt: '', stepUp: '31', expectedReturn: '6.125', inflation: '25', years: '2.5' });
    assert.ok(!parsed.ok);
    assert.deepEqual(parsed.errors, {
      start: MESSAGES.month,
      pv: MESSAGES.nonNegative,
      pmt: MESSAGES.nonNegative,
      stepUp: MESSAGES.stepUp,
      expectedReturn: MESSAGES.expectedReturn,
      inflation: MESSAGES.inflation,
      years: MESSAGES.years,
    });
    assert.ok(!parsePlanForm({ ...typed, years: '61' }).ok);
    assert.ok(!parsePlanForm({ ...typed, years: '0' }).ok);
  });
});

describe('parseOrderSizes', () => {
  const orders = [
    { kind: 'trade', ticker: 'AAPL', side: 'sell', qty: 3, price: 236, currency: 'USD', fxRate: 32.4, amountTwd: 22_939.2, assetClassId: 'us_stocks' },
    { kind: 'balance', assetId: 5, label: 'Savings', side: 'deposit', amountTwd: 5_000, assetClassId: 'strategic_cash' },
  ] as const;

  it('reads whole shares and whole NT$, 0 dropping an order', () => {
    assert.deepEqual(parseOrderSizes({ size_0: '2', size_1: '4,500' }, orders), { sizes: [2, 4_500], errors: {} });
    assert.deepEqual(parseOrderSizes({ size_0: '0', size_1: '0' }, orders).sizes, [0, 0]);
  });

  it('takes a fractional US order to its decimals', () => {
    const fractional = [{ ...orders[0], decimals: 4 }];
    assert.deepEqual(parseOrderSizes({ size_0: '0.1641' }, fractional), { sizes: [0.1641], errors: {} });
    assert.deepEqual(parseOrderSizes({ size_0: '0.16411' }, fractional).errors, { size_0: fractionalShares(4) });
  });

  it('refuses fractions, negatives and blanks', () => {
    assert.deepEqual(parseOrderSizes({ size_0: '1.5', size_1: '' }, orders).errors, { size_0: MESSAGES.shares, size_1: MESSAGES.wholeTwd });
    assert.deepEqual(parseOrderSizes({ size_0: '-1', size_1: '10' }, orders).errors, { size_0: MESSAGES.shares });
  });
});

describe('parseRuleForm', () => {
  const threshold = { max_weight: 0.05, pool: 'regular' };

  it('reads on or off, the cooldown and each number, keeping the words', () => {
    assert.deepEqual(parseRuleForm({ enabled: 'on', cooldownDays: '7', threshold_max_weight: '0.06' }, threshold), {
      ok: true,
      value: { enabled: true, cooldownDays: 7, threshold: { max_weight: 0.06, pool: 'regular' } },
    });
    const off = parseRuleForm({ cooldownDays: '0', threshold_max_weight: '0.05' }, threshold);
    assert.ok(off.ok && off.value.enabled === false);
  });

  it('keeps a share between 0 and 1 and a whole number whole', () => {
    assert.deepEqual((parseRuleForm({ cooldownDays: '7', threshold_max_weight: '5' }, threshold) as { errors: unknown }).errors, { threshold_max_weight: MESSAGES.fraction });
    const whole = parseRuleForm({ cooldownDays: '400', threshold_max_classes: '2.5' }, { max_classes: 2 });
    assert.ok(!whole.ok);
    assert.deepEqual(whole.errors, { cooldownDays: MESSAGES.cooldown, threshold_max_classes: MESSAGES.wholeNumber });
    // A multiple above 1, such as TRIM_ZONE's 1.25, stays a positive number.
    const multiple = parseRuleForm({ cooldownDays: '7', threshold_multiple: '1.3' }, { multiple: 1.25 });
    assert.ok(multiple.ok && multiple.value.threshold['multiple'] === 1.3);
    assert.ok(!parseRuleForm({ cooldownDays: '7', threshold_multiple: '0' }, { multiple: 1.25 }).ok);
  });
});

describe('parseEngineSettings', () => {
  it('reads the DCA amount and day, blank day allowed, and the expiry', () => {
    assert.deepEqual(parseEngineSettings({ dcaAmountTwd: '10,000', dcaDay: '6', expiryDays: '14', fractionalUs: 'on', shareDecimals: '4' }), {
      ok: true,
      value: { dcaAmountTwd: 10_000, dcaDay: 6, expiryDays: 14, fractionalUs: true, fractionalUk: false, shareDecimals: 4 },
    });
    const blank = parseEngineSettings({ dcaAmountTwd: '10000', dcaDay: ' ', expiryDays: '14', shareDecimals: '4' });
    assert.ok(blank.ok && blank.value.dcaDay === null);
  });

  it('refuses a day outside 1 to 31 and an expiry of 0', () => {
    const parsed = parseEngineSettings({ dcaAmountTwd: '-1', dcaDay: '32', expiryDays: '0', shareDecimals: '5' });
    assert.ok(!parsed.ok);
    assert.deepEqual(parsed.errors, { dcaAmountTwd: MESSAGES.nonNegative, dcaDay: MESSAGES.dcaDay, expiryDays: MESSAGES.expiryDays, shareDecimals: MESSAGES.shareDecimals });
  });
});
