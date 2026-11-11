/**
 * What the holdings overview draws for one holding (PRD Section 5, "Phone redesign", step 3): the
 * last session's move, where its buys and its price stand against its average cost, the signals
 * the app's own rules raise on it, and the tiles of the treemap. Nothing here forecasts: every
 * signal is a rule the app already runs (R1, N3, F8, F12, a filing date, a proposal waiting).
 */
import { percent, points } from '../format';
import type { Bilingual } from '../i18n';
import type { DriftStatus } from './allocation';
import type { ClosePoint } from './price-history';

/** The newest close against the one before it. */
export interface Move {
  date: string;
  previous: string;
  /** 0.012 is +1.2%. */
  change: number;
}

/** The last session's move; null with fewer than two closes or a previous close of 0. */
export function lastMove(closes: readonly ClosePoint[]): Move | null {
  const last = closes[closes.length - 1];
  const before = closes[closes.length - 2];
  if (!last || !before || before.close <= 0) return null;
  return { date: last.date, previous: before.date, change: last.close / before.close - 1 };
}

/** The closes on or after a date. */
export function closesSince(closes: readonly ClosePoint[], from: string): ClosePoint[] {
  return closes.filter((point) => point.date >= from);
}

/** Where a holding's buys, its price and its 52 weeks stand, each as a fraction against the average cost (+0.07 is 7% above it). */
export interface CostStrip {
  low: number;
  high: number;
  now: number;
  /** One per buy still relevant, oldest first. */
  lots: number[];
  /** F12's buy and trim prices for a valued stock; null otherwise. */
  buyZone: number | null;
  trimZone: number | null;
}

/**
 * A holding on the cost scale; null without an average cost or a price. The range covers the closes
 * given (a year's) and always takes in the price now.
 */
