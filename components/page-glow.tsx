import type { CSSProperties } from 'react';

import type { Glow } from '@/lib/models/glow';

/**
 * A tab headline's wash (Ink design, docs/design-handoff/02-components.md): the poster's glow, smaller, from the
 * card's top-right corner, toned by the page's own move at the page's fixed strength (lib/models/glow.ts pageGlowOf).
 * The card it sits in takes the class `has-glow`. Nothing without a glow.
 */
export function PageGlow({ glow }: { glow: Glow | undefined }) {
  if (!glow) return null;
  return <span className="glow page" data-tone={glow.tone} style={{ '--glow-k': glow.k } as CSSProperties} aria-hidden="true" />;
}
