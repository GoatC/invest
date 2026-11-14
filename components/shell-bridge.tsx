'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';

import { REMINDER_PREFS_KEY, reminderPrefs, remindersMessage, sameTop, shellBack, shellMove, shellState, sitePath, type RemindersMessage, type RemindersStatus, type ShellAction, type ShellReminder, type ShellState, type ShellTop } from '@/lib/shell';

/**
 * The page's side of the iOS shell (lib/shell.ts; ios/Shell/ShellViewController.swift is the other).
 * Inside the shell it tells the native tab bar where the page is, each time that changes (a tap, a
 * sub-page, the redirect after a form), and gives the shell `window.longview`:
 * - `select(key)`, which a tap on a native tab calls: the page opens from what the preloader keeps
 *   (components/preload.tsx), as it does under a tap on the web tab bar;
 * - `open(path)`, for a tapped reminder or a `longview://open` address: any page of the site;
 * - `remindersStatus(status)`, the shell's answer once it has scheduled the reminders;
 * - `action(key)`, a tap on a glass button of the shell's navigation bar: it presses the page's own
 *   control that lent it (`data-shell-action`).
 * With the state it also sends the top of the page (proposal G02): the title the shell's large title
 * shows, the controls lent to its bar, whether a back button belongs there and the status bar's
 * colour, read from the page as drawn and sent again when any of it changes.
 * When the app opens, and when it comes back after an hour, it fetches the reminders of the next
 * 14 days (app/shell/reminders) and hands the shell those chosen on this phone
 * (components/shell-reminders.tsx). In a browser or the installed web app there is no shell to
 * talk to and this does nothing.
 */

interface Handler<T> {
  postMessage(message: T): void;
}

interface ShellWindow {
  webkit?: { messageHandlers?: { shell?: Handler<ShellState>; reminders?: Handler<RemindersMessage> } };
  longview?: { select(key: string): void; open(path: string): void; remindersStatus(status: RemindersStatus): void; action(key: string): void };
  longviewReminders?: { status?: RemindersStatus; pushDevices?: number };
}

/** Fired on the window when the shell has scheduled the reminders; components/shell-reminders.tsx listens. */
export const REMINDERS_STATUS = 'longview:reminders-status';
/** Fired by the settings to have the reminders handed to the shell again, with the new choices. */
export const REMINDERS_SYNC = 'longview:reminders-sync';
/** Back after this long away, the reminders are fetched again. */
const REFRESH_MS = 60 * 60_000;

function shellWindow(): ShellWindow {
  return window as unknown as ShellWindow;
}

function post(state: ShellState) {
  shellWindow().webkit?.messageHandlers?.shell?.postMessage(state);
}

/** Below this many pixels from the top the poster has gone under the shell's bar, and the status bar turns dark. */
const UNDER_BAR_PX = 100;

/** The page's controls lent to the shell's bar, once each, in the page's order. */
function lentActions(): ShellAction[] {
  const seen = new Set<string>();
  const actions: ShellAction[] = [];
  for (const control of document.querySelectorAll<HTMLElement>('main [data-shell-action]')) {
    const key = control.dataset.shellAction;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    actions.push({ key, symbol: control.dataset.shellSymbol ?? 'circle', label: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? key });
  }
  return actions;
}

/** The top of the page as it is drawn now: the More list over it, the dashboard's poster, or a page with its h1. */
function readTop(path: string, sheet: boolean): ShellTop {
  if (sheet) return { title: '更多', statusBar: 'dark', back: false, actions: [] };
  const poster = document.querySelector<HTMLElement>('.page > .hero');
  const heading = document.querySelector<HTMLElement>('main h1:not(.hero h1)');
  return {
    title: poster ? null : heading?.textContent?.trim() || null,
    statusBar: poster && poster.getBoundingClientRect().bottom > UNDER_BAR_PX ? 'light' : 'dark',
    back: shellBack(path),
    actions: lentActions(),
  };
}

