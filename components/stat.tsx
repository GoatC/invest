import type { Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

/** A headline figure: a label, the value, and an optional note under it. */
export function Stat({ label, value, note, move }: { label: Bilingual; value: string; note?: Bilingual; /** A gain or a loss: positive, negative or 0, coloured by the app's convention. */ move?: number | null }) {
  return (
    <div className="stat">
      <span className="muted small">
        <Bi {...label} label />
      </span>
      <span className={move === undefined || move === null ? 'value' : `value ${move > 0 ? 'up' : move < 0 ? 'down' : 'flat'}`}>{value}</span>
      {note && (
        <span className="muted small">
          <Bi {...note} />
        </span>
      )}
    </div>
  );
}
