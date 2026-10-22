import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ManualHistory, ManualState } from './manual-history';
import type { PriceRow } from './market';
import {
  annualise,
  asReported,
  benchmarkWeights,
  buildSeries,
  chain,
  cumulativeReturns,
  firstDay,
  fxSplit,
  holdingSplits,
  monthEnds,
  monthlyReturns,
  monthsBefore,
  periodReturn,
  periodStart,
  periodTable,
  periodXirr,
  snapshots,
  xirr,
  type DayPoint,
  type PerformanceInput,
} from './performance';
import { ASSET_CLASSES, SECURITIES, trade } from './test-helpers';
import type { CashFlow, FxQuote } from './types';
import { GRAMS_PER_TROY_OUNCE } from './valuation';

function close(ticker: string, date: string, price: number, adjClose: number | null = price): PriceRow {
  return { ticker, date, close: price, adjClose };
}

function usd(date: string, rate: number): FxQuote {
  return { pair: 'USD/TWD', date, rate };
}

function input(overrides: Partial<PerformanceInput>): PerformanceInput {
  return { end: '2026-01-03', trades: [], cashFlows: [], manualAssets: [], securities: SECURITIES, benchmark: [], prices: [], rates: [], ...overrides };
}

function day(days: readonly DayPoint[], date: string): DayPoint {
  const found = days.find((point) => point.date === date);
  assert.ok(found, `no day ${date}`);
  return found;
}

function near(actual: number | null | undefined, expected: number, tolerance = 1e-9): void {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);
}

const BAR: ManualState = {
  from: '2026-01-01',
  name: 'Gold bar',
  assetClassId: 'real_assets',
  productType: 'gold',
  unit: 'grams',
  quantity: 10,
  lastValueTwd: 25000,
  pool: 'regular',
};

const SAVINGS: ManualState = { ...BAR, name: 'Savings', assetClassId: 'strategic_cash', productType: 'cash_mmf', unit: 'TWD', quantity: 10000, lastValueTwd: null };

describe('xirr', () => {
  it('matches the spreadsheet XIRR example (acceptance value 0.373362535)', () => {
    const rate = xirr([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ]);
    // A spreadsheet stops iterating within 0.000001%; the exact root is 0.37336253352.
    near(rate, 0.373362535, 1e-8);
  });

  it('is the yearly growth rate for one amount in and one out, in any order', () => {
    near(xirr([{ date: '2026-01-01', amount: 110 }, { date: '2025-01-01', amount: -100 }]), 0.1);
    near(xirr([{ date: '2024-01-01', amount: -100 }, { date: '2026-01-01', amount: 81 }]), 0.81 ** (365 / 731) - 1);
  });

  it('has no answer without money both in and out', () => {
    assert.equal(xirr([]), undefined);
    assert.equal(xirr([{ date: '2026-01-01', amount: -100 }, { date: '2026-02-01', amount: -50 }]), undefined);
    assert.equal(xirr([{ date: '2026-01-01', amount: -100 }, { date: '2026-02-01', amount: 0 }]), undefined);
  });

  it('finds a large loss where the first guess fails', () => {
    const rate = xirr([{ date: '2026-01-01', amount: -1000 }, { date: '2026-04-01', amount: 100 }]);
    near(rate, 0.1 ** (365 / 90) - 1, 1e-6);
  });
});

describe('fxSplit, chain and annualise', () => {
  it('splits 10% in local currency and 5% from the currency into 15.5% in TWD with a 0.5% cross term', () => {
    const twd = 1.1 * 1.05 - 1;
    near(twd, 0.155);
    const split = fxSplit(twd, 0.1);
    near(split.local, 0.1);
    near(split.currency, 0.05);
    near(split.cross, 0.005);
    near(split.local + split.currency + split.cross, twd);
  });

  it('chains daily returns and skips days without one', () => {
    near(chain([0.1, null, -0.1]), -0.01);
    assert.equal(chain([null, null]), null);
    assert.equal(chain([]), null);
  });

  it('turns a cumulative return into a yearly rate', () => {
    near(annualise(0.21, 730), 0.1, 1e-3);
    near(annualise(0.1, 365), 0.1);
  });
});

