import Link from 'next/link';

import { taipeiDateTime } from '@/lib/format';
import { LABELS, RUN_STATUS } from '@/lib/i18n';
import type { DataHealth } from '@/lib/models/data-health';

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
  const link = (
    <>
      {' '}
      <Link href="/data">
        <Bi {...LABELS.dataStatus} />
      </Link>
    </>
  );
  if (!latest) {
    return (
      <p className="banner info" role="status">
        <Bi
          en="The nightly price job has not run yet: * = trade price."
          zh="每夜價格排程尚未執行：＊＝交易價格。"
        />
        {quiet && link}
      </p>
    );
  }
  const when = taipeiDateTime(latest.finishedAt);
  if (alert) {
    return (
      <p className="banner warn" role="alert">
        <Bi
          en={`The nightly price job has missed ${misses} nights in a row (the DATA_FAILURE rule alerts at ${threshold}); prices may be out of date. Last run ${when}, Taipei time.`}
          zh={`每夜價格排程已連續 ${misses} 晚未成功（DATA_FAILURE 規則在 ${threshold} 次時警示），價格可能不是最新。最後一次執行：台北時間 ${when}。`}
        />
        {link}
      </p>
    );
  }
  if (latest.status !== 'ok') {
    return (
      <p className="banner info" role="status">
        {latest.status === 'failed' ? (
          <Bi
            en={`The nightly price job failed on its last run, ${when} Taipei time; prices stay as last loaded.`}
            zh={`每夜價格排程最後一次執行（台北時間 ${when}）失敗；價格維持上次載入的數值。`}
          />
        ) : (
          <Bi
            en={`The nightly price job last ran ${when}, Taipei time, and could not load everything; the rest keeps its previous price.`}
            zh={`每夜價格排程最後一次於台北時間 ${when} 執行，部分資料未能載入；未載入的項目沿用先前的價格。`}
          />
        )}
        {link}
      </p>
    );
  }
  if (quiet) return null;
  return (
    <p className="banner ok" role="status">
      <Bi en={`The nightly price job last ran ${when}, Taipei time, and loaded everything.`} zh={`每夜價格排程最後一次於台北時間 ${when} 執行，資料全部載入。`} />
    </p>
  );
}
