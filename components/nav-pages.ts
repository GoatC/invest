import { LABELS, type Bilingual } from '@/lib/i18n';

/**
 * The app's pages as the navigation groups them (PRD Section 5, "Navigation"): four pages that each
 * answer one question and take in the analysis pages that answer it too, and three groups for what
 * is used less often. Read by the header's pills and sub-tabs (components/site-nav.tsx), the phone's
 * tab bar (components/tab-bar.tsx) and the preloader (components/preload.tsx).
 */

export interface Page {
  href: string;
  label: Bilingual;
  /** Other paths that belong to this page (sub-pages, and pages folded into it). */
  also?: readonly string[];
  /** The tab's own pages, as sub-tabs: the first is the tab itself under a shorter name. */
  sub?: readonly Page[];
}

export interface Group {
  key: string;
  label: Bilingual;
  pages: readonly Page[];
}

export const MAIN: readonly Page[] = [
  {
    href: '/',
    label: LABELS.dashboard,
    also: ['/proposals', '/risk'],
    sub: [
      { href: '/', label: { en: 'This week', zh: '本週' }, also: ['/proposals', '/risk'] },
      { href: '/volatility', label: LABELS.volatility },
    ],
  },
  { href: '/holdings', label: LABELS.holdings, also: ['/assets', '/cash-flows', '/securities', '/valuation', '/history', '/red-flags'] },
  {
    href: '/performance',
    label: LABELS.performance,
    sub: [
      { href: '/performance', label: { en: 'Returns', zh: '報酬' } },
      { href: '/attribution', label: { en: 'Attribution', zh: '歸因' } },
      { href: '/costs', label: { en: 'Costs & tax', zh: '費用與稅' } },
    ],
  },
  {
    href: '/allocation',
    label: LABELS.allocation,
    sub: [
      { href: '/allocation', label: { en: 'Targets', zh: '目標' } },
      { href: '/look-through', label: LABELS.lookThrough },
      { href: '/sectors', label: LABELS.sectors },
      { href: '/stress', label: LABELS.stress },
      { href: '/frontier', label: LABELS.frontier },
    ],
  },
];

export const GROUPS: readonly Group[] = [
  {
    key: 'life',
    label: { en: 'Life planning', zh: '人生規劃' },
    pages: [
      { href: '/plan', label: LABELS.calculator },
      { href: '/timeline', label: LABELS.timeline },
      { href: '/monte-carlo', label: LABELS.monteCarlo },
      { href: '/windfall', label: LABELS.windfall },
    ],
  },
  {
    key: 'research',
    label: { en: 'Research', zh: '研究' },
    pages: [
      { href: '/regression', label: LABELS.regression },
      { href: '/capm', label: LABELS.costOfEquity },
    ],
  },
  {
    key: 'more',
    label: { en: 'Settings', zh: '設定' },
    pages: [
      { href: '/rules', label: LABELS.rules },
      { href: '/notifications', label: LABELS.notifications },
      { href: '/data', label: LABELS.dataStatus },
      { href: '/import', label: LABELS.importCsv },
    ],
  },
];

/** Whether `path` belongs to `page`: the page itself, a page folded into it, or one of its sub-tabs. */
export function matches(page: Page, path: string): boolean {
  const under = (base: string) => (base === '/' ? path === '/' : path === base || path.startsWith(`${base}/`));
  return under(page.href) || (page.also ?? []).some(under) || (page.sub ?? []).some((sub) => matches(sub, path));
}

/** Visible in Chinese; the accessible name starts with the same words and adds the English. */
export function name(label: Bilingual): string {
  return `${label.zh} ${label.en}`;
}

/**
 * Every page a tap in the navigation can open, the tab bar's first, then their sub-tabs, then the
 * groups': what the preloader fetches when the app opens.
 */
export const NAV_PATHS: readonly string[] = [...new Set([...MAIN.map((page) => page.href), ...MAIN.flatMap((page) => (page.sub ?? []).map((sub) => sub.href)), ...GROUPS.flatMap((group) => group.pages.map((page) => page.href))])];

/**
 * The pages one tap away from `path`: the tab bar's four, and the sub-tabs of the tab the page
 * belongs to. The opening screen waits for these; the rest of NAV_PATHS follows behind the page.
 */
export function oneTapAway(path: string): string[] {
  const tab = MAIN.find((page) => matches(page, path));
  return [...new Set([...MAIN.map((page) => page.href), ...(tab?.sub ?? []).map((sub) => sub.href)])];
}
