/**
 * What each non-listed asset (gold in grams, a TWD balance) held on any past day. The table keeps
 * only today's quantity; the audit log keeps every earlier version and the deletes, so the past
 * is replayed from it (N5: every edit is logged).
 */
import { taipeiToday } from '../dates';
import type { ManualAsset, Pool } from './types';

export interface ManualState {
  /** From this Taipei date on, until the next state. */
  from: string;
  name: string;
  assetClassId: string;
  productType: ManualAsset['productType'];
  unit: ManualAsset['unit'];
  quantity: number;
  /** The value entered by hand, the fallback for gold without a price. */
  lastValueTwd: number | null;
  pool: Pool;
}

export interface ManualHistory {
  id: number;
  /** Oldest first; an asset holds nothing before the first state. */
  states: ManualState[];
  /** The Taipei date it was deleted; it holds nothing at the end of that day and after. */
  deletedOn: string | null;
}

/** A manual asset as the table holds it now, with the day it was first saved. */
export interface ManualAssetRow extends ManualAsset {
  createdAt: string;
}

/** One audit-log row for the manual_assets table. */
export interface ManualAuditRow {
  rowKey: string;
  action: 'insert' | 'update' | 'delete';
  changedAt: string;
  oldRow: Record<string, unknown> | null;
  newRow: Record<string, unknown> | null;
}

function day(at: string): string {
  return taipeiToday(new Date(at));
}

/** A logged row's fields; undefined when it is not a manual asset row. */
function fromRow(row: Record<string, unknown> | null, from: string): ManualState | undefined {
  if (!row) return undefined;
  const quantity = Number(row['quantity']);
  const unit = row['unit'] === 'grams' ? 'grams' : row['unit'] === 'TWD' ? 'TWD' : undefined;
  if (!Number.isFinite(quantity) || !unit) return undefined;
  const value = row['last_value_twd'];
  return {
    from,
    name: String(row['name'] ?? ''),
    assetClassId: String(row['asset_class_id'] ?? ''),
    productType: row['product_type'] === 'gold' ? 'gold' : 'cash_mmf',
    unit,
    quantity,
    lastValueTwd: value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value),
    pool: row['pool'] === 'windfall' ? 'windfall' : 'regular',
  };
}

function fromAsset(asset: ManualAsset, from: string): ManualState {
  return {
    from,
    name: asset.name,
    assetClassId: asset.assetClassId,
    productType: asset.productType,
    unit: asset.unit,
    quantity: asset.quantity,
    lastValueTwd: asset.lastValueTwd,
    pool: asset.pool,
  };
}

/**
 * Replays the audit log over today's rows. An asset starts on the day it was created, as its
 * first logged version (or as it is now, if it was never edited); each edit starts a new state on
 * its day; a delete ends it. Several edits on one day leave the last one.
 */
export function manualHistories(current: readonly ManualAssetRow[], audit: readonly ManualAuditRow[]): ManualHistory[] {
  const events = new Map<string, ManualAuditRow[]>();
  for (const row of audit) {
    if (row.action === 'insert') continue;
    const list = events.get(row.rowKey) ?? [];
    list.push(row);
    events.set(row.rowKey, list);
  }
  const ids = new Set([...current.map((asset) => String(asset.id)), ...events.keys()]);
  const histories: ManualHistory[] = [];
  for (const id of ids) {
    const asset = current.find((candidate) => String(candidate.id) === id);
    const logged = (events.get(id) ?? []).sort((a, b) => a.changedAt.localeCompare(b.changedAt));
    const first = logged[0];
    const createdAt = asset?.createdAt ?? (typeof first?.oldRow?.['created_at'] === 'string' ? first.oldRow['created_at'] : undefined);
    if (!createdAt) continue;
    const start = day(createdAt);
    const initial = first ? fromRow(first.oldRow, start) : asset ? fromAsset(asset, start) : undefined;
    if (!initial) continue;
    const states: ManualState[] = [initial];
    let deletedOn: string | null = null;
    for (const event of logged) {
      if (event.action === 'delete') {
        deletedOn = day(event.changedAt);
        break;
      }
      const next = fromRow(event.newRow, day(event.changedAt));
      if (!next) continue;
      // An edit on the day the asset was created, or a second edit that day, replaces that day's state.
      if (states[states.length - 1]?.from === next.from) states[states.length - 1] = next;
      else states.push(next);
    }
    histories.push({ id: Number(id), states, deletedOn });
  }
  return histories.sort((a, b) => a.id - b.id);
}

/** The state at the end of a Taipei date, or undefined when the asset did not exist then. */
export function stateOn(history: ManualHistory, date: string): ManualState | undefined {
  if (history.deletedOn !== null && date >= history.deletedOn) return undefined;
  let found: ManualState | undefined;
  for (const state of history.states) {
    if (state.from <= date) found = state;
    else break;
  }
  return found;
}
