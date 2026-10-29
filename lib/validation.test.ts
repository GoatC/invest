import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isIsoDate, taipeiToday } from './dates';
import { readFrontierSettings } from './models/frontier';
import { readMcSettings } from './models/monte-carlo';
import { readRedFlagSettings } from './models/red-flags';
import { readSectorSettings } from './models/sectors';
import { ASSET_CLASSES, SECURITIES } from './models/test-helpers';
import {
  SPLIT_MESSAGES,
  parseSplitForm,
  MESSAGES,
  parseAssumptionForm,
  parseAssumptionsForm,
  parseBrokerForm,
  parseCashFlow,
  parseFeeForm,
  parseFundForm,
  parseManualAsset,
  parseFrontierForm,
  parseMonteCarloForm,
  parseNumber,
  parseTimelineForm,
  fractionalShares,
  parseEngineSettings,
  parseOrderSizes,
  parsePaceForm,
  parseCapmForm,
  parseRegressionForm,
  parsePlanForm,
  parsePlanStart,
  parseRuleForm,
  parseSchedule,
  parseSubscription,
  parseSecurity,
  parseTargets,
  parseTaxForm,
  parseTrade,
  parseWindfallSettingsForm,
  vehicleField,
  withholdingField,
  parseValuationSettingsForm,
  listField,
  parseLookThroughForm,
  parseSectorForm,
  parseFlagEntryForm,
  parseFlagSettingsForm,
} from './validation';

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

