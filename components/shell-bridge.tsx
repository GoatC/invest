'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';

import { REMINDER_PREFS_KEY, reminderPrefs, remindersMessage, shellMove, shellState, sitePath, type RemindersMessage, type RemindersStatus, type ShellReminder, type ShellState } from '@/lib/shell';

/**
 * The page's side of the iOS shell (lib/shell.ts; ios/Shell/ShellViewController.swift is the other).
 * Inside the shell it tells the native tab bar where the page is, each time that changes (a tap, a
 * sub-page, the redirect after a form), and gives the shell `window.longview`:
 * - `select(key)`, which a tap on a native tab calls: the page opens from what the preloader keeps
 *   (components/preload.tsx), as it does under a tap on the web tab bar;
 * - `open(path)`, for a tapped reminder or a `longview://open` address: any page of the site;
 * - `remindersStatus(status)`, the shell's answer once it has scheduled the reminders.
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
  longview?: { select(key: string): void; open(path: string): void; remindersStatus(status: RemindersStatus): void };
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

  useEffect(() => post(shellState(path, sheet, true)), [path, sheet]);

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
