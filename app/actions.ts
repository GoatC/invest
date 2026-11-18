'use server';

import { redirect } from 'next/navigation';

import { refreshPages } from '@/lib/action-redirect';
import { requireSession } from '@/lib/auth';
import { activeRun, dispatch, githubConfig, listRuns, runState, type RefreshState } from '@/lib/refresh';
import { createClient } from '@/lib/supabase/server';

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

/** The refresh button: starts every data job now (refresh.yml), or follows the run already going. */
export async function startRefresh(): Promise<RefreshState> {
  await requireSession();
  const config = githubConfig();
  if (!config) return { phase: 'unset' };
  const since = new Date().toISOString();
  try {
    const going = activeRun(await listRuns(config));
    if (going) return { phase: going.status === 'in_progress' ? 'running' : 'queued', since: going.created_at, url: going.html_url };
    await dispatch(config);
    return { phase: 'queued', since };
  } catch (err) {
    return { phase: 'failed', since, detail: err instanceof Error ? err.message : 'GitHub' };
  }
}

/** Where the run asked for at `since` is; once it is done, every page reads the new data. */
export async function refreshStatus(since: string): Promise<RefreshState> {
  await requireSession();
  const config = githubConfig();
  if (!config) return { phase: 'unset' };
  if (Number.isNaN(Date.parse(since))) return { phase: 'failed', detail: 'bad time' };
  try {
    const state = runState(await listRuns(config), since);
    if (state.phase === 'done') refreshPages();
    return state;
  } catch (err) {
    // A failed look at GitHub is not a failed run: keep waiting.
    return { phase: 'running', since, detail: err instanceof Error ? err.message : 'GitHub' };
  }
}
