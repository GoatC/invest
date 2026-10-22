import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addDays } from '../dates';
import type { ManualState } from './manual-history';
import { MarketHistory, type PriceRow } from './market';
import { buildSeries, type PerformanceInput } from './performance';
import {
  candidateProxies,
  covariance,
  dailyValueAtRisk,
  dayLines,
  fridayOnOrBefore,
  fridays,
  gridStart,
  histogram,
  lastOfEachWeek,
  lookbackWeeks,
  measure,
  normalQuantile,
  oneIn,
  overWeeks,
  parametricVar,
  proxyCandidates,
  readRiskSettings,
  returnWindow,
  riskFigures,
  riskReport,
  sparkline,
  varLine,
  weeklyReturns,
  weeksBeyond,
  windowOn,
  zScore,
  type RiskInput,
  type RiskLine,
} from './risk';
import { holding, SECURITIES, trade } from './test-helpers';
import type { Security } from './types';

function near(actual: number | null | undefined, expected: number, tolerance = 1e-9): void {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);
}

/** config var as seeded (supabase/migrations reference data). */
const SETTINGS = { confidence: 0.95, horizonWeeks: 1, monthWeeks: 4.33, lookbackYears: 3 };

/** The N4 proxy table (asset_classes.benchmark_ticker as seeded). */
const BENCHMARKS = new Map<string, string | null>([
  ['us_global_equity', 'VT'],
  ['tw_market_cap', '0050'],
  ['global_bonds', 'BNDW'],
  ['real_assets', 'GLDM'],
  ['strategic_cash', 'BIL'],
  ['us_stocks', 'VOO'],
  ['tw_stocks', '0050'],
  ['tactical_themes', 'VT'],
]);

/** A Friday, so the window ends on it. */
const TODAY = '2026-10-23';

/** Weekly closes from 100, one per Friday of the grid, growing by each return in turn. */
function closes(ticker: string, grid: readonly string[], returns: (week: number) => number): PriceRow[] {
  let price = 100;
  return grid.map((date, week) => {
    if (week > 0) price *= 1 + returns(week);
    return { ticker, date, close: price, adjClose: price };
  });
}

/** ±a in turn, a set so that 156 weeks have a sample standard deviation of exactly `sigma`. */
function alternating(sigma: number, weeks = 156): (week: number) => number {
  const a = sigma * Math.sqrt((weeks - 1) / weeks);
  return (week) => (week % 2 === 0 ? a : -a);
}

const line = (overrides: Partial<RiskLine>): RiskLine => ({ key: 'regular:VT', ticker: 'VT', label: 'VT', productType: 'equity_etf', assetClassId: 'us_global_equity', valueTwd: 0, ...overrides });

/** A window holding these weekly returns, as if every proxy had a full history. */
const windowOf = (returns: Record<string, number[]>) => ({ returns: new Map(Object.entries(returns)) });

describe('N4 VaR (PRD Section 11 acceptance)', () => {
  it('gives NT$32,900 for 1 week on NT$1,000,000 with a weekly σ of 2%', () => {
    near(parametricVar(1_000_000, 0.02, 1, zScore(0.95)), 32_900, 1e-6);
  });

  it('gives about NT$68,500 for 1 month: the 1-week figure × √4.33', () => {
    const month = parametricVar(1_000_000, 0.02, 4.33, zScore(0.95));
    near(month, 32_900 * Math.sqrt(4.33), 1e-6);
    assert.ok(Math.abs(month - 68_500) < 50, `${month} is not about 68,500`);
    near(overWeeks(32_900, 4.33), month, 1e-6);
  });

  it('works the same case out from 156 weekly closes: NT$1,000,000 in a proxy whose weekly σ is 2%', () => {
    const grid = fridays(gridStart(TODAY, 156), TODAY);
    const input: RiskInput = {
      settings: SETTINGS,
      benchmarks: BENCHMARKS,
      proxies: new Map([['0050', 'TWD']]),
      prices: closes('0050', grid, alternating(0.02)),
      rates: [],
    };
    const report = riskReport([holding({ key: 'regular:0050', ticker: '0050', assetClassId: 'tw_market_cap', currency: 'TWD', valueTwd: 1_000_000 })], input, TODAY);
    assert.ok(report);
    assert.deepEqual(report.window, { from: '2023-10-27', to: TODAY, weeks: 156 });
    near(report.sigma, 0.02, 1e-12);
    near(report.weekVar, 32_900, 1e-6);
    near(overWeeks(report.weekVar ?? 0, SETTINGS.monthWeeks), 32_900 * Math.sqrt(4.33), 1e-6);
  });
});

