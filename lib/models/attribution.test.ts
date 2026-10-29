import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { brinson, carino, cumulative, link, monthInputs, sectorInputs, waterfall, type Month, type Segment } from './attribution';
import { MarketHistory } from './market';
import { buildSeries } from './performance';
import { SECURITIES, trade } from './test-helpers';

function near(actual: number | null | undefined, expected: number, tolerance = 1e-12): void {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`);
}

/** Benchmark 60 / 40 earning 10% / 2%; portfolio 70 / 30 earning 12% / 1% (the PRD's case), no currency in it. */
const PRD: Segment[] = [
  { id: 'equity', wp: 0.7, wb: 0.6, rpTwd: 0.12, rpLocal: 0.12, rbTwd: 0.1, rbLocal: 0.1 },
  { id: 'bonds', wp: 0.3, wb: 0.4, rpTwd: 0.01, rpLocal: 0.01, rbTwd: 0.02, rbLocal: 0.02 },
];

describe('N2 acceptance (PRD Section 11)', () => {
  it('benchmark 60 / 40 earning 10% / 2%, portfolio 70 / 30 earning 12% / 1%: allocation 0.80%, selection 0.80%, interaction 0.30%, sum 1.90% = Rp − Rb', () => {
    const month = brinson(PRD);
    near(month.rb, 0.068);
    near(month.rp, 0.087);
    near(month.total.allocation, 0.008);
    near(month.total.selection, 0.008);
    near(month.total.interaction, 0.003);
    near(month.total.currency, 0);
    near(month.total.allocation + month.total.selection + month.total.interaction, month.rp - month.rb);
    // By class: equity allocation 0.1 × (10% − 6.8%), bonds −0.1 × (2% − 6.8%).
    near(month.segments[0]?.allocation, 0.0032);
    near(month.segments[1]?.allocation, 0.0048);
    near(month.segments[0]?.selection, 0.012);
    near(month.segments[1]?.selection, -0.004);
  });

  it('adds the currency effect so that the four effects sum to the TWD return’s difference', () => {
    // The same case, but the portfolio’s equity earned 2 points of its 12% from a rising dollar, the benchmark’s 1 of its 10%.
    const segments: Segment[] = [
      { id: 'equity', wp: 0.7, wb: 0.6, rpTwd: 0.12, rpLocal: 0.1, rbTwd: 0.1, rbLocal: 0.09 },
      { id: 'bonds', wp: 0.3, wb: 0.4, rpTwd: 0.01, rpLocal: 0.01, rbTwd: 0.02, rbLocal: 0.02 },
    ];
    const month = brinson(segments);
    near(month.total.currency, 0.7 * 0.02 - 0.6 * 0.01);
    near(month.total.allocation + month.total.selection + month.total.interaction + month.total.currency, month.rp - month.rb);
    // Own-currency return of the portfolio and the benchmark.
    near(month.rpLocal, 0.7 * 0.1 + 0.3 * 0.01);
    near(month.rbLocal, 0.6 * 0.09 + 0.4 * 0.02);
  });

  it('gives a segment the portfolio does not hold the benchmark’s return, so only its underweight shows', () => {
    const segments: Segment[] = [
      { id: 'equity', wp: 1, wb: 0.6, rpTwd: 0.1, rpLocal: 0.1, rbTwd: 0.1, rbLocal: 0.1 },
      { id: 'bonds', wp: 0, wb: 0.4, rpTwd: null, rpLocal: null, rbTwd: 0.02, rbLocal: 0.02 },
    ];
    const month = brinson(segments);
    near(month.segments[1]?.selection, 0);
    near(month.segments[1]?.interaction, 0);
    near(month.segments[1]?.currency, 0);
    near(month.total.allocation + month.total.selection + month.total.interaction, month.rp - month.rb);
    // The segment against the benchmark's total, for the quadrant chart.
    near(month.segments[1]?.relative, 0.02 - 0.068);
    near(month.segments[1]?.active, -0.4);
  });
});

describe('linking months with Carino', () => {
  it('is 1 ÷ (1 + r) when the two returns are equal, and the log ratio otherwise', () => {
    near(carino(0.05, 0.05), 1 / 1.05);
    near(carino(0.1, 0.05), (Math.log(1.1) - Math.log(1.05)) / 0.05);
  });

  it('makes several months’ effects add up to the period’s return difference', () => {
    const months: Month[] = [
      brinson(PRD),
      brinson([
        { id: 'equity', wp: 0.65, wb: 0.6, rpTwd: -0.04, rpLocal: -0.05, rbTwd: -0.03, rbLocal: -0.035 },
        { id: 'bonds', wp: 0.35, wb: 0.4, rpTwd: 0.012, rpLocal: 0.01, rbTwd: 0.01, rbLocal: 0.009 },
      ]),
      brinson([
        { id: 'equity', wp: 0.62, wb: 0.6, rpTwd: 0.03, rpLocal: 0.025, rbTwd: 0.03, rbLocal: 0.025 },
        { id: 'bonds', wp: 0.38, wb: 0.4, rpTwd: 0, rpLocal: 0, rbTwd: 0.004, rbLocal: 0.004 },
      ]),
    ];
    const linked = link(months);
    assert.ok(linked);
    near(linked.rp, months.reduce((acc, month) => acc * (1 + month.rp), 1) - 1);
    near(linked.rb, months.reduce((acc, month) => acc * (1 + month.rb), 1) - 1);
    const total = linked.total.allocation + linked.total.selection + linked.total.interaction + linked.total.currency;
    near(total, linked.rp - linked.rb, 1e-12);
    // By segment too: each segment's linked effects sum with the others' to the same total.
    near(linked.segments.reduce((sum, row) => sum + row.allocation + row.selection + row.interaction + row.currency, 0), total, 1e-12);
  });

  it('is a single month’s effects for a single month, and null for none', () => {
    const one = brinson(PRD);
    const linked = link([one]);
    assert.ok(linked);
    near(linked.total.allocation, one.total.allocation);
    near(linked.total.selection, one.total.selection);
    near(linked.total.interaction, one.total.interaction);
    assert.equal(link([]), null);
  });

  it('keeps a month with equal returns from dividing by zero', () => {
    const flat = brinson([{ id: 'a', wp: 1, wb: 1, rpTwd: 0.02, rpLocal: 0.02, rbTwd: 0.02, rbLocal: 0.02 }]);
    const linked = link([flat, flat]);
    assert.ok(linked);
    near(linked.total.allocation + linked.total.selection + linked.total.interaction + linked.total.currency, 0);
  });

  it('accumulates the effects month by month, the last point being the whole period', () => {
    const months = [
      { month: '2026-01', ...brinson(PRD) },
      { month: '2026-02', ...brinson(PRD) },
    ];
    const points = cumulative(months);
    assert.deepEqual(points.map((point) => point.month), ['2026-01', '2026-02']);
    near(points[0]?.allocation, 0.008);
    const whole = link(months);
    near(points[1]?.allocation, whole?.total.allocation ?? NaN);
    assert.ok((points[1]?.allocation ?? 0) > (points[0]?.allocation ?? 0));
  });
});

describe('the waterfall', () => {
  it('runs from the benchmark’s return through each effect to the portfolio’s', () => {
    const month = brinson(PRD);
    const steps = waterfall({ rb: month.rb, total: month.total });
    assert.deepEqual(
      steps.map((step) => step.step),
      ['benchmark', 'allocation', 'selection', 'interaction', 'currency', 'portfolio'],
    );
    near(steps[0]?.level, 0.068);
    near(steps[3]?.level, 0.068 + 0.008 + 0.008 + 0.003);
    near(steps[5]?.level, month.rp);
  });
});

describe('monthInputs, from the daily series', () => {
  // 10 VT at US$100 (32 TWD) and 100 shares of 0050 at NT$50 on the last day of 2025; the two classes
  // each have 50% in the benchmark, and the portfolio holds 32,000 against 5,000.
  const prices = [
    { ticker: 'VT', date: '2025-12-31', close: 100, adjClose: 100 },
    { ticker: 'VT', date: '2026-01-31', close: 110, adjClose: 110 },
    { ticker: 'VT', date: '2026-02-28', close: 99, adjClose: 99 },
    { ticker: '0050', date: '2025-12-31', close: 50, adjClose: 50 },
    { ticker: '0050', date: '2026-01-31', close: 52, adjClose: 52 },
    { ticker: '0050', date: '2026-02-28', close: 55, adjClose: 55 },
  ];
  const rates = [
    { pair: 'USD/TWD', date: '2025-12-31', rate: 32 },
    { pair: 'USD/TWD', date: '2026-01-31', rate: 31 },
    { pair: 'USD/TWD', date: '2026-02-28', rate: 33 },
  ];
  const days = buildSeries({
    end: '2026-02-28',
    trades: [
      trade({ tradeDate: '2025-12-31', ticker: 'VT', qty: 10, price: 100, fxRate: 32 }),
      trade({ tradeDate: '2025-12-31', ticker: '0050', qty: 100, price: 50, currency: 'TWD', fxRate: 1 }),
    ],
    cashFlows: [],
    manualAssets: [],
    securities: SECURITIES,
    benchmark: [],
    prices,
    rates,
  });
  const market = new MarketHistory(prices, rates);
  const classes = [
    { id: 'us_global_equity', targetWeight: 0.5, benchmarkTicker: 'VT', benchmarkCurrency: 'USD' },
    { id: 'tw_market_cap', targetWeight: 0.5, benchmarkTicker: '0050', benchmarkCurrency: 'TWD' },
  ];

  it('gives each month after the first its start weights, class returns and benchmark returns', () => {
    const months = monthInputs(days, market, classes);
    assert.deepEqual(months.map((month) => [month.month, month.from, month.to, month.complete]), [
      ['2026-01', '2025-12-31', '2026-01-31', true],
      ['2026-02', '2026-01-31', '2026-02-28', true],
    ]);
    const january = months[0];
    assert.ok(january);
    // 10 × 100 × 32 = 32,000 against 100 × 50 = 5,000.
    near(january.segments[0]?.wp, 32000 / 37000);
    near(january.segments[1]?.wp, 5000 / 37000);
    near(january.segments[0]?.wb, 0.5);
    near(january.segments[0]?.rbLocal, 0.1);
    near(january.segments[0]?.rbTwd, 1.1 * (31 / 32) - 1);
    near(january.segments[0]?.rpTwd, 1.1 * (31 / 32) - 1);
    near(january.segments[1]?.rpTwd, 0.04);
  });

  it('adds up, month by month and linked, to the portfolio’s return less the benchmark’s, which is the pool’s own return', () => {
    const months = monthInputs(days, market, classes);
    const results = months.map((month) => ({ month: month.month, ...brinson(month.segments) }));
    for (const [i, month] of results.entries()) {
      const sum = month.total.allocation + month.total.selection + month.total.interaction + month.total.currency;
      near(sum, month.rp - month.rb, 1e-12);
      // The holdings are the benchmark's own ETFs, so there is no selection; the pool's TWR is the attribution's return.
      near(month.total.selection, 0, 1e-12);
      near(months[i]?.twr, month.rp, 1e-9);
    }
    const linked = link(results);
    assert.ok(linked);
    near(linked.total.allocation + linked.total.selection + linked.total.interaction + linked.total.currency, linked.rp - linked.rb, 1e-12);
  });

  it('leaves out a class with no benchmark price and re-weights the rest', () => {
    const months = monthInputs(days, market, [...classes, { id: 'real_assets', targetWeight: 0.2, benchmarkTicker: 'GLDM', benchmarkCurrency: 'USD' }]);
    assert.deepEqual(months[0]?.left, ['real_assets']);
    near(months[0]?.segments.reduce((sum, segment) => sum + segment.wb, 0) ?? NaN, 1, 1e-12);
    near(months[0]?.segments.reduce((sum, segment) => sum + segment.wp, 0) ?? NaN, 1, 1e-12);
  });
});

describe('sectorInputs (level 2)', () => {
  const prices = [
    { ticker: 'AAPL', date: '2025-12-31', close: 100, adjClose: 100 },
    { ticker: 'AAPL', date: '2026-01-31', close: 110, adjClose: 110 },
    { ticker: 'XLK', date: '2025-12-31', close: 200, adjClose: 200 },
    { ticker: 'XLK', date: '2026-01-31', close: 210, adjClose: 210 },
    { ticker: 'XLF', date: '2025-12-31', close: 50, adjClose: 50 },
    { ticker: 'XLF', date: '2026-01-31', close: 49, adjClose: 49 },
  ];
  const rates = [
    { pair: 'USD/TWD', date: '2025-12-31', rate: 32 },
    { pair: 'USD/TWD', date: '2026-01-31', rate: 32 },
  ];
  const days = buildSeries({
    end: '2026-01-31',
    trades: [trade({ tradeDate: '2025-12-31', ticker: 'AAPL', qty: 10, price: 100, fxRate: 32 })],
    cashFlows: [],
    manualAssets: [],
    securities: SECURITIES,
    benchmark: [],
    prices,
    rates,
  });
  const market = new MarketHistory(prices, rates);
  const months = [{ month: '2026-01', from: '2025-12-31', to: '2026-01-31', complete: true }];
  const benchmark = [
    { sector: 'Information Technology', weight: 0.7, proxy: 'XLK', currency: 'USD' },
    { sector: 'Financials', weight: 0.3, proxy: 'XLF', currency: 'USD' },
  ];

  it('puts the satellite stock in its sector against the fund’s sector weights: all in tech against 70 / 30', () => {
    const [month] = sectorInputs(months, days, market, [{ ticker: 'AAPL', currency: 'USD', sector: 'Information Technology' }], benchmark);
    assert.ok(month);
    const tech = month.segments.find((segment) => segment.id === 'Information Technology');
    const financials = month.segments.find((segment) => segment.id === 'Financials');
    near(tech?.wp, 1);
    near(financials?.wp, 0);
    near(tech?.wb, 0.7);
    near(tech?.rpLocal, 0.1);
    near(tech?.rbLocal, 0.05);
    near(financials?.rbLocal, -0.02);
    assert.equal(financials?.rpTwd, null);
    // The effects add up to the satellite’s return less the benchmark’s: 10% − (0.7 × 5% + 0.3 × −2%).
    const result = brinson(month.segments);
    near(result.total.allocation + result.total.selection + result.total.interaction + result.total.currency, 0.1 - (0.7 * 0.05 - 0.3 * 0.02), 1e-12);
    // Overweighting the sector that did better is a good allocation (0.3 × 7% − 0.3 × (−2%−2.9%)... positive).
    assert.ok(result.total.allocation > 0);
  });

  it('skips a month with no satellite stock, and a sector with no proxy price', () => {
    assert.deepEqual(sectorInputs(months, days, market, [], benchmark), []);
    const [month] = sectorInputs(months, days, market, [{ ticker: 'AAPL', currency: 'USD', sector: 'Information Technology' }], [...benchmark, { sector: 'Energy', weight: 0.1, proxy: 'XLE', currency: 'USD' }]);
    assert.deepEqual(month?.left, ['Energy']);
    near(month?.segments.reduce((sum, segment) => sum + segment.wb, 0) ?? NaN, 1, 1e-12);
  });
});
