/**
 * The breaking-news feeds (N8 step 4): Google News searches, in English and in Traditional Chinese,
 * name the outlet of each headline, so a topic's spread across outlets can be counted. If Google
 * News fails, three feeds of their own stand in (CNBC's and MarketWatch's top stories, and cnyes'
 * 鉅亨網 headlines), matched on the topic's terms.
 */
import { parseRss, type Headline } from '../../../lib/models/news.ts';

export function googleNewsUrl(query: string, edition: 'en' | 'zh'): string {
  const where = edition === 'en' ? 'hl=en-US&gl=US&ceid=US:en' : 'hl=zh-TW&gl=TW&ceid=TW:zh-Hant';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${where}`;
}

export const FALLBACK_FEEDS = [
  { source: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', kind: 'rss' as const },
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', kind: 'rss' as const },
  { source: 'cnyes 鉅亨網', url: 'https://api.cnyes.com/media/api/v1/newslist/category/headline?limit=50', kind: 'cnyes' as const },
];

/** cnyes' headline list: {items: {data: [{title, publishAt (seconds), newsId}]}}. */
export function cnyesHeadlines(json: string): Headline[] {
  let body: unknown;
  try {
    body = JSON.parse(json);
  } catch {
    return [];
  }
  const data = (body as { items?: { data?: unknown } }).items?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((row: Record<string, unknown>) => {
    const title = typeof row['title'] === 'string' ? row['title'] : undefined;
    const at = typeof row['publishAt'] === 'number' ? row['publishAt'] * 1000 : NaN;
    return title && Number.isFinite(at) ? [{ title, source: 'cnyes 鉅亨網', url: `https://news.cnyes.com/news/id/${String(row['newsId'] ?? '')}`, at: new Date(at).toISOString() }] : [];
  });
}

export function fallbackHeadlines(kind: 'rss' | 'cnyes', body: string, source: string): Headline[] {
  return kind === 'cnyes' ? cnyesHeadlines(body) : parseRss(body, source);
}