describe('benchmarkWeights', () => {
  it('puts each class target on its proxy and merges classes that share one', () => {
    const proxies: Record<string, string> = {
      us_global_equity: 'VT',
      tw_market_cap: '0050',
      global_bonds: 'BNDW',
      real_assets: 'GLDM',
      strategic_cash: 'BIL',
      us_stocks: 'VOO',
      tw_stocks: '0050',
      tactical_themes: 'VT',
    };
    const weights = benchmarkWeights(ASSET_CLASSES.map((c) => ({ ...c, benchmarkTicker: proxies[c.id] ?? null })));
    const byTicker = Object.fromEntries(weights.map((w) => [w.ticker, Math.round(w.weight * 100) / 100]));
    assert.deepEqual(byTicker, { '0050': 0.17, BIL: 0.08, BNDW: 0.22, GLDM: 0.1, VOO: 0.1, VT: 0.33 });
  });

  it('leaves out classes without a proxy or a target', () => {
    assert.deepEqual(
      benchmarkWeights([
        { targetWeight: 0.5, benchmarkTicker: null },
        { targetWeight: 0, benchmarkTicker: 'VT' },
      ]),
      [],
    );
  });
});

describe('firstDay', () => {
  it('is the earliest trade, recorded dividend or non-listed asset', () => {
    const manual: ManualHistory = { id: 1, states: [{ ...BAR, from: '2026-01-05' }], deletedOn: null };
    const dividend: CashFlow = { flowDate: '2026-01-04', type: 'dividend', amount: 5, currency: 'TWD', fxRate: 1, pool: 'regular', ticker: '0050', note: null };
    const contribution: CashFlow = { ...dividend, flowDate: '2026-01-01', type: 'contribution', ticker: null };
    assert.equal(firstDay({ trades: [trade({ tradeDate: '2026-01-06' })], cashFlows: [dividend, contribution], manualAssets: [manual] }), '2026-01-04');
    assert.equal(firstDay({ trades: [], cashFlows: [contribution], manualAssets: [] }), undefined);
  });
});

