/**
 * Warnings as data for components/alert-tiles.tsx: each a status, a code, a name, the figure, a
 * gauge against its limit and a few short chips, in place of a sentence per warning.
 */
import type { Bilingual } from './i18n';

export type AlertTone = 'alert' | 'watch' | 'info' | 'ok';

/** A small figure under a tile's headline: a word or two of Chinese (English on hover) and the figure. */
export interface AlertChip {
  label: Bilingual;
  value: string;
}

/** Where a figure stands against its limit, drawn as a bar with the limit (and the target) marked. */
export interface AlertGauge {
  value: number;
  limit: number;
  target?: number;
}

export interface AlertItem {
  /** Unique within the list. */
  key: string;
  tone: AlertTone;
  /** A short code in front, e.g. R1, R2. */
  code?: string;
  /** What the tile is about: a name, shown in both languages. */
  title: Bilingual;
  /** The headline figure. */
  value?: string;
  gauge?: AlertGauge;
  chips?: readonly AlertChip[];
  href?: string;
}
