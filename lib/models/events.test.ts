import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clock24, EVENT_DEFAULTS, eventKey, eventMessage, eventsBetween, KIND_NAMES, readEventSettings, remindersDue, toTaipei, whenText, type MarketEvent } from './events';
import { plan, type PlanInput } from './notify';

const event = (date: string, kind: MarketEvent['kind'] = 'fomc', time: string | null = '03:00', name = KIND_NAMES[kind]): MarketEvent => ({ kind, date, time, name, source: kind === 'fomc' ? 'fed' : 'typed', note: null });

describe('PRD Section 11 acceptance: N8 event calendar', () => {
  it('FOMC: a decision at 14:00 New York on 2026-12-09 (standard time) is 2026-12-10 03:00 in Taipei; on 2026-06-17 (daylight time) 2026-06-18 02:00', () => {
    assert.deepEqual(toTaipei('2026-12-09', '14:00', 'America/New_York'), { date: '2026-12-10', time: '03:00' });
    assert.deepEqual(toTaipei('2026-06-17', '14:00', 'America/New_York'), { date: '2026-06-18', time: '02:00' });
  });

  it('CPI: 7:30 am Central on 2026-11-10 is 21:30 that day in Taipei; on 2026-10-14 20:30', () => {
    assert.equal(clock24('7:30 am'), '07:30');
    assert.deepEqual(toTaipei('2026-11-10', '07:30', 'America/Chicago'), { date: '2026-11-10', time: '21:30' });
    assert.deepEqual(toTaipei('2026-10-14', '07:30', 'America/Chicago'), { date: '2026-10-14', time: '20:30' });
  });

  it('Reminder: an event on 2026-12-10 with a lead of 2 days is due on 12-08 and 12-09 (once), not on 12-07 nor on the day', () => {
    const events = [event('2026-12-10')];
    assert.equal(remindersDue(events, '2026-12-07', EVENT_DEFAULTS, new Set()).length, 0);
    assert.equal(remindersDue(events, '2026-12-08', EVENT_DEFAULTS, new Set()).length, 1);
    assert.equal(remindersDue(events, '2026-12-09', EVENT_DEFAULTS, new Set([eventKey(events[0] as MarketEvent)])).length, 0);
    assert.equal(remindersDue(events, '2026-12-10', EVENT_DEFAULTS, new Set()).length, 0);
  });
});

describe('event calendar', () => {
  it('reads config volatility.events, the defaults when missing', () => {
    assert.deepEqual(readEventSettings(undefined), EVENT_DEFAULTS);
    assert.deepEqual(readEventSettings({ lead_days: 3, remind: ['cpi', 'fomc'] }), { leadDays: 3, remind: ['fomc', 'cpi'] });
    assert.equal(readEventSettings({ lead_days: 0, remind: [] }), undefined);
    assert.equal(readEventSettings({ lead_days: 2, remind: ['war'] }), undefined);
  });

  it('reads 12-hour clocks', () => {
    assert.equal(clock24('2:00 pm'), '14:00');
    assert.equal(clock24('12:15 am'), '00:15');
    assert.equal(clock24('12:00 p.m.'), '12:00');
    assert.equal(clock24('noon'), undefined);
  });

  it('reminds only of the kinds chosen, and lists events in order', () => {
    const events = [event('2026-11-08', 'other', null, { en: 'Election', zh: '選舉' }), event('2026-11-07', 'cpi', '21:30'), event('2026-11-07', 'fomc', '03:00')];
    assert.deepEqual(
      eventsBetween(events, '2026-11-07', '2026-11-08').map((row) => `${row.date} ${row.kind}`),
      ['2026-11-07 fomc', '2026-11-07 cpi', '2026-11-08 other'],
    );
    assert.deepEqual(
      remindersDue(events, '2026-11-06', { leadDays: 2, remind: ['other'] }, new Set()).map((row) => row.kind),
      ['other'],
    );
  });

  it('words the reminder in both languages, with no orders, and plans it after the quiet hours', () => {
    const message = eventMessage(event('2026-12-10'), '2026-12-08');
    assert.equal(message.kind, 'event');
    assert.equal(message.key, 'fomc:2026-12-10:FOMC rate decision');
    assert.equal(message.title, 'In 2 days: FOMC rate decision 2 天後：聯準會利率決議');
    assert.match(message.body, /Thu 2026-12-10 03:00 Taipei[\s\S]*no orders[\s\S]*2026-12-10（週四） 03:00/);
    assert.equal(message.url, '/volatility#events');
    assert.deepEqual(whenText(event('2026-11-08', 'other', null)), { en: 'Sun 2026-11-08', zh: '2026-11-08（週日）' });
    const input = {
      now: new Date('2026-12-07T16:30:00Z'), // 00:30 in Taipei, inside the quiet hours
      proposals: [],
      names: new Map(),
      weekly: null,
      weeklyKeys: new Set<string>(),
      summary: { openProposals: 0, approvedProposals: 0, largestDrift: null, valueTwd: null, weekAgoTwd: null },
      health: { alert: false, misses: 0 },
      lastGoodRunId: null,
      quiet: { start: 23 * 60, end: 8 * 60, timeZone: 'Asia/Taipei' },
      reminders: [message],
    } as unknown as PlanInput;
    const planned = plan(input);
    assert.equal(planned.length, 1);
    assert.equal(planned[0]?.sendAfter.toISOString(), '2026-12-08T00:00:00.000Z');
  });
});