describe('parseSubscription', () => {
  const browser = { endpoint: 'https://web.push.apple.com/QGuQyavXutnMH', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' }, deviceName: ' iPhone ' };

  it('keeps an https endpoint with its two keys and a short device name', () => {
    assert.deepEqual(parseSubscription(browser), { endpoint: browser.endpoint, keys: browser.keys, deviceName: 'iPhone' });
  });

  it('refuses what is not a push subscription', () => {
    assert.equal(parseSubscription({ ...browser, endpoint: 'http://push.example.com/1' }), undefined);
    assert.equal(parseSubscription({ ...browser, keys: { p256dh: 'short', auth: browser.keys.auth } }), undefined);
    assert.equal(parseSubscription(null), undefined);
  });
});

describe('parseSchedule', () => {
  it('reads the quiet hours and the weekly review time, 24-hour', () => {
    assert.deepEqual(parseSchedule({ quietStart: '23:00', quietEnd: '8:00', weeklyDay: 'sunday', weeklyTime: '20:00' }), {
      ok: true,
      value: { quietStart: '23:00', quietEnd: '08:00', weeklyDay: 'sunday', weeklyTime: '20:00' },
    });
  });

  it('refuses a malformed time, the same start and end, and an unknown day', () => {
    const parsed = parseSchedule({ quietStart: '25:00', quietEnd: '07:00', weeklyDay: 'funday', weeklyTime: '8pm' });
    assert.ok(!parsed.ok);
    assert.deepEqual(parsed.errors, { quietStart: MESSAGES.clock, weeklyDay: MESSAGES.weekday, weeklyTime: MESSAGES.clock });
    const same = parseSchedule({ quietStart: '22:00', quietEnd: '22:00', weeklyDay: 'monday', weeklyTime: '09:00' });
    assert.ok(!same.ok && same.errors.quietEnd === MESSAGES.quietSame);
  });
});

describe('cost settings (F15)', () => {
  it('reads the Taiwan commission in percent and its discount in 折, and the broker from the list', () => {
    const parsed = parseFeeForm({ broker: 'cathay', twRate: '0.1425', twDiscount: '2.8', twMin: '1', fxSpread: '0.1' }, ['cathay']);
    assert.deepEqual(parsed, { ok: true, value: { brokerId: 'cathay', tw: { rate: 0.001425, discount: 0.28, minTwd: 1 }, fxSpread: 0.001 } });
    const bad = parseFeeForm({ broker: 'nobody', twRate: '0.14251', twDiscount: '12', twMin: '1.5', fxSpread: '' }, ['cathay']);
    assert.deepEqual(Object.keys(bad.ok ? {} : bad.errors).sort(), ['broker', 'fxSpread', 'twDiscount', 'twMin', 'twRate']);
    assert.equal(parseFeeForm({ broker: '', twRate: '0.1425', twDiscount: '10', twMin: '20', fxSpread: '0' }, []).ok, true);
  });

  it('reads the tax thresholds, a withholding rate per domicile, and refuses a top estate rate under the bottom one', () => {
    const raw = {
      [withholdingField('US')]: '30',
      [withholdingField('IE')]: '15',
      twStock: '0.3',
      twEtf: '0.1',
      twBondEtf: '0',
      amtFloor: '1000000',
      amtExemption: '7500000',
      amtRate: '20',
      nhiRate: '2.11',
      nhiSingle: '20000',
      nhiMax: '10000000',
      estateMin: '18',
      estateMax: '40',
      checked: 'on',
    };
    const parsed = parseTaxForm(raw, ['US', 'IE']);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.tax.withholding, { US: 0.3, IE: 0.15 });
    assert.deepEqual(parsed.value.tax.nhi, { rate: 0.0211, singlePaymentTwd: 20_000, maxPaymentTwd: 10_000_000 });
    assert.equal(parsed.value.checked, true);
    const bad = parseTaxForm({ ...raw, estateMax: '10', amtFloor: '1e6.5' }, ['US', 'IE']);
    assert.deepEqual(bad.ok ? {} : bad.errors, { amtFloor: MESSAGES.wholeTwdAmount, estateMax: MESSAGES.rateRange });
  });

  it('reads a broker: shares by rate and minimum, ETFs flat, DCA either way, London only when entered', () => {
    const raw = { id: 'cathay', nameEn: 'Cathay', nameZh: '國泰', usRate: '0.08', usMin: '', etfFlat: '3', dcaFlat: '0.1', dcaRate: '', dcaMax: '', ukRate: '', ukMin: '', lseEtfs: 'unknown', custody: '0', fxSpread: '', promoUntil: '2026-12-31', source: 'x', noteEn: '', noteZh: '', checked: 'on' };
    const parsed = parseBrokerForm(raw, [], null, '2026-10-22');
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.usStock, { rate: 0.0008, min: 0, max: null, flat: null });
    assert.deepEqual(parsed.value.usEtf, { rate: 0, min: 0, max: null, flat: 3 });
    assert.deepEqual(parsed.value.usDca, { rate: 0, min: 0, max: null, flat: 0.1 });
    assert.equal(parsed.value.uk, null);
    assert.equal(parsed.value.lseEtfs, null);
    assert.equal(parsed.value.checked, '2026-10-22');
    const taken = parseBrokerForm({ ...raw, usRate: '', checked: '' }, ['cathay'], null, '2026-10-22');
    assert.deepEqual(taken.ok ? {} : taken.errors, { id: MESSAGES.idTaken, usRate: MESSAGES.required });
    const edited = parseBrokerForm({ ...raw, id: 'ignored', checked: '', checkedOn: '2026-09-27' }, ['cathay'], 'cathay', '2026-10-22');
    assert.equal(edited.ok && edited.value.id, 'cathay');
    assert.equal(edited.ok && edited.value.checked, '2026-09-27');
  });

  it('reads a fund: rates in percent, blanks as not entered, a new ticker that is free', () => {
    const raw = { ticker: 'vwra', name: 'Vanguard FTSE All-World', assetClass: 'us_global_equity', domicile: 'ie', market: 'UK', distribution: 'acc', ter: '0.19', yield: '1.8', withholding: '9', trackingDifference: '', source: '', noteEn: '', noteZh: '' };
    const parsed = parseFundForm(raw, ['VT'], null, new Set(['us_global_equity']), '2026-10-22');
    assert.ok(parsed.ok);
    assert.deepEqual([parsed.value.ticker, parsed.value.domicile, parsed.value.ter, parsed.value.yield, parsed.value.withholding, parsed.value.trackingDifference, parsed.value.checked], ['VWRA', 'IE', 0.0019, 0.018, 0.09, null, null]);
    const bad = parseFundForm({ ...raw, ticker: 'VT', market: 'JP', ter: '-1' }, ['VT'], null, new Set(['us_global_equity']), '2026-10-22');
    assert.deepEqual(Object.keys(bad.ok ? {} : bad.errors).sort(), ['market', 'ter', 'ticker']);
  });
});

