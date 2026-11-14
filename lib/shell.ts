import { GROUPS, MAIN, matches, NAV_PATHS } from '@/components/nav-pages';

/**
 * What the web app and its iOS shell tell each other (ios/, docs/ios-app.md; PRD Section 5, "Native
 * shell"). The shell is a native tab bar over one web view that shows this same site: the page
 * hides its own tab bar there (globals.css `html[data-shell]`), tells the shell which tab the page
 * on screen belongs to, and opens a tab when the shell asks (components/shell-bridge.tsx). The
 * tabs, their order and their names are decided here, from components/nav-pages.ts; the shell
 * keeps no list of pages of its own.
 */

/** The fifth tab, which opens the groups; the others are named by their page's path. */
export const MORE = 'more';

export interface ShellTab {
  key: string;
  title: string;
}

/** Left to right under the names of the web tab bar (components/tab-bar.tsx): the dashboard in the middle. */
export const SHELL_TABS: readonly ShellTab[] = [
  { key: MAIN[1]!.href, title: '持倉' },
  { key: MAIN[2]!.href, title: '績效' },
  { key: MAIN[0]!.href, title: '儀表板' },
  { key: MAIN[3]!.href, title: '配置' },
  { key: MORE, title: '更多' },
];

/**
 * The tab the shell should show as chosen: "More" while its list is open or on a page of a group,
 * else the tab the page belongs to; null on a page of neither (the shell leaves its choice alone).
 */
export function shellTab(path: string, sheet: boolean): string | null {
  if (sheet || GROUPS.some((group) => group.pages.some((page) => matches(page, path)))) return MORE;
  return MAIN.find((page) => matches(page, path))?.href ?? null;
}

/** A control of the page lent to the shell's navigation bar: `data-shell-action` on the control itself. */
export interface ShellAction {
  key: string;
  /** An SF Symbol's name (`data-shell-symbol`). */
  symbol: string;
  /** What VoiceOver says: the control's accessible name. */
  label: string;
}

/**
 * The top of the page, which the shell's own navigation bar draws (Liquid Glass proposal G02, with
 * C01; Hugo 2026-11-15): the page's title as iOS's large title, the page's own controls as glass
 * buttons, a back button on a page reached from inside another, and the status bar's colour.
 */
export interface ShellTop {
  /** The page's title (its h1); null on the dashboard, whose poster is the top of the screen. */
  title: string | null;
  /** White text over the poster's colour, dark over the grey ground. */
  statusBar: 'light' | 'dark';
  back: boolean;
  actions: readonly ShellAction[];
}

/** One message from the page to the shell, sent whenever any of it changes. */
export interface ShellState {
  /** The version of this message; the shell ignores what it does not know. */
  v: 1;
  signedIn: boolean;
  path: string;
  tab: string | null;
  tabs: readonly ShellTab[];
  /** Left out by a page from before the shell drew the top; the shell then keeps its bar empty. */
  top?: ShellTop;
}

export function shellState(path: string, sheet: boolean, signedIn: boolean, top?: ShellTop): ShellState {
  return { v: 1, signedIn, path, tab: signedIn ? shellTab(path, sheet) : null, tabs: SHELL_TABS, ...(top ? { top } : {}) };
}

/** Whether the page at `path` is reached from inside another (a holding's chart, a form): not a page of the navigation. */
export function shellBack(path: string): boolean {
  return !NAV_PATHS.includes(path);
}

/** Two tops the same, so the page tells the shell only of a change. */
export function sameTop(a: ShellTop | null, b: ShellTop | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.title === b.title &&
    a.statusBar === b.statusBar &&
    a.back === b.back &&
    a.actions.length === b.actions.length &&
    a.actions.every((action, index) => action.key === b.actions[index]!.key && action.symbol === b.actions[index]!.symbol && action.label === b.actions[index]!.label)
  );
}

/**
 * What a tap on the shell's tab `key` does on the page at `path`: "More" opens or closes the list;
 * a tab closes the list and opens its page, or, already on that very page, goes back to its top.
 */
export type ShellMove = { do: 'more' } | { do: 'open'; href: string } | { do: 'top' } | { do: 'none' };

export function shellMove(key: string, path: string, sheet: boolean): ShellMove {
  if (key === MORE) return { do: 'more' };
  if (!SHELL_TABS.some((tab) => tab.key === key)) return { do: 'none' };
  if (path !== key) return { do: 'open', href: key };
  return sheet ? { do: 'none' } : { do: 'top' };
}

// ---------------------------------------------------------------------------
// Reminders on the phone (lib/models/local-reminders.ts; ios/Shell/Reminders.swift)
// ---------------------------------------------------------------------------

/** Which reminders this phone schedules: the three the server lists, and the shell's own before it runs out. */
export interface ReminderPrefs {
  weekly: boolean;
  event: boolean;
  dividend: boolean;
  expiry: boolean;
}

/** Where the choices are kept on the phone (the web view's own storage). */
export const REMINDER_PREFS_KEY = 'shell.reminders';

/**
 * The choices as kept, each one missing taking its default: the reminder before the app runs out
 * on, which nothing else sends; the other three on only while no device gets the web app's pushes,
 * which send them already (they would come twice).
 */
export function reminderPrefs(stored: unknown, pushDevices: number): ReminderPrefs {
  const kept = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const pick = (key: keyof ReminderPrefs, fallback: boolean) => (typeof kept[key] === 'boolean' ? (kept[key] as boolean) : fallback);
  const alone = pushDevices === 0;
  return { weekly: pick('weekly', alone), event: pick('event', alone), dividend: pick('dividend', alone), expiry: pick('expiry', true) };
}

export interface ShellReminder {
  id: string;
  kind: 'weekly' | 'event' | 'dividend';
  at: string;
  title: string;
  body: string;
  url: string;
}

/** What the page hands the shell to schedule (version 1): the reminders chosen, and whether to add its own. */
export interface RemindersMessage {
  v: 1;
  expiry: boolean;
  items: ShellReminder[];
}

export function remindersMessage(reminders: readonly ShellReminder[], prefs: ReminderPrefs): RemindersMessage {
  return { v: 1, expiry: prefs.expiry, items: reminders.filter((reminder) => prefs[reminder.kind]) };
}

/** What the shell says back once it has scheduled them. */
export interface RemindersStatus {
  /** Whether iOS lets the app show notifications. */
  allowed: boolean;
  /** How many are waiting on the phone now. */
  scheduled: number;
  /** When this build runs out, as an ISO instant; null when it cannot tell. */
  expires: string | null;
}

// ---------------------------------------------------------------------------
// From the web app into the shell (longview://open?path=…)
// ---------------------------------------------------------------------------

/** A page of the site to open: a path that starts with one slash; anything else is refused. */
export function sitePath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw;
}

/** The address that opens the shell on a page of the site (its Info.plist claims the scheme). */
export function shellOpenUrl(path: string): string | null {
  const safe = sitePath(path);
  return safe ? `longview://open?path=${encodeURIComponent(safe)}` : null;
}

/** Where the web app keeps, on this device, whether a tapped push opens the shell instead. */
export const HANDOFF_KEY = 'push.openApp';
/** What the service worker adds to the address a tapped push opens (public/sw.js). */
export const VIA_PUSH = 'via';