describe('z, the one-sided normal quantile', () => {
  it('matches the normal table', () => {
    near(normalQuantile(0.95), 1.6448536270, 1e-8);
    near(normalQuantile(0.975), 1.9599639845, 1e-8);
    near(normalQuantile(0.99), 2.3263478740, 1e-8);
    near(normalQuantile(0.999), 3.0902323062, 1e-8);
    near(normalQuantile(0.01), -2.3263478740, 1e-8);
    near(normalQuantile(0.5), 0, 1e-12);
    assert.ok(Number.isNaN(normalQuantile(1)));
  });

  it('is rounded to three decimals as a z-table quotes it, so 95% is the PRD’s 1.645', () => {
    assert.equal(zScore(0.95), 1.645);
    assert.equal(zScore(0.99), 2.326);
    assert.equal(zScore(0.975), 1.96);
  });

  it('says how often a loss beyond the VaR comes: 1 period in 20 at 95%', () => {
    assert.equal(oneIn(0.95), 20);
    assert.equal(oneIn(0.99), 100);
  });
});

describe('readRiskSettings', () => {
  it('reads config var as seeded: 95%, 1 week, 4.33 weeks a month, 3 years of weekly returns', () => {
    const settings = readRiskSettings({ confidence: 0.95, horizon_weeks: 1, month_weeks: 4.33, lookback_years: 3 });
    assert.deepEqual(settings, SETTINGS);
    assert.equal(lookbackWeeks(SETTINGS), 156);
  });

  it('refuses a value it cannot use', () => {
    assert.equal(readRiskSettings({ confidence: 95, horizon_weeks: 1, month_weeks: 4.33, lookback_years: 3 }), undefined);
    assert.equal(readRiskSettings({ confidence: 0.95, horizon_weeks: 1, lookback_years: 3 }), undefined);
    assert.equal(readRiskSettings({ confidence: 0.95, horizon_weeks: 1, month_weeks: 4.33, lookback_years: 0 }), undefined);
    assert.equal(readRiskSettings({ confidence: 0.95, horizon_weeks: 1, month_weeks: 4.33, lookback_years: 0.01 }), undefined);
    assert.equal(readRiskSettings(null), undefined);
  });
});