describe('windfall planner (F3)', () => {
  it('reads the windfall in whole NT$ and the first tranche date', () => {
    assert.deepEqual(parsePlanStart({ totalTwd: '5,500,000', startDate: '2026-11-02' }), { ok: true, value: { totalTwd: 5_500_000, startDate: '2026-11-02' } });
    const bad = parsePlanStart({ totalTwd: '0', startDate: '2026-02-30' });
    assert.deepEqual(Object.keys(bad.ok ? {} : bad.errors).sort(), ['startDate', 'totalTwd']);
  });

  it("reads each class's vehicle from its own securities, blank for the benchmark", () => {
    const classes = new Map([
      ['global_bonds', ['BNDW', 'AGGU']],
      ['us_global_equity', ['VT', 'VOO']],
    ]);
    const parsed = parseWindfallSettingsForm({ [vehicleField('global_bonds')]: 'AGGU', [vehicleField('us_global_equity')]: '', cashReturn: '1.5', fromYear: '1900', horizonMonths: '60' }, classes);
    assert.deepEqual(parsed, { ok: true, value: { vehicles: { global_bonds: 'AGGU' }, cashReturn: 0.015, fromYear: 1900, horizonMonths: 60 } });
    const bad = parseWindfallSettingsForm({ [vehicleField('global_bonds')]: 'VT', cashReturn: '50', fromYear: '1800', horizonMonths: '6' }, classes);
    assert.deepEqual(Object.keys(bad.ok ? {} : bad.errors).sort(), ['cashReturn', 'fromYear', 'horizonMonths', vehicleField('global_bonds')]);
  });

  it('reads the pace and the tiers in percent, each tier deeper than the one before', () => {
    const raw = { cutLow: '30', cutHigh: '70', tranchesLow: '6', tranchesMid: '12', tranchesHigh: '24', tier1: '15', tier2: '25', tier2Share: '50', tier3: '35', tier3Share: '100' };
    assert.deepEqual(parsePaceForm(raw), {
      ok: true,
      value: { cutoffs: [30, 70], tranches: [6, 12, 24], tiers: [{ drawdown: 0.15 }, { drawdown: 0.25, share: 0.5 }, { drawdown: 0.35, share: 1 }] },
    });
    const bad = parsePaceForm({ ...raw, cutHigh: '20', tier2: '10', tranchesHigh: '2.5', tier3Share: '0' });
    assert.deepEqual(Object.keys(bad.ok ? {} : bad.errors).sort(), ['cutHigh', 'tier2', 'tier3Share', 'tranchesHigh']);
  });
});

describe('parseRegressionForm (N1)', () => {
  const form = { freq: 'weekly', windowYears: '2', currency: 'local', blumeWeight: '0.67', rfTWD: '1.7', rfUSD: '4' };

  it('reads the defaults, Blume weight and the rates in percent, stamping today when ticked', () => {
    const parsed = parseRegressionForm({ ...form, checked: 'on' }, [1, 2, 3, 5], '2026-10-28');
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, { freq: 'weekly', windowYears: 2, currency: 'local', blumeWeight: 0.67, riskFree: { TWD: 0.017, USD: 0.04 }, checked: '2026-10-28' });
  });

  it('keeps the date it was checked before, and refuses a window not offered or a weight past 1', () => {
    const kept = parseRegressionForm({ ...form, checkedOn: '2026-10-01' }, [1, 2, 3, 5], '2026-10-28');
    assert.ok(kept.ok && kept.value.checked === '2026-10-01');
    const bad = parseRegressionForm({ ...form, windowYears: '4', blumeWeight: '1.2', rfTWD: '' }, [1, 2, 3, 5], '2026-10-28');
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['blumeWeight', 'rfTWD', 'windowYears']);
  });
});

