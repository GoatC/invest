'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';

import { refreshStatus, startRefresh } from '@/app/actions';
import type { RefreshState } from '@/lib/refresh';

import { Bi } from './bi';

/**
 * The refresh button in the More menu: it runs the nightly job now (prices, FX, filings, analysts'
 * estimates, then the rules) and checks on it every 15 seconds until it is done, then reloads the
 * page's data. The run's state lives outside the menu, so closing the menu or changing page does
 * not lose it; a reload picks it up again from this tab's session storage.
 */

const POLL_MS = 15_000;
/** The workflow's own timeout is 20 minutes; past this the button stops waiting. */
const GIVE_UP_MS = 40 * 60_000;
const KEY = 'refresh-since';

type View = RefreshState | { phase: 'idle' } | { phase: 'starting' };

let view: View = { phase: 'idle' };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let onDone: (() => void) | undefined;

function set(next: View) {
  view = next;
  for (const listener of listeners) listener();
}

function remember(since: string | undefined) {
  try {
    if (since) sessionStorage.setItem(KEY, since);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Private mode: the state is simply not kept across a reload.
  }
}

function poll(since: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (Date.now() - Date.parse(since) > GIVE_UP_MS) {
      remember(undefined);
      set({ phase: 'failed', since, detail: 'timeout' });
      return;
    }
    const state = await refreshStatus(since).catch((): RefreshState => ({ phase: 'running', since }));
    set(state);
    if (state.phase === 'done' || state.phase === 'failed' || state.phase === 'unset') {
      remember(undefined);
      if (state.phase === 'done') onDone?.();
    } else poll(since);
  }, POLL_MS);
}

async function start() {
  if (view.phase === 'starting' || view.phase === 'queued' || view.phase === 'running') return;
  set({ phase: 'starting' });
  const state = await startRefresh().catch((): RefreshState => ({ phase: 'failed', detail: 'network' }));
  set(state);
  if (state.phase === 'unset') onDone?.();
  if ((state.phase === 'queued' || state.phase === 'running') && state.since) {
    remember(state.since);
    poll(state.since);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const MESSAGES: Record<View['phase'], { en: string; zh: string }> = {
  idle: { en: 'Runs the nightly job now: prices, FX rates, filings and estimates, about 10 minutes.', zh: '立即執行每夜排程：價格、匯率、財報與分析師預估，約需 10 分鐘。' },
  starting: { en: 'Asking GitHub to start the job…', zh: '正在請 GitHub 啟動排程…' },
  queued: { en: 'Waiting for GitHub to start the job…', zh: '等待 GitHub 開始執行…' },
  running: { en: 'Loading the latest data; you can keep using the app.', zh: '正在載入最新資料，可以繼續使用 App。' },
  done: { en: 'Updated: every page shows the new data.', zh: '已更新：各頁都已顯示最新資料。' },
  failed: { en: 'The job did not finish; the app keeps the data it had.', zh: '排程未完成，App 沿用原有資料。' },
  unset: { en: 'The page was reloaded. To run the job from here, set GITHUB_DISPATCH_TOKEN on Vercel (docs/nightly-job.md).', zh: '已重新整理畫面。若要從這裡執行排程，請在 Vercel 設定 GITHUB_DISPATCH_TOKEN（見 docs/nightly-job.md）。' },
};

export function RefreshData() {
  const router = useRouter();
  const state = useSyncExternalStore(subscribe, () => view, () => view);

  useEffect(() => {
    onDone = () => router.refresh();
    // A run asked for before a reload: follow it again.
    if (view.phase === 'idle') {
      let since: string | null = null;
      try {
        since = sessionStorage.getItem(KEY);
      } catch {
        since = null;
      }
      if (since && Date.now() - Date.parse(since) < GIVE_UP_MS) {
        set({ phase: 'queued', since });
        poll(since);
      }
    }
  }, [router]);

  const busy = state.phase === 'starting' || state.phase === 'queued' || state.phase === 'running';
  const url = 'url' in state ? state.url : undefined;
  return (
    <div className="refresh-data" data-phase={state.phase}>
      <button type="button" className="primary" onClick={() => void start()} disabled={busy} aria-describedby="refresh-note">
        {busy && <span className="refresh-spinner" aria-hidden="true" />}
        <Bi en={busy ? 'Refreshing…' : state.phase === 'done' ? 'Refresh again' : 'Refresh the latest data'} zh={busy ? '更新中…' : state.phase === 'done' ? '再更新一次' : '更新最新資料'} />
      </button>
      <p id="refresh-note" className="muted small" role="status" aria-live="polite">
        <Bi {...MESSAGES[state.phase]} />
        {url && (
          <>
            {' '}
            <a href={url} target="_blank" rel="noreferrer">
              <Bi en="The run on GitHub" zh="GitHub 上的執行紀錄" />
            </a>
          </>
        )}
      </p>
    </div>
  );
}
