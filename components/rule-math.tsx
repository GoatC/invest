import type { Bilingual } from '@/lib/i18n';
import type { PoolFigures } from '@/lib/models/portfolio';
import type { Caps } from '@/lib/models/rules';
import { ruleMath } from '@/lib/rule-text';

import { Bi } from './bi';

/** The R1 / R2 formulas with their inputs, folded away until asked for. */
export function RuleMath({ caps, pool, title }: { caps: Caps; pool?: PoolFigures; title?: Bilingual }) {
  if (!caps.singleStock && !caps.satellite) return null;
  return (
    <details className="small">
      <summary>
        <Bi {...(title ?? { en: 'How R1 and R2 are worked out', zh: 'R1 與 R2 的計算方式' })} />
      </summary>
      <ul>
        {ruleMath(caps, pool).map((line) => (
          <li key={line.en}>
            <Bi {...line} />
          </li>
        ))}
      </ul>
    </details>
  );
}
