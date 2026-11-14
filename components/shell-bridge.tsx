'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';

import { REMINDER_PREFS_KEY, reminderPrefs, remindersMessage, sameNext, sameTop, shellBack, shellMove, shellState, sitePath, type RemindersMessage, type RemindersStatus, type ShellAction, type ShellNext, type ShellReminder, type ShellState, type ShellTop } from '@/lib/shell';

/**
 * The page's side of the iOS shell (lib/shell.ts; ios/Shell/ShellViewController.swift is the other).
 * Inside the shell it tells the native tab bar where the page is, each time that changes (a tap, a
 * sub-page, the redirect after a form), and gives the shell `window.longview`:
 * - `select(key)`, which a tap on a native tab calls: the page opens from what the preloader keeps
 *   (components/preload.tsx), as it does under a tap on the web tab bar;
 * - `open(path)`, for a tapped reminder or a `longview://open` address: any page of the site;
 * - `remindersStatus(status)`, the shell's answer once it has scheduled the reminders;
 * - `action(key)`, a tap on a glass button of the shell's navigation bar: it presses the page's own
 *   control that lent it (`data-shell-action`);
 * - `later()`, 稍後再說 on the thing waiting above the tab bar: it presses the banner's own button;
 * - `segment(index)`, a choice in the shell's segmented control: it presses that sub-tab of the page's row;
 * - `refresh()`, a pull down at the top of the page (proposal G06): the page is read again from the
 *   server, as after a save; it resolves when the new page is on screen.
 * Inside the shell it also asks the phone for a haptic (G06): success when a save is confirmed
 * (`.banner.ok`), a warning when something is refused (`.banner[role="alert"]`), once each.
 * With the state it also sends the top of the page (proposal G02): the title the shell's large title
 * shows, the controls lent to its bar, whether a back button belongs there and the status bar's
 * colour, read from the page as drawn and sent again when any of it changes; and what waits on
 * Hugo (proposal G04), the first in-app banner, which the shell shows above its tab bar.
 * When the app opens, and when it comes back after an hour, it fetches the reminders of the next
 * 14 days (app/shell/reminders) and hands the shell those chosen on this phone
 * (components/shell-reminders.tsx). In a browser or the installed web app there is no shell to
 * talk to and this does nothing.
 */

interface Handler<T> {
  postMessage(message: T): void;
}

interface ShellWindow {
  webkit?: { messageHandlers?: { shell?: Handler<ShellState>; reminders?: Handler<RemindersMessage>; haptic?: Handler<'success' | 'warning'> } };
  longview?: { select(key: string): void; open(path: string): void; remindersStatus(status: RemindersStatus): void; action(key: string): void; later(): void; segment(index: number): void; refresh(): Promise<void> };
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

/** The sub-tabs of the page's row (`data-shell-segments`): its links or tab buttons. */
function segmentItems(): HTMLElement[] {
  const row = document.querySelector<HTMLElement>('[data-shell-segments]');
  return row ? [...row.querySelectorAll<HTMLElement>(':scope > a, :scope > button')] : [];
}

function readSegments(): ShellTop['segments'] {
  const items = segmentItems();
  if (items.length < 2) return null;
  const current = items.findIndex((item) => item.getAttribute('aria-current') === 'page' || item.getAttribute('aria-selected') === 'true');
  return { labels: items.map((item) => item.textContent?.trim() ?? ''), current: Math.max(0, current) };
}

/** The top of the page as it is drawn now: the More list over it, the dashboard's poster, or a page with its h1. */
function readTop(path: string, sheet: boolean): ShellTop {
  if (sheet) return { title: '更多', statusBar: 'dark', back: false, actions: [], segments: null };
  const poster = document.querySelector<HTMLElement>('.page > .hero');
  const heading = document.querySelector<HTMLElement>('main h1:not(.hero h1)');
  return {
    title: poster ? null : heading?.textContent?.trim() || null,
    statusBar: poster && poster.getBoundingClientRect().bottom > UNDER_BAR_PX ? 'light' : 'dark',
    back: shellBack(path),
    actions: lentActions(),
    segments: readSegments(),
  };
}

/** The first in-app banner, as the shell shows it above its tab bar; null when nothing waits. */
function readNext(): ShellNext | null {
  const first = document.querySelector<HTMLElement>('.guide-banner');
  const go = first?.querySelector<HTMLAnchorElement>('.guide-go');
  const text = first?.querySelector('.guide-text')?.textContent?.trim();
  if (!first || !go || !text) return null;
  const count = Number(first.closest<HTMLElement>('.guide')?.dataset.count ?? '1');
  return { text, href: go.getAttribute('href') ?? '/', label: go.textContent?.trim() ?? '', more: Math.max(0, count - 1), later: first.querySelector('.guide-close') !== null, tone: first.classList.contains('act') ? 'act' : 'info' };
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
  /** Pulls to refresh waiting for the page read again to be on screen. */
  const refreshing = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (!pending) refreshing.current.splice(0).forEach((done) => done());
  }, [pending]);

  // A haptic for what just happened on the page: a save confirmed, or something refused.
  useEffect(() => {
    const haptic = shellWindow().webkit?.messageHandlers?.haptic;
    if (!haptic) return undefined;
    const felt = new Set<string>();
    let frame = 0;
    const feel = () => {
      frame = 0;
      for (const banner of document.querySelectorAll<HTMLElement>('main .banner.ok[role="status"], main .banner[role="alert"]')) {
        const kind = banner.matches('.ok') ? 'success' : 'warning';
        const key = `${kind}:${banner.textContent ?? ''}`;
        if (felt.has(key)) continue;
        felt.add(key);
        haptic.postMessage(kind);
      }
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(feel);
    };
    feel();
    const changes = new MutationObserver(soon);
    const main = document.querySelector('main');
    if (main) changes.observe(main, { childList: true, subtree: true });
    return () => {
      changes.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [path]);

  // The state, and inside the shell the top of the page with it: told at once, then again whenever
  // the page changes under the same address (its parts arriving) or the poster scrolls under the bar.
  useEffect(() => {
    const inShell = document.documentElement.hasAttribute('data-shell');
    let told: ShellTop | null = inShell ? readTop(path, sheet) : null;
    let waiting: ShellNext | null = inShell ? readNext() : null;
    post(inShell ? shellState(path, sheet, true, told ?? undefined, waiting) : shellState(path, sheet, true));
    if (!inShell) return undefined;
    let frame = 0;
    const check = () => {
      frame = 0;
      const top = readTop(path, sheet);
      const next = readNext();
      if (sameTop(told, top) && sameNext(waiting, next)) return;
      told = top;
      waiting = next;
      post(shellState(path, sheet, true, top, next));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    // The whole body: the layout's banner streams in beside the page, not inside it.
    const changes = new MutationObserver(soon);
    changes.observe(document.body, { childList: true, subtree: true, characterData: true });
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
      later() {
        document.querySelector<HTMLElement>('.guide-banner .guide-close')?.click();
      },
      segment(index) {
        segmentItems()[index]?.click();
      },
      refresh() {
        return new Promise<void>((done) => {
          refreshing.current.push(done);
          // Answered at the latest after this long, should the page never say it is done.
          setTimeout(done, 10_000);
          start(() => router.refresh());
        });
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
