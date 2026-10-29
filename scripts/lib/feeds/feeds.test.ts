import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { makeRedactor } from '../http.ts';
import { avDaily, avSymbol, avWeeklyAdjusted } from './alphavantage.ts';
import { fredRates } from './fred.ts';
import { makeGet } from './get.ts';
import { adjustForDividends, bankOfTaiwanRates, exDividendFactors, finmindRows, goldCloses, splitFactors, taiwanPrices, usPrices } from './finmind.ts';
import { adjustForSplits, ISHARES_FUNDS, navFromProductPage, navHistory } from './ishares.ts';
import { rocDateToIso, twseCloses } from './twse.ts';
import { FeedError } from './types.ts';

const ok = (data: unknown[]) => JSON.stringify({ msg: 'success', status: 200, data });

describe('FinMind', () => {
  it('reads the rows of a reply and turns an error envelope into a FeedError', () => {
    assert.equal(finmindRows(ok([{ a: 1 }]), 'x').length, 1);
    assert.throws(
      () => finmindRows(JSON.stringify({ msg: 'Your level is register. Please update your user level.', status: 400 }), 'TaiwanStockPriceAdj 0050'),
      (err: unknown) => err instanceof FeedError && /TaiwanStockPriceAdj 0050: Your level is register/.test(err.message),
    );
    assert.throws(() => finmindRows('<html>', 'x'), FeedError);
  });

  it('reads Taiwan closes and leaves out days without trading', () => {
    const rows = finmindRows(
      ok([
        { date: '2026-10-20', stock_id: '0050', close: 107.25 },
        { date: '2026-10-21', stock_id: '0050', close: 108.15 },
        { date: '2026-10-22', stock_id: '0050', close: 0 },
      ]),
      'TaiwanStockPrice',
    );
    assert.deepEqual(
      taiwanPrices(rows, '0050').map((p) => [p.date, p.close, p.adjClose, p.source]),
      [
        ['2026-10-20', 107.25, null, 'finmind'],
        ['2026-10-21', 108.15, null, 'finmind'],
      ],
    );
  });

  it('adjusts Taiwan closes before an ex-dividend date by after ÷ before price', () => {
    // 0050 went ex-dividend on 2026-07-21: NT$0.60, from 99.20 to a reference price of 98.60.
    const factors = exDividendFactors([{ date: '2026-07-21', before_price: 99.2, after_price: 98.6 }]);
    assert.equal(factors.length, 1);
    const prices = [
      { ticker: '0050', date: '2026-07-18', close: 99.2, adjClose: null, source: 'finmind' },
      { ticker: '0050', date: '2026-07-21', close: 98.6, adjClose: null, source: 'finmind' },
      { ticker: '0050', date: '2026-07-22', close: 99, adjClose: null, source: 'finmind' },
    ];
    assert.deepEqual(
      adjustForDividends(prices, factors).map((p) => [p.date, p.adjClose]),
      [
        ['2026-07-18', 98.6],
        ['2026-07-21', 98.6],
        ['2026-07-22', 99],
      ],
    );
  });

  it('compounds several ex-dates and ignores rows that are not a price drop', () => {
    const factors = exDividendFactors([
      { date: '2026-01-20', before_price: 100, after_price: 98 },
      { date: '2026-07-21', before_price: 100, after_price: 99 },
      { date: '2026-09-01', before_price: 50, after_price: 50 },
      { date: 'bad', before_price: 1, after_price: 0.5 },
    ]);
    const prices = [{ ticker: 'X', date: '2026-01-02', close: 100, adjClose: null, source: 'finmind' }];
    assert.equal(adjustForDividends(prices, factors)[0]?.adjClose, 97.02);
  });

  it("finds a split in the closes: 0050's 1-into-4 split of June 2025 is a jump to a quarter, the day's own move left in", () => {
    const close = (date: string, price: number) => ({ ticker: '0050', date, close: price, adjClose: null, source: 'finmind' });
    // Trading stopped from 11 to 17 June; it reopened at a quarter of the price, 0.4% below it.
    const prices = [close('2025-06-09', 186), close('2025-06-10', 188), close('2025-06-18', 46.81), close('2025-06-19', 47.2)];
    const splits = splitFactors(prices);
    assert.deepEqual(splits, [{ date: '2025-06-18', factor: 0.25 }]);
    assert.deepEqual(
      adjustForDividends(prices, splits).map((p) => [p.date, p.adjClose]),
      [
        ['2025-06-09', 46.5],
        ['2025-06-10', 47],
        ['2025-06-18', 46.81],
        ['2025-06-19', 47.2],
      ],
    );
  });

  it('never takes a move within the 10% daily limit for a split, and finds a reverse split and one on an ex-dividend day', () => {
    const close = (date: string, price: number) => ({ ticker: 'X', date, close: price, adjClose: null, source: 'finmind' });
    assert.deepEqual(splitFactors([close('2026-01-02', 100), close('2026-01-05', 90), close('2026-01-06', 99)]), []);
    assert.deepEqual(splitFactors([close('2026-01-02', 20), close('2026-01-05', 41)]), [{ date: '2026-01-05', factor: 2 }]);
    // Ex-dividend from 100 to 98 and a 1-into-2 split the same day: 49 is half of 98.
    const dividend = exDividendFactors([{ date: '2026-01-05', before_price: 100, after_price: 98 }]);
    assert.deepEqual(splitFactors([close('2026-01-02', 100), close('2026-01-05', 49)], dividend), [{ date: '2026-01-05', factor: 0.5 }]);
  });

  it('reads US closes with the adjusted close', () => {
    const prices = usPrices([{ date: '2026-10-20', stock_id: 'VT', Adj_Close: 157.8, Close: 157.8 }], 'VT');
    assert.deepEqual(prices, [{ ticker: 'VT', date: '2026-10-20', close: 157.8, adjClose: 157.8, source: 'finmind' }]);
  });

  it('takes the middle of the Bank of Taiwan spot rates, else of the cash rates', () => {
    const rates = bankOfTaiwanRates(
      [
        { date: '2026-10-21', currency: 'USD', cash_buy: 32.085, cash_sell: 32.755, spot_buy: 32.435, spot_sell: 32.535 },
        { date: '2026-10-22', currency: 'USD', cash_buy: 32, cash_sell: 33, spot_buy: 0, spot_sell: -1 },
      ],
      'USD',
    );
    assert.deepEqual(
      rates.map((r) => [r.pair, r.date, Number(r.rate.toFixed(4))]),
      [
        ['USD/TWD', '2026-10-21', 32.485],
        ['USD/TWD', '2026-10-22', 32.5],
      ],
    );
  });

  it("keeps each day's last gold price as its close, in USD per ounce", () => {
    const closes = goldCloses([
      { Price: 4131.63, date: '2026-10-20 00:00:00' },
      { Price: 4115.29, date: '2026-10-20 23:55:00' },
      { Price: 4120, date: '2026-10-20 12:00:00' },
      { Price: 4118.39, date: '2026-10-21 10:30:00' },
    ]);
    assert.deepEqual(
      closes.map((r) => [r.pair, r.date, r.rate]),
      [
        ['XAU/USD', '2026-10-20', 4115.29],
        ['XAU/USD', '2026-10-21', 4118.39],
      ],
    );
  });
});

