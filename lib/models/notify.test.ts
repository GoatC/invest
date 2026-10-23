import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ASSET_CLASSES } from './test-helpers';
import {
  comingWeek,
  dataFailureMessage,
  instantOf,
  lastWeeklyReview,
  localTime,
  plan,
  proposalMessage,
  quietUntil,
  readQuietHours,
  readWeeklyReview,
  summaryLines,
  weeklyMessage,
  weeklySummary,
  type PlanInput,
  type ProposalForPush,
  type WeeklySummary,
} from './notify';

const QUIET = readQuietHours({ start: '23:00', end: '08:00', time_zone: 'Asia/Taipei' });
const SUNDAY_8PM = readWeeklyReview({ day: 'sunday', time: '20:00', time_zone: 'Asia/Taipei' });
/** An instant given in Taipei time (UTC+8). */
const taipei = (local: string) => new Date(`${local}+08:00`);

describe('time in Taipei', () => {
  it('reads the local date, minute and weekday, and turns them back into an instant', () => {
    // 2026-10-25 is a Sunday; 15:30 UTC is 23:30 in Taipei.
    assert.deepEqual(localTime(new Date('2026-10-25T15:30:00Z'), 'Asia/Taipei'), { date: '2026-10-25', minutes: 23 * 60 + 30, weekday: 0 });
    assert.equal(instantOf('2026-10-26', 8 * 60, 'Asia/Taipei').toISOString(), '2026-10-26T00:00:00.000Z');
  });
});

describe('quiet hours', () => {
  it('reads the setting and refuses a malformed one', () => {
    assert.deepEqual(QUIET, { start: 23 * 60, end: 8 * 60, timeZone: 'Asia/Taipei' });
    assert.equal(readQuietHours({ start: '25:00', end: '08:00' }), null);
    assert.equal(readQuietHours(null), null);
  });

  it('hold a push from 23:00 to 08:00 Taipei time, across midnight', () => {
    assert.equal(quietUntil(taipei('2026-10-25T23:30'), QUIET)?.toISOString(), taipei('2026-10-26T08:00').toISOString());
    assert.equal(quietUntil(taipei('2026-10-26T07:59'), QUIET)?.toISOString(), taipei('2026-10-26T08:00').toISOString());
    assert.equal(quietUntil(taipei('2026-10-26T08:00'), QUIET), null);
    assert.equal(quietUntil(taipei('2026-10-25T22:30'), QUIET), null);
    assert.equal(quietUntil(taipei('2026-10-25T23:30'), null), null);
  });

  it('also work as a window within one day', () => {
    const lunch = readQuietHours({ start: '12:00', end: '13:30', time_zone: 'Asia/Taipei' });
    assert.equal(quietUntil(taipei('2026-10-25T12:15'), lunch)?.toISOString(), taipei('2026-10-25T13:30').toISOString());
    assert.equal(quietUntil(taipei('2026-10-25T13:30'), lunch), null);
  });
});

describe('the weekly review time', () => {
  it('finds the latest Sunday 20:00 at or before now', () => {
    assert.ok(SUNDAY_8PM);
    assert.equal(lastWeeklyReview(taipei('2026-10-25T20:05'), SUNDAY_8PM).key, '2026-10-25');
    assert.equal(lastWeeklyReview(taipei('2026-10-25T19:59'), SUNDAY_8PM).key, '2026-10-18');
    const wednesday = lastWeeklyReview(taipei('2026-10-28T09:00'), SUNDAY_8PM);
    assert.equal(wednesday.key, '2026-10-25');
    assert.equal(wednesday.at.toISOString(), taipei('2026-10-25T20:00').toISOString());
    assert.equal(readWeeklyReview({ day: 'someday', time: '20:00' }), null);
  });
});

const SUMMARY: WeeklySummary = {
  openProposals: 2,
  approvedProposals: 1,
  largestDrift: { name: { en: 'Global bonds', zh: '全球債券' }, drift: -0.129 },
  valueTwd: 101_000,
  weekAgoTwd: 100_000,
};