describe('buildSeries', () => {
  it('values every day from the first trade to the end, weekends at the last close', () => {
    const days = buildSeries(
      input({
        trades: [trade({ tradeDate: '2026-01-01', ticker: '0050', qty: 10, price: 100, currency: 'TWD', fxRate: 1 })],
        prices: [close('0050', '2026-01-01', 100), close('0050', '2026-01-02', 110)],
        end: '2026-01-04',
      }),
    );
    assert.deepEqual(
      days.map((point) => [point.date, point.value.all]),
      [
        ['2026-01-01', 1000],
        ['2026-01-02', 1100],
        ['2026-01-03', 1100],
        ['2026-01-04', 1100],
      ],
    );
    assert.equal(day(days, '2026-01-01').ret.all, null);
    near(day(days, '2026-01-02').ret.all, 0.1);
    assert.equal(day(days, '2026-01-03').ret.all, 0);
  });

  it('has no days before anything was bought, and none after the end', () => {
    assert.deepEqual(buildSeries(input({})), []);
    assert.deepEqual(buildSeries(input({ trades: [trade({ tradeDate: '2026-02-01' })], end: '2026-01-31' })), []);
  });

  it('keeps the TWR independent of when money goes in, while the XIRR reflects it', () => {
    // 1 share at 100, +20% to 120, then 9 more at 120 just before a 10% fall.
    const days = buildSeries(
      input({
        trades: [
          trade({ tradeDate: '2026-01-01', ticker: '0050', qty: 1, price: 100, currency: 'TWD', fxRate: 1 }),
          trade({ tradeDate: '2026-04-01', ticker: '0050', qty: 9, price: 120, currency: 'TWD', fxRate: 1 }),
        ],
        prices: [close('0050', '2026-01-01', 100), close('0050', '2026-04-01', 120), close('0050', '2026-07-01', 108)],
        end: '2026-07-01',
      }),
    );
    const period = periodReturn(days, 'all', '2025-12-31', '2026-07-01');
    near(period.twr, 1.2 * 0.9 - 1);
    assert.ok(period.xirr !== null && period.xirr < 0, `XIRR ${period.xirr} should be a loss: 1,180 went in, 1,080 is left`);
    assert.equal(period.from, '2026-01-01');
    assert.equal(period.days, 181);
  });

  it('splits a USD holding into local and currency returns, and counts fees in the money put in', () => {
    const days = buildSeries(
      input({
        trades: [trade({ tradeDate: '2026-01-01', qty: 10, price: 100, fee: 1, fxRate: 30 })],
        prices: [close('VT', '2026-01-01', 100), close('VT', '2026-01-02', 110)],
        rates: [usd('2026-01-01', 30), usd('2026-01-02', 31.5)],
        end: '2026-01-02',
      }),
    );
    assert.equal(day(days, '2026-01-01').value.all, 30000);
    assert.equal(day(days, '2026-01-01').flow.all, -30030);
    near(day(days, '2026-01-02').value.all, 34650);
    near(day(days, '2026-01-02').ret.all, 0.155);
    near(day(days, '2026-01-02').local.all, 0.1);
  });

  it('counts a sale as money taken out, net of fee and tax', () => {
    const days = buildSeries(
      input({
        trades: [
          trade({ tradeDate: '2026-01-01', ticker: '0050', qty: 10, price: 100, currency: 'TWD', fxRate: 1 }),
          trade({ tradeDate: '2026-01-02', ticker: '0050', side: 'sell', qty: 5, price: 110, fee: 2, tax: 3, currency: 'TWD', fxRate: 1 }),
        ],
        prices: [close('0050', '2026-01-01', 100), close('0050', '2026-01-02', 110)],
        end: '2026-01-02',
      }),
    );
    assert.equal(day(days, '2026-01-02').flow.all, 545);
    assert.equal(day(days, '2026-01-02').value.all, 550);
    near(day(days, '2026-01-02').ret.all, 0.1);
  });

  it('values a holding at its trade price until the first close, then measures from that price', () => {
    const days = buildSeries(
      input({
        trades: [trade({ tradeDate: '2026-01-01', qty: 10, price: 100, fxRate: 30 })],
        prices: [close('VT', '2026-01-03', 105)],
        rates: [usd('2026-01-01', 30)],
      }),
    );
    assert.deepEqual(
      days.map((point) => [point.value.all, point.estimated]),
      [
        [30000, true],
        [30000, true],
        [31500, false],
      ],
    );
    assert.equal(day(days, '2026-01-02').ret.all, 0);
    near(day(days, '2026-01-03').ret.all, 0.05);
  });

  it('measures returns on adjusted closes and counts a recorded dividend as money paid out', () => {
    const dividend: CashFlow = { flowDate: '2026-01-03', type: 'dividend', amount: 50, currency: 'TWD', fxRate: 1, pool: 'regular', ticker: '0050', note: null };
    const days = buildSeries(
      input({
        trades: [trade({ tradeDate: '2026-01-01', ticker: '0050', qty: 10, price: 100, currency: 'TWD', fxRate: 1 })],
        // Ex-dividend on the 2nd: the close falls from 100 to 96 after paying 5 a share.
        prices: [close('0050', '2026-01-01', 100, 95), close('0050', '2026-01-02', 96, 96)],
        cashFlows: [dividend, { ...dividend, type: 'contribution', amount: 9999, ticker: null }],
      }),
    );
    near(day(days, '2026-01-02').ret.all, 96 / 95 - 1);
    assert.equal(day(days, '2026-01-02').value.all, 960);
    assert.equal(day(days, '2026-01-03').flow.all, 50);
  });

  it('weights the SAA benchmark by target: 60/40 earning 10% and 2% is 6.8%', () => {
    const days = buildSeries(
      input({
        trades: [trade({ tradeDate: '2026-01-01', qty: 1, price: 100, fxRate: 30 })],
        benchmark: [
          { ticker: 'VT', weight: 0.6 },
          { ticker: 'BNDW', weight: 0.4 },
        ],
        securities: [...SECURITIES, { ...SECURITIES[0]!, ticker: 'BNDW', assetClassId: 'global_bonds', productType: 'bond_etf' }],
        prices: [close('VT', '2026-01-01', 100), close('VT', '2026-01-02', 110), close('BNDW', '2026-01-02', 50), close('BNDW', '2026-01-03', 51)],
        rates: [usd('2026-01-01', 30)],
      }),
    );
    // BNDW has no price on the 1st yet, so the 2nd has no benchmark return.
    assert.equal(day(days, '2026-01-02').benchmark, null);
    near(day(days, '2026-01-03').benchmark, 0.6 * 0 + 0.4 * 0.02);
    const both = buildSeries(
      input({
        trades: [trade({ tradeDate: '2026-01-01', qty: 1, price: 100, fxRate: 30 })],
        benchmark: [
          { ticker: 'VT', weight: 0.6 },
          { ticker: '0050', weight: 0.4 },
        ],
        prices: [close('VT', '2026-01-01', 100), close('VT', '2026-01-02', 110), close('0050', '2026-01-01', 50), close('0050', '2026-01-02', 51)],
        rates: [usd('2026-01-01', 30)],
        end: '2026-01-02',
      }),
    );
    near(day(both, '2026-01-02').benchmark, 0.068);
  });

  it('keeps the pools apart and counts class values in the regular pool only', () => {
    const days = buildSeries(
      input({
        trades: [
          trade({ tradeDate: '2026-01-01', qty: 10, price: 100, fxRate: 30 }),
          trade({ tradeDate: '2026-01-01', ticker: '0050', qty: 100, price: 100, currency: 'TWD', fxRate: 1, pool: 'windfall' }),
        ],
        manualAssets: [{ id: 1, states: [SAVINGS], deletedOn: null }],
        prices: [close('VT', '2026-01-01', 100), close('0050', '2026-01-01', 100), close('0050', '2026-01-02', 110)],
        rates: [usd('2026-01-01', 30)],
        end: '2026-01-02',
      }),
    );
    const last = day(days, '2026-01-02');
    assert.deepEqual(last.value, { all: 51000, regular: 40000, windfall: 11000 });
    assert.deepEqual(last.classValue, { us_global_equity: 30000, strategic_cash: 10000 });
    // Each holding at the close, both pools, keyed as on the holdings page: what the VaR (N4) reads.
    assert.deepEqual(last.held, { 'regular:VT': 30000, 'windfall:0050': 11000, 'manual:1': 10000 });
    near(last.ret.windfall, 0.1);
    assert.equal(last.ret.regular, 0);
    near(last.ret.all, 1000 / 50000);
    assert.deepEqual(day(days, '2026-01-01').flow, { all: -50000, regular: -40000, windfall: -10000 });
  });

  it('counts non-listed assets as money in or out when added, changed or removed, at the day’s price', () => {
    const perGram = (twd: number): FxQuote => ({ pair: 'XAU/TWD', date: '2026-01-01', rate: twd * GRAMS_PER_TROY_OUNCE });
    const days = buildSeries(
      input({
        manualAssets: [
          { id: 1, states: [SAVINGS, { ...SAVINGS, from: '2026-01-03', quantity: 15000 }], deletedOn: null },
          { id: 2, states: [BAR], deletedOn: '2026-01-03' },
        ],
        rates: [perGram(3000), { ...perGram(3300), date: '2026-01-02' }, usd('2026-01-01', 30), usd('2026-01-02', 31.5)],
      }),
    );
    near(day(days, '2026-01-01').flow.all, -10000 - 30000);
    assert.equal(day(days, '2026-01-02').flow.all, 0);
    near(day(days, '2026-01-03').flow.all, -5000 + 33000);
    assert.equal(day(days, '2026-01-03').value.all, 15000);
    // On the 2nd: savings earn nothing, gold gained 10% in TWD, about 4.8% of it before the dollar's 5%.
    near(day(days, '2026-01-02').ret.all, (30000 * 0.1) / 40000);
    near(day(days, '2026-01-02').local.all, (30000 * (1.1 / 1.05 - 1)) / 40000);
    assert.equal(day(days, '2026-01-03').ret.all, 0);
  });

  it('counts gold revalued by hand as return, and grams added by hand as money in at that value', () => {
    const days = buildSeries(
      input({
        manualAssets: [
          {
            id: 2,
            states: [BAR, { ...BAR, from: '2026-01-02', lastValueTwd: 27500 }, { ...BAR, from: '2026-01-03', quantity: 12, lastValueTwd: 33000 }],
            deletedOn: null,
          },
        ],
      }),
    );
    assert.deepEqual(
      days.map((point) => [point.value.all, point.flow.all]),
      [
        [25000, -25000],
        [27500, 0],
        [33000, -5500],
      ],
    );
    near(day(days, '2026-01-02').ret.all, 0.1);
    assert.equal(day(days, '2026-01-03').ret.all, 0);
  });

  it('values gold at the hand-entered value until there is a gold price, flagged as estimated', () => {
    const days = buildSeries(input({ manualAssets: [{ id: 2, states: [BAR], deletedOn: null }], end: '2026-01-02' }));
    assert.deepEqual(
      days.map((point) => [point.value.all, point.estimated, point.ret.all]),
      [
        [25000, true, null],
        [25000, true, 0],
      ],
    );
  });
});

