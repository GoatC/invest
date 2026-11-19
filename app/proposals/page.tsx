import { DataProblem } from '@/components/data-problem';
import { WarningsPanel } from '@/components/warnings-panel';
import { requireSession } from '@/lib/auth';
import { DataError, loadAllocationData, loadProposals, loadRules } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';

type Params = Record<string, string | string[] | undefined>;

/**
 * The rule warnings (L2 step 1), on a page of their own since 2026-11-19 (Hugo: off the dashboard, whose collapsible
 * rules row stays): each standing warning with its dismiss button and its reasons, the check-now button, and the
 * dismissed and closed ones folded. The banner, the pushes and the other pages link here.
 */
export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireSession();
  const params = await searchParams;
  const today = taipeiToday();
  let found: Awaited<ReturnType<typeof loadProposals>>;
  let rules: Awaited<ReturnType<typeof loadRules>>;
  let classes: Awaited<ReturnType<typeof loadAllocationData>>['assetClasses'];
  try {
    const [proposals, ruleRows, data] = await Promise.all([loadProposals(supabase, today), loadRules(supabase), loadAllocationData(supabase)]);
    found = proposals;
    rules = ruleRows;
    classes = data.assetClasses;
  } catch (err) {
    if (err instanceof DataError) return <DataProblem table={err.table} detail={err.detail} />;
    throw err;
  }
  return (
    <>
      <h1 className="visually-hidden" lang="zh-Hant" aria-label="規則警示 Rule warnings">
        規則警示
      </h1>
      <WarningsPanel supabase={supabase} params={params} proposals={found} rules={rules} names={new Map(classes.map((assetClass) => [assetClass.id, { en: assetClass.nameEn, zh: assetClass.nameZh }]))} />
    </>
  );
}
