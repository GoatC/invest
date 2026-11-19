'use client';

import { useEffect, useRef } from 'react';
import { posterLine } from '@/lib/native-chart';

import { nativeCharts, showNative } from './native-charts';

/**
 * Inside a shell that draws charts, hands the poster's line (app/page.tsx) to Swift Charts: the
 * chart's box is this element's parent, whose own line then stays out of sight.
 */
export function NativePosterLine({ changes }: { changes: readonly number[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host || !nativeCharts()) return undefined;
    host.classList.add('native-drawn');
    // The poster's own text colour (the Ink poster is light; it was white on the old accent poster).
    const stop = showNative(host, posterLine(changes, getComputedStyle(host).color));
    return () => {
      stop();
      host.classList.remove('native-drawn');
    };
  }, [changes]);
  return <span ref={ref} hidden />;
}