describe('periodReturn', () => {
  const days = buildSeries(
    input({
      trades: [
        trade({ tradeDate: '2026-01-01', ticker: '0050', qty: 1, price: 100, fee: 1, currency: 'TWD', fxRate: 1 }),
        trade({ tradeDate: '2026-04-01', ticker: '0050', qty: 9, price: 120, currency: 'TWD', fxRate: 1 }),
      ],
      benchmark: [{ ticker: '0050', weight: 1 }],
      prices: [close('0050', '2026-01-01', 100), close('0050', '2026-04-01', 120), close('0050', '2026-07-01', 108)],
      end: '2026-07-01',
    }),
  );

  it('measures from the close of `from` when the scope already held something then', () => {
    const period = periodReturn(days, 'all', '2026-04-01', '2026-07-01');
    assert.equal(period.from, '2026-04-01');
    assert.equal(period.days, 91);
    near(period.twr, -0.1);
    near(period.benchmark, -0.1);
    // Worth 1,200 at the close of 1 April, 1,080 on 1 July.
    near(period.xirr, 0.9 ** (365 / 91) - 1, 1e-7);
  });

  it('counts the buys themselves, fees included, in an XIRR that starts before them', () => {
    near(periodXirr(days, 'all', '2025-12-31', '2026-07-01'), xirr([
      { date: '2026-01-01', amount: -101 },
      { date: '2026-04-01', amount: -1080 },
      { date: '2026-07-01', amount: 1080 },
    ]) ?? Number.NaN, 1e-9);
  });

  it('has no return for a scope that held nothing', () => {
    const period = periodReturn(days, 'windfall', '2025-12-31', '2026-07-01');
    assert.equal(period.twr, null);
    assert.equal(period.benchmark, null);
    assert.equal(period.xirr, null);
  });

  it('reports the gain net of the money put in, from the value at the start', () => {
    const fromApril = periodReturn(days, 'all', '2026-04-01', '2026-07-01');
    assert.deepEqual([fromApril.startValue, fromApril.endValue, fromApril.gain], [1200, 1080, -120]);
    // 101 and 1,080 went in, 1,080 is left.
    const sinceStart = periodReturn(days, 'all', '2025-12-31', '2026-07-01');
    assert.deepEqual([sinceStart.startValue, sinceStart.endValue, sinceStart.gain], [0, 1080, -101]);
    assert.equal(sinceStart.estimated, false);
  });

  it('lists the periods the scope was invested for in full, then since the start', () => {
    const rows = periodTable(days, 'all', '2026-07-01');
    assert.deepEqual(
      rows.map((row) => [row.period, row.result.from]),
      [
        ['1m', '2026-06-01'],
        ['3m', '2026-04-01'],
        ['all', '2026-01-01'],
      ],
    );
    near(rows[0]?.result.twr, -0.1);
    assert.deepEqual(periodTable(days, 'windfall', '2026-07-01'), []);
    assert.deepEqual(periodTable([], 'all', '2026-07-01'), []);
  });
});

