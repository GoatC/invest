/**
 * The app's appearance (Hugo, 2026-11-19; docs/superpowers/specs/2026-11-19-appearance-and-splash-design.md):
 * 淺色 by default, 深色 or 自動 (the phone's) when chosen on 帳號. The choice is kept on this device, in
 * localStorage, and THEME_SCRIPT, the first thing in <head>, marks <html data-theme> before the first
 * paint, so a dark choice never flashes light. app/globals.css keys Ink's dark tokens off that mark.
 * The iOS shell is told the choice in the page's state message (lib/shell.ts) and themes its own bars.
 */

export type ThemeChoice = 'light' | 'dark' | 'auto';
export type Theme = 'light' | 'dark';

/** Where the choice is kept, in localStorage. */
export const THEME_KEY = 'theme';

/** The browser's bar colour in each theme: the page head's ground (app/layout.tsx's earlier values). */
export const THEME_COLOR: Record<Theme, string> = { light: '#fafbfa', dark: '#101613' };

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The stored choice; anything else, or nothing, is the default 淺色. */
export function readTheme(stored: string | null | undefined): ThemeChoice {
  return stored === 'dark' || stored === 'auto' ? stored : 'light';
}

/** The theme a choice shows: 自動 follows the phone, the other two do not. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  return choice === 'auto' ? (prefersDark ? 'dark' : 'light') : choice;
}

/**
 * Run before the first paint, as an inline script at the top of <head>: marks <html> with the theme and
 * sets the bar colour. Self-contained (no imports), and never throws: a blocked localStorage paints light.
 */
export const THEME_SCRIPT = `(function(){var t='light';try{var s=localStorage.getItem('${THEME_KEY}');if(s==='dark')t='dark';else if(s==='auto'&&matchMedia('${DARK_QUERY}').matches)t='dark'}catch(e){}document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==='dark'?'${THEME_COLOR.dark}':'${THEME_COLOR.light}'})()`;

/** The choice kept on this device. */
export function storedTheme(): ThemeChoice {
  try {
    return readTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return 'light';
  }
}

function paint(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[theme];
}

let follow: { query: MediaQueryList; listener: () => void } | null = null;

/** Keeps the choice and shows it now; while it is 自動, follows the phone turning light or dark. */
export function applyTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private mode: the choice holds until the page closes.
  }
  if (follow) follow.query.removeEventListener('change', follow.listener);
  follow = null;
  const query = window.matchMedia(DARK_QUERY);
  paint(resolveTheme(choice, query.matches));
  if (choice === 'auto') {
    const listener = () => paint(resolveTheme('auto', query.matches));
    query.addEventListener('change', listener);
    follow = { query, listener };
  }
}
