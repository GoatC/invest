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
    // The poster's own text colour (the Ink poster is light; it was white on the old accent poster),
    // handed over again when the appearance chosen on 帳號 changes it (lib/theme.ts marks <html>).
    // Today's dot takes the colour the page's own (hidden) dot has: up, down or flat (Ink design).
    const dot = () => {
      const mark = host.querySelector<HTMLElement>('.hero-dot');
      return mark ? getComputedStyle(mark).backgroundColor : undefined;
    };
    let ink = getComputedStyle(host).color;
    let stop = showNative(host, posterLine(changes, ink, dot()));
    const theme = new MutationObserver(() => {
      const now = getComputedStyle(host).color;
      if (now === ink) return;
      ink = now;
      stop();
      stop = showNative(host, posterLine(changes, ink, dot()));
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      theme.disconnect();
      stop();
      host.classList.remove('native-drawn');
    };
  }, [changes]);
  return <span ref={ref} hidden />;
}
