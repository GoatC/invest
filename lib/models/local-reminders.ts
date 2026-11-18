/**
 * The reminders the iOS shell schedules on the phone itself (PRD Section 5, "Phone redesign" step 8:
 * a free-signed app gets no push, and a web view no Web Push). Only what can be known ahead is
 * scheduled: the weekly review, an event's reminder, a dividend's asking day; the shell adds the
 * day before its own build runs out (ios/Shell/Reminders.swift). Each comes at the time and with
 * the words the push would have had (lib/models/notify.ts, events.ts, dividends.ts): the weekly
 * review at its time, the others in the morning as the quiet hours end, never inside them. What
 * cannot be known ahead (a rule warning, the volatility alert, news) stays with the web app's pushes.
 * Pure functions; lib/data.ts loadLocalReminders reads what they need, app/shell/reminders serves them.
 */
import { addDays } from '../dates';
import { dividendMessage, dueKey, type DividendDue, type DividendSettings } from './dividends';
import { eventKey, eventMessage, type EventSettings, type MarketEvent } from './events';
import { instantOf, lastWeeklyReview, quietUntil, type QuietHours, type WeeklyReview } from './notify';

/** How far ahead the shell is given reminders; it asks again each time the app opens. */
export const LOCAL_REMINDER_DAYS = 14;
/** iOS keeps 64 scheduled notifications for an app: room is left for the shell's own. */
export const LOCAL_REMINDER_MAX = 48;
/** The morning time when there are no quiet hours: 09:00 Taipei. */
const MORNING = { minutes: 9 * 60, timeZone: 'Asia/Taipei' };

export type LocalReminderKind = 'weekly' | 'event' | 'dividend';
export const LOCAL_REMINDER_KINDS: readonly LocalReminderKind[] = ['weekly', 'event', 'dividend'];

export interface LocalReminder {
  /** Unique and stable: the same reminder keeps its id from one opening to the next. */
  id: string;
  kind: LocalReminderKind;
  /** When it shows, as an ISO instant. */
  at: string;
  title: string;
  body: string;
  /** The page a tap opens. */
  url: string;
}

export interface LocalReminderInput {
  now: Date;
  /** Today in Taipei. */
  today: string;
  quiet: QuietHours | null;
  weekly: WeeklyReview | null;
  /** The market events from tomorrow on; null before config volatility or the calendar exist. */
  events: readonly MarketEvent[] | null;
  eventSettings: EventSettings | null;
  /** The dividends not recorded, asked about today and ahead; null before config dividends exists. */
  dividends: readonly DividendDue[] | null;
  dividendSettings: DividendSettings | null;
}

/** The morning of a Taipei date: when the quiet hours end, or 09:00 without them. */
function morning(date: string, quiet: QuietHours | null): Date {
  return quiet ? instantOf(date, quiet.end, quiet.timeZone) : instantOf(date, MORNING.minutes, MORNING.timeZone);
}

/** The reminders from now to LOCAL_REMINDER_DAYS ahead, the soonest first. */
export function localReminders(input: LocalReminderInput): LocalReminder[] {
  const { now, today, quiet } = input;
  const until = now.getTime() + LOCAL_REMINDER_DAYS * 86_400_000;
  const out: Array<LocalReminder & { time: number }> = [];
  const add = (kind: LocalReminderKind, id: string, at: Date, message: { title: string; body: string; url: string }) => {
    const time = at.getTime();
    if (time > now.getTime() && time <= until) out.push({ id: `${kind}:${id}`, kind, at: at.toISOString(), title: message.title, body: message.body, url: message.url, time });
  };

  // The weekly review, each week ahead: at its time, or when the quiet hours end if it falls in them.
  if (input.weekly) {
    const last = lastWeeklyReview(now, input.weekly);
    for (let week = 1; week <= Math.ceil(LOCAL_REMINDER_DAYS / 7) + 1; week += 1) {
      const date = addDays(last.key, 7 * week);
      const at = instantOf(date, input.weekly.minutes, input.weekly.timeZone);
      add('weekly', date, quietUntil(at, quiet) ?? at, { title: '每週檢視', body: '本週的三行摘要：規則狀態、最大偏離、市值與本週變化。', url: '/' });
    }
  }

  // An event's reminder, lead_days before it, in the morning: the day the push job would send it.
  if (input.events && input.eventSettings) {
    const settings = input.eventSettings;
    for (const event of input.events) {
      if (!settings.remind.includes(event.kind)) continue;
      const day = addDays(event.date, -settings.leadDays);
      if (day < today) continue;
      add('event', eventKey(event), morning(day, quiet), eventMessage(event, day));
    }
  }

  // A dividend on its asking day, in the morning, when dividends are pushed at all.
  if (input.dividends && input.dividendSettings?.push) {
    for (const line of input.dividends) {
      if (line.askOn < today) continue;
      add('dividend', dueKey(line), morning(line.askOn, quiet), dividendMessage(line));
    }
  }

  return out
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
    .slice(0, LOCAL_REMINDER_MAX)
    .map(({ time: _time, ...reminder }) => reminder);
}