describe('parseCapmForm (F11)', () => {
  const form = { beta: 'adjusted', erpSource: 'damodaran', erpManual: '4.23', rf_US: '5', crp_US: '0', rf_TW: '1.955', crp_TW: '0.78' };

  it('reads the β choice, the ERP and each market in percent, stamping today when ticked', () => {
    const parsed = parseCapmForm({ ...form, checked: 'on' }, ['US', 'TW'], '2026-10-28');
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, {
      beta: 'adjusted',
      erpSource: 'damodaran',
      erpManual: 0.0423,
      markets: { US: { riskFree: 0.05, countryPremium: 0 }, TW: { riskFree: 0.01955, countryPremium: 0.0078 } },
      checked: '2026-10-28',
    });
  });

  it('keeps the date it was checked before, and refuses an unknown choice, a zero ERP or a negative premium', () => {
    const kept = parseCapmForm({ ...form, checkedOn: '2026-10-01' }, ['US', 'TW'], '2026-10-28');
    assert.ok(kept.ok && kept.value.checked === '2026-10-01');
    const bad = parseCapmForm({ ...form, beta: 'blume', erpManual: '0', crp_TW: '-1', rf_US: '' }, ['US', 'TW'], '2026-10-28');
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['beta', 'crp_TW', 'erpManual', 'rf_US']);
  });
});

describe('F12 valuation forms', () => {
  const form = {
    model: 'dcf',
    years: '5',
    growth_bear: '2',
    growth_base: '6',
    growth_bull: '10',
    terminal_bear: '1.5',
    terminal_base: '2.5',
    terminal_bull: '3',
    fcff: '',
    netDebt: '-1,500',
    shares: '',
    taxRate: '18',
    costOfDebt: '',
    peers: 'msft, nvda',
    buy: '',
    trim: '1.3',
    active: 'on',
  };

  it("reads a stock's assumptions: rates in percent, figures in millions, peers by ticker", () => {
    const parsed = parseAssumptionsForm(form, ['AAPL', 'MSFT', 'NVDA'], 'AAPL');
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, {
      active: true,
      buy: null,
      trim: 1.3,
      assumptions: {
        model: 'dcf',
        years: 5,
        growth: { bear: 0.02, base: 0.06, bull: 0.1 },
        terminal: { bear: 0.015, base: 0.025, bull: 0.03 },
        overrides: { netDebt: -1_500_000_000, taxRate: 0.18 },
        peers: ['MSFT', 'NVDA'],
      },
    });
  });

  it('refuses scenarios out of order, a peer that is no stock or the stock itself, and multiples on the wrong side of 1', () => {
    const parsed = parseAssumptionsForm({ ...form, growth_base: '12', peers: 'AAPL, XYZ', buy: '1.2', trim: '0.9', shares: '0', terminal_bull: '9' }, ['AAPL', 'MSFT'], 'AAPL');
    assert.ok(!parsed.ok);
    assert.deepEqual(Object.keys(parsed.errors).sort(), ['buy', 'growth_base', 'peers', 'shares', 'terminal_bull', 'trim']);
  });

  it('reads the defaults, with a tax rate per market', () => {
    const parsed = parseValuationSettingsForm({ ...form, debtSpread: '1.5', tax_US: '21', tax_TW: '20', historyYears: '5', minQuarters: '8', checked: 'on' }, ['US', 'TW'], '2026-10-29');
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.taxRate, { US: 0.21, TW: 0.2 });
    assert.equal(parsed.value.debtSpread, 0.015);
    assert.equal(parsed.value.checked, '2026-10-29');
    assert.ok(!parseValuationSettingsForm({ ...form, debtSpread: '1.5', tax_US: '21', historyYears: '0', minQuarters: '8' }, ['US'], '2026-10-29').ok);
  });
});

