import type { Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

/** A headline figure: a label, the value, and an optional note under it. */
export function Stat({ label, value, note }: { label: Bilingual; value: string; note?: Bilingual }) {
  return (
    <div className="stat">
      <span className="muted small">
        <Bi {...label} />
      </span>
      <span className="value">{value}</span>
      {note && (
        <span className="muted small">
          <Bi {...note} />
        </span>
      )}
    </div>
  );
}
