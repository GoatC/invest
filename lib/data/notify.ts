/**
 * Web Push and the weekly review: what the push plan reads, the planned and sent pushes, the
 * devices, the iOS shell's local reminders and the widget key's date.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { addDays } from '../dates';
import { dataHealth } from '../models/data-health';
import { dividendPushes } from '../models/dividends';
import type { ProposalStatus } from '../models/engine';
import { eventMessage, remindersDue } from '../models/events';
import { LOCAL_REMINDER_DAYS, localReminders, type LocalReminder } from '../models/local-reminders';
import { newsMessage } from '../models/news';
import { readQuietHours, readWeeklyReview, weeklySummary, type Message, type PlanInput, type ProposalForPush, type WeeklySummary } from '../models/notify';
import { buildPortfolio } from '../models/portfolio';
import { proposalTitle } from '../proposal-text';
import { pushToAll, type DeviceSubscription, type PushResult, type Sender, type Vapid } from '../push';
import { DataError, missingTable, rows } from './core';
import { loadDividendView } from './dividends';
import { loadAssetClasses, loadHoldingsData } from './holdings';
import { loadProposals, loadRules } from './rules';
import { loadJobRuns } from './status';
import { loadMarketEvents, loadNewsAlerts, loadNewsSettings, loadVolatilitySettings, NEWS_PUSH_HOURS } from './volatility';

/** Both pools' value at the newest NAV snapshot up to `today`, and at the newest one a week or more before it. */
export async function loadValueWeek(supabase: SupabaseClient, today: string): Promise<{ valueTwd: number | null; weekAgoTwd: number | null }> {
  const latest = await rows<{ snapshot_date: string; total_twd: number }>(
    'nav_snapshots',
    supabase.from('nav_snapshots').select('snapshot_date, total_twd').lte('snapshot_date', today).order('snapshot_date', { ascending: false }).limit(1),
  );
  const newest = latest[0];
  if (!newest) return { valueTwd: null, weekAgoTwd: null };
  const weekAgo = await rows<{ total_twd: number }>(
    'nav_snapshots',
    supabase.from('nav_snapshots').select('total_twd').lte('snapshot_date', addDays(newest.snapshot_date, -7)).order('snapshot_date', { ascending: false }).limit(1),
  );
  return { valueTwd: Number(newest.total_twd), weekAgoTwd: weekAgo[0] ? Number(weekAgo[0].total_twd) : null };
}

/**
 * The weekly review's three figures (PRD Section 5): proposals waiting, the core class furthest
 * from its target in the regular pool as held now, and both pools' value at the newest NAV
 * snapshot against the one a week before it.
 */
export async function loadWeeklySummary(supabase: SupabaseClient, today: string): Promise<WeeklySummary> {
  const [holdings, proposals, value] = await Promise.all([
    loadHoldingsData(supabase),
    rows<{ status: ProposalStatus }>('proposals', supabase.from('proposals').select('status').eq('status', 'open')),
    loadValueWeek(supabase, today),
  ]);
  const portfolio = buildPortfolio(holdings);
  return weeklySummary({ statuses: proposals.map((row) => row.status), classes: portfolio.classes, poolTwd: portfolio.pool.totalTwd, ...value });
}