describe('messages', () => {
  it('sums the week up in three lines: rules, allocation, value', () => {
    assert.deepEqual(summaryLines(SUMMARY), [
      { en: 'Rules: 3 proposals waiting (1 approved, to trade).', zh: '規則：3 份提案待處理（其中 1 份已核准、待下單）。' },
      { en: 'Allocation: largest drift Global bonds −12.9 pp.', zh: '配置：最大偏離為全球債券 −12.9 pp。' },
      { en: 'Value: NT$101,000, +NT$1,000 (+1.0%) this week.', zh: '市值：NT$101,000，本週 +NT$1,000（+1.0%）。' },
    ]);
    const quiet = summaryLines({ openProposals: 0, approvedProposals: 0, largestDrift: null, valueTwd: null, weekAgoTwd: null });
    assert.deepEqual(
      quiet.map((line) => line.en),
      ['Rules: all on track.', 'Allocation: nothing held yet.', 'Value: no NAV snapshot yet.'],
    );
    const message = weeklyMessage(SUMMARY, '2026-10-25');
    assert.deepEqual([message.kind, message.key, message.title, message.url], ['weekly', '2026-10-25', 'Weekly review 每週檢視', '/']);
    assert.equal(message.body.split('\n').length, 3);
  });

  it('names the rule that fired and what it proposes, and opens the proposal', () => {
    const r1: ProposalForPush = {
      id: 7,
      ruleId: 'R1',
      condition: 'single_stock_weight_above',
      title: { en: 'R1 · Single-stock trim', zh: 'R1 · 單一個股減碼' },
      state: '2330,NVDA',
      detail: { poolTwd: 97_501, limit: 0.05, cashTwd: 0, leftTwd: 0 },
    };
    assert.deepEqual(proposalMessage(r1, new Map()), {
      kind: 'proposal',
      key: '7',
      title: 'R1 · Single-stock trim 單一個股減碼',
      body: 'Trim 2330, NVDA back to the 5% cap.\n2330, NVDA 減碼回 5% 上限。',
      url: '/proposals#proposal-7',
    });
    const drift = proposalMessage(
      { ...r1, id: 8, ruleId: 'F8_DRIFT', condition: 'class_drift_exceeds', title: { en: 'F8_DRIFT · Drift rebalance', zh: 'F8_DRIFT · 偏離再平衡' }, detail: { poolTwd: 1, cashTwd: 0, leftTwd: 0, classes: [{ id: 'global_bonds', weight: 0.091, target: 0.22, band: 0.05 }] } },
      new Map([['global_bonds', { en: 'Global bonds', zh: '全球債券' }]]),
    );
    assert.equal(drift.body, 'Rebalance: Global bonds −12.9 pp.\n再平衡：全球債券 −12.9 pp。');
    const estate = proposalMessage(
      { ...r1, id: 9, ruleId: 'US_ESTATE_TAX', condition: 'us_situs_value_above', title: { en: 'US_ESTATE_TAX · US estate tax', zh: 'US_ESTATE_TAX · 美國遺產稅' }, state: 'over', detail: { poolTwd: 1, cashTwd: 0, leftTwd: 0, situsUsd: 61_000, limitUsd: 60_000 } },
      new Map(),
    );
    assert.equal(estate.title, 'US_ESTATE_TAX · US estate tax 美國遺產稅');
    const tranche = proposalMessage({ ...r1, id: 10, ruleId: 'WINDFALL_TRANCHE_DUE', condition: 'tranche_due', title: { en: 'WINDFALL_TRANCHE_DUE · Windfall tranche', zh: 'WINDFALL_TRANCHE_DUE · 大額資金分批' }, state: 'tranche:1', detail: { poolTwd: 1, cashTwd: 229_167, leftTwd: 0, dueDate: '2026-11-02' } }, new Map());
    assert.equal(tranche.body, 'Deploy NT$229,167 of the windfall: the tranche due 2026-11-02.\n投入大額資金 NT$229,167：2026-11-02 到期的分批。');
    assert.equal(estate.body, 'US assets 61,000 USD, above the 60,000 USD exemption: consider Irish-domiciled ETFs.\n美國資產 61,000 USD，超過 60,000 USD 免稅額：可考慮愛爾蘭註冊 ETF。');
  });

  it('alerts once per streak of missed nights, keyed by the last good run', () => {
    assert.equal(dataFailureMessage({ latest: undefined, misses: 1, alert: false }, 4), undefined);
    const alert = dataFailureMessage({ latest: undefined, misses: 2, alert: true }, 41);
    assert.deepEqual([alert?.key, alert?.url], ['after-run-41', '/data']);
    assert.ok(alert?.body.includes('missed 2 nights in a row'));
  });
});

