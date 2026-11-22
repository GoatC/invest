/**
 * The notifications page: a device's push subscription and when pushes may go.
 */
import { finish, MESSAGES, oneOf, text, type FieldErrors, type Parsed, type RawForm } from './core';

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceName: string | null;
}

/** A browser's push subscription as the page sends it; undefined when it is not one. */
export function parseSubscription(value: unknown): SubscriptionInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const row = value as Record<string, unknown>;
  const keys = (typeof row['keys'] === 'object' && row['keys'] !== null ? row['keys'] : {}) as Record<string, unknown>;
  const endpoint = typeof row['endpoint'] === 'string' ? row['endpoint'] : '';
  const key = (name: string) => (typeof keys[name] === 'string' && /^[A-Za-z0-9_-]{8,200}={0,2}$/.test(keys[name] as string) ? (keys[name] as string) : undefined);
  const [p256dh, auth] = [key('p256dh'), key('auth')];
  let url: URL | undefined;
  try {
    url = new URL(endpoint);
  } catch {
    url = undefined;
  }
  if (!url || url.protocol !== 'https:' || endpoint.length > 1000 || !p256dh || !auth) return undefined;
  const name = typeof row['deviceName'] === 'string' ? row['deviceName'].trim().slice(0, 60) : '';
  return { endpoint, keys: { p256dh, auth }, deviceName: name || null };
}

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export interface ScheduleInput {
  quietStart: string;
  quietEnd: string;
  weeklyDay: Weekday;
  weeklyTime: string;
}

export type ScheduleField = keyof ScheduleInput;

function clockText(raw: string | undefined): string | undefined {
  const value = text(raw);
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  return `${match[1]?.padStart(2, '0')}:${match[2]}`;
}

/** Quiet hours (config quiet_hours) and the weekly review's day and time (config weekly_review), in Taipei time. */
export function parseSchedule(raw: RawForm): Parsed<ScheduleInput, ScheduleField> {
  const errors: FieldErrors<ScheduleField> = {};
  const quietStart = clockText(raw['quietStart']);
  if (!quietStart) errors.quietStart = MESSAGES.clock;
  const quietEnd = clockText(raw['quietEnd']);
  if (!quietEnd) errors.quietEnd = MESSAGES.clock;
  else if (quietStart === quietEnd) errors.quietEnd = MESSAGES.quietSame;
  const weeklyDay = oneOf(raw['weeklyDay'], WEEKDAYS);
  if (!weeklyDay) errors.weeklyDay = MESSAGES.weekday;
  const weeklyTime = clockText(raw['weeklyTime']);
  if (!weeklyTime) errors.weeklyTime = MESSAGES.clock;
  return finish(errors, () => ({ quietStart: quietStart ?? '', quietEnd: quietEnd ?? '', weeklyDay: weeklyDay ?? 'sunday', weeklyTime: weeklyTime ?? '' }));
}
