'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

/** How long the notice stays once it has slid in; keyboard focus inside it holds it. */
const SHOW_MS = 3000;
/** The slide out, matching .data-toast.leaving in globals.css. */
const LEAVE_MS = 250;

/** Once per load of the app: moving between pages does not bring it back, a reload does. */
let shownThisLoad = false;

/**
 * The nightly job's status as a notice that slides down from the top when the app loads, stays
 * three seconds and slides away; ✕ closes it sooner. Not on the data status page, which shows the
 * same line in full.
 */
export function DataToast({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [phase, setPhase] = useState<'waiting' | 'in' | 'out' | 'gone'>('waiting');
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (shownThisLoad || path.startsWith('/data')) {
      shownThisLoad = true;
      setPhase('gone');
      return;
    }
    shownThisLoad = true;
    setPhase('in');
    // Only the page the app was loaded on decides; later pages never show it.
  }, []);

  useEffect(() => {
    if (phase === 'in' && !held) {
      const timer = setTimeout(() => setPhase('out'), SHOW_MS);
      return () => clearTimeout(timer);
    }
    if (phase === 'out') {
      const timer = setTimeout(() => setPhase('gone'), LEAVE_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase, held]);

  if (phase === 'waiting' || phase === 'gone') return null;
  return (
    <div
      className={`data-toast${phase === 'out' ? ' leaving' : ''}`}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {children}
      <button type="button" className="toast-close" aria-label="關閉 Close" onClick={() => setPhase('gone')}>
        ✕
      </button>
    </div>
  );
}
