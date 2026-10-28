import type { ReactNode } from 'react';

import type { Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

const HOW: Bilingual = { en: 'How it works', zh: '說明' };

/** An explanation folded away until asked for (PRD principle 4 keeps it one tap from every number). */
export function Info({ children, label = HOW, id }: { children: ReactNode; label?: Bilingual; id?: string }) {
  return (
    <details className="info" id={id}>
      <summary>
        <span aria-hidden="true">ⓘ </span>
        <Bi {...label} />
      </summary>
      <div className="info-body">{children}</div>
    </details>
  );
}
