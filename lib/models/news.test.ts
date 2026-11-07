import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BASELINE_RUNS, countTopic, matching, median, newsMessage, newsSettingsValue, parseRss, readNewsSettings, termsByEdition, topicQuery, verdict, type NewsSettings } from './news';

/** config news as the migration seeds it, two topics shown. */
const CONFIG = {
  window_hours: 3,
  min_sources: 10,
  spike: 3,
  baseline_days: 7,
  cooldown_hours: 12,
  push_in_quiet_hours: true,
  topics: {
    war: { en: 'War or strikes', zh: '戰爭／空襲', terms: ['airstrike', 'strikes on', '空襲', '開戰'] },
    taiwan_strait: { en: 'Taiwan Strait', zh: '台海情勢', terms: ['Taiwan Strait', '台海'] },
  },
};
const settings = readNewsSettings(CONFIG) as NewsSettings;
const now = new Date('2026-11-07T08:00:00Z');
const history = (value: number, runs = BASELINE_RUNS) => Array.from({ length: runs }, () => value);

describe('PRD Section 11 acceptance: N8 breaking news', () => {
  it('Spike: usual count 5 (median of the saved runs), 10 at least, 3 times → 15 needed: 12 outlets do not alert, 16 do', () => {
    assert.deepEqual(verdict(12, history(5), null, now, settings), { alert: false, baseline: 5, needed: 15, why: 'below' });
    assert.deepEqual(verdict(16, history(5), null, now, settings), { alert: true, baseline: 5, needed: 15 });
  });

  it('A quiet topic needs min_sources: usual 1 → 10 needed; before half a day of runs, spike times it: 30', () => {
    assert.equal(verdict(10, history(1), null, now, settings).alert, true);
    assert.deepEqual(verdict(28, history(1, BASELINE_RUNS - 1), null, now, settings), { alert: false, baseline: null, needed: 30, why: 'below' });
    assert.equal(verdict(56, [], null, now, settings).alert, true);
  });

  it('Cooldown: alerted 11 hours ago → not again; 13 hours ago → again', () => {
    assert.equal(verdict(40, history(5), '2026-11-06T21:00:00Z', now, settings).why, 'cooldown');
    assert.equal(verdict(40, history(5), '2026-11-06T19:00:00Z', now, settings).alert, true);
  });
});

describe('breaking news', () => {
  it('reads config news and writes it back unchanged; refuses a topic without terms', () => {
    assert.deepEqual(newsSettingsValue(settings), CONFIG);
    assert.equal(readNewsSettings({ ...CONFIG, topics: { war: { en: 'War', zh: '戰爭', terms: [] } } }), undefined);
    assert.equal(readNewsSettings({ ...CONFIG, spike: 0 }), undefined);
  });

  it('asks the English edition for Latin terms and the Chinese one for Chinese terms', () => {
    assert.deepEqual(termsByEdition(settings.topics[0]?.terms ?? []), { en: ['airstrike', 'strikes on'], zh: ['空襲', '開戰'] });
    assert.equal(topicQuery(['airstrike', 'strikes on'], 3), '("airstrike" OR "strikes on") when:3h');
  });

  it("reads Google News items, dropping the outlet from the title, and counts each outlet once", () => {
    const xml = [
      '<item><title>Trump says U.S. carried out &#x2018;minor strikes&#x2019; on Iran - CNBC</title><link>https://news.google.com/a</link><pubDate>Sat, 07 Nov 2026 07:37:36 GMT</pubDate><source url="https://www.cnbc.com">CNBC</source></item>',
      '<item><title>Strikes on Iran rattle oil - Reuters</title><link>https://news.google.com/b</link><pubDate>Sat, 07 Nov 2026 07:10:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>',
      '<item><title>Earlier strikes on Iran - CNBC</title><link>https://news.google.com/c</link><pubDate>Sat, 07 Nov 2026 06:00:00 GMT</pubDate><source url="https://www.cnbc.com">CNBC</source></item>',
      '<item><title>Old story - AP</title><link>https://news.google.com/d</link><pubDate>Fri, 06 Nov 2026 20:00:00 GMT</pubDate><source url="https://apnews.com">AP</source></item>',
    ].join('');
    const items = parseRss(`<rss><channel>${xml}</channel></rss>`);
    assert.equal(items[0]?.title, 'Trump says U.S. carried out ‘minor strikes’ on Iran');
    assert.equal(items[0]?.source, 'CNBC');
    const recent = matching(items, null, now, 3);
    assert.equal(recent.length, 3);
    const counted = countTopic(recent);
    assert.equal(counted.sources, 2);
    assert.deepEqual(counted.headlines.map((row) => row.source), ['CNBC', 'Reuters']);
    // A feed of its own (the fallback) is matched on the terms in its titles: "strikes’ on" is not "strikes on".
    assert.equal(matching(parseRss(xml.replace(/<source[^>]*>[^<]*<\/source>/g, ''), 'MarketWatch'), ['strikes on'], now, 3).length, 2);
  });

  it('takes the median, and words the push in both languages', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 10]), 2.5);
    assert.equal(median([]), 0);
    const message = newsMessage({ id: 7, topic: settings.topics[0]!, detectedAt: now.toISOString(), sources: 40, baseline: 8, windowHours: 3, headlines: [{ title: 'Strikes on Iran', source: 'CNBC', url: 'https://x', at: now.toISOString() }] });
    assert.deepEqual(message, {
      kind: 'news',
      key: '7',
      title: 'Breaking: War or strikes 前沿新聞：戰爭／空襲',
      body: '40 outlets in 3 h · Strikes on Iran (CNBC)\n3 小時內 40 家媒體報導',
      url: '/volatility#news',
    });
  });
});
