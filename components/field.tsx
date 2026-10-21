import type { ReactNode } from 'react';

import type { Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

/** A labelled form field with an optional hint and error, both bilingual. */
export function Field({ label, hint, error, children }: { label: Bilingual; hint?: ReactNode; error?: Bilingual | null; children: ReactNode }) {
  return (
    <label className="field">
      <Bi {...label} />
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && (
        <span className="error" role="alert">
          <Bi {...error} />
        </span>
      )}
    </label>
  );
}