describe('red-flag forms (N3)', () => {
  it('reads an entry: a count of events as of a date, or a governance tier, never in the future', () => {
    const parsed = parseFlagEntryForm({ ticker: 'AAPL', indicator: 'environmental_penalties', asOf: '2026-10-01', value: '0', note: ' ECHO: none ' }, ['AAPL', '2330'], '2026-10-28');
    assert.deepEqual(parsed, { ok: true, value: { ticker: 'AAPL', indicator: 'environmental_penalties', asOf: '2026-10-01', value: 0, note: 'ECHO: none' } });
    const tier = parseFlagEntryForm({ ticker: '2330', indicator: 'governance_rating', asOf: '2026-05-01', value: '33' }, ['2330'], '2026-10-28');
    assert.equal(tier.ok, false);
    assert.ok(!tier.ok && tier.errors.value);
    const wrong = parseFlagEntryForm({ ticker: 'X', indicator: 'beneish_m', asOf: '2026-11-01', value: '1.5' }, ['2330'], '2026-10-28');
    assert.ok(!wrong.ok && wrong.errors.ticker && wrong.errors.indicator && wrong.errors.asOf && wrong.errors.value);
  });

  it('reads the settings, lists typed one per line or with commas, and keeps the SIC ranges', () => {
    const current = readRedFlagSettings({
      lookback_years: 3,
      scan_days: 7,
      beneish: { red_above: -1.78 },
      altman: { z: { red_below: 1.81, amber_below: 2.99 }, z2: { red_below: 1.1, amber_below: 2.6 } },
      cash_flow_years: 3,
      governance: { bottom_share: 0.35 },
      manufacturing: { sic: [[2000, 3999]], tw_industries: ['24'] },
      financial: { sic: [[6000, 6799]], tw_industries: ['17'] },
      excluded: { industries: [], tickers: [] },
      last_verified: null,
    });
    assert.ok(current);
    const raw = { lookbackYears: '3', scanDays: '7', beneish: '-1.78', zRed: '1.81', zAmber: '2.99', z2Red: '1.1', z2Amber: '2.6', cashFlowYears: '3', governance: '35', manufacturing: '24, 28\n1', financial: '17', industries: 'Tobacco\n菸酒', tickers: 'mo, pm', checked: 'on' };
    const parsed = parseFlagSettingsForm(raw, current, '2026-10-28');
    assert.ok(parsed.ok);
    assert.equal(parsed.value.governanceBottomShare, 0.35);
    assert.deepEqual(parsed.value.manufacturing, { sic: [[2000, 3999]], twIndustries: ['24', '28', '01'] });
    assert.deepEqual(parsed.value.excluded, { industries: ['Tobacco', '菸酒'], tickers: ['MO', 'PM'] });
    assert.equal(parsed.value.lastVerified, '2026-10-28');
    const bad = parseFlagSettingsForm({ ...raw, zAmber: '1', manufacturing: 'semis' }, current, '2026-10-28');
    assert.ok(!bad.ok && bad.errors.zAmber && bad.errors.manufacturing);
    assert.deepEqual(listField(' a，b、a\n\n'), ['a', 'b']);
  });
});

describe('look-through form (F14)', () => {
  const sectorNames = new Map([['information technology', 'Information Technology'], ['資訊科技', 'Information Technology'], ['financials', 'Financials']]);
  const current = { sources: {}, fundCountry: {}, refreshDays: 28, topCompanies: 30, twSectors: {}, lastVerified: null };

  it('reads the TWSE industry map in either language and the whole funds\' countries', () => {
    const parsed = parseLookThroughForm({ topCompanies: '40', refreshDays: '28', twSectors: '24 = Information Technology\n17：Financials\n2 = 資訊科技', fundCountry: 'bil = us\n0050=TW', checked: 'on' }, current, sectorNames, '2026-10-28');
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.twSectors, { '24': 'Information Technology', '17': 'Financials', '02': 'Information Technology' });
    assert.deepEqual(parsed.value.fundCountry, { BIL: 'US', '0050': 'TW' });
    assert.equal(parsed.value.lastVerified, '2026-10-28');
  });

  it('refuses an unknown sector, a bad country and too few companies', () => {
    const parsed = parseLookThroughForm({ topCompanies: '3', refreshDays: '28', twSectors: '24 = Chips', fundCountry: 'BIL = USA' }, current, sectorNames, '2026-10-28');
    assert.ok(!parsed.ok && parsed.errors.topCompanies && parsed.errors.twSectors && parsed.errors.fundCountry);
  });
});

