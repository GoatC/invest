import { GROUPS, MAIN } from '@/components/nav-pages';
import { requireSession } from '@/lib/auth';
import { buildSearchIndex } from '@/lib/search-index';

import { SearchBox } from './search-box';

/**
 * 搜尋 (Ink design, Hugo 2026-11-18): what the dashboard's search button opens, like pulling down on the iPhone home
 * screen. One field finds any page, sub-tab, setting, holding or explanation (lib/search-index.ts).
 */
export default async function SearchPage() {
  const { supabase } = await requireSession();
  const { data } = await supabase.from('securities').select('ticker, name').order('ticker');
  const index = buildSearchIndex(MAIN, GROUPS, (data ?? []) as Array<{ ticker: string; name: string }>);
  return (
    <section className="card form search-card">
      <h1 className="visually-hidden" lang="zh-Hant" aria-label="搜尋 Search">
        搜尋
      </h1>
      <SearchBox index={index} />
    </section>
  );
}