describe('periodStart and monthsBefore', () => {
  it('goes back whole months, to the month’s last day when it is shorter', () => {
    assert.equal(monthsBefore('2026-03-31', 1), '2026-02-28');
    assert.equal(monthsBefore('2028-03-31', 1), '2028-02-29');
    assert.equal(monthsBefore('2026-01-15', 1), '2025-12-15');
    assert.equal(monthsBefore('2026-10-21', 36), '2023-10-21');
  });

  it('starts year to date at the last close of the year before, and since the start the day before the first', () => {
    assert.equal(periodStart('ytd', '2026-10-21', '2026-05-07'), '2025-12-31');
    assert.equal(periodStart('all', '2026-10-21', '2026-05-07'), '2026-05-06');
    assert.equal(periodStart('1y', '2026-10-21', '2026-05-07'), '2025-10-21');
    assert.equal(periodStart('3m', '2026-10-21', '2026-05-07'), '2026-07-21');
  });
});

describe('asReported', () => {
  const base = { from: '2024-01-01', to: '2026-01-01', local: null, startValue: 0, endValue: 0, gain: 0, estimated: false };

  it('gives a year or more per year', () => {
    const shown = asReported({ ...base, days: 730, twr: 0.21, benchmark: 0.1025, xirr: 0.08 });
    assert.equal(shown.perYear, true);
    near(shown.twr, 0.1, 1e-3);
    near(shown.benchmark, 0.05, 1e-3);
    assert.equal(shown.moneyWeighted, 0.08);
  });

  it('gives a shorter period as it was, the XIRR included', () => {
    const shown = asReported({ ...base, days: 73, twr: 0.02, benchmark: null, xirr: 0.1 });
    assert.equal(shown.perYear, false);
    assert.equal(shown.twr, 0.02);
    assert.equal(shown.benchmark, null);
    near(shown.moneyWeighted, 1.1 ** 0.2 - 1);
  });
});

