'use server';

import { redirect } from '@/lib/action-redirect';
import { requireSession } from '@/lib/auth';
import { DataError, loadProposal, orDataError, runRules } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { formFields, parseId } from '@/lib/forms';

/** Evaluates every rule now, as the nightly job does after its refresh (L2 step 1). */
export async function checkRules(): Promise<void> {
  const { supabase } = await requireSession();
  const result = await orDataError(runRules(supabase, taipeiToday(), new Date().toISOString()));
  if (result instanceof DataError) redirect(`/?failed=${encodeURIComponent(result.message)}#proposals`);
  redirect(`/?saved=checked&created=${result.created}&closed=${result.closed}#proposals`);
}

/**
 * Dismisses a standing warning (an open proposal; Hugo, 2026-11-12). A windfall warning dismissed
 * moves its tranches on, as the tranche is dealt with either way: the cash not bought stays in the
 * pool and the next tranches spread it. A warning the nightly job already closed is left as it is.
 */
export async function dismissProposal(formData: FormData): Promise<void> {
  const { supabase } = await requireSession();
  const id = parseId(formFields(formData)['id']);
  if (id === undefined) redirect('/?saved=stale#proposals');
  const { data, error } = await supabase.from('proposals').update({ status: 'dismissed', decided_at: new Date().toISOString() }).eq('id', id).eq('status', 'open').select('id');
  if (error) redirect(`/?failed=${encodeURIComponent(error.message)}#proposals`);
  if (!data || data.length === 0) redirect('/?saved=stale#proposals');
  const failed = await settleTranches(supabase, id);
  if (failed) redirect(`/?failed=${encodeURIComponent(failed)}#proposals`);
  redirect('/?saved=dismissed#proposals');
}

/**
 * A windfall warning dismissed moves its tranches on (F3): the tranche it named is done, those an
 * acceleration pulled forward are accelerated. Returns an error message, if any.
 */
async function settleTranches(supabase: Awaited<ReturnType<typeof requireSession>>['supabase'], id: number): Promise<string | undefined> {
  const proposal = await orDataError(loadProposal(supabase, id));
  if (proposal instanceof DataError) return proposal.message;
  const { trancheId, accelerated } = proposal?.detail ?? {};
  const moves: Array<{ ids: number[]; status: 'done' | 'accelerated' }> = [];
  if (typeof trancheId === 'number') moves.push({ ids: [trancheId], status: 'done' });
  if (Array.isArray(accelerated) && accelerated.length > 0) moves.push({ ids: accelerated, status: 'accelerated' });
  for (const move of moves) {
    const { error } = await supabase.from('windfall_tranches').update({ status: move.status, proposal_id: id }).in('id', move.ids).eq('status', 'scheduled');
    if (error) return error.message;
  }
  return undefined;
}