describe('weekly returns, Friday to Friday', () => {
  it('finds the Friday on or before any day', () => {
    assert.equal(fridayOnOrBefore('2026-10-22'), '2026-10-16');
    assert.equal(fridayOnOrBefore('2026-10-23'), '2026-10-23');
    assert.equal(fridayOnOrBefore('2026-10-24'), '2026-10-23');
    assert.equal(fridayOnOrBefore('2026-10-25'), '2026-10-23');
    assert.equal(fridayOnOrBefore('2026-10-26'), '2026-10-23');
  });

  it('reaches back 156 weeks for three years, and lists every Friday in between', () => {
    assert.equal(gridStart('2026-10-22', 156), '2023-10-20');
    const grid = fridays(gridStart('2026-10-22', 156), '2026-10-22');
    assert.equal(grid.length, 157);
    assert.equal(grid[156], '2026-10-16');
    assert.equal(addDays(grid[0] ?? '', 7), grid[1]);
  });

  it('measures a US ETF in TWD: its own move times the dollar’s', () => {
    const market = new MarketHistory(
      [
        { ticker: 'VT', date: '2026-10-09', close: 100, adjClose: 100 },
        // Friday the 16th has no close (a holiday): Thursday's stands in.
        { ticker: 'VT', date: '2026-10-15', close: 110, adjClose: 110 },
        { ticker: 'VT', date: '2026-10-23', close: 99, adjClose: 99 },
      ],
      [
        { pair: 'USD/TWD', date: '2026-10-09', rate: 30 },
        { pair: 'USD/TWD', date: '2026-10-16', rate: 30.6 },
        { pair: 'USD/TWD', date: '2026-10-23', rate: 30.6 },
      ],
    );
    const returns = weeklyReturns(market, new Map([['VT', 'USD']]), ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23']).get('VT');
    assert.equal(returns?.[0], undefined, 'no close on or before 2 October yet');
    near(returns?.[1], 1.1 * 1.02 - 1);
    near(returns?.[2], 0.9 - 1);
  });

  it('keeps out of a window a proxy whose history does not reach its first Friday', () => {
    const all = new Map([
      ['VT', [0.01, -0.01, 0.02]],
      ['QQQM', [undefined, 0.03, -0.01]],
    ]);
    const grid = ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23'];
    assert.deepEqual([...returnWindow(all, grid, 3, 3).returns.keys()], ['VT']);
    const shorter = returnWindow(all, grid, 3, 2);
    assert.deepEqual([...shorter.returns.keys()], ['VT', 'QQQM']);
    assert.deepEqual([shorter.from, shorter.to], ['2026-10-09', '2026-10-23']);
  });
});

describe('covariance', () => {
  it('is the sample covariance, divided by n − 1', () => {
    const [x, y] = covariance([
      [1, 2, 3, 4],
      [2, 4, 6, 8],
    ]);
    near(x?.[0], 5 / 3);
    near(x?.[1], 10 / 3);
    near(y?.[0], 10 / 3);
    near(y?.[1], 20 / 3);
  });
});

describe('holdings to proxies', () => {
  it('measures each holding by its class proxy, both pools together, a TWD balance as cash', () => {
    const lines = [
      line({ key: 'regular:VT', valueTwd: 300 }),
      line({ key: 'windfall:VT', valueTwd: 200 }),
      line({ key: 'regular:AAPL', ticker: 'AAPL', label: 'Apple Inc.', productType: 'stock', assetClassId: 'us_stocks', valueTwd: 100 }),
      line({ key: 'regular:00692', ticker: '00692', label: '富邦公司治理', assetClassId: 'tw_market_cap', valueTwd: 80 }),
      line({ key: 'regular:2330', ticker: '2330', label: '台積電', productType: 'stock', assetClassId: 'tw_stocks', valueTwd: 120 }),
      line({ key: 'manual:1', ticker: null, label: 'Gold bar', productType: 'gold', assetClassId: 'real_assets', valueTwd: 50 }),
      line({ key: 'manual:2', ticker: null, label: 'Savings', productType: 'cash_mmf', assetClassId: 'strategic_cash', valueTwd: 150 }),
    ];
    const measured = measure(lines, BENCHMARKS, windowOf({ VT: [0], VOO: [0], '0050': [0], GLDM: [0] }));
    assert.equal(measured.valueTwd, 1000);
    assert.deepEqual(
      measured.exposures.map((row) => [row.proxy, row.valueTwd, row.holdings.map((h) => h.key)]),
      [
        ['VT', 500, ['regular:VT', 'windfall:VT']],
        ['0050', 200, ['regular:2330', 'regular:00692']],
        ['VOO', 100, ['regular:AAPL']],
        ['GLDM', 50, ['manual:1']],
      ],
    );
    assert.deepEqual(measured.cash, { valueTwd: 150, holdings: [{ key: 'manual:2', ticker: null, label: 'Savings', valueTwd: 150, standIn: false }] });
    assert.deepEqual(measured.unmeasured, []);
  });

  it('measures a listed cash ETF such as BIL by its prices: only a TWD balance is riskless', () => {
    const measured = measure([line({ key: 'regular:BIL', ticker: 'BIL', productType: 'cash_mmf', assetClassId: 'strategic_cash', valueTwd: 10 })], BENCHMARKS, windowOf({ BIL: [0] }));
    assert.deepEqual(measured.exposures.map((row) => row.proxy), ['BIL']);
    assert.equal(measured.cash.valueTwd, 0);
  });

  it('measures a theme ETF by its own prices, with VT standing in until it has the whole window', () => {
    const theme = line({ key: 'regular:QQQM', ticker: 'QQQM', productType: 'theme_etf', assetClassId: 'tactical_themes', valueTwd: 40 });
    assert.deepEqual(proxyCandidates(theme, BENCHMARKS), ['QQQM', 'VT']);
    const own = measure([theme], BENCHMARKS, windowOf({ QQQM: [0], VT: [0] }));
    assert.deepEqual(own.exposures.map((row) => [row.proxy, row.holdings[0]?.standIn]), [['QQQM', false]]);
    const standIn = measure([theme], BENCHMARKS, windowOf({ VT: [0] }));
    assert.deepEqual(standIn.exposures.map((row) => [row.proxy, row.holdings[0]?.standIn]), [['VT', true]]);
    // A theme stock is not a theme ETF: VT, the class proxy, measures it.
    assert.deepEqual(proxyCandidates({ ...theme, productType: 'stock' }, BENCHMARKS), ['VT']);
  });

  it('leaves a holding unmeasured when its proxy lacks the history, or its class has none', () => {
    const lines = [line({ valueTwd: 10 }), line({ key: 'regular:X', ticker: 'X', assetClassId: 'new_class', valueTwd: 5 })];
    const measured = measure(lines, BENCHMARKS, windowOf({}));
    assert.deepEqual(
      measured.unmeasured.map((h) => [h.key, h.proxy]),
      [
        ['regular:VT', 'VT'],
        ['regular:X', null],
      ],
    );
  });

  it('lists every proxy the VaR may read: class benchmarks and theme ETFs, with their currency', () => {
    const securities: Security[] = [
      ...SECURITIES,
      { ticker: 'QQQM', name: 'Invesco NASDAQ 100 ETF', market: 'US', productType: 'theme_etf', assetClassId: 'tactical_themes', sleeve: 'satellite', currency: 'USD' },
    ];
    assert.deepEqual([...candidateProxies(new Map([['us_global_equity', 'VT'], ['tw_market_cap', '0050'], ['x', null]]), securities)], [
      ['VT', 'USD'],
      ['0050', 'TWD'],
      ['QQQM', 'USD'],
    ]);
  });
});

describe('riskFigures', () => {
  // Sample variances 0.02² × 4/3 and 0.01² × 4/3, uncorrelated.
  const returns = { VT: [0.02, -0.02, 0.02, -0.02], BNDW: [0.01, -0.01, -0.01, 0.01] };
  const lines = [line({ key: 'regular:VT', valueTwd: 600 }), line({ key: 'regular:BNDW', ticker: 'BNDW', productType: 'bond_etf', assetClassId: 'global_bonds', valueTwd: 400 })];

  it('adds up the proxies through their covariance: σ_p = √(wᵀΣw), each one’s share of the VaR', () => {
    const figures = riskFigures(measure(lines, BENCHMARKS, windowOf(returns)), windowOf(returns), 1.645);
    // eᵀΣe = 600² × 0.0004 × 4/3 + 400² × 0.0001 × 4/3 = 192 + 21.33 TWD².
    const variance = 192 + 64 / 3;
    near(figures.sigma, Math.sqrt(variance) / 1000);
    near(figures.weekVar, 1.645 * Math.sqrt(variance));
    assert.deepEqual(
      figures.proxies.map((p) => p.proxy),
      ['VT', 'BNDW'],
    );
    near(figures.proxies[0]?.share, 192 / variance);
    near(figures.proxies[1]?.share, 64 / 3 / variance);
    near(figures.proxies[0]?.weeklySigma, 0.02 * Math.sqrt(4 / 3));
    near(figures.correlations[0]?.[1], 0);
    near(figures.correlations[1]?.[1], 1);
    // The current mix's weekly returns: 60% of VT's and 40% of BNDW's.
    assert.deepEqual(
      figures.mixReturns.map((r) => Math.round(r * 1e6) / 1e6),
      [0.016, -0.016, 0.008, -0.008],
    );
  });

  it('gives no diversification between proxies that move together', () => {
    const together = { VT: returns.VT, BNDW: returns.VT.map((r) => r / 2) };
    const figures = riskFigures(measure(lines, BENCHMARKS, windowOf(together)), windowOf(together), 1.645);
    const sd = 0.02 * Math.sqrt(4 / 3);
    near(figures.weekVar, 1.645 * (600 * sd + 400 * (sd / 2)));
    near(figures.correlations[0]?.[1], 1);
  });

  it('adds value but no risk for TWD balances, and gives no VaR while a holding is unmeasured', () => {
    const savings = line({ key: 'manual:1', ticker: null, productType: 'cash_mmf', assetClassId: 'strategic_cash', valueTwd: 1000 });
    const withCash = riskFigures(measure([...lines, savings], BENCHMARKS, windowOf(returns)), windowOf(returns), 1.645);
    near(withCash.weekVar, 1.645 * Math.sqrt(192 + 64 / 3));
    near(withCash.sigma, Math.sqrt(192 + 64 / 3) / 2000);
    const onlyCash = riskFigures(measure([savings], BENCHMARKS, windowOf(returns)), windowOf(returns), 1.645);
    assert.equal(onlyCash.weekVar, 0);
    const missing = riskFigures(measure(lines, BENCHMARKS, windowOf({ VT: returns.VT })), windowOf({ VT: returns.VT }), 1.645);
    assert.equal(missing.weekVar, null);
    assert.equal(missing.sigma, null);
    assert.equal(missing.proxies[0]?.share, null);
    assert.deepEqual(missing.mixReturns, []);
    assert.equal(riskFigures(measure([], BENCHMARKS, windowOf(returns)), windowOf(returns), 1.645).weekVar, null);
  });
});

describe('riskReport', () => {
  const grid = fridays(gridStart(TODAY, 156), TODAY);
  const input = (overrides: Partial<RiskInput> = {}): RiskInput => ({
    settings: SETTINGS,
    benchmarks: BENCHMARKS,
    proxies: new Map([
      ['VT', 'USD'],
      ['0050', 'TWD'],
    ]),
    prices: [...closes('VT', grid, alternating(0.02)), ...closes('0050', grid, alternating(0.03))],
    rates: [{ pair: 'USD/TWD', date: grid[0] ?? '', rate: 32 }],
    ...overrides,
  });

  it('values the holdings as the holdings page does, leaving out what is not priced yet', () => {
    const report = riskReport(
      [holding({ valueTwd: 1000 }), holding({ key: 'manual:1', ticker: null, label: 'Gold bar', productType: 'gold', assetClassId: 'real_assets', valueTwd: null })],
      input(),
      TODAY,
    );
    assert.ok(report);
    assert.equal(report.measured.valueTwd, 1000);
    assert.deepEqual(report.unpriced.map((h) => h.key), ['manual:1']);
    near(report.weekVar, 1.645 * 0.02 * 1000, 1e-9);
    assert.equal(report.z, 1.645);
  });

  it('names the proxies that lack three years of weekly prices', () => {
    const report = riskReport([holding({ valueTwd: 1000 })], input({ prices: closes('VT', grid.slice(10), alternating(0.02)) }), TODAY);
    assert.deepEqual(report?.missing, ['VT']);
    assert.equal(report?.weekVar, null);
  });

  it('needs config var', () => {
    assert.equal(riskReport([holding({ valueTwd: 1000 })], input({ settings: undefined }), TODAY), undefined);
  });

  it('reads the weekly returns to the Friday on or before today', () => {
    assert.equal(windowOn(new MarketHistory(input().prices, input().rates), input().proxies, '2026-10-28', 156).to, TODAY);
  });
});

describe('histogram and the weeks beyond the VaR', () => {
  it('bins the weekly returns in round widths, edges included', () => {
    const { width, bins } = histogram([-0.031, -0.004, 0, 0.004, 0.012, 0.0125]);
    assert.equal(width, 0.0025);
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 6);
    assert.deepEqual(bins[0], { from: -0.0325, to: -0.03, count: 1 });
    assert.deepEqual(bins.find((bin) => bin.from === 0.0125), { from: 0.0125, to: 0.015, count: 1 });
    assert.deepEqual(histogram([]), { width: 0, bins: [] });
  });

  it('counts the weeks that lost more than the VaR', () => {
    assert.equal(weeksBeyond([-0.05, -0.03, -0.0329, 0.01], 0.0329), 1);
  });

  it('puts a bin edge on the cutoff, so the bins left of it hold exactly the weeks beyond it', () => {
    const returns = [-0.05, -0.034, -0.0329, -0.01, 0, 0.02];
    const { bins } = histogram(returns, 24, -0.0329);
    assert.ok(bins.some((bin) => bin.from === -0.0329));
    const left = bins.filter((bin) => bin.to <= -0.0329).reduce((sum, bin) => sum + bin.count, 0);
    assert.equal(left, weeksBeyond(returns, 0.0329));
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), returns.length);
  });
});