describe('sector form (N7)', () => {
  const current = readSectorSettings({ colour: 'red_up', us: { XLK: 'Information Technology' }, tw: { Electronic: { name: '電子工業類指數', sector: 'Information Technology' }, Cement: { name: '水泥類指數', sector: 'Materials' } }, last_verified: null });
  const names = new Map([['information technology', 'Information Technology'], ['原物料', 'Materials'], ['industrials', 'Industrials']]);

  it('reads the convention and remaps or drops the Taiwan indices already listed, keeping the US funds', () => {
    assert.ok(current);
    const parsed = parseSectorForm({ colour: 'green_up', tw: 'cement = Industrials\n' }, current, names, '2026-10-28');
    assert.ok(parsed.ok);
    assert.equal(parsed.value.colour, 'green_up');
    assert.deepEqual(parsed.value.proxies.map((proxy) => [proxy.id, proxy.sector]), [['XLK', 'Information Technology'], ['TW_CEMENT', 'Industrials']]);
  });

  it('refuses an index not listed, or an unknown sector', () => {
    assert.ok(current);
    for (const tw of ['Semiconductor = Information Technology', 'Cement = Chips']) {
      const parsed = parseSectorForm({ colour: 'red_up', tw }, current, names, '2026-10-28');
      assert.ok(!parsed.ok && parsed.errors.tw, tw);
    }
  });
});

describe('parseMonteCarloForm (F5)', () => {
  const current = readMcSettings({
    paths: 10000,
    lookback_years: 5,
    block_months: 3,
    min_months: 36,
    scale_to_cma: true,
    band: [0.1, 0.9],
    mark_years: [10, 20, 30],
    target_twd: null,
    windfall: { amount_twd: null, month: null, tranches: 12 },
  });
  assert.ok(current);

  it('reads the goal and an expected windfall into the row, leaving the rest as it is', () => {
    const parsed = parseMonteCarloForm({ target: '20,000,000', windfallAmount: '5500000', windfallMonth: '2030-06', windfallTranches: '24' }, current);
    assert.ok(parsed.ok);
    assert.equal(parsed.value.targetTwd, 20_000_000);
    assert.deepEqual(parsed.value.windfall, { amountTwd: 5_500_000, month: '2030-06', tranches: 24 });
    assert.equal(parsed.value.paths, 10000);
  });

  it('takes blank fields as none, and keeps the tranches when left blank', () => {
    const parsed = parseMonteCarloForm({ target: '', windfallAmount: '', windfallMonth: '', windfallTranches: '' }, current);
    assert.ok(parsed.ok);
    assert.equal(parsed.value.targetTwd, null);
    assert.deepEqual(parsed.value.windfall, { amountTwd: null, month: null, tranches: 12 });
  });

  it('asks for the month when there is an amount, and refuses what is not whole NT$ or a month', () => {
    const noMonth = parseMonteCarloForm({ target: '', windfallAmount: '1000000', windfallMonth: '' }, current);
    assert.ok(!noMonth.ok);
    assert.deepEqual(Object.keys(noMonth.errors), ['windfallMonth']);
    const bad = parseMonteCarloForm({ target: '-5', windfallAmount: '1.5', windfallMonth: '2030-13', windfallTranches: '0' }, current);
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['target', 'windfallAmount', 'windfallMonth', 'windfallTranches']);
  });
});

describe('parseTimelineForm (F1)', () => {
  it('reads one goal per line, in date order, an amount being optional', () => {
    const parsed = parseTimelineForm({ goals: '2045-06 | 3,000,000 | House\n\n2040-01 |  | Children’s university 子女大學' });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.goals, [
      { month: '2040-01', amountTwd: null, name: 'Children’s university 子女大學' },
      { month: '2045-06', amountTwd: 3_000_000, name: 'House' },
    ]);
  });

  it('takes an empty box as no goals', () => {
    const parsed = parseTimelineForm({ goals: '  \n' });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.goals, []);
  });

  it('refuses a line without a valid month, a whole-NT$ amount above 0 or a name, and too many goals', () => {
    for (const goals of ['2045-13 | 1 | x', '2045-06 | 1.5 | x', '2045-06 | 0 | x', '2045-06 | 100 | ', '2045-06 only']) {
      const parsed = parseTimelineForm({ goals });
      assert.ok(!parsed.ok, goals);
      assert.deepEqual(Object.keys(parsed.errors), ['goals']);
    }
    const many = Array.from({ length: 13 }, (_, i) => `2040-${String((i % 12) + 1).padStart(2, '0')} | | g${i}`).join('\n');
    assert.ok(!parseTimelineForm({ goals: many }).ok);
  });
});

