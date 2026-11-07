import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BASELINE_RUNS, readNewsSettings, type NewsSettings } from '../../../lib/models/news.ts';
import { cnyesHeadlines } from '../feeds/news.ts';
import { JOB, newsSummary, runNews, type NewsAlertRow, type NewsRun, type NewsStore } from './job.ts';

const SETTINGS = readNewsSettings({
  window_hours: 3,
  min_sources: 10,
  spike: 3,
  baseline_days: 7,
  cooldown_hours: 12,
  push_in_quiet_hours: true,
  topics: {
    war: { en: 'War or strikes', zh: '戰爭／空襲', terms: ['strikes on', '空襲'] },
    crash: { en: 'Market crash', zh: '市場崩跌', terms: ['circuit breaker'] },
  },
}) as NewsSettings;

const NOW = new Date('2026-11-07T08:00:00Z');

/** A Google News reply with `outlets` different outlets in the last hour. */
function google(outlets: number, title = 'Strikes on Iran'): string {
  const items = Array.from({ length: outlets }, (_, i) => `<item><title>${title} - Outlet ${i}</title><link>https://news.google.com/${i}</link><pubDate>Sat, 07 Nov 2026 07:${String(10 + (i % 40)).padStart(2, '0')}:00 GMT</pubDate><source url="https://o${i}.example">Outlet ${i}</source></item>`);
  return `<rss><channel>${items.join('')}</channel></rss>`;
}

function memoryStore(history: Map<string, number[]> = new Map(), last: Map<string, string> = new Map()) {
  const alerts: NewsAlertRow[] = [];
  const counts: Array<{ topic: string; sources: number }> = [];
  const runs: NewsRun[] = [];
  const store: NewsStore = {
    settings: async () => SETTINGS,
    history: async () => history,
    lastAlerts: async () => last,
    saveCounts: async (rows) => void counts.push(...rows),
    saveAlert: async (row) => void alerts.push(row),
    prune: async () => {},
    recordRun: async (run) => void runs.push(run),
  };
  return { store, alerts, counts, runs };
}

describe('news job (N8 step 4)', () => {
  it('counts each topic in both editions, alerts the one far above its usual count, saves every count', async () => {
    const usual = new Map([
      ['war', Array.from({ length: BASELINE_RUNS }, () => 8)],
      ['crash', Array.from({ length: BASELINE_RUNS }, () => 3)],
    ]);
    const { store, alerts, counts, runs } = memoryStore(usual);
    const asked: string[] = [];
    const get = async (url: string) => {
      asked.push(url);
      if (url.includes('circuit')) return google(5, 'Circuit breaker in Istanbul');
      return url.includes('hl=zh-TW') ? google(10, '美軍空襲伊朗') : google(30);
    };
    const run = await runNews({ get, store, now: () => NOW, gapMs: 0 });
    assert.equal(run.job, JOB);
    assert.equal(run.status, 'ok');
    // war: English and Chinese outlets (Outlet 0–29 and Outlet 0–9 are the same names): 30 outlets ≥ 3 × 8 = 24.
    assert.deepEqual(run.detail.topics['war'], { sources: 30, needed: 24, baseline: 8, outcome: 'alert' });
    assert.deepEqual(run.detail.topics['crash'], { sources: 5, needed: 10, baseline: 3, outcome: 'below' });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.topic, 'war');
    assert.equal(alerts[0]?.headlines.length, 3);
    assert.deepEqual(counts, [{ topic: 'war', sources: 30 }, { topic: 'crash', sources: 5 }]);
    assert.equal(asked.filter((url) => url.includes('news.google.com')).length, 3);
    assert.ok(asked[0]?.includes(encodeURIComponent('("strikes on") when:3h')));
    assert.equal(runs.length, 1);
    assert.ok(newsSummary(run).some((line) => line === '  war: 30 outlets, 24 needed, usual 8 → alert'));
  });

  it('holds a topic back within its cooldown', async () => {
    const usual = new Map([['war', Array.from({ length: BASELINE_RUNS }, () => 2)]]);
    const { store, alerts } = memoryStore(usual, new Map([['war', '2026-11-07T02:00:00Z']]));
    const run = await runNews({ get: async () => google(30), store, now: () => NOW, gapMs: 0 });
    assert.equal(run.detail.topics['war']?.outcome, 'cooldown');
    assert.equal(alerts.filter((row) => row.topic === 'war').length, 0);
  });

  it('falls back to its three feeds when Google News fails, two of them at once, and saves no count', async () => {
    const { store, alerts, counts } = memoryStore();
    const cnyes = JSON.stringify({ items: { data: [{ title: '美軍空襲伊朗 油價急漲', publishAt: Date.parse('2026-11-07T07:30:00Z') / 1000, newsId: 1 }] } });
    const rss = (source: string) => `<rss><channel><item><title>US strikes on Iran</title><link>https://${source}/a</link><pubDate>Sat, 07 Nov 2026 07:20:00 GMT</pubDate></item></channel></rss>`;
    const get = async (url: string) => {
      if (url.includes('news.google.com')) throw new Error('HTTP 503');
      if (url.includes('cnyes')) return cnyes;
      return rss(url.includes('cnbc') ? 'cnbc' : 'marketwatch');
    };
    const run = await runNews({ get, store, now: () => NOW, gapMs: 0 });
    assert.equal(run.detail.fallback, true);
    assert.equal(run.status, 'partial');
    assert.deepEqual(run.detail.topics['war'], { sources: 3, needed: 2, baseline: null, outcome: 'alert' });
    assert.equal(alerts.length, 1);
    assert.deepEqual(counts, []);
  });

  it('fails when no feed answers, and before its migration', async () => {
    const offline = await runNews({ get: async () => Promise.reject(new Error('offline')), store: memoryStore().store, now: () => NOW, gapMs: 0 });
    assert.equal(offline.status, 'failed');
    const missing = memoryStore();
    missing.store.settings = async () => undefined;
    const run = await runNews({ get: async () => '', store: missing.store, now: () => NOW, gapMs: 0 });
    assert.equal(run.status, 'failed');
    assert.match(run.detail.errors[0] ?? '', /config news/);
  });

  it("reads cnyes' headline list", () => {
    assert.deepEqual(cnyesHeadlines('{"items":{"data":[{"title":"台股重挫","publishAt":1762500000,"newsId":9}]}}'), [{ title: '台股重挫', source: 'cnyes 鉅亨網', url: 'https://news.cnyes.com/news/id/9', at: new Date(1762500000 * 1000).toISOString() }]);
    assert.deepEqual(cnyesHeadlines('not json'), []);
  });
});