describe('sparkline', () => {
  it('ends with today’s worked-out VaR, one saved point a week before it', () => {
    const saved = ['2026-10-12', '2026-10-15', '2026-10-21', TODAY].map((date) => ({ date, valueAtRisk: 10, totalTwd: 1000 }));
    const report = { weekVar: 12, measured: { valueTwd: 1100, exposures: [], cash: { valueTwd: 0, holdings: [] }, unmeasured: [] } };
    assert.deepEqual(
      sparkline(saved, TODAY, report).map((p) => [p.date, p.valueAtRisk]),
      [
        ['2026-10-15', 10],
        [TODAY, 12],
      ],
    );
    assert.deepEqual(sparkline(saved, TODAY, { ...report, weekVar: null }).map((p) => p.date), ['2026-10-15', TODAY]);
  });
});

describe('lastOfEachWeek', () => {
  it('keeps the last point of each week to Friday, and the newest', () => {
    const point = (date: string) => ({ date, valueAtRisk: 1, totalTwd: 1 });
    // Thursday 15, Friday 16, Monday 19, Wednesday 21 October.
    assert.deepEqual(
      lastOfEachWeek(['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-21'].map(point)).map((p) => p.date),
      ['2026-10-16', '2026-10-21'],
    );
  });
});

describe('varLine', () => {
  it('keeps the last 52 weeks of saved figures, with today’s worked-out one in place of today’s saved one', () => {
    const saved = [
      { date: '2025-10-24', valueAtRisk: 1, totalTwd: 100 },
      { date: '2025-10-25', valueAtRisk: 2, totalTwd: 100 },
      { date: TODAY, valueAtRisk: 3, totalTwd: 100 },
    ];
    assert.deepEqual(
      varLine(saved, TODAY, { date: TODAY, valueAtRisk: 4, totalTwd: 110 }).map((p) => [p.date, p.valueAtRisk]),
      [
        ['2025-10-25', 2],
        [TODAY, 4],
      ],
    );
    assert.deepEqual(varLine(saved, TODAY, undefined).map((p) => p.valueAtRisk), [2, 3]);
  });
});

