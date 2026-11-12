import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { guideBanners, hiddenOn, readBannerSettings, type BannerInput } from './banners';
import type { DividendDue } from './dividends';

const SETTINGS = readBannerSettings({ enabled: true, snooze_days: 7, balance_stale_days: 45, kinds: {} });
if (!SETTINGS) throw new Error('settings');

const quiet: BannerInput = {
  dividends: [],
  proposals: [],
  windfall: { arrivedTwd: 0, lastArrival: null, cashTwd: 0, traded: false, hasPlan: false },
  balances: [],
  trades: 8,
  assets: 2,
  devices: 1,
  dismissed: new Map(),
};

const due = (id: number, ticker = 'VT'): DividendDue => ({
  event: { id, ticker, exDate: '2026-09-18', payDate: '2026-09-22', amount: 0.4084, currency: 'USD', source: 'alphavantage', skippedPools: [] },
  security: { ticker, name: ticker, market: 'US', domicile: 'US', currency: 'USD', reinvested: false },
  pool: 'regular',
  qty: 2,
  askOn: '2026-09-22',
  estimatedDate: false,
  withholding: 0.3,
  grossLocal: 0.8168,
  netLocal: 0.57,
  netTwd: 18.24,
});

const kinds = (input: BannerInput, today = '2026-11-12') => guideBanners(input, SETTINGS, today).map((banner) => banner.kind);

describe('banner settings', () => {
  it('reads config banners: every kind on unless turned off; malformed is refused', () => {
    assert.equal(SETTINGS.kinds.dividend, true);
    assert.equal(readBannerSettings({ snooze_days: 7, balance_stale_days: 45, kinds: { push: false } })?.kinds.push, false);
    assert.equal(readBannerSettings({ snooze_days: 0, balance_stale_days: 45 }), undefined);
    assert.equal(readBannerSettings(undefined), undefined);
  });
});

describe('when a banner is needed', () => {
  it('shows nothing when nothing waits', () => {
    assert.deepEqual(kinds(quiet), []);
  });

  it('asks about one dividend by name, with its form and a skip; several as a count', () => {
    const [one] = guideBanners({ ...quiet, dividends: [due(5)] }, SETTINGS, '2026-11-12');
    assert.deepEqual([one?.key, one?.text.zh, one?.action.href, one?.skip], ['dividend:5:regular', 'VT 配息約 NT$18，要記一筆嗎？', '/cash-flows/new?dividend=5&pool=regular', { eventId: 5, pool: 'regular' }]);
    const [many] = guideBanners({ ...quiet, dividends: [due(5), due(6, 'BNDW')] }, SETTINGS, '2026-11-12');
    assert.deepEqual([many?.text.zh, many?.action.href, many?.skip], ['2 筆配息待確認。', '/holdings#dividends-due', undefined]);
  });

  it('counts the standing warnings and leads to the one, or to all', () => {
    const [one] = guideBanners({ ...quiet, proposals: [{ id: 12 }] }, SETTINGS, '2026-11-12');
    assert.deepEqual([one?.text.zh, one?.action.href, one?.key], ['1 則規則警示。', '/#proposal-12', 'proposals:open:12']);
    const [many] = guideBanners({ ...quiet, proposals: [{ id: 13 }, { id: 14 }] }, SETTINGS, '2026-11-12');
    assert.deepEqual([many?.text.zh, many?.action.href, many?.key], ['2 則規則警示。', '/#proposals', 'proposals:open:14']);
  });

  it('leads the windfall step by step: its balance first, then its plan, then nothing', () => {
    const arrived = { arrivedTwd: 5_500_000, lastArrival: '2026-11-01', cashTwd: 0, traded: false, hasPlan: false };
    assert.deepEqual(kinds({ ...quiet, windfall: arrived }), ['windfall_balance']);
    assert.deepEqual(kinds({ ...quiet, windfall: { ...arrived, cashTwd: 5_500_000 } }), ['windfall_plan']);
    assert.deepEqual(kinds({ ...quiet, windfall: { ...arrived, cashTwd: 5_500_000, hasPlan: true } }), []);
    // Fully deployed: no cash left to plan, nothing to add.
    assert.deepEqual(kinds({ ...quiet, windfall: { ...arrived, traded: true, hasPlan: false } }), []);
  });

  it('asks about the TWD balance left longest, past balance_stale_days only', () => {
    const balances = [{ id: 2, name: '高利活存', valuedOn: '2026-09-28' }, { id: 3, name: '定存', valuedOn: '2026-08-01' }, { id: 4, name: '新帳戶', valuedOn: null }];
    // 2026-09-28 is 45 days before 2026-11-12: not past it yet.
    assert.deepEqual(kinds({ ...quiet, balances: balances.slice(0, 1) }), []);
    const [stale] = guideBanners({ ...quiet, balances }, SETTINGS, '2026-11-12');
    assert.deepEqual([stale?.kind, stale?.text.zh, stale?.action.href], ['stale_balance', '定存：餘額已 103 天未更新。', '/assets/3']);
  });

  it('starts an empty app at the first buy, and asks for push only once something is held', () => {
    assert.deepEqual(kinds({ ...quiet, trades: 0, assets: 0, devices: 0 }), ['first_trade']);
    assert.deepEqual(kinds({ ...quiet, devices: 0 }), ['push']);
    assert.deepEqual(kinds({ ...quiet, devices: null }), []);
  });

  it('orders by urgency, hides a dismissed one until its day, and follows the settings', () => {
    const busy: BannerInput = { ...quiet, dividends: [due(5)], proposals: [{ id: 13 }], devices: 0 };
    assert.deepEqual(kinds(busy), ['dividend', 'proposals', 'push']);
    assert.deepEqual(kinds({ ...busy, dismissed: new Map([['dividend:5:regular', '2026-11-19']]) }), ['proposals', 'push']);
    assert.deepEqual(kinds({ ...busy, dismissed: new Map([['dividend:5:regular', '2026-11-19']]) }, '2026-11-19'), ['dividend', 'proposals', 'push']);
    // Another dividend is another key: it shows at once.
    assert.deepEqual(kinds({ ...busy, dividends: [due(6)], dismissed: new Map([['dividend:5:regular', '2026-11-19']]) }), ['dividend', 'proposals', 'push']);
    assert.deepEqual(guideBanners(busy, { ...SETTINGS, kinds: { ...SETTINGS.kinds, push: false } }, '2026-11-12').map((banner) => banner.kind), ['dividend', 'proposals']);
    assert.deepEqual(guideBanners(busy, { ...SETTINGS, enabled: false }, '2026-11-12'), []);
  });

  it('stays off the page it leads to', () => {
    assert.equal(hiddenOn({ hideOn: ['/', '/holdings'] }, '/'), true);
    assert.equal(hiddenOn({ hideOn: ['/', '/holdings'] }, '/holdings/chart/VT'), true);
    assert.equal(hiddenOn({ hideOn: ['/', '/holdings'] }, '/performance'), false);
    assert.equal(hiddenOn({ hideOn: ['/cash-flows'] }, '/cash-flows/new'), true);
  });
});
