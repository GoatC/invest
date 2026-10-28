import type { ReactNode } from 'react';

import type { Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

export type FactTone = 'ok' | 'watch' | 'alert' | 'none';

export interface Fact {
  label: Bilingual;
  /** The figure, as written: numbers need no translation. */
  value: ReactNode;
  /** A word or two under the figure, when it needs one. */
  note?: Bilingual;
  tone?: FactTone;
}

const ICON: Record<FactTone, string> = { ok: '✓', watch: '!', alert: '✕', none: '' };

/** Short labelled figures in place of sentences: a label, the figure, a status icon. */
export function Facts({ facts }: { facts: readonly Fact[] }) {
  return (
    <ul className="facts">
      {facts.map((fact) => (
        <li key={fact.label.en} className={`fact ${fact.tone ?? 'none'}`}>
          <span className="fact-label">
            {fact.tone && fact.tone !== 'none' && (
              <span className={`status-icon ${fact.tone === 'alert' ? 'rebalance' : fact.tone}`} aria-hidden="true">
                {ICON[fact.tone]}
              </span>
            )}
            <Bi {...fact.label} />
          </span>
          <strong className="fact-value">{fact.value}</strong>
          {fact.note && (
            <span className="fact-note">
              <Bi {...fact.note} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
