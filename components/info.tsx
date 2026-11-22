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

const METHOD: Bilingual = { en: 'How these are worked out', zh: '計算方式' };

/** A page's method notes, folded: one line each (PRD principle 6 keeps them out of sight until asked for). */
export function MethodDetails({ notes }: { notes: readonly Bilingual[] }) {
  return (
    <details>
      <summary>
        <Bi {...METHOD} />
      </summary>
      <ul>
        {notes.map((note) => (
          <li key={note.en}>
            <Bi {...note} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The method notes as a page's last card, with whatever follows them (a link to the settings). */
export function MethodNotes({ notes, children }: { notes: readonly Bilingual[]; children?: ReactNode }) {
  return (
    <section className="card">
      <MethodDetails notes={notes} />
      {children}
    </section>
  );
}
