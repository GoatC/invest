/** The push job's database side: the Data API with the secret key, through lib/data. */
import type { SupabaseClient } from '@supabase/supabase-js';

import { dueNotifications, loadNotifyInput, planNotifications, sendNotification } from '../../../lib/data.ts';
import type { NotifyStore } from './job.ts';

export function supabaseNotifyStore(client: SupabaseClient): NotifyStore {
  return {
    input: (today) => loadNotifyInput(client, today),
    plan: (messages) => planNotifications(client, messages),
    due: (now) => dueNotifications(client, now),
    send: (notification, vapid) => sendNotification(client, notification, vapid),
  };
}
