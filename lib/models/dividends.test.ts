import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { askDate, dividendMessage, dividendPushes, dividendsDue, entitledShares, readDividendSettings, recordHref, type DividendEvent, type DividendInput, type DividendSecurity } from './dividends';
import { trade } from './test-helpers';
import type { CashFlow } from './types';

const SETTINGS = readDividendSettings({ lookback_days: 60, match_days: 30, pay_lag_days: { US: 7, TW: 30 }, withholding: { US: 0.3 }, push: true, push_days: 3 });
if (!SETTINGS) throw new Error('settings');

const SECURITIES: DividendSecurity[] = [
  { ticker: 'VT', name: 'Vanguard Total World Stock ETF', market: 'US', domicile: 'US', currency: 'USD', reinvested: false },
  { ticker: '0050', name: '元大台灣50', market: 'TW', domicile: 'TW', currency: 'TWD', reinvested: false },
  { ticker: 'AGGU', name: 'iShares Core Global Aggregate Bond UCITS ETF', market: 'UK', domicile: 'IE', currency: 'USD', reinvested: true },
];

const event = (overrides: Partial<DividendEvent>): DividendEvent => ({ id: 1, ticker: '0050', exDate: '2026-07-21', payDate: '2026-08-10', amount: 0.6, currency: 'TWD', source: 'finmind', skippedPools: [], ...overrides });
const dividend = (overrides: Partial<CashFlow>): CashFlow => ({ flowDate: '2026-08-10', type: 'dividend', amount: 60, currency: 'TWD', fxRate: 1, pool: 'regular', ticker: '0050', note: null, ...overrides });
const tw = (overrides = {}) => trade({ ticker: '0050', tradeDate: '2026-06-08', qty: 100, price: 99, currency: 'TWD', fxRate: 1, ...overrides });
const input = (overrides: Partial<DividendInput>): DividendInput => ({ events: [event({})], trades: [tw()], securities: SECURITIES, flows: [], fx: new Map([['USD', 32]]), ...overrides });

describe('dividend settings', () => {
  it('reads config dividends and refuses a malformed one', () => {
    assert.deepEqual(SETTINGS, { lookbackDays: 60, matchDays: 30, payLagDays: { US: 7, TW: 30 }, withholding: { US: 0.3 }, push: true, pushDays: 3 });
    assert.equal(readDividendSettings({ lookback_days: -1, match_days: 30 }), undefined);
    assert.equal(readDividendSettings(null), undefined);
  });
});

describe('entitled shares', () => {
  it('counts the long shares held before the ex-dividend date, one pool at a time', () => {
    const trades = [tw(), tw({ tradeDate: '2026-07-21', qty: 50 }), tw({ tradeDate: '2026-07-01', side: 'sell', qty: 30 }), tw({ tradeDate: '2026-07-02', pool: 'windfall', qty: 7 })];
    // 100 bought − 30 sold; the 50 bought on the ex-date come without the dividend.
    assert.equal(entitledShares(trades, undefined, '0050', 'regular', '2026-07-21'), 70);
    assert.equal(entitledShares(trades, undefined, '0050', 'windfall', '2026-07-21'), 7);
    assert.equal(entitledShares(trades, undefined, 'VT', 'regular', '2026-07-21'), 0);
  });

  it('reads the shares in the units of that day: a split before it counts, one after it does not', () => {
    const trades = [tw({ tradeDate: '2026-01-05', qty: 10 })];
    assert.equal(entitledShares(trades, [{ ticker: '0050', exDate: '2026-06-18', ratio: 4 }], '0050', 'regular', '2026-07-21'), 40);
    assert.equal(entitledShares(trades, [{ ticker: '0050', exDate: '2026-09-01', ratio: 4 }], '0050', 'regular', '2026-07-21'), 10);
  });

  it('leaves a short out: it owes the dividend, it does not receive it', () => {
    assert.equal(entitledShares([tw({ side: 'sell', direction: 'short', qty: 5 })], undefined, '0050', 'regular', '2026-07-21'), 0);
  });
});