describe('parseFrontierForm (F7)', () => {
  const current = readFrontierSettings({ lookback_years: 10, min_months: 36, points: 40, risk_free: 0.017, bounds: { a: [0, 0.5], b: [0, 0.6] } });
  assert.ok(current);
  const raw = { riskFree: '1.5', lookbackYears: '8', bounds: 'a = 0 - 50\nb = 10 - 60.5', checked: 'on' };

  it('reads the rate, the years and the bounds, and stamps the check', () => {
    const parsed = parseFrontierForm(raw, current, ['a', 'b'], '2026-10-29');
    assert.ok(parsed.ok);
    assert.equal(parsed.value.riskFree, 0.015);
    assert.equal(parsed.value.lookbackYears, 8);
    assert.deepEqual(parsed.value.bounds, { a: [0, 0.5], b: [0.1, 0.605] });
    assert.equal(parsed.value.lastVerified, '2026-10-29');
    assert.equal(parsed.value.points, 40);
  });

  it('refuses an unknown class, a minimum above its maximum, bounds that cannot sum to 100% and bad numbers', () => {
    for (const bounds of ['z = 0 - 50', 'a = 60 - 50', 'a = 0 - 40\nb = 0 - 40', 'a = 60 - 70\nb = 50 - 60', 'a = x', '']) {
      const parsed = parseFrontierForm({ ...raw, bounds }, current, ['a', 'b'], '2026-10-29');
      assert.ok(!parsed.ok, bounds);
      assert.deepEqual(Object.keys(parsed.errors), ['bounds']);
    }
    const bad = parseFrontierForm({ ...raw, riskFree: 'x', lookbackYears: '0' }, current, ['a', 'b'], '2026-10-29');
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['lookbackYears', 'riskFree']);
  });
});

describe('parseSplitForm', () => {
  const tickers = ['0050', 'AAPL'];
  const raw = { security: '0050', exDate: '2025-06-18', oldShares: '1', newShares: '4', note: ' 1 拆 4 ' };

  it('reads N old shares becoming M new ones as the ratio M ÷ N', () => {
    assert.deepEqual(parseSplitForm(raw, tickers, [], '2026-10-29'), { ok: true, value: { ticker: '0050', exDate: '2025-06-18', ratio: 4, note: '1 拆 4' } });
    const reverse = parseSplitForm({ ...raw, oldShares: '10', newShares: '1', note: '' }, tickers, [], '2026-10-29');
    assert.ok(reverse.ok && reverse.value.ratio === 0.1 && reverse.value.note === null);
  });

  it('refuses an unknown ticker, a future ex-date, a second split that day, no change and zero shares', () => {
    const unknown = parseSplitForm({ ...raw, security: 'NOPE' }, tickers, [], '2026-10-29');
    assert.ok(!unknown.ok && unknown.errors.ticker === MESSAGES.unknownTicker);
    const future = parseSplitForm(raw, tickers, [], '2025-06-17');
    assert.ok(!future.ok && future.errors.exDate === SPLIT_MESSAGES.future);
    const taken = parseSplitForm(raw, tickers, [{ ticker: '0050', exDate: '2025-06-18' }], '2026-10-29');
    assert.ok(!taken.ok && taken.errors.exDate === SPLIT_MESSAGES.taken);
    const same = parseSplitForm({ ...raw, newShares: '1' }, tickers, [], '2026-10-29');
    assert.ok(!same.ok && same.errors.newShares === SPLIT_MESSAGES.noChange);
    const zero = parseSplitForm({ ...raw, oldShares: '0' }, tickers, [], '2026-10-29');
    assert.ok(!zero.ok && zero.errors.oldShares === SPLIT_MESSAGES.shares);
    const huge = parseSplitForm({ ...raw, newShares: '1000' }, tickers, [], '2026-10-29');
    assert.ok(!huge.ok && huge.errors.newShares === SPLIT_MESSAGES.range);
  });
});