/** Everything the push plan reads besides the time (lib/models/notify.ts plan). */
export async function loadNotifyInput(supabase: SupabaseClient, today: string): Promise<Omit<PlanInput, 'now'>> {
  const [proposals, rules, classes, config, planned, summary, jobs] = await Promise.all([
    loadProposals(supabase, today),
    loadRules(supabase),
    loadAssetClasses(supabase),
    rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').in('key', ['quiet_hours', 'weekly_review'])),
    rows<{ kind: string; key: string }>('notifications', supabase.from('notifications').select('kind, key').in('kind', ['proposal', 'weekly', 'event', 'news', 'dividend']).gte('created_at', addDays(today, -400))),
    loadWeeklySummary(supabase, today),
    loadJobRuns(supabase),
  ]);
  // The event reminders (N8 step 2): none before config volatility or market_events exist.
  const volatility = await loadVolatilitySettings(supabase);
  const events = volatility ? await loadMarketEvents(supabase, addDays(today, 1), addDays(today, volatility.events.leadDays)) : null;
  const eventKeys = new Set(planned.filter((row) => row.kind === 'event').map((row) => row.key));
  const reminders = volatility && events ? remindersDue(events, today, volatility.events, eventKeys).map((event) => eventMessage(event, today)) : [];
  // Breaking news (N8 step 4): each alert of the last day not pushed yet; none before config news exists.
  const newsSettings = await loadNewsSettings(supabase);
  const newsKeys = new Set(planned.filter((row) => row.kind === 'news').map((row) => row.key));
  const fresh = newsSettings ? await loadNewsAlerts(supabase, newsSettings, new Date(Date.now() - NEWS_PUSH_HOURS * 3_600_000).toISOString(), 50) : null;
  const news = newsSettings && fresh ? { messages: fresh.filter((alert) => !newsKeys.has(String(alert.id))).map(newsMessage), urgent: newsSettings.pushInQuietHours } : undefined;
  // Dividends paid and not recorded (2026-11-12): one push each, on the day; none before config dividends exists.
  const dividendView = await loadDividendView(supabase, today);
  const dividends = dividendView ? dividendPushes(dividendView.due, dividendView.settings, today, new Set(planned.filter((row) => row.kind === 'dividend').map((row) => row.key))) : [];
  const value = (key: string) => config.find((row) => row.key === key)?.value;
  const pushed = new Set(planned.filter((row) => row.kind === 'proposal').map((row) => row.key));
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const open: ProposalForPush[] = proposals
    .filter((proposal) => proposal.status === 'open' && !pushed.has(String(proposal.id)))
    .map((proposal) => {
      const rule = byId.get(proposal.ruleId) ?? { id: proposal.ruleId, condition: '' };
      const urgent = rule.condition === 'volatility_score_crosses' && (('threshold' in rule ? rule.threshold : null) as Record<string, unknown> | null)?.['push_in_quiet_hours'] === true;
      return { id: proposal.id, ruleId: proposal.ruleId, condition: rule.condition, title: proposalTitle(rule), state: proposal.state, detail: proposal.detail, ...(urgent ? { urgent } : {}) };
    });
  return {
    proposals: open,
    names: new Map(classes.map((assetClass) => [assetClass.id, { en: assetClass.nameEn, zh: assetClass.nameZh }])),
    weekly: readWeeklyReview(value('weekly_review')),
    weeklyKeys: new Set(planned.filter((row) => row.kind === 'weekly').map((row) => row.key)),
    summary,
    health: dataHealth(jobs.runs, jobs.threshold, today),
    lastGoodRunId: jobs.runs.find((run) => run.status !== 'failed')?.id ?? null,
    quiet: readQuietHours(value('quiet_hours')),
    reminders,
    ...(news ? { news } : {}),
    dividends,
  };
}

/** A planned or sent push, as the notifications table holds it. */
export interface NotificationRecord extends Message {
  id: number;
  createdAt: string;
  sendAfter: string;
  sentAt: string | null;
  delivered: number | null;
  error: string | null;
}

const NOTIFICATION_COLUMNS = 'id, kind, key, title, body, url, created_at, send_after, sent_at, delivered, error';

interface NotificationRow {
  id: number;
  kind: Message['kind'];
  key: string;
  title: string;
  body: string;
  url: string;
  created_at: string;
  send_after: string;
  sent_at: string | null;
  delivered: number | null;
  error: string | null;
}

function toNotification(row: NotificationRow): NotificationRecord {
  return {
    id: Number(row.id),
    kind: row.kind,
    key: row.key,
    title: row.title,
    body: row.body,
    url: row.url,
    createdAt: row.created_at,
    sendAfter: row.send_after,
    sentAt: row.sent_at,
    delivered: row.delivered,
    error: row.error,
  };
}