export function costStrip(input: { avgCost: number | null; last: number | null; closes: readonly ClosePoint[]; lots: readonly number[]; buyPrice?: number | null; trimPrice?: number | null }): CostStrip | null {
  const { avgCost, last } = input;
  if (avgCost === null || last === null || !(avgCost > 0)) return null;
  const against = (price: number) => price / avgCost - 1;
  const prices = [...input.closes.map((point) => point.close), last];
  return {
    low: against(Math.min(...prices)),
    high: against(Math.max(...prices)),
    now: against(last),
    lots: input.lots.map(against),
    buyZone: input.buyPrice ? against(input.buyPrice) : null,
    trimZone: input.trimPrice ? against(input.trimPrice) : null,
  };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** act: a rule asks for a trade; watch: look at it; buy: the rules would buy it; wait: something is due; ok: checked and fine; info: a figure, no status. */
export type SignalKind = 'act' | 'watch' | 'buy' | 'wait' | 'ok' | 'info';
/** The matrix's columns: R1, F12's zones, N3's light, F8's drift of its class, a date or a proposal. */
export const SIGNAL_COLUMNS = ['rule', 'value', 'flag', 'mix', 'event'] as const;
export type SignalColumn = (typeof SIGNAL_COLUMNS)[number];

export interface Signal {
  column: SignalColumn;
  kind: SignalKind;
  label: Bilingual;
  href?: string;
}

export interface SignalInput {
  ticker: string;
  /** R1: this stock's share of the regular pool and the cap, when over it. */
  breach?: { weight: number; limit: number };
  /** N3's light; undefined for a fund, null when nothing could be scored. */
  light?: 'red' | 'amber' | 'green' | null;
  /** F12: where the price stands against the saved value's zones. */
  zone?: { zone: 'buy' | 'trim' | 'between'; toBuy: number; toTrim: number };
  /** F8: the holding's class against its target; `nextBuy` when the next contribution goes to it. */
  drift?: { status: DriftStatus; drift: number; nextBuy: boolean };
  /** The next filing, when it falls within the days looked ahead. */
  filing?: { date: string };
  /** A proposal with an order for this ticker waits. */
  proposal?: boolean;
}

const ORDER: Record<SignalKind, number> = { act: 0, watch: 1, buy: 2, wait: 3, ok: 4, info: 5 };

/** "11/14" for 2026-11-14. */
function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** A holding's signals, the ones to act on first. */
export function holdingSignals(input: SignalInput): Signal[] {
  const t = encodeURIComponent(input.ticker);
  const out: Signal[] = [];
  if (input.breach) {
    const figures = `${percent(input.breach.weight)} / ${percent(input.breach.limit, 0)}`;
    out.push({ column: 'rule', kind: 'act', label: { en: `Over the single-stock cap ${figures}`, zh: `超過個股上限 ${figures.replace(' / ', '／')}` }, href: '/#proposals' });
  }
  if (input.light === 'red') out.push({ column: 'flag', kind: 'act', label: { en: 'Red flag: red', zh: '紅旗紅燈' }, href: `/red-flags?t=${t}` });
  else if (input.light === 'amber') out.push({ column: 'flag', kind: 'watch', label: { en: 'Red flag: amber', zh: '紅旗黃燈' }, href: `/red-flags?t=${t}` });
  else if (input.light === 'green') out.push({ column: 'flag', kind: 'ok', label: { en: 'Red flag: green', zh: '紅旗綠燈' }, href: `/red-flags?t=${t}` });
  if (input.zone) {
    const href = `/valuation?t=${t}`;
    if (input.zone.zone === 'buy') out.push({ column: 'value', kind: 'buy', label: { en: 'In the buy zone', zh: '在買入區' }, href });
    else if (input.zone.zone === 'trim') out.push({ column: 'value', kind: 'watch', label: { en: 'In the trim zone', zh: '在減碼區' }, href });
    else out.push({ column: 'value', kind: 'info', label: { en: `${percent(input.zone.toBuy, 0)} above the buy zone`, zh: `距買入區 ${percent(input.zone.toBuy, 0)}` }, href });
  }
  if (input.drift) {
    const { status, drift, nextBuy } = input.drift;
    const size = points(Math.abs(drift)).replace(/^[+−]/, '');
    const side: Bilingual = drift < 0 ? { en: `Class ${size} under target`, zh: `類別低配 ${size}` } : { en: `Class ${size} over target`, zh: `類別超配 ${size}` };
    if (nextBuy) {
      out.push({ column: 'mix', kind: 'buy', label: { en: 'Next contribution buys this', zh: '下次扣款優先' }, href: '/allocation' });
      out.push({ column: 'mix', kind: 'info', label: side, href: '/allocation' });
    } else if (status === 'rebalance') out.push({ column: 'mix', kind: 'act', label: side, href: '/allocation' });
    else if (status === 'watch') out.push({ column: 'mix', kind: 'watch', label: side, href: '/allocation' });
    else if (status === 'ok') out.push({ column: 'mix', kind: 'ok', label: { en: 'Class on target', zh: '類別符合目標' }, href: '/allocation' });
  }
  if (input.proposal) out.push({ column: 'event', kind: 'wait', label: { en: 'Proposal waiting', zh: '提案待處理' }, href: '/#proposals' });
  if (input.filing) out.push({ column: 'event', kind: 'wait', label: { en: `Filing due ${shortDate(input.filing.date)}`, zh: `${shortDate(input.filing.date)} 財報` }, href: `/valuation?t=${t}` });
  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

/** The one signal a matrix cell shows for a column: the first by the order above, a figure-only one last. */
export function cellSignal(signals: readonly Signal[], column: SignalColumn): Signal | undefined {
  return signals.find((signal) => signal.column === column && signal.kind !== 'info') ?? signals.find((signal) => signal.column === column);
}

/**
 * The core classes the next contribution buys: the most underweight ones, at most `max`
 * (MONTHLY_CONTRIBUTION's max_classes, F8's minimum-fee limit); a class at or above its target is
 * never one. F8 never buys the satellite.
 */
export function nextBuyClasses(drifts: ReadonlyArray<{ assetClass: { id: string; sleeve: string }; drift: number }>, max: number): string[] {
  return drifts
    .filter((row) => row.assetClass.sleeve === 'core' && row.drift < -1e-9)
    .sort((a, b) => a.drift - b.drift)
    .slice(0, Math.max(0, max))
    .map((row) => row.assetClass.id);
}

// ---------------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------------

export interface Tile<T> {
  item: T;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A squarified treemap: each item's area in proportion to its value, laid out largest first so the
 * tiles stay near square. Items with no value are left out.
 */
export function treemap<T>(items: ReadonlyArray<{ item: T; value: number }>, width: number, height: number): Tile<T>[] {
  const rows = items.filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, entry) => sum + entry.value, 0);
  if (total <= 0 || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const tiles: Tile<T>[] = [];
  let [x, y, w, h] = [0, 0, width, height];
  let index = 0;
  /** The worst side ratio of a strip of these areas along a side of this length. */
  const worst = (areas: readonly number[], side: number) => {
    const sum = areas.reduce((a, b) => a + b, 0);
    return Math.max(...areas.map((area) => Math.max((side * side * area) / (sum * sum), (sum * sum) / (side * side * area))));
  };
  while (index < rows.length) {
    const side = Math.min(w, h);
    const strip = [rows[index]!.value * scale];
    let end = index + 1;
    while (end < rows.length && worst([...strip, rows[end]!.value * scale], side) <= worst(strip, side)) {
      strip.push(rows[end]!.value * scale);
      end += 1;
    }
    const sum = strip.reduce((a, b) => a + b, 0);
    const thickness = sum / side;
    let offset = 0;
    strip.forEach((area, k) => {
      const length = area / thickness;
      // The strip runs along the shorter side: down the left when the box is wide, across the top when tall.
      tiles.push(w >= h ? { item: rows[index + k]!.item, x, y: y + offset, width: thickness, height: length } : { item: rows[index + k]!.item, x: x + offset, y, width: length, height: thickness });
      offset += length;
    });
    if (w >= h) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
    index = end;
  }
  return tiles;
}
