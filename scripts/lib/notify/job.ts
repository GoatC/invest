/**
 * The push job (PRD Section 4 and 5, Phase 1 step 10): plans the pushes due (new proposals, the
 * weekly review, the data-failure alert) and sends those whose time has come, after the quiet
 * hours. GitHub Actions runs it every hour and right after the nightly job
 * (.github/workflows/notify.yml and nightly.yml). Everything outside this file is injected, so a
 * run can be tested without a network or a database.
 */
import type { NotificationRecord } from '../../../lib/data.ts';
import { plan, type PlanInput } from '../../../lib/models/notify.ts';
import type { PushResult, Vapid } from '../../../lib/push.ts';

export interface NotifyStore {
  /** What the plan reads besides the time (loadNotifyInput in lib/data). */
  input(today: string): Promise<Omit<PlanInput, 'now'>>;
  /** Saves the planned pushes, skipping any already planned; returns how many are new. */
  plan(messages: Parameters<typeof import('../../../lib/data.ts').planNotifications>[1]): Promise<number>;
  due(now: Date): Promise<NotificationRecord[]>;
  /** Sends one push to every device; undefined when another run already had it. */
  send(notification: NotificationRecord, vapid: Vapid): Promise<(PushResult & { skipped?: boolean }) | undefined>;
}

export interface NotifyRun {
  /** Set when the VAPID settings are missing: nothing is planned or sent until they are there. */
  missing?: string[];
  planned: number;
  sent: number;
  skipped: number;
  devices: number;
  gone: number;
  errors: string[];
}

export interface NotifyDeps {
  store: NotifyStore;
  vapid: Vapid | { missing: string[] };
  now: Date;
  /** Today in Taipei. */
  today: string;
}

export async function runNotify({ store, vapid, now, today }: NotifyDeps): Promise<NotifyRun> {
  const run: NotifyRun = { planned: 0, sent: 0, skipped: 0, devices: 0, gone: 0, errors: [] };
  // Without keys nothing could be sent, and a backlog planned now would all go out at once later.
  if ('missing' in vapid) return { ...run, missing: vapid.missing };
  run.planned = await store.plan(plan({ ...(await store.input(today)), now }));
  for (const notification of await store.due(now)) {
    const result = await store.send(notification, vapid);
    if (!result) continue;
    if (result.skipped) {
      run.skipped += 1;
      continue;
    }
    run.sent += 1;
    run.devices += result.delivered.length;
    run.gone += result.gone.length;
    run.errors.push(...result.errors);
  }
  return run;
}

/** What the run prints; counts only, as the Actions log of a public repo is public. */
export function notifySummary(run: NotifyRun): string[] {
  if (run.missing) {
    return [
      `::notice::Web Push is not set up yet: missing ${run.missing.join(', ')}; see docs/web-push.md. 推播尚未設定：缺少 ${run.missing.join('、')}，設定方式見 docs/web-push.md。`,
    ];
  }
  const level = run.errors.length > 0 ? 'warning' : 'notice';
  return [
    `::${level}::Web Push: ${run.planned} planned, ${run.sent} sent (${run.devices} deliveries), ${run.skipped} skipped, ${run.gone} gone devices removed, ${run.errors.length} errors.` +
      ` 推播：新排入 ${run.planned} 則，送出 ${run.sent} 則（${run.devices} 次送達），略過 ${run.skipped} 則，移除失效裝置 ${run.gone} 台，錯誤 ${run.errors.length} 項。`,
    ...run.errors.map((error) => `::warning::${error}`),
  ];
}