function readPrefs(): unknown {
  try {
    return JSON.parse(localStorage.getItem(REMINDER_PREFS_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/** Signed in: `sheet` is whether the "More" list is open, `onMore` toggles it, `closeSheet` closes it. */
export function ShellBridge({ path, sheet, onMore, closeSheet }: { path: string; sheet: boolean; onMore: () => void; closeSheet: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const live = useRef({ path, sheet, onMore, closeSheet });
  live.current = { path, sheet, onMore, closeSheet };

  // The state, and inside the shell the top of the page with it: told at once, then again whenever
  // the page changes under the same address (its parts arriving) or the poster scrolls under the bar.
  useEffect(() => {
    const inShell = document.documentElement.hasAttribute('data-shell');
    let told: ShellTop | null = inShell ? readTop(path, sheet) : null;
    post(shellState(path, sheet, true, told ?? undefined));
    if (!inShell) return undefined;
    let frame = 0;
    const check = () => {
      frame = 0;
      const now = readTop(path, sheet);
      if (sameTop(told, now)) return;
      told = now;
      post(shellState(path, sheet, true, now));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const changes = new MutationObserver(soon);
    const main = document.querySelector('main');
    if (main) changes.observe(main, { childList: true, subtree: true, characterData: true });
    window.addEventListener('scroll', soon, { passive: true });
    return () => {
      changes.disconnect();
      window.removeEventListener('scroll', soon);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [path, sheet]);

  useEffect(() => {
    const shell = shellWindow();
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
      open(raw) {
        const target = sitePath(raw);
        if (!target) return;
        live.current.closeSheet();
        start(() => router.push(target));
      },
      remindersStatus(status) {
        shell.longviewReminders = { ...shell.longviewReminders, status };
        window.dispatchEvent(new CustomEvent(REMINDERS_STATUS, { detail: status }));
      },
      action(key) {
        document.querySelector<HTMLElement>(`main [data-shell-action="${CSS.escape(key)}"]`)?.click();
      },
    };
    return () => {
      delete shell.longview;
    };
  }, [router]);

  // The reminders on the phone: fetched when the app opens and after an hour away, handed over again when the choices change.
  useEffect(() => {
    const shell = shellWindow();
    const handler = shell.webkit?.messageHandlers?.reminders;
    if (!handler || !document.documentElement.hasAttribute('data-shell')) return undefined;
    let fetched: { reminders: ShellReminder[]; pushDevices: number } | null = null;
    let at = 0;
    const hand = () => {
      if (!fetched) return;
      handler.postMessage(remindersMessage(fetched.reminders, reminderPrefs(readPrefs(), fetched.pushDevices)));
    };
    const fetchAndHand = async () => {
      at = Date.now();
      try {
        const response = await fetch('/shell/reminders', { cache: 'no-store' });
        if (!response.ok) return;
        const body = (await response.json()) as { v?: number; reminders?: ShellReminder[]; pushDevices?: number };
        if (body.v !== 1 || !Array.isArray(body.reminders)) return;
        fetched = { reminders: body.reminders, pushDevices: body.pushDevices ?? 0 };
        shell.longviewReminders = { ...shell.longviewReminders, pushDevices: fetched.pushDevices };
        hand();
      } catch {
        // Offline: the reminders scheduled last time stay; the next opening tries again.
      }
    };
    const back = () => {
      if (document.visibilityState === 'visible' && Date.now() - at > REFRESH_MS) void fetchAndHand();
    };
    void fetchAndHand();
    window.addEventListener(REMINDERS_SYNC, hand);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener(REMINDERS_SYNC, hand);
      document.removeEventListener('visibilitychange', back);
    };
  }, []);

  // The bar along the top while the server prepares a page not yet kept, as under a tapped link.
  return pending ? <span className="link-pending" data-pending aria-hidden="true" /> : null;
}

/** Signed out (the login page): the shell hides its tab bar. */
export function ShellSignedOut() {
  useEffect(() => post(shellState(window.location.pathname, false, false)), []);
  return null;
}
