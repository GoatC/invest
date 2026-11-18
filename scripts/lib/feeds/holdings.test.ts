import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as XLSX from 'xlsx';

import { fubonHoldings, sectorFundUrl, sectorMembers, vanguardPage, vanguardUrl, vanguardWeights, withSectors } from './holdings.ts';

describe('Vanguard holdings', () => {
  it("reads each line's ticker, ISIN and weight, keyed by the ISIN's country, with the fund's size and date", () => {
    const reply = JSON.stringify({
      size: 10170,
      asOfDate: '2026-09-30T00:00:00-04:00',
      fund: {
        entity: [
          { longName: 'NVIDIA Corp.', ticker: 'NVDA', isin: 'US67066G1040', percentWeight: '4.52' },
          { longName: 'Taiwan Semiconductor Manufacturing Co. Ltd.', ticker: '2330', isin: 'TW0002330008', percentWeight: '1.62' },
          { longName: 'Toyota Motor Corp.', ticker: '7203', isin: 'JP3633400001', percentWeight: '0.30' },
          { longName: 'Futures', ticker: '', isin: '', percentWeight: '0' },
        ],
      },
    });
    const page = vanguardPage(reply);
    assert.equal(page.size, 10170);
    assert.equal(page.asOf, '2026-09-30');
    assert.deepEqual(
      page.constituents.map((row) => [row.key, row.country, row.currency, row.weight]),
      [
        ['US:NVDA', 'US', 'USD', 0.0452],
        ['TW:2330', 'TW', 'TWD', 0.0162],
        ['JP:7203', 'JP', 'JPY', 0.003],
      ],
    );
    assert.equal(page.lines, 4);
    assert.equal(vanguardUrl('VT', 501), 'https://investor.vanguard.com/vmf/api/VT/portfolio-holding/stock.json?start=501&count=500');
    assert.throws(() => vanguardPage('{}'), /no holdings/);
  });
});

describe('Vanguard weights', () => {
  it('weights each line by market value within the stocks\' share the large lines give, so the tail Vanguard shows as 0.00% keeps its weight', () => {
    const page = vanguardPage(JSON.stringify({ size: 3, fund: { entity: [
      { longName: 'Big', ticker: 'BIG', isin: 'US0000000001', percentWeight: '59.40', marketValue: 600 },
      { longName: 'Mid', ticker: 'MID', isin: 'US0000000002', percentWeight: '39.60', marketValue: 400 },
      { longName: 'Tail', ticker: 'TAIL', isin: 'US0000000003', percentWeight: '0.00', marketValue: 0.5 },
    ] } }));
    const weights = vanguardWeights(page.constituents);
    assert.deepEqual(weights.map((row) => row.key), ['US:BIG', 'US:MID', 'US:TAIL']);
    const total = weights.reduce((sum, row) => sum + row.weight, 0);
    assert.ok(Math.abs(total - 0.99) < 1e-3, `the stocks keep about the 99% the large lines give, got ${total}`);
    assert.ok((weights[2]?.weight ?? 0) > 0, 'the tail keeps a weight');
    assert.ok(!('marketValue' in (weights[0] ?? {})), 'the market value is not saved');
  });
});

describe('Fubon holdings', () => {
  it("reads a Taiwan ETF's stocks and the page's date", () => {
    const html = `<div>資料日期：2026/10/28</div><table>
      <tr><th>代號</th><th>名稱</th><th>股數</th><th>金額</th><th>權重(%)</th></tr>
      <tr><td>2330</td><td>台積電</td><td>12,531,100</td><td>30,387,917,500</td><td>52.5483</td></tr>
      <tr><td>2317</td><td>鴻海</td><td>1,000</td><td>200,000</td><td>4.1</td></tr>
      <tr><td>現金</td><td>&nbsp;</td><td></td><td>1,000</td><td>0.5</td></tr>
    </table>`;
    const result = fubonHoldings(html);
    assert.equal(result.asOf, '2026-10-28');
    assert.deepEqual(result.constituents.map((row) => [row.key, row.name, row.weight]), [['TW:2330', '台積電', 0.525483], ['TW:2317', '鴻海', 0.041]]);
    assert.throws(() => fubonHoldings('<html></html>'), /no stock rows/);
  });
});

describe('Select Sector SPDR holdings', () => {
  it("lists a sector fund's tickers from below its header", () => {
    const book = XLSX.utils.book_new();
    const rows = [['Fund Name:', 'Technology Select Sector SPDR'], ['Holdings:', 'As of 27-Oct-2026'], [], ['Name', 'Ticker', 'Identifier', 'Weight'], ['NVIDIA CORP', 'NVDA', '67066G104', 15.2], ['APPLE INC', 'AAPL', '037833100', 14.6], ['US DOLLAR', '-', '', 0.1]];
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'holdings');
    const bytes = new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
    assert.deepEqual(sectorMembers(bytes), ['NVDA', 'AAPL']);
    assert.equal(sectorFundUrl('XLK'), 'https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-xlk.xlsx');
  });

  it('gives US lines their sector fund\'s sector and Taiwan lines their industry\'s', () => {
    const page = vanguardPage(JSON.stringify({ fund: { entity: [
      { longName: 'NVIDIA', ticker: 'NVDA', isin: 'US67066G1040', percentWeight: '4' },
      { longName: 'TSMC', ticker: '2330', isin: 'TW0002330008', percentWeight: '1' },
      { longName: 'Toyota', ticker: '7203', isin: 'JP3633400001', percentWeight: '1' },
    ] } }));
    const sectors = withSectors(page.constituents, new Map([['NVDA', 'Information Technology']]), new Map([['2330', '24']]), { '24': 'Information Technology' });
    assert.deepEqual(sectors.map((row) => row.sector), ['Information Technology', 'Information Technology', null]);
  });
});