describe('iShares', () => {
  it('reads the NAV the product page shows', () => {
    const html = '<div>USD Hedged (Acc)</div><span>NAV as of 20/Oct/2026</span> <span>NAV as of 20/Oct/2026</span> <span>USD 5.77</span> 52 WK: 5.71 - 5.8';
    assert.deepEqual(navFromProductPage(html, 'AGGU'), { ticker: 'AGGU', date: '2026-10-20', close: 5.77, adjClose: 5.77, source: 'ishares_nav' });
    assert.equal(navFromProductPage('<p>no price here</p>', 'AGGU'), undefined);
  });

  it('reads the full-precision NAV from the page data, and the text where the figure runs into the 52-week range (October 2026 page)', () => {
    const data =
      '<script>{&quot;navAmount&quot;:{&quot;name&quot;:&quot;navAmount&quot;,&quot;asOfDate&quot;:20261028,&quot;formattedAsOfDate&quot;:&quot;28/Oct/2026&quot;,' +
      '&quot;formattedValue&quot;:&quot;5.79&quot;,&quot;prefix&quot;:&quot;USD &quot;,&quot;value&quot;:5.786162,&quot;fullName&quot;:&quot;fundHeader.fundNav.navAmount&quot;}}</script>';
    assert.deepEqual(navFromProductPage(data, 'AGGU'), { ticker: 'AGGU', date: '2026-10-28', close: 5.786162, adjClose: 5.786162, source: 'ishares_nav' });
    const text = '<span>NAV as of 28/Oct/2026</span><span>NAV as of</span><span>28/Oct/2026</span><div>USD 835.69</div><span>52 WK: 681.22 - 843.55</span>';
    assert.deepEqual(navFromProductPage(text, 'CSPX'), { ticker: 'CSPX', date: '2026-10-28', close: 835.69, adjClose: 835.69, source: 'ishares_nav' });
  });

  it('prices the Irish swaps the estate-tax check suggests from iShares too', () => {
    assert.deepEqual(Object.keys(ISHARES_FUNDS).sort(), ['AGGU', 'CSPX', 'IB01', 'IGLN']);
    assert.ok(ISHARES_FUNDS['IB01']?.download.includes('portfolioId=307243'));
  });

  it('scales the NAVs before a consolidation, as IB01’s about 20 into 1 on 2021-07-26, and leaves a market move alone', () => {
    const price = (date: string, close: number) => ({ ticker: 'IB01', date, close, adjClose: close, source: 'ishares_nav' });
    const adjusted = adjustForSplits([price('2021-07-26', 102.11), price('2021-07-22', 5.14), price('2021-07-23', 5.15), price('2021-07-27', 102.12)]);
    assert.deepEqual(
      adjusted.map((p) => [p.date, p.close, p.adjClose]),
      [
        ['2021-07-22', 5.14, 5.14 * 20],
        ['2021-07-23', 5.15, 5.15 * 20],
        ['2021-07-26', 102.11, 102.11],
        ['2021-07-27', 102.12, 102.12],
      ],
    );
    const crash = adjustForSplits([price('2020-03-13', 270.44), price('2020-03-16', 238.04)]);
    assert.deepEqual(crash.map((p) => p.adjClose), [270.44, 238.04]);
    const split = adjustForSplits([price('2026-01-01', 100), price('2026-01-02', 25.2)]);
    assert.deepEqual(split.map((p) => p.adjClose), [25, 25.2]);
  });

  it('reads the NAV history from the fund download', () => {
    const xml = `<Workbook><ss:Worksheet ss:Name="Holdings"><ss:Table><ss:Row><ss:Cell><ss:Data ss:Type="String">x</ss:Data></ss:Cell></ss:Row></ss:Table></ss:Worksheet>
      <ss:Worksheet ss:Name="Historical NAVs"><ss:Table>
        <ss:Row><ss:Cell><ss:Data ss:Type="String">As Of</ss:Data></ss:Cell><ss:Cell><ss:Data ss:Type="String">NAV per Share</ss:Data></ss:Cell></ss:Row>
        <ss:Row><ss:Cell><ss:Data ss:Type="String">20/Oct/2026</ss:Data></ss:Cell><ss:Cell><ss:Data ss:Type="Number">5.77</ss:Data></ss:Cell></ss:Row>
        <ss:Row><ss:Cell><ss:Data ss:Type="String">19/Oct/2026</ss:Data></ss:Cell><ss:Cell><ss:Data ss:Type="Number">5.76</ss:Data></ss:Cell></ss:Row>
      </ss:Table></ss:Worksheet></Workbook>`;
    assert.deepEqual(
      navHistory(xml, 'AGGU').map((p) => [p.date, p.close]),
      [
        ['2026-10-19', 5.76],
        ['2026-10-20', 5.77],
      ],
    );
  });
});

