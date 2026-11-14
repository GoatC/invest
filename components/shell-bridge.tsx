'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';

import { shellMove, shellState, type ShellState } from '@/lib/shell';

/**
 * The page's side of the iOS shell (lib/shell.ts; ios/Shell/WebBridge.swift is the other). Inside
 * the shell it tells the native tab bar where the page is, each time that changes (a tap, a
 * sub-page, the redirect after a form), and gives the shell `window.longview.select(key)`, which a
 * tap on a native tab calls: the page opens from what the preloader keeps
 * (components/preload.tsx), as it does under a tap on the web tab bar. In a browser or the
 * installed web app there is no shell to talk to and this does nothing.
 */

interface ShellWindow {
  webkit?: { messageHandlers?: { shell?: { postMessage(message: ShellState): void } } };
  longview?: { select(key: string): void };
}

function post(state: ShellState) {
  (window as unknown as ShellWindow).webkit?.messageHandlers?.shell?.postMessage(state);
}

/** Signed in: `sheet` is whether the "More" list is open, `onMore` toggles it, `closeSheet` closes it. */
export function ShellBridge({ path, sheet, onMore, closeSheet }: { path: string; sheet: boolean; onMore: () => void; closeSheet: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const live = useRef({ path, sheet, onMore, closeSheet });
  live.current = { path, sheet, onMore, closeSheet };

  useEffect(() => post(shellState(path, sheet, true)), [path, sheet]);

  useEffect(() => {
    const shell = window as unknown as ShellWindow;
    shell.longview = {
      select(key) {
        const now = live.current;
        const move = shellMove(key, now.path, now.sheet);
        if (move.do === 'more') now.onMore();
        else if (move.do === 'open') {
          now.closeSheet();
          start(() => router.push(move.href));
        } else if (move.do === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
        else now.closeSheet();
      },
    };
    return () => {
      delete shell.longview;
    };
  }, [router]);

  // The bar along the top while the server prepares a page not yet kept, as under a tapped link.
  return pending ? <span className="link-pending" data-pending aria-hidden="true" /> : null;
}

/** Signed out (the login page): the shell hides its tab bar. */
export function ShellSignedOut() {
  useEffect(() => post(shellState(window.location.pathname, false, false)), []);
  return null;
}
