'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { GROUPS, MAIN, matches, name } from './nav-pages';
import { RefreshData } from './refresh-data';
import { TabBar } from './tab-bar';

/**
 * The main navigation: four pages as pills, each answering one question and taking in the analysis
 * pages that answer it too (PRD Section 5, "Phone redesign", step 5), and three groups that open a
 * short list below their button for what is used less often. Labels show in Chinese only; each
 * link's accessible name adds the English. On a phone the pills become the floating glass tab bar
 * (components/tab-bar.tsx), whose "More" opens the groups as a sheet. The settings group also holds the button that refreshes the
 * data now (components/refresh-data.tsx). `SubNav` is the row of sub-tabs under the header on a
 * page that belongs to a tab with several pages.
 */

/**
 * Inside a link: lights up the moment it is tapped, while the server prepares the page, so a tap
 * always answers at once (a thin bar along the top of the screen, and the tab itself).
 */
function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="link-pending" data-pending aria-hidden="true" /> : null;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`nav-chevron${open ? ' open' : ''}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The sub-tabs of the tab the page belongs to, in one row under the header (it slides sideways on
 * a phone); nothing on a page of a tab with no other page, or of a group.
 */
export function SubNav() {
  const path = usePathname();
  const tab = MAIN.find((page) => page.sub && matches(page, path));
  if (!tab?.sub) return null;
  return (
    <nav className="sub-nav" aria-label={`${tab.label.en} ${tab.label.zh}`}>
      {tab.sub.map((page) => {
        const here = matches(page, path);
        return (
          <Link key={page.href} href={page.href} lang="zh-Hant" aria-label={name(page.label)} aria-current={here ? 'page' : undefined} className={here ? 'current' : undefined}>
            {page.label.zh}
            <Pending />
          </Link>
        );
      })}
    </nav>
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
                <Pending />
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
                          <Pending />
                        </Link>
                      </li>
                    );
                  })}
                  {group.key === 'more' && (
                    <li className="nav-refresh">
                      <RefreshData />
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
      <div className="nav-signout">{signOut}</div>

      <TabBar path={path} sheet={sheet} inGroup={groupOf !== undefined} onMore={() => setSheet((was) => !was)} />

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
                          <Pending />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {group.key === 'more' && <RefreshData />}
              </div>
            ))}
            {signOut}
          </section>
        </div>
      )}
    </>
  );
}
