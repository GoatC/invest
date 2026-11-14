import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DividendDue, DividendSettings } from './dividends';
import type { EventSettings, MarketEvent } from './events';
import { LOCAL_REMINDER_MAX, localReminders, type LocalReminderInput } from './local-reminders';
import { readQuietHours, readWeeklyReview } from './notify';

const QUIET = readQuietHours({ start: '23:00', end: '08:00', time_zone: 'Asia/Taipei' });
const SUNDAY_8PM = readWeeklyReview({ day: 'sunday', time: '20:00', time_zone: 'Asia/Taipei' });
/** An instant given in Taipei time (UTC+8). */
const taipei = (local: string) => new Date(`${local}+08:00`);
const iso = (local: string) => taipei(local).toISOString();

/** Saturday 2026-11-14, 18:00 in Taipei. */
const NOW = taipei('2026-11-14T18:00:00');
const EVENTS: EventSettings = { leadDays: 2, remind: ['fomc', 'cpi', 'cbc', 'other'] };
const DIVIDENDS: DividendSettings = { lookbackDays: 30, matchDays: 30, payLagDays: {}, withholding: {}, push: true, pushDays: 3 };

const event = (kind: MarketEvent['kind'], date: string, time: string | null, zh: string): MarketEvent => ({ kind, date, time, name: { en: zh, zh }, source: 'typed', note: null });

const dividend = (ticker: string, askOn: string, id: number): DividendDue => ({
  event: { id, ticker, exDate: '2026-11-03', payDate: askOn, amount: 0.5, currency: 'USD', source: 'demo', skippedPools: [] },
  security: { ticker, name: ticker, market: 'US', domicile: 'US', currency: 'USD', reinvested: false },
  pool: 'regular',
  qty: 10,
  askOn,
  estimatedDate: false,
  withholding: 0.3,
  grossLocal: 5,
  netLocal: 3.5,
  netTwd: 113.4,
});

const base: LocalReminderInput = { now: NOW, today: '2026-11-14', quiet: QUIET, weekly: SUNDAY_8PM, events: [], eventSettings: EVENTS, dividends: [], dividendSettings: DIVIDENDS };

describe('local reminders for the iOS shell', () => {
  it('schedules the weekly review at its time each week within the next 14 days', () => {
    const out = localReminders(base);
    assert.deepEqual(
      out.map((reminder) => [reminder.id, reminder.at]),
      [
        ['weekly:2026-11-15', iso('2026-11-15T20:00:00')],
        ['weekly:2026-11-22', iso('2026-11-22T20:00:00')],
      ],
    );
    assert.equal(out[0]?.title, '每週檢視');
    assert.equal(out[0]?.url, '/');
  });

  it('moves a weekly review that falls in the quiet hours to their end', () => {
    const late = readWeeklyReview({ day: 'sunday', time: '23:30', time_zone: 'Asia/Taipei' });
    assert.equal(localReminders({ ...base, weekly: late })[0]?.at, iso('2026-11-16T08:00:00'));
  });

  it('reminds of an event lead_days before it, at 08:00 as the quiet hours end, with the push words', () => {
    const cpi = event('cpi', '2026-11-20', '21:30', '美國 CPI');
    const out = localReminders({ ...base, weekly: null, events: [cpi] });
    assert.equal(out.length, 1);
    assert.equal(out[0]?.id, 'event:cpi:2026-11-20:美國 CPI');
    assert.equal(out[0]?.at, iso('2026-11-18T08:00:00'));
    assert.equal(out[0]?.title, '2 天後：美國 CPI');
    assert.equal(out[0]?.url, '/volatility#events');
  });

  it('leaves out an event of a kind not reminded of, one whose day has passed, and one past the 14 days', () => {
    const out = localReminders({
      ...base,
      weekly: null,
      events: [event('payrolls', '2026-11-20', null, '非農'), event('fomc', '2026-11-16', '03:00', '聯準會'), event('cbc', '2026-12-17', null, '央行')],
    });
    assert.deepEqual(out, []);
  });

  it('uses 09:00 Taipei for the morning when there are no quiet hours', () => {
    const out = localReminders({ ...base, quiet: null, weekly: null, events: [event('other', '2026-11-20', null, '選舉')] });
    assert.equal(out[0]?.at, iso('2026-11-18T09:00:00'));
  });

  it("reminds of a dividend on its asking day, in the morning, with the push's words and form", () => {
    const out = localReminders({ ...base, weekly: null, dividends: [dividend('VT', '2026-11-20', 7), dividend('VOO', '2026-11-14', 8)] });
    assert.equal(out.length, 1, "today's morning has passed: the push job has that one");
    assert.equal(out[0]?.at, iso('2026-11-20T08:00:00'));
    assert.equal(out[0]?.title, 'VT 配息');
    assert.match(out[0]?.body ?? '', /^2026-11-20 發放，約 /);
    assert.match(out[0]?.url ?? '', /7/);
  });

  it('schedules no dividend when dividends are not pushed', () => {
    const out = localReminders({ ...base, weekly: null, dividends: [dividend('VT', '2026-11-20', 7)], dividendSettings: { ...DIVIDENDS, push: false } });
    assert.deepEqual(out, []);
  });

  it('puts them in time order and keeps at most LOCAL_REMINDER_MAX', () => {
    const many = Array.from({ length: 60 }, (_, index) => dividend(`T${index}`, '2026-11-19', index));
    const out = localReminders({ ...base, dividends: many, events: [event('cpi', '2026-11-19', null, 'CPI')] });
    assert.equal(out.length, LOCAL_REMINDER_MAX);
    assert.equal(out[0]?.id, 'weekly:2026-11-15');
    assert.equal(out[1]?.id, 'event:cpi:2026-11-19:CPI');
    assert.ok(out.every((reminder, index) => index === 0 || reminder.at >= (out[index - 1]?.at ?? '')));
  });

  it('gives nothing to schedule before the settings exist', () => {
    assert.deepEqual(localReminders({ ...base, weekly: null, events: null, eventSettings: null, dividends: null, dividendSettings: null }), []);
  });
});