describe('dailyValueAtRisk (the nightly job’s var_95_1w)', () => {
  // 0050 held from Monday 19 October; weekly closes back far enough for both Fridays' windows.
  const grid = fridays(gridStart('2026-10-16', 156), TODAY);
  const prices = closes('0050', grid, alternating(0.02));
  const at = (date: string) => prices.find((row) => row.date === date)?.close ?? 0;
  const savings: ManualState = { from: '2026-10-19', name: 'Savings', assetClassId: 'strategic_cash', productType: 'cash_mmf', unit: 'TWD', quantity: 5000, lastValueTwd: null, pool: 'regular' };
  const performance: PerformanceInput = {
    end: TODAY,
    trades: [trade({ tradeDate: '2026-10-19', ticker: '0050', qty: 100, price: at('2026-10-16'), currency: 'TWD', fxRate: 1 })],
    cashFlows: [],
    manualAssets: [{ id: 1, states: [savings], deletedOn: null }],
    securities: SECURITIES,
    benchmark: [],
    prices,
    rates: [],
  };
  const risk: RiskInput = { settings: SETTINGS, benchmarks: BENCHMARKS, proxies: new Map([['0050', 'TWD']]), prices, rates: [] };

  it("works out each day's VaR from that day's holdings and the weeks to the Friday before it", () => {
    const days = buildSeries(performance);
    const values = dailyValueAtRisk(days, performance, risk);
    assert.deepEqual([...values.keys()], ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    // Savings add value, not risk: 1.645 × 2% × the 0050 holding at the day's close.
    near(values.get('2026-10-21'), Math.round(0.0329 * 100 * at('2026-10-16') * 100) / 100, 1e-9);
    near(values.get(TODAY), Math.round(0.0329 * 100 * at(TODAY) * 100) / 100, 1e-9);
  });

  it('turns each day into risk lines, gold and balances from their state on that day', () => {
    const [first] = buildSeries(performance);
    assert.ok(first);
    assert.deepEqual(
      dayLines(first, new Map(SECURITIES.map((s) => [s.ticker, s])), new Map(performance.manualAssets.map((a) => [a.id, a]))).map((l) => [l.key, l.ticker, l.productType]),
      [
        ['regular:0050', '0050', 'equity_etf'],
        ['manual:1', null, 'cash_mmf'],
      ],
    );
  });

  it('leaves a day without a VaR when the proxy history is too short, and has none without settings', () => {
    const short = { ...risk, prices: prices.slice(-20) };
    const days = buildSeries(performance);
    assert.ok([...dailyValueAtRisk(days, performance, short).values()].every((value) => value === null));
    assert.equal(dailyValueAtRisk(days, performance, { ...risk, settings: undefined }).size, 0);
  });
});
