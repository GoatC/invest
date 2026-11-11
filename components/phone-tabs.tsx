'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Bilingual } from '@/lib/i18n';

export interface TabPart {
  /** The sub-tab this part of the page shows under on a phone. */
  tab: string;
  content: ReactNode;
}

/**
 * A long page as sub-tabs on a phone (PRD Section 5, "Phone redesign"): the parts are given in the
 * order a wide screen shows them, all at once; under 760px a row of sub-tabs shows the parts of one
 * tab at a time. An address that names a part (`/holdings#add-trade`) opens the tab that holds it.
 */
export function PhoneTabs({ tabs, parts, initial, label }: { tabs: ReadonlyArray<{ key: string; label: Bilingual }>; parts: readonly TabPart[]; initial?: string; label: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key ?? '');
  const top = useRef<HTMLDivElement>(null);
  const wanted = useRef<string | null>(null);
  const path = usePathname();
  const search = useSearchParams().toString();

  // The part the address names: its tab opens, and the page moves to it once it shows.
  useEffect(() => {
    const follow = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const part = id ? document.getElementById(id)?.closest<HTMLElement>('[data-tab-part]') : null;
      const tab = part?.dataset['tabPart'];
      if (!tab) return;
      wanted.current = id;
      setActive((was) => {
        if (was === tab) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
        return tab;
      });
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [path, search]);

  useEffect(() => {
    if (!wanted.current) return;
    document.getElementById(wanted.current)?.scrollIntoView();
    wanted.current = null;
  }, [active]);

  function choose(key: string) {
    setActive(key);
    // A tab chosen far down the page starts at its top.
    if (top.current && top.current.getBoundingClientRect().top < 0) top.current.scrollIntoView();
  }

  return (
    <>
      <div ref={top} className="phone-tabs-top" />
      <div className="phone-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab) => (
          <button key={tab.key} type="button" role="tab" lang="zh-Hant" aria-label={`${tab.label.zh} ${tab.label.en}`} aria-selected={tab.key === active} className={tab.key === active ? 'selected' : undefined} onClick={() => choose(tab.key)}>
            {tab.label.zh}
          </button>
        ))}
      </div>
      {parts.map((part, index) => (
        <div key={index} className={part.tab === active ? 'tab-part' : 'tab-part off'} data-tab-part={part.tab}>
          {part.content}
        </div>
      ))}
    </>
  );
}
