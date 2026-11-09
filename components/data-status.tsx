import { taipeiDateTime } from '@/lib/format';
import type { AlertItem } from '@/lib/alerts';
import { RUN_STATUS } from '@/lib/i18n';
import type { DataHealth } from '@/lib/models/data-health';

import { AlertTiles } from './alert-tiles';
import { Bi } from './bi';

export function RunStatusBadge({ status }: { status: keyof typeof RUN_STATUS }) {
  return (
    <span className={status === 'ok' ? 'badge' : 'badge warn'}>
      <Bi {...RUN_STATUS[status]} />
    </span>
  );
}

/** Whether the quiet banner has anything to say: the job never ran, missed its nights, or last loaded only part. */
export function hasNotice(health: DataHealth): boolean {
  return !health.latest || health.alert || health.latest.status !== 'ok';
}

/**
 * Whether prices are current, from the nightly job's runs: an alert once the DATA_FAILURE rule's
 * misses in a row are reached, a note while the job has never run or last loaded only part of the
 * data. `quiet` leaves out the line for a healthy run (the notice on loading the app shows nothing then).
 */
export function DataHealthBanner({ health, threshold, quiet = false }: { health: DataHealth; threshold: number | null; quiet?: boolean }) {
  const { latest, misses, alert } = health;
  const title = { en: 'Nightly prices', zh: '每夜價格' };
  const tile = (item: Omit<AlertItem, 'key' | 'title' | 'href'>) => <AlertTiles items={[{ key: 'nightly', title, href: '/data', ...item }]} />;
  if (!latest) {
    return tile({ tone: 'info', value: '…', chips: [{ label: { en: 'Not run yet', zh: '尚未執行' }, value: '＊＝交易價格' }] });
  }
  const when = taipeiDateTime(latest.finishedAt);
  const lastRun = { label: { en: 'Last run (Taipei)', zh: '最後執行' }, value: when };
  if (alert) {
    return tile({
      tone: 'watch',
      value: `${misses} 晚未成功`,
      chips: [...(threshold === null ? [] : [{ label: { en: 'DATA_FAILURE alerts at', zh: '警示門檻' }, value: `${threshold} 晚` }]), lastRun],
    });
  }
  if (latest.status !== 'ok') {
    return tile({ tone: 'info', value: RUN_STATUS[latest.status].zh, chips: [lastRun, { label: { en: 'The rest keeps its last price', zh: '未載入者' }, value: '沿用前值' }] });
  }
  if (quiet) return null;
  return tile({ tone: 'ok', value: RUN_STATUS.ok.zh, chips: [lastRun] });
}
