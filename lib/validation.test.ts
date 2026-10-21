import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isIsoDate, taipeiToday } from './dates';
import { ASSET_CLASSES, SECURITIES } from './models/test-helpers';
import { MESSAGES, parseCashFlow, parseManualAsset, parseNumber, parseSecurity, parseTrade } from './validation';

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
