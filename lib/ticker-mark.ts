import type { Market } from './models/types';

/**
 * The mark at the left of a holding inside the iOS shell (Liquid Glass proposal C03, Hugo
 * 2026-11-15): the company's or the fund's logo where one is published, else the ticker on its
 * class's line colour (globals.css `.tick-mark`, components/ticker-mark.tsx). The logos come from
 * Financial Modeling Prep's image address, which is free and needs no key: a US ticker as it is, a
 * Taiwan one with ".TW", a London one with ".L". Not every ticker has one (most Taiwan ETFs do
 * not); the badge stays in view when the image does not load.
 */
const SUFFIX: Record<Market, string> = { US: '', TW: '.TW', UK: '.L' };

export function logoUrl(ticker: string | null, market: Market | null): string | null {
  if (!ticker || !market) return null;
  const symbol = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) return null;
  return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol + SUFFIX[market])}.png`;
}

/** The badge's text: the ticker whole (Taiwan's run to six digits), or a non-listed asset's first two characters. */
export function markText(ticker: string | null, label: string): string {
  return ticker ? [...ticker.trim()].slice(0, 6).join('') : [...label.trim()].slice(0, 2).join('');
}