describe('monthlyReturns', () => {
  it('splits each month’s TWD return into local, currency and cross terms', () => {
    const days = buildSeries(
      input({
        trades: [trade({ tradeDate: '2026-01-01', qty: 10, price: 100, fxRate: 30 })],
        prices: [close('VT', '2026-01-01', 100), close('VT', '2026-01-31', 110), close('VT', '2026-02-28', 99)],
        rates: [usd('2026-01-01', 30), usd('2026-01-31', 31.5)],
        end: '2026-02-28',
      }),
    );
    const [january, february] = monthlyReturns(days, 'all');
    assert.equal(january?.month, '2026-01');
    near(january?.twr, 0.155);
    near(january?.local, 0.1);
    near(january?.currency, 0.05);
    near(january?.cross, 0.005);
    assert.equal(january?.benchmark, null);
    assert.equal(february?.month, '2026-02');
    near(february?.twr, -0.1);
    near(february?.currency, 0);
  });
});

describe('cumulativeReturns', () => {
  it('starts both lines at 0 on the first close with a value and compounds from there', () => {
    const days = buildSeries(
      input({
        trades: [trade({ tradeDate: '2026-01-02', ticker: '0050', qty: 1, price: 100, currency: 'TWD', fxRate: 1 })],
        cashFlows: [{ flowDate: '2026-01-01', type: 'dividend', amount: 1, currency: 'TWD', fxRate: 1, pool: 'regular', ticker: '0050', note: null }],
        benchmark: [{ ticker: 'VT', weight: 1 }],
        prices: [close('0050', '2026-01-01', 100), close('0050', '2026-01-03', 110), close('VT', '2026-01-01', 10), close('VT', '2026-01-03', 12)],
        rates: [usd('2026-01-01', 30)],
      }),
    );
    const points = cumulativeReturns(days, 'all');
    assert.equal(points.length, 2);
    assert.deepEqual(points[0], { date: '2026-01-02', twr: 0, benchmark: 0 });
    near(points[1]?.twr, 0.1);
    near(points[1]?.benchmark, 0.2);
  });
});

