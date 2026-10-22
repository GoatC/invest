import Link from 'next/link';

import { Bi } from '@/components/bi';
import { DataProblem } from '@/components/data-problem';
import { LogList } from '@/components/history';
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
      <LogList entries={entries} />
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
