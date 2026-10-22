'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { DataError, orDataError, sendNotification, type NotificationRecord } from '@/lib/data';
import { ACTION_MESSAGES, formFields, parseId, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { vapidFromEnv } from '@/lib/push';
import { parseSchedule, parseSubscription, type FieldErrors, type ScheduleField } from '@/lib/validation';

/** Saves this device's push subscription; turning it on again on the same device updates its row. */
export async function saveSubscription(subscription: unknown): Promise<{ ok: boolean; message: Bilingual }> {
  const { supabase } = await requireSession();
  const parsed = parseSubscription(subscription);
  if (!parsed) return { ok: false, message: { en: 'The browser sent something that is not a push subscription.', zh: '瀏覽器傳來的不是推播訂閱。' } };
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ endpoint: parsed.endpoint, keys: parsed.keys, device_name: parsed.deviceName, last_error: null }, { onConflict: 'endpoint' });
  if (error) return { ok: false, message: saveFailed(error.message) };
  return { ok: true, message: { en: 'Notifications are on for this device.', zh: '這台裝置已開啟推播。' } };
}

/** Forgets a device; it gets no more pushes. */
export async function removeDevice(formData: FormData): Promise<void> {
  const { supabase } = await requireSession();
  const id = parseId(formFields(formData)['id']);
  if (id !== undefined) {
    const { error } = await supabase.from('push_subscriptions').delete().eq('id', id);
    if (error) redirect(`/notifications?failed=${encodeURIComponent(error.message)}`);
  }
  redirect('/notifications?saved=removed');
}

export interface TestState {
  message: Bilingual | null;
  ok: boolean;
}

/** Sends a test push to every device now, quiet hours or not, and logs it like any other. */
export async function sendTest(_previous: TestState): Promise<TestState> {
  const { supabase } = await requireSession();
  const vapid = vapidFromEnv();
  if ('missing' in vapid) {
    return {
      ok: false,
      message: {
        en: `The app cannot send yet: ${vapid.missing.join(', ')} missing from Vercel's environment variables (docs/web-push.md).`,
        zh: `App 還不能送出推播：Vercel 的環境變數缺少 ${vapid.missing.join('、')}（見 docs/web-push.md）。`,
      },
    };
  }
  const at = new Date().toISOString();
  const { data, error } = await supabase
    .from('notifications')
    .insert({ kind: 'test', key: at, title: 'Test 測試推播', body: 'Notifications work on this device.\n這台裝置可以收到推播。', url: '/notifications' })
    .select('id, kind, key, title, body, url, created_at, send_after, sent_at, delivered, error');
  if (error || !data?.[0]) return { ok: false, message: saveFailed(error?.message ?? 'notifications') };
  const row = data[0] as { id: number; kind: 'test'; key: string; title: string; body: string; url: string; created_at: string; send_after: string; sent_at: null; delivered: null; error: null };
  const notification: NotificationRecord = { ...row, id: Number(row.id), createdAt: row.created_at, sendAfter: row.send_after, sentAt: null };
  const result = await orDataError(sendNotification(supabase, notification, vapid));
  if (result instanceof DataError) return { ok: false, message: saveFailed(result.detail) };
  if (!result || result.delivered.length === 0) {
    return {
      ok: false,
      message: result?.errors.length
        ? { en: `No device took it: ${result.errors.join('; ')}.`, zh: `沒有裝置收到：${result.errors.join('；')}。` }
        : { en: 'No device has notifications on yet: turn them on above first.', zh: '還沒有裝置開啟推播：請先在上方開啟。' },
    };
  }
  return { ok: true, message: { en: `Sent to ${result.delivered.length} device${result.delivered.length === 1 ? '' : 's'}; it should arrive within a minute.`, zh: `已送到 ${result.delivered.length} 台裝置，應在一分鐘內收到。` } };
}

export interface ScheduleState {
  errors: FieldErrors<ScheduleField>;
  message: Bilingual | null;
}

/** Saves the quiet hours and the weekly review's day and time, in Taipei time. */
export async function saveSchedule(_previous: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const { supabase } = await requireSession();
  const parsed = parseSchedule(formFields(formData));
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const zone = 'Asia/Taipei';
  const results = await Promise.all([
    supabase.from('config').update({ value: { start: parsed.value.quietStart, end: parsed.value.quietEnd, time_zone: zone } }).eq('key', 'quiet_hours').select('key'),
    supabase.from('config').update({ value: { day: parsed.value.weeklyDay, time: parsed.value.weeklyTime, time_zone: zone } }).eq('key', 'weekly_review').select('key'),
  ]);
  const error = results.find((result) => result.error)?.error;
  if (error) return { errors: {}, message: saveFailed(error.message) };
  if (results.some((result) => !result.data?.length)) {
    return { errors: {}, message: { en: 'The quiet_hours or weekly_review setting is missing: run npx supabase db push.', zh: '找不到 quiet_hours 或 weekly_review 設定：請執行 npx supabase db push。' } };
  }
  redirect('/notifications?saved=schedule');
}
