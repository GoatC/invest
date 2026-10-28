import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fredMonthly } from './fred.ts';
import { avSectorFund, finmindIndustryIndex, finmindSectorFund, finmindSpx, finmindTaiex, fredSpx, twseIndustryIndex, twseTaiex } from './indices.ts';

describe('index closes (N1)', () => {
  it("reads FinMind's ^GSPC and TAIEX total return rows", () => {
    assert.deepEqual(finmindSpx([{ date: '2026-10-27', Close: 7722.6 }, { date: 'bad', Close: 1 }]), [{ index: 'SPX', date: '2026-10-27', close: 7722.6, source: 'finmind' }]);
    assert.deepEqual(finmindTaiex([{ date: '2026-10-27', price: 106591.78 }, { date: '2026-10-28', price: 0 }]), [{ index: 'TAIEX', date: '2026-10-27', close: 106591.78, source: 'finmind' }]);
  });

  it("reads FRED's SP500, leaving out holidays", () => {
    assert.deepEqual(fredSpx('observation_date,SP500\n2026-10-26,7676.77\n2026-10-27,.\n'), [{ index: 'SPX', date: '2026-10-26', close: 7676.77, source: 'fred' }]);
  });

  it("finds the total return index in TWSE's daily report, by its Chinese name and ROC date", () => {
    const json = JSON.stringify([
      { 日期: '1151027', 指數: '發行量加權股價指數', 收盤指數: '46096.23' },
      { 日期: '1151027', 指數: '發行量加權股價報酬指數', 收盤指數: '106,591.78' },
    ]);
    assert.deepEqual(twseTaiex(json), [{ index: 'TAIEX', date: '2026-10-27', close: 106591.78, source: 'twse' }]);
    assert.throws(() => twseTaiex('<html>'), /not JSON/);
  });
});

describe('FRED monthly rates', () => {
  it('reads TB3MS in percent a year as a fraction per month', () => {
    assert.deepEqual(fredMonthly('observation_date,TB3MS\n2026-09-01,3.94\n2026-10-01,.\n', 'us_tbill_3m'), [{ series: 'us_tbill_3m', month: '2026-09', value: 0.0394, source: 'fred' }]);
  });
});

describe('sector proxies (N7)', () => {
  it("read a Select Sector SPDR fund's adjusted closes, a TWSE industry index's closes, and the index on TWSE's last trading day", () => {
    assert.deepEqual(finmindSectorFund([{ date: '2026-10-27', Close: 250.5, Adj_Close: 249.8 }, { date: '2026-10-28', Close: 251 }], 'XLK'), [
      { index: 'XLK', date: '2026-10-27', close: 249.8, source: 'finmind' },
      { index: 'XLK', date: '2026-10-28', close: 251, source: 'finmind' },
    ]);
    assert.deepEqual(finmindIndustryIndex([{ date: '2026-10-27', stock_id: 'Semiconductor', close: 1564.79 }], 'TW_SEMICONDUCTOR'), [{ index: 'TW_SEMICONDUCTOR', date: '2026-10-27', close: 1564.79, source: 'finmind' }]);
    const reply = JSON.stringify([
      { 日期: '1151028', 指數: '半導體類指數', 收盤指數: '1,564.79' },
      { 日期: '1151028', 指數: '金融保險類指數', 收盤指數: '3749.31' },
    ]);
    assert.deepEqual(twseIndustryIndex(reply, 'TW_SEMICONDUCTOR', '半導體類指數'), [{ index: 'TW_SEMICONDUCTOR', date: '2026-10-28', close: 1564.79, source: 'twse' }]);
  });

  it("fall back on Alpha Vantage's weekly adjusted closes of a fund, from the span's start", () => {
    const reply = JSON.stringify({ 'Weekly Adjusted Time Series': {
      '2026-10-23': { '4. close': '251.00', '5. adjusted close': '250.40' },
      '2025-09-19': { '4. close': '200.00', '5. adjusted close': '198.00' },
    } });
    assert.deepEqual(avSectorFund(reply, 'XLK', '2025-09-23'), [{ index: 'XLK', date: '2026-10-23', close: 250.4, source: 'alphavantage' }]);
  });
});
