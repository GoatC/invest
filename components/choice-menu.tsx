'use client';

import { Children, isValidElement, type ReactNode } from 'react';

import type { Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

/**
 * A row of choices (a pool, a period) folded into one menu button that names the current one (Hugo's
 * choice D03, 2026-11-24). The choices stay the page's own links (`aria-current` on the chosen one),
 * listed when it opens; the menu closes on a pick.
 */
export function ChoiceMenu({ label, children }: { label: Bilingual; children: ReactNode }) {
  const current = Children.toArray(children).find((child) => isValidElement<{ 'aria-current'?: string; children?: ReactNode }>(child) && child.props['aria-current'] === 'true');
  return (
    <details
      className="choice-menu"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a')) event.currentTarget.open = false;
      }}
    >
      <summary>
        <span className="choice-label">
          <Bi {...label} />
        </span>
        {isValidElement<{ children?: ReactNode }>(current) ? current.props.children : null}
        <span className="choice-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="choice-list" role="group" aria-label={`${label.zh} ${label.en}`}>
        {children}
      </div>
    </details>
  );
}
