import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { ACTION, ChangeList, TaipeiTime } from '@/components/history';
import { describeRow, TABLE_LABELS } from '@/lib/audit';
import { requireSession } from '@/lib/auth';
import { DataError, loadAuditLog, orDataError } from '@/lib/data';
import { LABELS } from '@/lib/i18n';

/** Every edit and deletion the database logged, deleted entries included (N5 audit log). */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { supabase } = await requireSession();
  const page = Math.max(0, Number.parseInt((await searchParams).page ?? '', 10) || 0);
  const loaded = await orDataError(loadAuditLog(supabase, page));
  if (loaded instanceof DataError) return <DataProblem table={loaded.table} detail={loaded.detail} />;
  const { entries, more } = loaded;

  return (
    <section className="card form">
      <h1>
        <Bi {...LABELS.history} />
      </h1>
      <p className="muted small">
        <Bi
          en="Every change to and deletion of trades, cash flows, non-listed assets, securities and settings, newest first. Deleted entries stay here with what they held."
          zh="交易、現金流、非上市資產、證券與設定的每一次修改與刪除，最新的在前。已刪除的資料會連同內容保留在這裡。"
        />
      </p>
      {entries.length === 0 ? (
        <p className="muted">
          <Bi en="No edits yet." zh="尚無修改紀錄。" />
        </p>
      ) : (
        <ul className="log">
          {entries.map((entry) => (
            <li key={entry.id}>
              <div className="row">
                <span className={entry.action === 'delete' ? 'badge warn' : 'badge'}>
                  <Bi {...ACTION[entry.action]} />
                </span>
                <span className="muted small">
                  <Bi {...(TABLE_LABELS[entry.table] ?? { en: entry.table, zh: entry.table })} />
                </span>
                <strong>
                  <Bi {...describeRow(entry.table, entry.row, entry.rowKey)} />
                </strong>
                <TaipeiTime at={entry.changedAt} />
              </div>
              {entry.action === 'update' && <ChangeList changes={entry.changes} />}
            </li>
          ))}
        </ul>
      )}
      {(page > 0 || more) && (
        <div className="row">
          {page > 0 && (
            <Link href={page === 1 ? '/history' : `/history?page=${page - 1}`} className="button">
              <Bi en="Newer" zh="較新" />
            </Link>
          )}
          {more && (
            <Link href={`/history?page=${page + 1}`} className="button">
              <Bi en="Older" zh="較舊" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