/** Plans pushes; one already planned (same kind and key) is left as it is. Returns how many are new. */
export async function planNotifications(supabase: SupabaseClient, messages: ReadonlyArray<Message & { sendAfter: Date }>): Promise<number> {
  if (messages.length === 0) return 0;
  const { data, error } = await supabase
    .from('notifications')
    .upsert(
      messages.map((message) => ({ kind: message.kind, key: message.key, title: message.title, body: message.body, url: message.url, send_after: message.sendAfter.toISOString() })),
      { onConflict: 'kind,key', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new DataError('notifications', error.message);
  return data?.length ?? 0;
}

/** Pushes planned and not sent, whose time has come, oldest first. */
export async function dueNotifications(supabase: SupabaseClient, now: Date): Promise<NotificationRecord[]> {
  const found = await rows<NotificationRow>(
    'notifications',
    supabase.from('notifications').select(NOTIFICATION_COLUMNS).is('sent_at', null).lte('send_after', now.toISOString()).order('id'),
  );
  return found.map(toNotification);
}

/** The newest pushes, for the notifications page. */
export async function loadNotifications(supabase: SupabaseClient, limit = 30): Promise<NotificationRecord[]> {
  const found = await rows<NotificationRow>('notifications', supabase.from('notifications').select(NOTIFICATION_COLUMNS).order('id', { ascending: false }).limit(limit));
  return found.map(toNotification);
}

/** A device the owner turned notifications on for. */
export interface DeviceRecord extends DeviceSubscription {
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  lastError: string | null;
}

export async function loadDevices(supabase: SupabaseClient): Promise<DeviceRecord[]> {
  const found = await rows<{ id: number; endpoint: string; keys: { p256dh: string; auth: string }; device_name: string | null; created_at: string; last_used_at: string | null; last_error: string | null }>(
    'push_subscriptions',
    supabase.from('push_subscriptions').select('id, endpoint, keys, device_name, created_at, last_used_at, last_error').order('id'),
  );
  return found.map((row) => ({
    id: Number(row.id),
    endpoint: row.endpoint,
    keys: row.keys,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
  }));
}

/**
 * Sends one planned push to every device, once: the row is claimed first, so two jobs at once
 * cannot both send it. A proposal decided before its push went out is skipped. Devices the push
 * service says are gone are removed. Returns the outcome, or undefined when another run had it.
 */
export async function sendNotification(supabase: SupabaseClient, notification: NotificationRecord, vapid: Vapid, send?: Sender): Promise<(PushResult & { skipped?: boolean }) | undefined> {
  const now = new Date().toISOString();
  const claimed = await supabase.from('notifications').update({ sent_at: now }).eq('id', notification.id).is('sent_at', null).select('id');
  if (claimed.error) throw new DataError('notifications', claimed.error.message);
  if (!claimed.data || claimed.data.length === 0) return undefined;
  const finish = async (delivered: number, error: string | null) => {
    const { error: updateError } = await supabase.from('notifications').update({ delivered, error }).eq('id', notification.id);
    if (updateError) throw new DataError('notifications', updateError.message);
  };
  if (notification.kind === 'proposal') {
    const [proposal] = await rows<{ status: string }>('proposals', supabase.from('proposals').select('status').eq('id', Number(notification.key)));
    if (proposal?.status !== 'open') {
      await finish(0, 'skipped: the proposal was decided first');
      return { delivered: [], gone: [], errors: [], skipped: true };
    }
  }
  const devices = await loadDevices(supabase);
  if (devices.length === 0) {
    await finish(0, 'no devices');
    return { delivered: [], gone: [], errors: [] };
  }
  const result = await pushToAll(devices, { title: notification.title, body: notification.body, url: notification.url, tag: `${notification.kind}-${notification.key}` }, vapid, send);
  if (result.gone.length > 0) {
    const { error } = await supabase.from('push_subscriptions').delete().in('id', result.gone);
    if (error) throw new DataError('push_subscriptions', error.message);
  }
  if (result.delivered.length > 0) {
    const { error } = await supabase.from('push_subscriptions').update({ last_used_at: now, last_error: null }).in('id', result.delivered);
    if (error) throw new DataError('push_subscriptions', error.message);
  }
  await finish(result.delivered.length, result.errors.length > 0 ? result.errors.join('; ') : result.gone.length > 0 ? `${result.gone.length} device(s) gone, removed` : null);
  return result;
}

/**
 * When the home-screen widget's key was made (ISO), or null with none; the key itself is never
 * stored. Null too before its migration is applied, so the push page keeps working.
 */
export async function loadWidgetKeyDate(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.from('widget_key').select('created_at').maybeSingle();
  if (error) {
    if (missingTable('widget_key', error.message)) return null;
    throw new DataError('widget_key', error.message);
  }
  return (data as { created_at: string } | null)?.created_at ?? null;
}

/**
 * What the iOS shell schedules on the phone (lib/models/local-reminders.ts, app/shell/reminders):
 * the reminders of the next 14 days, and how many devices get the web app's pushes, which the
 * shell's settings read to leave on only what would not come twice.
 */
export async function loadLocalReminders(supabase: SupabaseClient, now: Date, today: string): Promise<{ reminders: LocalReminder[]; pushDevices: number }> {
  const [config, volatility, dividendView, devices] = await Promise.all([
    rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').in('key', ['quiet_hours', 'weekly_review'])),
    loadVolatilitySettings(supabase),
    loadDividendView(supabase, today),
    rows<{ id: number }>('push_subscriptions', supabase.from('push_subscriptions').select('id')),
  ]);
  const events = volatility ? await loadMarketEvents(supabase, today, addDays(today, LOCAL_REMINDER_DAYS + volatility.events.leadDays)) : null;
  const value = (key: string) => config.find((row) => row.key === key)?.value;
  const reminders = localReminders({
    now,
    today,
    quiet: readQuietHours(value('quiet_hours')),
    weekly: readWeeklyReview(value('weekly_review')),
    events,
    eventSettings: volatility?.events ?? null,
    dividends: dividendView ? [...dividendView.due, ...dividendView.upcoming] : null,
    dividendSettings: dividendView?.settings ?? null,
  });
  return { reminders, pushDevices: devices.length };
}
