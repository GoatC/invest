'use client';

import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { NAV_PATHS, oneTapAway } from './nav-pages';

/**
 * Fetches every page the navigation can open, whole, as soon as the app has loaded, so a tab opens
 * from the phone's memory without asking the server (Hugo, 2026-11-13: the app should answer a tap
 * as an installed app does). On the first load of a visit the opening screen
 * (components/splash.tsx) stays until the pages one tap away have arrived (the tab bar's four and
 * the sub-tabs of the tab that opened), or WAIT_MS at most, and shows the count as a bar; the
 * pages two taps away (the other tabs' sub-tabs, those under More) follow behind the page, as do
 * all of them on later loads. Waiting for every page held the opening screen twice as long
 * (tests/e2e/bench.mjs). The chart library is fetched along with them.
 *
 * A page fetched this way is kept for `staleTimes.static` (next.config.ts). The set is fetched again
 * when a save clears it (a server action, the refresh button), when that time is up while the app
 * is on screen, and when the app comes back after RESUME_MS in the background, which also reloads
 * the page on screen. `localStorage.preload = 'off'` turns the fetching off on a device (the
 * end-to-end check sets it, so each step meets a server that is not busy with twenty other pages).
 */

/** The opening screen never holds the app back longer than this. */
const WAIT_MS = 8000;
/** Nor does it flash by: long enough to be seen as a screen. */
const SHOW_MS = 500;
/** After the last awaited page's answer has come in, the router gets this long to put it away. */
const SETTLE_MS = 60;
/** Back on screen after this long away, the app reloads what it shows. */
const RESUME_MS = 5 * 60_000;
/** How long a page fetched ahead is kept: staleTimes.static in next.config.ts (seconds there). */
const KEEP_MS = 30 * 60_000;
/** The opening screen's fade, matching .splash.leaving in globals.css. */
const LEAVE_MS = 380;

function preloadOff(): boolean {
  try {
    return localStorage.getItem('preload') === 'off';
  } catch {
    return false;
  }
}

/** Lifts the opening screen and marks the visit as opened, so a reload does not show it again. */
function lift(splash: HTMLElement | null) {
  try {
    sessionStorage.setItem('opened', '1');
  } catch {
    // Private mode: the screen simply shows again on a reload.
  }
  if (!splash || splash.classList.contains('leaving')) return;
  splash.classList.add('leaving');
  setTimeout(() => document.documentElement.setAttribute('data-opened', ''), LEAVE_MS);
}

export function Preload() {
  const router = useRouter();

  useEffect(() => {
    const root = document.documentElement;
    const splash = root.hasAttribute('data-opened') ? null : document.getElementById('splash');
    const since = performance.now();
    const bar = splash?.querySelector<HTMLElement>('.splash-progress > span');
    if (preloadOff()) {
      lift(splash);
      return undefined;
    }

    // Every page of the navigation; asked for the one on screen, the router answers from what it holds.
    const here = window.location.pathname;
    const near = oneTapAway(here);
    /** In the order they are wanted: the pages one tap away, then the rest. */
    const paths = [...near, ...NAV_PATHS.filter((path) => !near.includes(path))];
    /** What the opening screen waits for: the pages one tap away, but for the one that has just loaded. */
    const awaited = near.filter((path) => path !== here);
    /** Pages whose own request has come back. */
    const arrived = new Set<string>();
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let waiting = splash !== null;
    const plain = window.fetch;
    const done = () => {
      if (!waiting) return;
      waiting = false;
      clearTimeout(quiet);
      if (window.fetch === watching) window.fetch = plain;
      setTimeout(() => lift(splash), Math.max(0, SHOW_MS - (performance.now() - since)));
    };
    const progress = () => {
      bar?.style.setProperty('--progress', String(awaited.length === 0 ? 1 : awaited.filter((path) => arrived.has(path)).length / awaited.length));
      if (waiting && quiet === undefined && awaited.every((path) => arrived.has(path))) quiet = setTimeout(done, SETTLE_MS);
    };

    // The router gives no word when a page it fetched ahead has arrived, so while the opening screen
    // waits its requests are watched as they pass: each is handed on untouched, and counted when
    // its answer has come in.
    const watching = (input: RequestInfo | URL, init?: RequestInit) => {
      const answer = plain(input, init);
      let url: URL;
      try {
        url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
      } catch {
        return answer;
      }
      if (url.origin !== window.location.origin || !url.searchParams.has('_rsc')) return answer;
      // The router first asks for each page's outline, marked as a prefetch, then for the page
      // itself, unmarked: only the second means the page is in hand.
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const whole = !headers.has('next-router-prefetch');
      if (!whole) return answer;
      const settle = () => {
        arrived.add(url.pathname);
        progress();
      };
      // The answer streams: it has arrived once a copy of its body has been read to the end.
      answer.then((response) => response.clone().arrayBuffer()).then(settle, settle);
      return answer;
    };
    if (waiting) window.fetch = watching;

    let fetchedAt = 0;
    let again: ReturnType<typeof setTimeout> | undefined;
    const onScreen = () => (document.visibilityState === 'visible' ? fetchAll() : undefined);
    const fetchAll = () => {
      clearTimeout(again);
      fetchedAt = Date.now();
      let cleared = false;
      // The router fetches what was asked for last first: the pages one tap away go in last.
      for (const path of [...paths].reverse()) {
        router.prefetch(path, {
          kind: PrefetchKind.FULL,
          // A save or a reload cleared what was kept: fetch the set again, once for all of them.
          onInvalidate: () => {
            if (cleared) return;
            cleared = true;
            clearTimeout(again);
            again = setTimeout(onScreen, 300);
          },
        });
      }
      // What is kept goes stale after KEEP_MS; on screen, the set is fetched again just after.
      again = setTimeout(onScreen, KEEP_MS + 2000);
    };
    fetchAll();
    progress();
    const cap = setTimeout(done, WAIT_MS);
    // The chart library, apart from the pages: the first chart draws without waiting for it.
    void import('./echarts-core').catch(() => undefined);

    let hiddenAt = 0;
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === 0 ? 0 : Date.now() - hiddenAt;
      // Back after a while: the page on screen is read again, then the set (not yet stale ones are kept).
      if (away >= RESUME_MS) router.refresh();
      // A moment later, so the reload's answer has renewed the session before twenty requests use it.
      if (away >= RESUME_MS || Date.now() - fetchedAt >= KEEP_MS) {
        clearTimeout(again);
        again = setTimeout(onScreen, 1500);
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(cap);
      clearTimeout(quiet);
      clearTimeout(again);
      document.removeEventListener('visibilitychange', visibility);
      if (window.fetch === watching) window.fetch = plain;
    };
  }, [router]);

  return null;
}