describe('plan', () => {
  const base: PlanInput = {
    now: taipei('2026-10-25T20:05'),
    proposals: [],
    names: new Map(),
    weekly: SUNDAY_8PM,
    weeklyKeys: new Set(),
    summary: SUMMARY,
    health: { latest: undefined, misses: 0, alert: false },
    lastGoodRunId: null,
    quiet: QUIET,
  };

  it('plans the weekly review once its time has come, once a week', () => {
    assert.deepEqual(
      plan(base).map((message) => [message.kind, message.key]),
      [['weekly', '2026-10-25']],
    );
    assert.deepEqual(plan({ ...base, weeklyKeys: new Set(['2026-10-25']) }), []);
    // A day late (the job was down) it is stale and skipped.
    assert.deepEqual(plan({ ...base, now: taipei('2026-10-26T21:00') }), []);
    assert.deepEqual(plan({ ...base, weekly: null }), []);
  });

  it('holds what it plans in the quiet hours until they end', () => {
    const proposal: ProposalForPush = { id: 3, ruleId: 'R2', condition: 'satellite_weight_above', title: { en: 'R2 · Satellite trim', zh: 'R2 · 衛星部位減碼' }, state: 'satellite', detail: { poolTwd: 1, weight: 0.26, target: 0.2, cashTwd: 0, leftTwd: 0 } };
    const late = plan({ ...base, now: taipei('2026-10-25T23:40'), proposals: [proposal], weeklyKeys: new Set(['2026-10-25']) });
    assert.equal(late.length, 1);
    assert.equal(late[0]?.sendAfter.toISOString(), taipei('2026-10-26T08:00').toISOString());
    assert.equal(late[0]?.body, 'Trim the satellite from 26.0% back to 20%.\n衛星部位由 26.0% 減碼回 20%。');
  });
});

describe('weeklySummary', () => {
  it('counts proposals by status and finds the core class furthest from target', () => {
    const classes = ASSET_CLASSES.map((assetClass) => ({ assetClass, valueTwd: 0, weight: assetClass.targetWeight, drift: 0 }));
    const bonds = classes.find((row) => row.assetClass.id === 'global_bonds');
    const stocks = classes.find((row) => row.assetClass.id === 'us_stocks');
    assert.ok(bonds && stocks);
    bonds.drift = -0.05;
    stocks.drift = 0.08;
    const summary = weeklySummary({ statuses: ['open', 'approved', 'open'], classes, poolTwd: 100_000, valueTwd: 100_000, weekAgoTwd: null });
    // The satellite class drifts more, but R2 watches the satellite as a whole: the core's largest is bonds.
    assert.deepEqual(summary, { openProposals: 2, approvedProposals: 1, largestDrift: { name: { en: 'Global bonds', zh: '全球債券' }, drift: -0.05 }, valueTwd: 100_000, weekAgoTwd: null });
    assert.equal(weeklySummary({ statuses: [], classes, poolTwd: 0, valueTwd: null, weekAgoTwd: null }).largestDrift, null);
  });
});

describe('comingWeek', () => {
  it('lists the DCA debit and the proposal after it, the weekly review and January review in the next seven days', () => {
    // Thursday 22 October 2026, DCA on the 26th: the debit, the proposal the day after, Sunday's review.
    assert.deepEqual(comingWeek('2026-10-22', 26, SUNDAY_8PM, 1), [
      { date: '2026-10-25', time: '20:00', what: { en: 'Weekly review push', zh: '每週檢視推播' } },
      { date: '2026-10-26', what: { en: 'DCA debit', zh: '定期定額扣款' } },
      { date: '2026-10-27', what: { en: 'Monthly-contribution proposal', zh: '每月投入提案' } },
    ]);
  });

  it('crosses into the next month and the new year, and leaves out what is not set', () => {
    const events = comingWeek('2026-12-29', 2, null, 1);
    assert.deepEqual(
      events.map((event) => [event.date, event.what.en]),
      [
        ['2027-01-02', 'DCA debit'],
        ['2027-01-02', 'Annual review proposal'],
        ['2027-01-03', 'Monthly-contribution proposal'],
      ],
    );
    assert.deepEqual(comingWeek('2027-01-01', null, null, 1), [{ date: '2027-01-02', what: { en: 'Annual review proposal', zh: '年度檢查提案' } }]);
    assert.deepEqual(comingWeek('2026-10-22', null, null, null), []);
  });
});
