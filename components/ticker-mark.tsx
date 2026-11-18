'use client';

import { useEffect, useRef, useState } from 'react';

import type { Market } from '@/lib/models/types';
import { logoUrl, markText } from '@/lib/ticker-mark';

/**
 * A holding's mark, shown inside the iOS shell only (globals.css `.tick-mark`; lib/ticker-mark.ts):
 * the ticker on its class's line colour, with the logo laid over it once it loads. An image that
 * fails leaves the badge, including one that failed before the page was hydrated, whose error
 * event React never saw. Decorative: the holding's name follows it in text.
 */
export function TickerMark({ ticker, market, label, classId }: { ticker: string | null; market: Market | null; label: string; classId: string }) {
  const url = logoUrl(ticker, market);
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const shown = image.current;
    if (shown?.complete && shown.naturalWidth === 0) setFailed(true);
  }, [url]);
  return (
    <i className="tick-mark" data-line={classId} aria-hidden="true">
      {markText(ticker, label)}
      {url && !failed && <img ref={image} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    </i>
  );
}
