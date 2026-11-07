/**
 * Breaking-news alerts (N8 step 4, added 2026-11-07): Hugo is told only of news that may move
 * markets, besides the volatility score. Free headline feeds, no language model:
 *
 * - Each topic (config news.topics: war, the Taiwan Strait, an emergency central-bank move, a
 *   crash, a financial crisis, tariffs and sanctions, a major disaster) is a list of terms, in
 *   English and Chinese. Every run asks Google News for the last `window_hours` (3) of headlines
 *   carrying any of them, in English and in Traditional Chinese.
 * - A topic's count is the number of different outlets reporting it in that window. A routine
 *   story runs in a few; news that moves markets runs everywhere at once.
 * - It alerts when the count is at least `min_sources` (10) and at least `spike` (3) times its
 *   usual count, the median of its runs over the last `baseline_days` (7). Until half a day of
 *   runs is saved, the count must be `spike` times min_sources (30): only news on every outlet
 *   alerts before the usual counts are known. Once per topic per `cooldown_hours` (12).
 * Pure functions; the news job loads the feeds and saves the counts and alerts.
 */
import type { Bilingual } from '../i18n';
import type { Message } from './notify';

export interface NewsTopic {
  id: string;
  name: Bilingual;
  /** Terms in either language; a term with Chinese characters is asked of the Chinese edition. */
  terms: string[];
}

export interface NewsSettings {
  topics: NewsTopic[];
  windowHours: number;
  minSources: number;
  spike: number;
  baselineDays: number;
  cooldownHours: number;
  pushInQuietHours: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** config news read defensively; undefined when missing or malformed. */
export function readNewsSettings(value: unknown): NewsSettings | undefined {
  const row = record(value);
  const topics: NewsTopic[] = [];
  for (const [id, entry] of Object.entries(record(row['topics']))) {
    const { en, zh, terms } = record(entry);
    if (!/^[a-z][a-z0-9_]*$/.test(id) || typeof en !== 'string' || typeof zh !== 'string' || !Array.isArray(terms)) return undefined;
    const list = terms.filter((term): term is string => typeof term === 'string' && term.trim() !== '').map((term) => term.trim());
    if (list.length === 0) return undefined;
    topics.push({ id, name: { en, zh }, terms: list });
  }
  const [windowHours, minSources, spike, baselineDays, cooldownHours] = ['window_hours', 'min_sources', 'spike', 'baseline_days', 'cooldown_hours'].map((key) => positive(row[key]));
  if (topics.length === 0 || !windowHours || !minSources || !spike || !baselineDays || !cooldownHours) return undefined;
  return { topics, windowHours, minSources, spike, baselineDays, cooldownHours, pushInQuietHours: row['push_in_quiet_hours'] === true };
}

export function newsSettingsValue(settings: NewsSettings): Record<string, unknown> {
  return {
    window_hours: settings.windowHours,
    min_sources: settings.minSources,
    spike: settings.spike,
    baseline_days: settings.baselineDays,
    cooldown_hours: settings.cooldownHours,
    push_in_quiet_hours: settings.pushInQuietHours,
    topics: Object.fromEntries(settings.topics.map((topic) => [topic.id, { en: topic.name.en, zh: topic.name.zh, terms: topic.terms }])),
  };
}

const HAN = /\p{Script=Han}/u;

/** A topic's terms split by the edition they are asked of. */
export function termsByEdition(terms: readonly string[]): { en: string[]; zh: string[] } {
  return { en: terms.filter((term) => !HAN.test(term)), zh: terms.filter((term) => HAN.test(term)) };
}

/** The Google News query: any of the terms, quoted, in the last `hours`. */
export function topicQuery(terms: readonly string[], hours: number): string {
  return `(${terms.map((term) => `"${term.replace(/"/g, '')}"`).join(' OR ')}) when:${Math.max(1, Math.round(hours))}h`;
}

