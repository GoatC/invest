/**
 * The news job (N8 step 4, added 2026-11-07). GitHub Actions runs it every 30 minutes
 * (.github/workflows/news.yml): for each topic of config news it counts the outlets reporting it
 * in the last window_hours (Google News, English and Chinese editions), saves the count, and saves
 * an alert when the count is breaking news against the topic's usual count (lib/models/news); the
 * workflow then runs the push job. If Google News fails for every topic, the fallback feeds count
 * instead, two of the three at once (they are three outlets, not hundreds), and no count is saved
 * so the usual counts stay Google's. The run goes to job_runs as job "news".
 */
import { countTopic, matching, parseRss, termsByEdition, topicQuery, verdict, type Headline, type NewsSettings, type NewsTopic } from '../../../lib/models/news.ts';
import { FALLBACK_FEEDS, fallbackHeadlines, googleNewsUrl } from '../feeds/news.ts';
import type { Get } from '../feeds/types.ts';

export const JOB = 'news';

export interface NewsAlertRow {
  topic: string;
  sources: number;
  baseline: number | null;
  windowHours: number;
  headlines: Headline[];
}

export interface NewsRunDetail {
  /** Each topic's count, the count it needed and what was decided. */
  topics: Record<string, { sources: number; needed: number; baseline: number | null; outcome: 'alert' | 'below' | 'cooldown' }>;
  /** True when the fallback feeds counted instead of Google News. */
  fallback?: boolean;
  warnings: string[];
  errors: string[];
}

export interface NewsRun {
  job: string;
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'partial' | 'failed';
  detail: NewsRunDetail;
}

export interface NewsStore {
  /** config news; undefined before its migration or when malformed. */
  settings(): Promise<NewsSettings | undefined>;
  /** Each topic's counts since `since`, oldest first. */
  history(since: string): Promise<Map<string, number[]>>;
  /** Each topic's newest alert time. */
  lastAlerts(): Promise<Map<string, string>>;
  saveCounts(rows: ReadonlyArray<{ topic: string; sources: number }>, at: string): Promise<void>;
  saveAlert(row: NewsAlertRow): Promise<void>;
  /** Drops counts older than `before`. */
  prune(before: string): Promise<void>;
  recordRun(run: NewsRun): Promise<void>;
}

export interface NewsDeps {
  get: Get;
  store: NewsStore;
  now: () => Date;
  /** The pause between two Google News requests, ms. */
  gapMs?: number;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One topic's headlines from both editions of Google News, within the window. */
async function googleTopic(get: Get, topic: NewsTopic, settings: NewsSettings, now: Date, gapMs: number): Promise<Headline[]> {
  const { en, zh } = termsByEdition(topic.terms);
  const rows: Headline[] = [];
  for (const [edition, terms] of [['en', en], ['zh', zh]] as const) {
    if (terms.length === 0) continue;
    rows.push(...parseRss(await get(googleNewsUrl(topicQuery(terms, settings.windowHours), edition))));
    if (gapMs > 0) await pause(gapMs);
  }
  return matching(rows, null, now, settings.windowHours);
}

export async function runNews(deps: NewsDeps): Promise<NewsRun> {
  const startedAt = deps.now().toISOString();
  const { get, store } = deps;
  const detail: NewsRunDetail = { topics: {}, warnings: [], errors: [] };
  const finish = async (status: NewsRun['status']): Promise<NewsRun> => {
    const run: NewsRun = { job: JOB, startedAt, finishedAt: deps.now().toISOString(), status, detail };
    await store.recordRun(run);
    return run;
  };

  let settings: NewsSettings | undefined;
  let history: Map<string, number[]>;
  let last: Map<string, string>;
  const now = deps.now();
  try {
    settings = await store.settings();
    if (!settings) {
      detail.errors.push('config news is missing or malformed: apply the migration (npx supabase db push)');
      return finish('failed');
    }
    [history, last] = await Promise.all([store.history(new Date(now.getTime() - settings.baselineDays * 86_400_000).toISOString()), store.lastAlerts()]);
  } catch (err) {
    detail.errors.push(`reading the database: ${message(err)}`);
    return finish('failed');
  }

  // Google News, topic by topic.
  const counted = new Map<string, { sources: number; headlines: Headline[] }>();
  for (const topic of settings.topics) {
    try {
      counted.set(topic.id, countTopic(await googleTopic(get, topic, settings, now, deps.gapMs ?? 1_000)));
    } catch (err) {
      detail.warnings.push(`${topic.id}: google news: ${message(err)}`);
    }
  }

  // Every topic failed: the fallback feeds, against min_sources alone.
  let fallback = false;
  if (counted.size === 0) {
    fallback = true;
    detail.fallback = true;
    const headlines: Headline[] = [];
    for (const feed of FALLBACK_FEEDS) {
      try {
        headlines.push(...fallbackHeadlines(feed.kind, await get(feed.url), feed.source));
      } catch (err) {
        detail.warnings.push(`fallback ${feed.source}: ${message(err)}`);
      }
    }
    if (headlines.length === 0) {
      detail.errors.push('no feed answered: Google News and the fallback feeds all failed');
      return finish('failed');
    }
    for (const topic of settings.topics) counted.set(topic.id, countTopic(matching(headlines, topic.terms, now, settings.windowHours)));
  }

  try {
    for (const topic of settings.topics) {
      const count = counted.get(topic.id);
      if (!count) continue;
      // The fallback has no usual count: two of its three feeds at once (a spike of 2 on a min_sources of 1).
      const found = fallback ? verdict(count.sources, [], last.get(topic.id) ?? null, now, { ...settings, minSources: 1, spike: 2 }) : verdict(count.sources, history.get(topic.id) ?? [], last.get(topic.id) ?? null, now, settings);
      detail.topics[topic.id] = { sources: count.sources, needed: found.needed, baseline: found.baseline, outcome: found.alert ? 'alert' : (found.why ?? 'below') };
      if (found.alert) await store.saveAlert({ topic: topic.id, sources: count.sources, baseline: found.baseline, windowHours: settings.windowHours, headlines: count.headlines });
    }
    if (!fallback) {
      await store.saveCounts([...counted.entries()].map(([topic, count]) => ({ topic, sources: count.sources })), now.toISOString());
      await store.prune(new Date(now.getTime() - (settings.baselineDays + 1) * 86_400_000).toISOString());
    }
  } catch (err) {
    detail.errors.push(`saving: ${message(err)}`);
    return finish('failed');
  }
  return finish(detail.warnings.length > 0 || fallback ? 'partial' : 'ok');
}

/** The run's log lines: topics and counts only (public market news, no holdings). */
export function newsSummary(run: NewsRun): string[] {
  const lines = [`News job 新聞排程: ${run.status}${run.detail.fallback ? ' (fallback feeds 備援來源)' : ''}`];
  for (const [topic, row] of Object.entries(run.detail.topics)) lines.push(`  ${topic}: ${row.sources} outlets, ${row.needed} needed${row.baseline === null ? '' : `, usual ${row.baseline}`} → ${row.outcome}`);
  for (const warning of run.detail.warnings) lines.push(`  warning 警告: ${warning}`);
  for (const error of run.detail.errors) lines.push(`  error 錯誤: ${error}`);
  return lines;
}