describe('fallback feeds', () => {
  it('reads FRED values and skips holidays', () => {
    const csv = 'observation_date,DEXTAUS\n2026-10-15,32.2650\n2026-10-16,.\n2026-10-19,32.4450\n';
    assert.deepEqual(
      fredRates(csv, 'USD/TWD').map((r) => [r.date, r.rate, r.source]),
      [
        ['2026-10-15', 32.265, 'fred'],
        ['2026-10-19', 32.445, 'fred'],
      ],
    );
  });

  it('reads TWSE closes for the tickers asked for, with ROC dates', () => {
    assert.equal(rocDateToIso('1151020'), '2026-10-20');
    assert.equal(rocDateToIso('991231'), '2010-12-31');
    const json = JSON.stringify([
      { Date: '1151020', Code: '0050', ClosingPrice: '107.25' },
      { Date: '1151020', Code: '2330', ClosingPrice: '2405.00' },
      { Date: '1151020', Code: '9999', ClosingPrice: '' },
    ]);
    assert.deepEqual(
      twseCloses(json, new Set(['0050', '9999'])).map((p) => [p.ticker, p.date, p.close]),
      [['0050', '2026-10-20', 107.25]],
    );
  });

  it('reads Alpha Vantage series, maps London tickers, and reports a refusal', () => {
    assert.equal(avSymbol('AGGU', 'UK'), 'AGGU.LON');
    assert.equal(avSymbol('VT', 'US'), 'VT');
    assert.equal(avSymbol('0050', 'TW'), undefined);
    const daily = JSON.stringify({ 'Time Series (Daily)': { '2026-10-20': { '4. close': '157.80' } } });
    assert.deepEqual(avDaily(daily, 'VT')[0], { ticker: 'VT', date: '2026-10-20', close: 157.8, adjClose: null, source: 'alphavantage' });
    const weekly = JSON.stringify({ 'Weekly Adjusted Time Series': { '2026-10-17': { '4. close': '5.76', '5. adjusted close': '5.76' } } });
    assert.equal(avWeeklyAdjusted(weekly, 'AGGU')[0]?.adjClose, 5.76);
    const refused = JSON.stringify({ Information: 'Our standard API rate limit is 25 requests per day.' });
    assert.throws(() => avDaily(refused, 'VT'), /Alpha Vantage refused: Our standard API rate limit/);
  });
});

describe('makeGet', () => {
  let server: Server;
  let base = '';
  let calls = 0;
  before(async () => {
    server = createServer((req, res) => {
      calls += 1;
      if (req.url === '/flaky' && calls % 2 === 1) res.writeHead(503).end('busy');
      else if (req.url?.startsWith('/missing')) res.writeHead(404).end('not here, token=SECRET123');
      else res.writeHead(200).end(`hello ${req.headers['authorization'] ?? ''}`.trim());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const get = () => makeGet({ userAgent: 'test', timeoutMs: 2000, retryAfterMs: 1, redact: makeRedactor(['SECRET123']) });

  it('retries once after a 5xx reply', async () => {
    calls = 0;
    assert.equal(await get()(`${base}/flaky`, { Authorization: 'Bearer t' }), 'hello Bearer t');
    assert.equal(calls, 2);
  });

  it('reports other failures without the secret', async () => {
    await assert.rejects(get()(`${base}/missing?token=SECRET123`), (err: unknown) => {
      assert.ok(err instanceof FeedError);
      assert.match(err.message, /HTTP 404/);
      assert.doesNotMatch(err.message, /SECRET123/);
      return true;
    });
  });
});
