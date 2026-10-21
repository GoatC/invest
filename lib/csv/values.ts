/** Turning statement cells into amounts, dates, sides and tickers. */
import type { Side } from '../models/types';

/**
 * "1,234.50", "$1,234.50", "1,234.50 USD", "(12.30)" and "−12.3" as numbers; blank, a dash or
 * text gives undefined.
 */
export function parseAmount(raw: string): number | undefined {
  let text = raw.replace(/[,\s]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/^[-−]/.test(text)) {
    negative = !negative;
    text = text.slice(1);
  }
  // Currency signs and codes around the number: NT$, US$, $, USD, TWD.
  text = text.replace(/^[^\d.]+/, '').replace(/[^\d.]+$/, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return undefined;
  const value = Number(text);
  return negative ? -value : value;
}

/** A blank or dash-only cell, which statements use for "none". */
export function isBlank(raw: string): boolean {
  return /^[\s\-−–—]*$/.test(raw);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * ymd 2026/10/07, mdy 10/07/2026, dmy 07/10/2026, roc 115/10/07 (Republic of China year, as
 * Taiwanese statements write it; 115 is 2026). Any of / - . 年 月 works as the separator, and
 * 20261007 or 1151007 without one.
 */
export type DateFormat = 'ymd' | 'mdy' | 'dmy' | 'roc';
export const DATE_FORMATS: readonly DateFormat[] = ['ymd', 'roc', 'mdy', 'dmy'];

function dateParts(raw: string): [string, string, string] | undefined {
  // Drop a time of day: "2026/10/07 09:30:00", "2026-10-07T09:30".
  const text = raw.trim().split(/[\sT]/)[0] ?? '';
  const separated = /^(\d{1,4})[/\-.年](\d{1,2})[/\-.月](\d{1,4})日?$/.exec(text);
  if (separated) return [separated[1] ?? '', separated[2] ?? '', separated[3] ?? ''];
  const compact = /^(\d{3,4})(\d{2})(\d{2})$/.exec(text);
  if (compact) return [compact[1] ?? '', compact[2] ?? '', compact[3] ?? ''];
  return undefined;
}

function isoDate(year: number, month: number, day: number): string | undefined {
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1) return undefined;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fromParts([a, b, c]: [string, string, string], format: DateFormat): string | undefined {
  switch (format) {
    case 'ymd':
      return a.length === 4 && c.length <= 2 ? isoDate(Number(a), Number(b), Number(c)) : undefined;
    case 'roc':
      return a.length <= 3 && c.length <= 2 ? isoDate(Number(a) + 1911, Number(b), Number(c)) : undefined;
    case 'mdy':
      return c.length === 4 && a.length <= 2 ? isoDate(Number(c), Number(a), Number(b)) : undefined;
    case 'dmy':
      return c.length === 4 && a.length <= 2 ? isoDate(Number(c), Number(b), Number(a)) : undefined;
  }
}

/** The date as YYYY-MM-DD, or undefined when it does not read in this format. */
export function parseDate(raw: string, format: DateFormat): string | undefined {
  const parts = dateParts(raw);
  return parts ? fromParts(parts, format) : undefined;
}

/**
 * The format that reads every date in a column. Day-first and month-first both fit when no day
 * is above 12; month-first wins then, and the result says the choice was a guess.
 */
export function guessDateFormat(values: readonly string[]): { format: DateFormat; ambiguous: boolean } | undefined {
  const parts = values.map(dateParts).filter((part) => part !== undefined);
  if (parts.length === 0) return undefined;
  const fits = DATE_FORMATS.filter((format) => parts.every((part) => fromParts(part, format) !== undefined));
  const [format] = fits;
  return format ? { format, ambiguous: fits.includes('mdy') && fits.includes('dmy') } : undefined;
}

// ---------------------------------------------------------------------------
// Buy or sell
// ---------------------------------------------------------------------------

export interface SideWords {
  buy: string[];
  sell: string[];
}

/** What statements write in their buy / sell column; editable per broker. */
export const DEFAULT_SIDE_WORDS: SideWords = {
  buy: ['buy', 'b', 'bought', '買', '買進', '買入'],
  sell: ['sell', 's', 'sold', '賣', '賣出'],
};

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A cell that equals a buy or a sell word, else one that contains a word of two or more letters
 * (or one Chinese character), as in 現股買進. A cell matching both, or neither, is not a side.
 */
export function parseSide(raw: string, words: SideWords): Side | undefined {
  const value = normalise(raw);
  if (!value) return undefined;
  const equals = (list: readonly string[]) => list.some((word) => normalise(word) === value);
  const contains = (list: readonly string[]) =>
    list.some((word) => {
      const needle = normalise(word);
      return (needle.length >= 2 || /[^\x00-\x7f]/.test(needle)) && value.includes(needle);
    });
  const buyEquals = equals(words.buy);
  const sellEquals = equals(words.sell);
  if (buyEquals !== sellEquals) return buyEquals ? 'buy' : 'sell';
  const buyContains = contains(words.buy);
  const sellContains = contains(words.sell);
  if (buyContains !== sellContains) return buyContains ? 'buy' : 'sell';
  return undefined;
}

/** "buy, 買進" → ["buy", "買進"]: the comma list a person types for the side words. */
export function wordList(text: string): string[] {
  return text
    .split(/[,，、]/)
    .map((word) => word.trim())
    .filter((word) => word !== '');
}

// ---------------------------------------------------------------------------
// Tickers
// ---------------------------------------------------------------------------

/**
 * The known ticker a statement means: as written, else its first word ("VT US"), else without
 * a market suffix ("2330.TW"), else a Taiwan code that lost its leading zeros in a spreadsheet
 * ("692" for 00692) when exactly one known code matches. Unknown text comes back upper-cased.
 */
export function resolveTicker(raw: string, known: ReadonlySet<string>): { ticker: string; known: boolean } {
  const text = raw.trim().toUpperCase();
  const candidates = [text, text.split(/\s+/)[0] ?? '', text.includes('.') ? text.slice(0, text.lastIndexOf('.')) : ''];
  for (const candidate of candidates) if (candidate && known.has(candidate)) return { ticker: candidate, known: true };
  if (/^\d+$/.test(text)) {
    const matches = [...known].filter((ticker) => /^\d+$/.test(ticker) && Number(ticker) === Number(text));
    const [only] = matches;
    if (only !== undefined && matches.length === 1) return { ticker: only, known: true };
  }
  return { ticker: text, known: false };
}
