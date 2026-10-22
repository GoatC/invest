import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { TaipeiTime } from '@/components/history';
import { requireSession } from '@/lib/auth';
import { DataError, loadDevices, loadNotifications, type DeviceRecord, type NotificationRecord } from '@/lib/data';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { readQuietHours, readWeeklyReview } from '@/lib/models/notify';
import { vapidFromEnv } from '@/lib/push';
import { WEEKDAYS } from '@/lib/validation';

import { removeDevice } from './actions';
import { PushSetup } from './push-setup';
import { ScheduleForm } from './schedule-form';

type Params = Record<string, string | string[] | undefined>;

const KIND: Record<NotificationRecord['kind'], Bilingual> = {
  proposal: { en: 'Proposal', zh: '提案' },
  weekly: { en: 'Weekly review', zh: '每週檢視' },
  data_failure: { en: 'Data failure', zh: '資料異常' },
  test: { en: 'Test', zh: '測試' },
};

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Web Push (Phase 1, step 10): which devices get pushes, when they may arrive, and what was sent. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  let devices: DeviceRecord[];
  let sent: NotificationRecord[];
  let settings: Array<{ key: string; value: unknown }>;
  try {
    const [found, log, config] = await Promise.all([
      loadDevices(supabase),
      loadNotifications(supabase),
      supabase.from('config').select('key, value').in('key', ['quiet_hours', 'weekly_review']),
    ]);
    if (config.error) throw new DataError('config', config.error.message);
    devices = found;
    sent = log;
    settings = (config.data ?? []) as Array<{ key: string; value: unknown }>;
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  const quiet = readQuietHours(settings.find((row) => row.key === 'quiet_hours')?.value);
  const weekly = readWeeklyReview(settings.find((row) => row.key === 'weekly_review')?.value);
  const publicKey = process.env['NEXT_PUBLIC_VAPID_PUBLIC_KEY']?.trim() || null;
  const server = vapidFromEnv();
  const saved = params['saved'];

  return (
    <>
      <section className="card form">
        <h1>
          <Bi {...LABELS.notifications} />
        </h1>
        <p className="muted">
          <Bi
            en="The app pushes only when a decision is due: a new proposal from the rules, the weekly review with its three lines, or a data failure. Never a price move. Pushes wait out the quiet hours."
            zh="App 只在需要你做決定時推播：規則產生的新提案、三行的每週檢視摘要，或資料異常；不推播價格波動。安靜時段內的推播會等到時段結束後才送出。"
          />
        </p>
        {saved && (
          <p className="banner ok" role="status">
            <Bi {...(saved === 'schedule' ? { en: 'Saved; pushes follow the new times.', zh: '已儲存，推播改依新的時間。' } : { en: 'Device removed.', zh: '已移除裝置。' })} />
          </p>
        )}
        {'missing' in server && (
          <p className="banner warn">
            <Bi
              en={`Web Push is not set up yet: ${server.missing.join(', ')} missing here. docs/web-push.md walks through it.`}
              zh={`推播尚未設定：缺少 ${server.missing.join('、')}。設定步驟見 docs/web-push.md。`}
            />
          </p>
        )}
        <PushSetup publicKey={publicKey} devices={devices.map((device) => ({ id: device.id, endpoint: device.endpoint }))} />
      </section>

      <section className="card form">
        <h2>
          <Bi en="Devices" zh="裝置" />
        </h2>
        {devices.length === 0 ? (
          <p className="muted">
            <Bi en="No device has notifications on yet." zh="還沒有裝置開啟推播。" />
          </p>
        ) : (
          <ul className="form">
            {devices.map((device) => (
              <li key={device.id} className="row spread">
                <span>
                  <strong>{device.deviceName ?? <Bi en="A device" zh="裝置" />}</strong>{' '}
                  <span className="muted small">
                    <Bi en="since" zh="開啟於" /> <TaipeiTime at={device.createdAt} />
                    {device.lastUsedAt && (
                      <>
                        {' · '}
                        <Bi en="last push" zh="最近推播" /> <TaipeiTime at={device.lastUsedAt} />
                      </>
                    )}
                  </span>
                  {device.lastError && <span className="muted small"> · {device.lastError}</span>}
                </span>
                <form action={removeDevice}>
                  <input type="hidden" name="id" value={device.id} />
                  <button type="submit" className="button">
                    <Bi en="Remove" zh="移除" />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card form">
        <h2>
          <Bi en="When pushes may arrive" zh="推播時間" />
        </h2>
        <p className="muted small">
          <Bi
            en="Taipei time. The weekly review goes out within the hour after its time (the push job runs at minute 7 of each hour). The day and time are still open in the spec (PRD Section 9): pick what suits you."
            zh="台北時間。每週檢視會在設定時間後一小時內送出（推播排程在每小時第 7 分鐘執行）。規格書第 9 節中星期與時間仍待決定，請依你的習慣設定。"
          />
        </p>
        <ScheduleForm
          initial={{
            quietStart: quiet ? hhmm(quiet.start) : '23:00',
            quietEnd: quiet ? hhmm(quiet.end) : '08:00',
            weeklyDay: weekly ? (WEEKDAYS[weekly.weekday] ?? 'sunday') : 'sunday',
            weeklyTime: weekly ? hhmm(weekly.minutes) : '20:00',
          }}
        />
      </section>

      <section className="card">
        <h2>
          <Bi en="Recent pushes" zh="最近的推播" />
        </h2>
        {sent.length === 0 ? (
          <p className="muted">
            <Bi en="None yet." zh="尚無紀錄。" />
          </p>
        ) : (
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>
                    <Bi en="Planned" zh="排入時間" />
                  </th>
                  <th>
                    <Bi en="Kind" zh="類型" />
                  </th>
                  <th>
                    <Bi en="Push" zh="推播內容" />
                  </th>
                  <th>
                    <Bi en="Sent" zh="送出" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sent.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">
                      <TaipeiTime at={row.createdAt} />
                    </td>
                    <td>
                      <Bi {...KIND[row.kind]} />
                    </td>
                    <td className="small">
                      <strong>{row.title}</strong>
                      <br />
                      <span className="pre-line">{row.body}</span>
                    </td>
                    <td className="small">
                      {row.sentAt ? (
                        <>
                          <TaipeiTime at={row.sentAt} />{' '}
                          <Bi en={`to ${row.delivered ?? 0} device${row.delivered === 1 ? '' : 's'}`} zh={`送達 ${row.delivered ?? 0} 台`} />
                          {row.error && <div className="muted">{row.error}</div>}
                        </>
                      ) : (
                        <>
                          <Bi en="Waiting until" zh="等待至" /> <TaipeiTime at={row.sendAfter} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
