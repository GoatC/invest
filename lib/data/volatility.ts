/**
 * N8 volatility alert: the score's settings and series, the event calendar, the shadow log and breaking news.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { addDays } from '../dates';
import type { RunStatus } from '../models/data-health';
import { readDetail, readOrders } from '../models/engine';
import type { EventKind, EventSource, MarketEvent } from '../models/events';
import { readNewsSettings, type Headline, type NewsAlert, type NewsSettings } from '../models/news';
import { shadowRows, type ShadowProposal, type ShadowRow } from '../models/shadow';
import { readVolatilitySettings, scoreHistory, VOLATILITY_SERIES, volatilityScore, type Close as VolatilityClose, type VolatilityScore, type VolatilitySettings } from '../models/volatility';
import { allRows, DataError, missingTable, rows } from './core';

// ---------------------------------------------------------------------------
// N8 volatility alert
// ---------------------------------------------------------------------------

/** The volatility job's name in job_runs (scripts/lib/volatility/job.ts). */
export const VOLATILITY_JOB = 'volatility';

async function loadVolatilitySettingsUncached(supabase: SupabaseClient): Promise<VolatilitySettings | undefined> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'volatility'));
  return readVolatilitySettings(found[0]?.value);
}

export interface VolatilityData {
  settings: VolatilitySettings | undefined;
  /** Today's score from the closes saved. */
  today?: VolatilityScore;
  /** The score on each day of the last year with a close, for the chart. */
  history?: Array<{ date: string; score: number | null; coverage: number }>;
  /** The volatility job's newest run. */
  lastRun?: { finishedAt: string; status: RunStatus } | null;
  /** The calendar's events from today on (step 2); null before its migration. */
  events?: MarketEvent[] | null;
}

interface EventRow {
  id: number;
  kind: EventKind;
  event_date: string;
  event_time: string | null;
  name_en: string;
  name_zh: string;
  source: EventSource;
  note: string | null;
}

/**
 * The calendar's events from `from` to `to` (N8 step 2), in order; null when market_events is not
 * there yet (its migration not applied), so the pushes and pages that read it keep working.
 */
export async function loadMarketEvents(supabase: SupabaseClient, from: string, to: string): Promise<MarketEvent[] | null> {
  const { data, error } = await supabase
    .from('market_events')
    .select('id, kind, event_date, event_time, name_en, name_zh, source, note')
    .gte('event_date', from)
    .lte('event_date', to)
    .order('event_date')
    .order('event_time', { nullsFirst: true });
  if (error) {
    if (/market_events/.test(error.message) && /(does not exist|schema cache|not find)/i.test(error.message)) return null;
    throw new DataError('market_events', error.message);
  }
  return ((data ?? []) as EventRow[]).map((row) => ({ id: Number(row.id), kind: row.kind, date: row.event_date, time: row.event_time, name: { en: row.name_en, zh: row.name_zh }, source: row.source, note: row.note }));
}

/** The score today and over the last year, from the series in index_prices, and the job's newest run. */
export async function loadVolatilityData(supabase: SupabaseClient, today: string): Promise<VolatilityData> {
  const settings = await loadVolatilitySettings(supabase);
  if (!settings) return { settings };
  const from = addDays(today, -(366 + settings.drawdownDays + 14));
  const [found, runs, events] = await Promise.all([
    allRows<{ index_id: string; price_date: string; close: number }>('index_prices', (start, end) =>
      supabase.from('index_prices').select('index_id, price_date, close').in('index_id', [...VOLATILITY_SERIES]).gte('price_date', from).order('index_id').order('price_date').range(start, end),
    ),
    rows<{ finished_at: string; status: RunStatus }>('job_runs', supabase.from('job_runs').select('finished_at, status').eq('job', VOLATILITY_JOB).order('finished_at', { ascending: false }).limit(1)),
    loadMarketEvents(supabase, today, addDays(today, EVENT_PAGE_DAYS)),
  ]);
  const series = new Map<string, VolatilityClose[]>();
  for (const row of found) series.set(row.index_id, [...(series.get(row.index_id) ?? []), { date: row.price_date, close: Number(row.close) }]);
  const run = runs[0];
  return {
    settings,
    today: volatilityScore(series, settings, today),
    history: scoreHistory(series, settings, addDays(today, -365), today),
    lastRun: run ? { finishedAt: run.finished_at, status: run.status } : null,
    events,
  };
}

