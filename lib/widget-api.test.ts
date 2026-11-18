import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHash } from 'node:crypto';

import { hashWidgetKey, newWidgetKey, readBearer, widgetReply } from './widget-api';

describe('readBearer', () => {
  const KEY = `${'A_-9'.repeat(10)}abc`;

  it('takes a 43-character base64url key', () => {
    assert.equal(KEY.length, 43);
    assert.equal(readBearer(`Bearer ${KEY}`), KEY);
  });

  it('refuses a missing header, Basic, an empty bearer, a short, a long or a foreign-character key', () => {
    for (const header of [null, '', 'Basic abc', 'Bearer ', `Bearer ${'a'.repeat(42)}`, `Bearer ${'a'.repeat(129)}`, `Bearer ${'a'.repeat(2048)}`, `Bearer ${'a'.repeat(42)}!`, `Bearer ${KEY} extra`]) {
      assert.equal(readBearer(header), null, String(header).slice(0, 20));
    }
  });
});

describe('widgetReply', () => {
  it('rejects a replaced key with no figures', () => {
    assert.deepEqual(widgetReply(null, '2026-11-18'), { status: 401, body: { error: 'key' } });
  });

  it('passes an empty snapshot through', () => {
    assert.deepEqual(widgetReply({ figures: null, stale_days: 3 }, '2026-11-18'), { status: 200, body: { figures: null } });
  });

  it('camel-cases the figures and marks a close older than the stale days', () => {
    const row = { figures: { as_of: '2026-11-13', total_twd: 1080, week_change: -0.1, points: [0, 0.08], red_up: true }, stale_days: 3 };
    assert.deepEqual(widgetReply(row, '2026-11-17'), {
      status: 200,
      body: { figures: { asOf: '2026-11-13', totalTwd: 1080, weekChange: -0.1, points: [0, 0.08], redUp: true, stale: true } },
    });
    assert.equal((widgetReply(row, '2026-11-16').body as { figures: { stale: boolean } }).figures.stale, false);
  });

  it('reads numbers sent as text and a missing 7-day change, and never marks stale without the setting', () => {
    const row = { figures: { as_of: '2026-11-13', total_twd: '1080.5', week_change: null, points: ['0', 0.08], red_up: false }, stale_days: null };
    assert.deepEqual(widgetReply(row, '2026-12-31').body, { figures: { asOf: '2026-11-13', totalTwd: 1080.5, weekChange: null, points: [0, 0.08], redUp: false, stale: false } });
  });
});

describe('newWidgetKey', () => {
  it('makes a 43-character base64url key the route accepts, a new one each time', () => {
    const { key } = newWidgetKey();
    assert.match(key, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(readBearer(`Bearer ${key}`), key);
    assert.notEqual(newWidgetKey().key, key);
  });

  it("stores only the key's SHA-256, as the database compares it", () => {
    const { key, hash } = newWidgetKey();
    assert.equal(hash, createHash('sha256').update(key, 'utf8').digest('hex'));
    assert.equal(hashWidgetKey('a'.repeat(43)), createHash('sha256').update('a'.repeat(43)).digest('hex'));
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});
