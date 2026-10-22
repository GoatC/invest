import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NotificationRecord } from '../../../lib/data.ts';
import type { Message, PlanInput } from '../../../lib/models/notify.ts';
import type { Vapid } from '../../../lib/push.ts';
import { notifySummary, runNotify, type NotifyStore } from './job.ts';

const VAPID: Vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:owner@example.com' };
/** Sunday 25 October 2026, 20:07 in Taipei: just after the weekly review time. */
const NOW = new Date('2026-10-25T12:07:00Z');

const INPUT: Omit<PlanInput, 'now'> = {
  proposals: [{ id: 5, ruleId: 'R1', condition: 'single_stock_weight_above', title: { en: 'R1 · Single-stock trim', zh: 'R1 · 單一個股減碼' }, state: 'NVDA', detail: { poolTwd: 1, limit: 0.05, cashTwd: 0, leftTwd: 0 } }],
  names: new Map(),
  weekly: { weekday: 0, minutes: 20 * 60, timeZone: 'Asia/Taipei' },
  weeklyKeys: new Set(),
  summary: { openProposals: 1, approvedProposals: 0, largestDrift: null, valueTwd: 100_000, weekAgoTwd: 99_000 },
  health: { latest: undefined, misses: 0, alert: false },
  lastGoodRunId: 3,
  quiet: { start: 23 * 60, end: 8 * 60, timeZone: 'Asia/Taipei' },
};

/** An in-memory outbox: planned pushes are due at once, each sent to two devices, one of them gone. */
class MemoryStore implements NotifyStore {
  planned: Array<Message & { sendAfter: Date }> = [];
  sent: number[] = [];
  constructor(private readonly options: { decided?: number[]; taken?: number[] } = {}) {}
  async input() {
    return INPUT;
  }
  async plan(messages: ReadonlyArray<Message & { sendAfter: Date }>) {
    const fresh = messages.filter((message) => !this.planned.some((planned) => planned.kind === message.kind && planned.key === message.key));
    this.planned.push(...fresh);
    return fresh.length;
  }
  async due(now: Date): Promise<NotificationRecord[]> {
    return this.planned
      .map((message, index) => ({ ...message, id: index + 1, createdAt: '', sendAfter: message.sendAfter.toISOString(), sentAt: null, delivered: null, error: null }))
      .filter((row) => !this.sent.includes(row.id) && Date.parse(row.sendAfter) <= now.getTime());
  }
  async send(notification: NotificationRecord) {
    if (this.options.taken?.includes(notification.id)) return undefined;
    this.sent.push(notification.id);
    if (notification.kind === 'proposal' && this.options.decided?.includes(Number(notification.key))) return { delivered: [], gone: [], errors: [], skipped: true };
    return { delivered: [1], gone: [2], errors: [] };
  }
}

describe('runNotify', () => {
  it('plans the new proposal and the weekly review, sends both, and plans nothing twice', async () => {
    const store = new MemoryStore();
    const run = await runNotify({ store, vapid: VAPID, now: NOW, today: '2026-10-25' });
    assert.deepEqual(
      store.planned.map((message) => [message.kind, message.key]),
      [
        ['proposal', '5'],
        ['weekly', '2026-10-25'],
      ],
    );
    assert.deepEqual(run, { planned: 2, sent: 2, skipped: 0, devices: 2, gone: 2, errors: [] });
    const again = await runNotify({ store, vapid: VAPID, now: NOW, today: '2026-10-25' });
    assert.deepEqual([again.planned, again.sent], [0, 0]);
  });

  it('holds what it plans in the quiet hours, then sends it when they end', async () => {
    const store = new MemoryStore();
    const night = new Date('2026-10-25T15:30:00Z');
    // 23:30: the proposal and the review (20:00, missed by the job) wait for 08:00.
    const held = await runNotify({ store, vapid: VAPID, now: night, today: '2026-10-25' });
    assert.deepEqual([held.planned, held.sent], [2, 0]);
    assert.ok(store.planned.every((message) => message.sendAfter.toISOString() === '2026-10-26T00:00:00.000Z'));
    const morning = await runNotify({ store, vapid: VAPID, now: new Date('2026-10-26T00:05:00Z'), today: '2026-10-26' });
    assert.equal(morning.sent, 2);
  });

  it('skips a proposal decided before its push went out, and one another run sent', async () => {
    const decided = await runNotify({ store: new MemoryStore({ decided: [5] }), vapid: VAPID, now: NOW, today: '2026-10-25' });
    assert.deepEqual([decided.sent, decided.skipped], [1, 1]);
    const taken = await runNotify({ store: new MemoryStore({ taken: [1, 2] }), vapid: VAPID, now: NOW, today: '2026-10-25' });
    assert.deepEqual([taken.sent, taken.skipped], [0, 0]);
  });

  it('plans and sends nothing until the VAPID settings are there, and says which are missing', async () => {
    const store = new MemoryStore();
    const run = await runNotify({ store, vapid: { missing: ['VAPID_PRIVATE_KEY'] }, now: NOW, today: '2026-10-25' });
    assert.deepEqual(run.missing, ['VAPID_PRIVATE_KEY']);
    assert.deepEqual(store.planned, []);
    assert.match(notifySummary(run)[0] ?? '', /^::notice::Web Push is not set up yet: missing VAPID_PRIVATE_KEY/);
  });
});

describe('notifySummary', () => {
  it('prints counts only, never what was pushed', () => {
    const lines = notifySummary({ planned: 2, sent: 2, skipped: 0, devices: 3, gone: 1, errors: ['push service 429'] });
    assert.match(lines[0] ?? '', /^::warning::Web Push: 2 planned, 2 sent \(3 deliveries\), 0 skipped, 1 gone devices removed, 1 errors\./);
    assert.deepEqual(lines.slice(1), ['::warning::push service 429']);
    assert.match(notifySummary({ planned: 0, sent: 0, skipped: 0, devices: 0, gone: 0, errors: [] })[0] ?? '', /^::notice::/);
  });
});