export interface Headline {
  title: string;
  source: string;
  url: string;
  /** ISO time. */
  at: string;
}

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(item: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(item);
  return match ? decode(match[1] as string) : undefined;
}

/**
 * An RSS feed's items. Google News names each outlet in <source> and ends the title with
 * " - Outlet", which is dropped; another feed's items are its own (`source`).
 */
export function parseRss(xml: string, source?: string): Headline[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap((match) => {
    const item = match[1] as string;
    const outlet = tag(item, 'source') ?? source;
    const title = tag(item, 'title');
    const at = Date.parse(tag(item, 'pubDate') ?? '');
    if (!outlet || !title || !Number.isFinite(at)) return [];
    const suffix = ` - ${outlet}`;
    return [{ title: title.endsWith(suffix) ? title.slice(0, -suffix.length) : title, source: outlet, url: tag(item, 'link') ?? '', at: new Date(at).toISOString() }];
  });
}

/** Headlines within `hours` of `now` carrying a term (any, when terms is null: the feed matched them already). */
export function matching(headlines: readonly Headline[], terms: readonly string[] | null, now: Date, hours: number): Headline[] {
  const since = now.getTime() - hours * 3_600_000;
  const lower = terms?.map((term) => term.toLowerCase());
  return headlines.filter((row) => Date.parse(row.at) >= since && (!lower || lower.some((term) => row.title.toLowerCase().includes(term))));
}

/** A topic's count: the different outlets, and the newest headlines, one per outlet. */
export function countTopic(headlines: readonly Headline[], keep = 3): { sources: number; headlines: Headline[] } {
  const byOutlet = new Map<string, Headline>();
  for (const row of [...headlines].sort((a, b) => b.at.localeCompare(a.at))) if (!byOutlet.has(row.source)) byOutlet.set(row.source, row);
  return { sources: byOutlet.size, headlines: [...byOutlet.values()].slice(0, keep) };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Runs of history that make a baseline: half a day at a run every 30 minutes. */
export const BASELINE_RUNS = 24;

export interface Verdict {
  alert: boolean;
  /** The usual count (median of the runs saved), null until BASELINE_RUNS are. */
  baseline: number | null;
  /** The count needed to alert. */
  needed: number;
  /** Why not, when not: below the count needed, or the topic alerted within the cooldown. */
  why?: 'below' | 'cooldown';
}

/** Whether a topic's count now is breaking news, against its usual count and its last alert. */
export function verdict(sources: number, history: readonly number[], lastAlertAt: string | null, now: Date, settings: NewsSettings): Verdict {
  const baseline = history.length >= BASELINE_RUNS ? median(history) : null;
  const needed = baseline === null ? settings.spike * settings.minSources : Math.max(settings.minSources, settings.spike * baseline);
  if (sources < needed) return { alert: false, baseline, needed, why: 'below' };
  if (lastAlertAt && now.getTime() - Date.parse(lastAlertAt) < settings.cooldownHours * 3_600_000) return { alert: false, baseline, needed, why: 'cooldown' };
  return { alert: true, baseline, needed };
}

export interface NewsAlert {
  id: number;
  topic: NewsTopic;
  detectedAt: string;
  sources: number;
  baseline: number | null;
  windowHours: number;
  headlines: Headline[];
}

/** The push: the topic, how many outlets in how long, and the newest headline; it opens the news list. */
export function newsMessage(alert: NewsAlert): Message {
  const top = alert.headlines[0];
  const line = top ? ` · ${top.title} (${top.source})` : '';
  return {
    kind: 'news',
    key: String(alert.id),
    title: `Breaking: ${alert.topic.name.en} 前沿新聞：${alert.topic.name.zh}`,
    body: `${alert.sources} outlets in ${alert.windowHours} h${line}\n${alert.windowHours} 小時內 ${alert.sources} 家媒體報導`,
    url: '/volatility#news',
  };
}