describe('monthEnds', () => {
  it('keeps the first point, the last of each month and the last one', () => {
    const at = (date: string) => ({ date, twr: 0, benchmark: null });
    assert.deepEqual(
      monthEnds([at('2026-01-30'), at('2026-01-31'), at('2026-02-01'), at('2026-02-14'), at('2026-02-15')]).map((point) => point.date),
      ['2026-01-30', '2026-01-31', '2026-02-15'],
    );
    assert.deepEqual(monthEnds([]), []);
  });
});

describe('holdingSplits', () => {
  it('splits each foreign holding’s TWD return since its first buy, leaving out TWD and sold-out ones', () => {
    const splits = holdingSplits(
      {
        trades: [
          trade({ tradeDate: '2026-01-01', qty: 2 }),
          trade({ tradeDate: '2026-01-01', ticker: '0050', currency: 'TWD', fxRate: 1 }),
          trade({ tradeDate: '2026-01-01', ticker: 'AAPL' }),
          trade({ tradeDate: '2026-02-01', ticker: 'AAPL', side: 'sell' }),
        ],
        prices: [close('VT', '2026-01-01', 100), close('VT', '2026-03-01', 120), close('0050', '2026-01-01', 50), close('AAPL', '2026-01-01', 200)],
        rates: [usd('2026-01-01', 32), usd('2026-03-01', 31)],
      },
      '2025-12-31',
      '2026-03-01',
    );
    assert.equal(splits.length, 1);
    const [vt] = splits;
    assert.equal(vt?.ticker, 'VT');
    assert.equal(vt?.from, '2026-01-01');
    near(vt?.twd, 1.2 * (31 / 32) - 1);
    near(vt?.split.local, 0.2);
    near(vt?.split.currency, 31 / 32 - 1);
    near(vt?.split.cross, 0.2 * (31 / 32 - 1));
  });
});

describe('snapshots', () => {
  it('stores the value of both pools and each class’s share of the regular pool', () => {
    const point: DayPoint = {
      date: '2026-01-02',
      value: { all: 51000.004, regular: 30000, windfall: 21000.004 },
      flow: { all: 0, regular: 0, windfall: 0 },
      classValue: { us_global_equity: 20000, strategic_cash: 10000, tw_market_cap: 0 },
      held: { 'regular:VT': 20000, 'manual:1': 10000, 'windfall:VT': 21000.004 },
      ret: { all: null, regular: null, windfall: null },
      local: { all: null, regular: null, windfall: null },
      benchmark: null,
      estimated: false,
    };
    assert.deepEqual(snapshots([point]), [{ date: '2026-01-02', totalTwd: 51000, weightsByClass: { us_global_equity: 0.666667, strategic_cash: 0.333333 } }]);
  });

  it("carries each day's VaR when given one, null for a day without", () => {
    const point = (date: string): DayPoint => ({
      date,
      value: { all: 1000, regular: 1000, windfall: 0 },
      flow: { all: 0, regular: 0, windfall: 0 },
      classValue: { us_global_equity: 1000 },
      held: { 'regular:VT': 1000 },
      ret: { all: null, regular: null, windfall: null },
      local: { all: null, regular: null, windfall: null },
      benchmark: null,
      estimated: false,
    });
    const rows = snapshots([point('2026-01-02'), point('2026-01-05')], new Map([['2026-01-02', 32.9]]));
    assert.deepEqual(
      rows.map((row) => [row.date, row.valueAtRisk]),
      [
        ['2026-01-02', 32.9],
        ['2026-01-05', null],
      ],
    );
  });
});
