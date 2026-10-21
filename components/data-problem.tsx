import { Bi } from './bi';

/** Shown instead of a page when a database read fails, with the most likely fix. */
export function DataProblem({ table, detail }: { table: string; detail: string }) {
  return (
    <section className="card">
      <p className="banner danger" role="alert">
        <Bi en={`Could not read ${table} from the database: ${detail}`} zh={`無法從資料庫讀取 ${table}：${detail}`} />
      </p>
      <p className="muted">
        <Bi
          en="If the app was just updated, apply its database changes with npx supabase db push (docs/supabase-setup.md, step 3)."
          zh="如果剛更新過程式，請執行 npx supabase db push 套用資料庫變更（見 docs/supabase-setup.md 第 3 步）。"
        />
      </p>
    </section>
  );
}
