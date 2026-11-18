import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cboeHistory, cboeUrl, epuDaily, fredDaily, recentMonths, taifexVix, taifexVixUrl, volatilityAttempts } from './volatility.ts';

// Shaped like the replies of 2026-11-06.
const CBOE = 'DATE,OPEN,HIGH,LOW,CLOSE\n01/02/1990,17.240000,17.240000,17.240000,17.240000\n11/04/2026,19.200000,19.220000,16.570000,16.610000\n11/05/2026,17.140000,28.360000,16.700000,28.180000\n';
const TAIFEX = [
  '交易日期\t時間(時/分/秒/毫秒)\t臺指選擇權波動率指數\t收盤前1分鐘平均指數',
  '--------\t-------------------\t--------------------\t-------------------',
  '20261105\t13450000\t\t\t39.92\t\t39.93',
  '20261106\t13450000\t\t\t46.52\t\t46.62',
].join('\r\n');
const TAIFEX_404 = "<HTML><head><meta http-equiv='Content-Type' content='text/html; charset=big5' /></head><title>404</title></HTML>";
const EPU = 'day,month,year,daily_policy_index\n1,1,1985,103.83\n4,11,2026,279.21\n5,11,2026,168.20\n';
const FRED = 'observation_date,BAMLH0A0HYM2\n2026-11-04,3.12\n2026-11-05,.\n2026-11-06,3.48\n';

describe('volatility feeds (N8)', () => {
  it("reads CBOE's history from a start date, MM/DD/YYYY to ISO", () => {
    assert.equal(cboeUrl('VIX3M'), 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv');
    assert.deepEqual(cboeHistory(CBOE, 'VIX', '2026-01-01'), [
      { index: 'VIX', date: '2026-11-04', close: 16.61, source: 'cboe' },
      { index: 'VIX', date: '2026-11-05', close: 28.18, source: 'cboe' },
    ]);
  });

  it("reads TAIFEX's month file of Taiwan's VIX, and nothing from its 404 page", () => {
    assert.equal(taifexVixUrl('202611'), 'https://www.taifex.com.tw/file/taifex/Dailydownload/vix/log2data/202611new.txt');
    assert.deepEqual(taifexVix(TAIFEX), [
      { index: 'TWVIX', date: '2026-11-05', close: 39.92, source: 'taifex' },
      { index: 'TWVIX', date: '2026-11-06', close: 46.52, source: 'taifex' },
    ]);
    assert.deepEqual(taifexVix(TAIFEX_404), []);
  });

  it('names the last three months, across a year end', () => {
    assert.deepEqual(recentMonths('2026-11-06', 3), ['202609', '202610', '202611']);
    assert.deepEqual(recentMonths('2027-01-15', 3), ['202611', '202612', '202701']);
  });

  it('reads the daily policy-uncertainty index and a FRED daily series, holidays left out', () => {
    assert.deepEqual(epuDaily(EPU, '2026-01-01'), [
      { index: 'EPU', date: '2026-11-04', close: 279.21, source: 'policyuncertainty' },
      { index: 'EPU', date: '2026-11-05', close: 168.2, source: 'policyuncertainty' },
    ]);
    assert.deepEqual(fredDaily(FRED, 'HY_OAS', '2026-11-05'), [{ index: 'HY_OAS', date: '2026-11-06', close: 3.48, source: 'fred' }]);
  });

  it("falls back to FRED for the VIX; reads every TAIFEX month that answers", async () => {
    const asked: string[] = [];
    const get = async (url: string) => {
      asked.push(url);
      if (url.includes('cboe')) throw new Error('HTTP 503');
      if (url.includes('VIXCLS')) return 'observation_date,VIXCLS\n2026-11-05,28.18\n';
      if (url.endsWith('202611new.txt')) return TAIFEX;
      return TAIFEX_404;
    };
    const vix = volatilityAttempts('VIX', get, '2026-01-01', '2026-11-06');
    assert.deepEqual(vix.map((attempt) => attempt.source), ['cboe', 'fred']);
    await assert.rejects(vix[0]!.load());
    assert.deepEqual(await vix[1]!.load(), [{ index: 'VIX', date: '2026-11-05', close: 28.18, source: 'fred' }]);
    const tw = volatilityAttempts('TWVIX', get, '2026-01-01', '2026-11-06');
    assert.equal((await tw[0]!.load()).length, 2);
    assert.equal(asked.filter((url) => url.includes('taifex')).length, 3);
    assert.deepEqual(volatilityAttempts('HY_OAS', get, '2026-01-01', '2026-11-06').map((attempt) => attempt.source), ['fred']);
    assert.deepEqual(volatilityAttempts('NONE', get, '2026-01-01', '2026-11-06'), []);
  });
});