describe('dividends to ask about', () => {
  it('asks from the payment date, with the amount worked out (PRD Section 11)', () => {
    // 100 shares of 0050 held before 2026-07-21, NT$0.60 a share, paid 2026-08-10: NT$60.
    assert.deepEqual(dividendsDue(input({}), SETTINGS, '2026-08-09').due, []);
    assert.equal(dividendsDue(input({}), SETTINGS, '2026-08-09').upcoming.length, 1);
    const [due] = dividendsDue(input({}), SETTINGS, '2026-08-10').due;
    assert.deepEqual([due?.qty, due?.askOn, due?.estimatedDate, due?.grossLocal, due?.netLocal, due?.netTwd], [100, '2026-08-10', false, 60, 60, 60]);
    assert.equal(recordHref(due as NonNullable<typeof due>), '/cash-flows/new?dividend=1&pool=regular');
  });

  it('takes the withholding off a US fund’s dividend and converts at the newest rate', () => {
    // 2 VT × US$0.4084 = US$0.8168; 30% withheld leaves US$0.57, NT$18.24 at 32.
    const vt = event({ id: 2, ticker: 'VT', exDate: '2026-09-18', payDate: '2026-09-22', amount: 0.4084, currency: 'USD', source: 'alphavantage' });
    const [due] = dividendsDue(input({ events: [vt], trades: [trade({ tradeDate: '2026-05-07', qty: 2 })] }), SETTINGS, '2026-09-22').due;
    assert.equal(due?.withholding, 0.3);
    assert.equal(due?.netLocal, 0.57);
    assert.ok(Math.abs((due?.netTwd ?? 0) - 18.24) < 1e-9);
  });

  it('estimates the asking day from the ex-dividend date when the feed gives no payment date', () => {
    const vt = event({ id: 2, ticker: 'VT', exDate: '2026-09-18', payDate: null, amount: 0.41, currency: 'USD', source: 'adjusted_close' });
    assert.equal(askDate(vt, 'US', SETTINGS), '2026-09-25');
    const data = input({ events: [vt], trades: [trade({ tradeDate: '2026-05-07', qty: 2 })] });
    assert.equal(dividendsDue(data, SETTINGS, '2026-09-24').due.length, 0);
    assert.equal(dividendsDue(data, SETTINGS, '2026-09-25').due[0]?.estimatedDate, true);
  });

  it('does not ask without shares before the ex-date, about a reinvesting fund, or past the lookback', () => {
    assert.deepEqual(dividendsDue(input({ trades: [tw({ tradeDate: '2026-07-21' })] }), SETTINGS, '2026-08-10').due, []);
    const acc = event({ id: 3, ticker: 'AGGU', currency: 'USD' });
    assert.deepEqual(dividendsDue(input({ events: [acc], trades: [trade({ ticker: 'AGGU', tradeDate: '2026-06-01' })] }), SETTINGS, '2026-08-10').due, []);
    // Asked from 08-10 for 60 days: still on 10-09, no longer on 10-10.
    assert.equal(dividendsDue(input({}), SETTINGS, '2026-10-09').due.length, 1);
    assert.equal(dividendsDue(input({}), SETTINGS, '2026-10-10').due.length, 0);
  });

  it('is answered by a dividend cash flow of the same security and pool within the window, or by skip', () => {
    assert.deepEqual(dividendsDue(input({ flows: [dividend({})] }), SETTINGS, '2026-08-12').due, []);
    // Recorded on the ex-date already (a broker that books early), or up to 30 days after the payment.
    assert.deepEqual(dividendsDue(input({ flows: [dividend({ flowDate: '2026-07-21' })] }), SETTINGS, '2026-08-12').due, []);
    assert.deepEqual(dividendsDue(input({ flows: [dividend({ flowDate: '2026-09-09' })] }), SETTINGS, '2026-09-10').due, []);
    assert.equal(dividendsDue(input({ flows: [dividend({ flowDate: '2026-09-10' })] }), SETTINGS, '2026-09-10').due.length, 1);
    // Another pool's or another security's dividend answers nothing.
    assert.equal(dividendsDue(input({ flows: [dividend({ pool: 'windfall' })] }), SETTINGS, '2026-08-12').due.length, 1);
    assert.equal(dividendsDue(input({ flows: [dividend({ ticker: 'VT' })] }), SETTINGS, '2026-08-12').due.length, 1);
    assert.deepEqual(dividendsDue(input({ events: [event({ skippedPools: ['regular'] })] }), SETTINGS, '2026-08-12').due, []);
  });

  it('asks once per pool that held the security, and one flow answers one dividend', () => {
    const both = input({ trades: [tw(), tw({ pool: 'windfall', qty: 40 })] });
    assert.deepEqual(dividendsDue(both, SETTINGS, '2026-08-10').due.map((line) => [line.pool, line.netLocal]), [['regular', 60], ['windfall', 24]]);
    // A monthly payer: two dividends, one recorded after the second ex-date answers the second.
    const monthly = input({
      events: [event({ id: 1, exDate: '2026-07-01', payDate: '2026-07-06' }), event({ id: 2, exDate: '2026-08-03', payDate: '2026-08-06' })],
      flows: [dividend({ flowDate: '2026-08-07' })],
    });
    assert.deepEqual(dividendsDue(monthly, SETTINGS, '2026-08-10').due.map((line) => line.event.id), [1]);
  });

  it('pushes a title and one line in Chinese, once, only for the days just past', () => {
    const [due] = dividendsDue(input({}), SETTINGS, '2026-08-10').due;
    assert.deepEqual(dividendMessage(due as NonNullable<typeof due>), { kind: 'dividend', key: '1:regular', title: '0050 配息', body: '2026-08-10 發放，約 NT$60：要記一筆股利嗎？', url: '/cash-flows/new?dividend=1&pool=regular' });
    const due13 = dividendsDue(input({}), SETTINGS, '2026-08-13').due;
    assert.equal(dividendPushes(due13, SETTINGS, '2026-08-13', new Set()).length, 1);
    assert.equal(dividendPushes(due13, SETTINGS, '2026-08-13', new Set(['1:regular'])).length, 0);
    assert.equal(dividendPushes(dividendsDue(input({}), SETTINGS, '2026-08-14').due, SETTINGS, '2026-08-14', new Set()).length, 0);
    assert.equal(dividendPushes(due13, { ...SETTINGS, push: false }, '2026-08-13', new Set()).length, 0);
  });
});
