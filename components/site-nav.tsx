'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { LABELS, type Bilingual } from '@/lib/i18n';

/**
 * The main navigation: four pages as pills, and four groups that open a short list below their
 * button. Labels show in Chinese only; each link's accessible name adds the English. On a phone the
 * pills become a bottom tab bar whose "More" opens the four groups as a sheet.
 */

interface Page {
  href: string;
  label: Bilingual;
  /** Other paths that belong to this page (sub-pages, and pages folded into it). */
  also?: readonly string[];
}

interface Group {
  key: string;
  label: Bilingual;
  pages: readonly Page[];
}

const MAIN: readonly Page[] = [
  { href: '/', label: LABELS.dashboard, also: ['/proposals', '/risk', '/rules', '/notifications'] },
  { href: '/holdings', label: LABELS.holdings, also: ['/assets', '/cash-flows', '/securities', '/valuation', '/history'] },
  { href: '/performance', label: LABELS.performance },
  { href: '/allocation', label: LABELS.allocation },
];

const GROUPS: readonly Group[] = [
  {
    key: 'analysis',
    label: { en: 'Analysis', zh: '分析區' },
    pages: [
      { href: '/look-through', label: LABELS.lookThrough },
      { href: '/stress', label: LABELS.stress },
      { href: '/frontier', label: LABELS.frontier },
      { href: '/attribution', label: LABELS.attribution },
      { href: '/regression', label: LABELS.regression },
      { href: '/sectors', label: LABELS.sectors },
    ],
  },
  {
    key: 'risks',
    label: { en: 'Other risks', zh: '其他風險' },
    pages: [
      { href: '/red-flags', label: LABELS.redFlags },
      { href: '/capm', label: LABELS.costOfEquity },
      { href: '/costs', label: LABELS.costs },
    ],
  },
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
    key: 'more',
    label: { en: 'More', zh: '其他' },
    pages: [
      { href: '/data', label: LABELS.dataStatus },
      { href: '/import', label: LABELS.importCsv },
    ],
  },
];

/** The tab bar's short labels; the fifth tab opens the groups. */
const TABS: ReadonlyArray<{ page: Page; short: string; icon: ReactNode }> = [
  { page: MAIN[0]!, short: '儀表板', icon: <path d="M3 10 L11 3.5 L19 10 V18.5 H13.5 V13.5 H8.5 V18.5 H3 Z" /> },
  {
    page: MAIN[1]!,
    short: '持倉',
    icon: (
      <>
        <rect x="3" y="4" width="16" height="14" rx="2" />
        <path d="M3 9 H19 M8 9 V18" />
      </>
    ),
  },
  { page: MAIN[2]!, short: '績效', icon: <path d="M3 16 L9 10 L12.5 13.5 L19 7 M14.5 7 H19 V11.5" /> },
  {
    page: MAIN[3]!,
    short: '配置',
    icon: (
      <>
        <circle cx="11" cy="11" r="7.5" />
        <path d="M11 3.5 V11 H18.5" />
      </>
    ),
  },
];

function matches(page: Page, path: string): boolean {
  const under = (base: string) => (base === '/' ? path === '/' : path === base || path.startsWith(`${base}/`));
  return under(page.href) || (page.also ?? []).some(under);
}

/** Visible in Chinese; the accessible name starts with the same words and adds the English. */
function name(label: Bilingual): string {
  return `${label.zh} ${label.en}`;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`nav-chevron${open ? ' open' : ''}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SiteNav({ signOut }: { signOut: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // A new page closes whatever was open.
  useEffect(() => {
    setOpen(null);
    setSheet(false);
  }, [path]);

  // A click outside the navigation, or Escape, closes an open list.
  useEffect(() => {
    if (open === null) return;
    const away = (event: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const groupOf = GROUPS.find((group) => group.pages.some((page) => matches(page, path)));

  return (
    <>
      <nav
        ref={navRef}
        className="site-nav"
        aria-label="Main 主選單"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(null);
        }}
      >
        <div className="nav-pills">
          {MAIN.map((page) => {
            const current = matches(page, path);
            return (
              <Link key={page.href} href={page.href} lang="zh-Hant" aria-label={name(page.label)} aria-current={current ? 'page' : undefined} className={`nav-pill${current ? ' current' : ''}`}>
                {page.label.zh}
              </Link>
            );
          })}
        </div>
        {GROUPS.map((group) => {
          const expanded = open === group.key;
          const current = groupOf?.key === group.key;
          return (
            <div key={group.key} className="nav-group">
              <button
                type="button"
                lang="zh-Hant"
                className={`nav-drop${expanded ? ' open' : ''}${current ? ' current' : ''}`}
                aria-label={name(group.label)}
                aria-expanded={expanded}
                aria-controls={`nav-${group.key}`}
                onClick={() => setOpen(expanded ? null : group.key)}
              >
                {group.label.zh}
                <Chevron open={expanded} />
              </button>
              {expanded && (
                <ul id={`nav-${group.key}`} className="nav-menu">
                  {group.pages.map((page) => {
                    const here = matches(page, path);
                    return (
                      <li key={page.href}>
                        <Link href={page.href} lang="zh-Hant" aria-label={name(page.label)} aria-current={here ? 'page' : undefined} className={here ? 'current' : undefined}>
                          {page.label.zh}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
      <div className="nav-signout">{signOut}</div>

      <nav className="tab-bar" aria-label="Tabs 分頁">
        {TABS.map(({ page, short, icon }) => {
          const current = matches(page, path) && !sheet;
          return (
            <Link key={page.href} href={page.href} lang="zh-Hant" aria-label={name(page.label)} aria-current={current ? 'page' : undefined} className={current ? 'current' : undefined}>
              <span className="tab-icon">
                <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  {icon}
                </svg>
              </span>
              {short}
            </Link>
          );
        })}
        <button type="button" lang="zh-Hant" aria-label="更多 More" aria-expanded={sheet} aria-controls="nav-sheet" className={sheet || groupOf ? 'current' : undefined} onClick={() => setSheet(!sheet)}>
          <span className="tab-icon">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M5 11 H5.2 M11 11 H11.2 M17 11 H17.2" />
            </svg>
          </span>
          更多
        </button>
      </nav>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <section
            id="nav-sheet"
            className="sheet"
            role="dialog"
            aria-label="更多 More"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSheet(false);
            }}
          >
            <div className="row spread">
              <h2 lang="zh-Hant">更多</h2>
              <button type="button" className="sheet-close" aria-label="關閉 Close" onClick={() => setSheet(false)}>
                ✕
              </button>
            </div>
            {GROUPS.map((group) => (
              <div key={group.key} className="sheet-group">
                <h3 lang="zh-Hant">{group.label.zh}</h3>
                <ul>
                  {group.pages.map((page) => {
                    const here = matches(page, path);
                    return (
                      <li key={page.href}>
                        <Link href={page.href} lang="zh-Hant" aria-label={name(page.label)} aria-current={here ? 'page' : undefined} className={here ? 'current' : undefined}>
                          {page.label.zh}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {signOut}
          </section>
        </div>
      )}
    </>
  );
}
