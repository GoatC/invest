/**
 * The volatility alert's event calendar (N8 step 2, added 2026-11-06): the market events known in
 * advance, and a reminder pushed `lead_days` (2) before each.
 *
 * - FOMC rate decisions from the Fed's calendar: the second day of each meeting at 14:00 New York.
 * - US CPI and the jobs report (Employment Situation) from FRED's release calendar, at the time it
 *   gives (Central Time).
 * - Taiwan's central bank board meetings and anything else (elections), typed in by Hugo.
 * Every event is kept by its Taipei date and time, as Hugo lives by them. Implied volatility tends
 * to rise before an event and fall after it, so a reminder proposes no orders.
 * Pure functions; the volatility job loads the feeds, lib/data and the push job read the rows.
 */
import { addDays } from '../dates';
import type { Bilingual } from '../i18n';
import { instantOf, localTime, type Message } from './notify';

export const EVENT_KINDS = ['fomc', 'cpi', 'payrolls', 'cbc', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
/** Where a row comes from: the Fed's calendar, FRED's release calendar, or typed in. */
export type EventSource = 'fed' | 'fred' | 'typed';

export interface MarketEvent {
  id?: number;
  kind: EventKind;
  /** The Taipei date, YYYY-MM-DD. */
  date: string;
  /** The Taipei time, HH:MM, when known. */
  time: string | null;
  name: Bilingual;
  source: EventSource;
  note: string | null;
}

export const KIND_NAMES: Record<EventKind, Bilingual> = {
  fomc: { en: 'FOMC rate decision', zh: '聯準會利率決議' },
  cpi: { en: 'US CPI', zh: '美國 CPI' },
  payrolls: { en: 'US jobs report', zh: '美國非農就業' },
  cbc: { en: "Taiwan's central bank meeting", zh: '央行理監事會議' },
  other: { en: 'Other event', zh: '其他事件' },
};

export interface EventSettings {
  /** Days before an event its reminder is pushed. */
  leadDays: number;
  /** The kinds reminded of. */
  remind: EventKind[];
}

export const EVENT_DEFAULTS: EventSettings = { leadDays: 2, remind: [...EVENT_KINDS] };

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** config volatility.events; the defaults when missing, undefined when malformed. */
export function readEventSettings(value: unknown): EventSettings | undefined {
  if (value === undefined || value === null) return { ...EVENT_DEFAULTS, remind: [...EVENT_DEFAULTS.remind] };
  const row = record(value);
  const lead = row['lead_days'];
  const remind = row['remind'];
  if (typeof lead !== 'number' || !Number.isInteger(lead) || lead < 1 || lead > 14) return undefined;
  if (!Array.isArray(remind) || !remind.every((kind) => (EVENT_KINDS as readonly unknown[]).includes(kind))) return undefined;
  return { leadDays: lead, remind: EVENT_KINDS.filter((kind) => remind.includes(kind)) };
}

export function eventSettingsValue(settings: EventSettings): Record<string, unknown> {
  return { lead_days: settings.leadDays, remind: settings.remind };
}

/** A clock time in a time zone on a date, as Taipei's date and HH:MM. */
export function toTaipei(date: string, time: string, timeZone: string): { date: string; time: string } {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  const local = localTime(instantOf(date, hours * 60 + minutes, timeZone), 'Asia/Taipei');
  return { date: local.date, time: `${String(Math.floor(local.minutes / 60)).padStart(2, '0')}:${String(local.minutes % 60).padStart(2, '0')}` };
}

/** "7:30 am" / "2:00 pm" → "07:30" / "14:00"; undefined when unreadable. */
export function clock24(text: string): string | undefined {
  const match = /^\s*(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\s*$/i.exec(text);
  if (!match) return undefined;
  let hours = Number(match[1]) % 12;
  if ((match[3] as string).toLowerCase() === 'p') hours += 12;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

/** The events from `from` to `to`, both included, in order. */
export function eventsBetween(events: readonly MarketEvent[], from: string, to: string): MarketEvent[] {
  return events.filter((event) => event.date >= from && event.date <= to).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.name.en.localeCompare(b.name.en));
}

/** What makes a reminder once only: its kind, Taipei date and name. */
export function eventKey(event: MarketEvent): string {
  return `${event.kind}:${event.date}:${event.name.en}`.slice(0, 200);
}

/**
 * The reminders due today: events of a kind reminded of, from tomorrow to `leadDays` ahead (so a
 * reminder missed on its day, or an event typed in late, still goes once), not planned before.
 */
export function remindersDue(events: readonly MarketEvent[], today: string, settings: EventSettings, planned: ReadonlySet<string>): MarketEvent[] {
  return eventsBetween(events, addDays(today, 1), addDays(today, settings.leadDays)).filter((event) => settings.remind.includes(event.kind) && !planned.has(eventKey(event)));
}

const WEEKDAY: ReadonlyArray<Bilingual> = [
  { en: 'Sun', zh: '週日' },
  { en: 'Mon', zh: '週一' },
  { en: 'Tue', zh: '週二' },
  { en: 'Wed', zh: '週三' },
  { en: 'Thu', zh: '週四' },
  { en: 'Fri', zh: '週五' },
  { en: 'Sat', zh: '週六' },
];

/** "Thu 2026-12-10 03:00" in each language. */
export function whenText(event: MarketEvent): Bilingual {
  const day = WEEKDAY[new Date(`${event.date}T00:00:00Z`).getUTCDay()] as Bilingual;
  const time = event.time ? ` ${event.time}` : '';
  return { en: `${day.en} ${event.date}${time}`, zh: `${event.date}（${day.zh}）${time}` };
}

/** The reminder: what and when (Taipei), and that it proposes no orders; it opens the calendar. */
export function eventMessage(event: MarketEvent, today: string): Message {
  const days = Math.round((Date.parse(`${event.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const when = whenText(event);
  const name = event.name;
  return {
    kind: 'event',
    key: eventKey(event),
    title: `In ${days} day${days === 1 ? '' : 's'}: ${name.en} ${days} 天後：${name.zh}`,
    body: `${when.en} Taipei. Volatility often rises before and falls after; no orders.\n台北時間 ${when.zh}。事件前波動常升高、事件後回落；不附下單清單。`,
    url: '/volatility#events',
  };
}