/** The rules whose proposals the shadow log follows (N8 step 3). */
export const SHADOW_RULES = ['VOLATILITY_ALERT', 'VOLATILITY_HEDGE'];

/** The proposals the page lists, newest first. */
const SHADOW_LIMIT = 40;

/** The alert's and hedge's proposals, any status, and the quoted closes of their trades since (N8 step 3). */
export async function loadShadowLog(supabase: SupabaseClient): Promise<ShadowRow[]> {
  const found = await rows<{ id: number; rule_id: string; created_at: string; status: string; orders: unknown; detail: unknown }>(
    'proposals',
    supabase.from('proposals').select('id, rule_id, created_at, status, orders, detail').in('rule_id', SHADOW_RULES).order('created_at', { ascending: false }).limit(SHADOW_LIMIT),
  );
  const proposals: ShadowProposal[] = found.map((row) => ({
    id: Number(row.id),
    ruleId: row.rule_id,
    date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(row.created_at)),
    status: row.status,
    orders: readOrders(row.orders),
    detail: readDetail(row.detail),
  }));
  const tickers = [...new Set(proposals.flatMap((proposal) => proposal.orders.flatMap((order) => (order.kind === 'trade' ? [order.ticker] : []))))];
  const from = proposals.reduce((min, proposal) => (proposal.date < min ? proposal.date : min), '9999-12-31');
  const closes = new Map<string, Array<{ date: string; close: number }>>();
  if (tickers.length > 0) {
    const prices = await allRows<{ ticker: string; price_date: string; close: number }>('prices', (start, end) =>
      supabase.from('prices').select('ticker, price_date, close').in('ticker', tickers).gt('price_date', from).order('ticker').order('price_date').range(start, end),
    );
    for (const row of prices) closes.set(row.ticker, [...(closes.get(row.ticker) ?? []), { date: row.price_date, close: Number(row.close) }]);
  }
  return shadowRows(proposals, closes);
}

// ---------------------------------------------------------------------------
// N8 breaking news
// ---------------------------------------------------------------------------

export async function loadNewsSettings(supabase: SupabaseClient): Promise<NewsSettings | undefined> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'news'));
  return readNewsSettings(found[0]?.value);
}

/** The newest breaking-news alerts, newest first, since `since` (ISO); null before the migration. */
export async function loadNewsAlerts(supabase: SupabaseClient, settings: NewsSettings, since: string, limit = 20): Promise<NewsAlert[] | null> {
  const { data, error } = await supabase.from('news_alerts').select('id, topic, detected_at, sources, baseline, window_hours, headlines').gte('detected_at', since).order('detected_at', { ascending: false }).limit(limit);
  if (error) {
    if (missingTable('news_alerts', error.message)) return null;
    throw new DataError('news_alerts', error.message);
  }
  const topics = new Map(settings.topics.map((topic) => [topic.id, topic]));
  return ((data ?? []) as Array<{ id: number; topic: string; detected_at: string; sources: number; baseline: number | null; window_hours: number; headlines: unknown }>).map((row) => ({
    id: Number(row.id),
    topic: topics.get(row.topic) ?? { id: row.topic, name: { en: row.topic, zh: row.topic }, terms: [] },
    detectedAt: row.detected_at,
    sources: Number(row.sources),
    baseline: row.baseline === null ? null : Number(row.baseline),
    windowHours: Number(row.window_hours),
    headlines: Array.isArray(row.headlines) ? (row.headlines as Headline[]) : [],
  }));
}

/** How far back the page lists breaking news, and the push job looks for alerts not pushed yet. */
export const NEWS_PAGE_DAYS = 14;

export const NEWS_PUSH_HOURS = 24;

/** The days ahead the volatility page lists events for. */
export const EVENT_PAGE_DAYS = 120;

// One read per request (core.ts).
export const loadVolatilitySettings = cache(loadVolatilitySettingsUncached);
