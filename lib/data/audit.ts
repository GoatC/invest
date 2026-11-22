/**
 * The edit history: every logged insert, edit and delete, by table or by row (N5).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { rows } from './core';

export interface FieldChange {
  column: string;
  before: unknown;
  after: unknown;
}

export interface AuditEntry {
  id: number;
  action: 'insert' | 'update' | 'delete';
  changedAt: string;
  changes: FieldChange[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Columns whose value differs between two logged versions of a row; bookkeeping columns are left
 * out. A JSON setting that changed is opened one level, as "column.key", so its history names the
 * part that changed rather than repeating the whole setting.
 */
export function diffRows(before: Record<string, unknown> | null, after: Record<string, unknown> | null): FieldChange[] {
  const columns = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: FieldChange[] = [];
  for (const column of columns) {
    if (['id', 'created_at', 'updated_at'].includes(column)) continue;
    const old = before?.[column] ?? null;
    const now = after?.[column] ?? null;
    if (JSON.stringify(old) === JSON.stringify(now)) continue;
    if (before && after && isPlainObject(old) && isPlainObject(now)) {
      for (const key of new Set([...Object.keys(old), ...Object.keys(now)])) {
        const was = old[key] ?? null;
        const is = now[key] ?? null;
        if (JSON.stringify(was) !== JSON.stringify(is)) changes.push({ column: `${column}.${key}`, before: was, after: is });
      }
    } else changes.push({ column, before: old, after: now });
  }
  return changes;
}

export interface AuditRow {
  id: number;
  table_name: string;
  row_key: string;
  action: AuditEntry['action'];
  changed_at: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}

/** One line of the whole edit history, with the row it concerns. */
export interface LogEntry extends AuditEntry {
  table: string;
  rowKey: string;
  /** The row after the edit, or as it was when deleted. */
  row: Record<string, unknown> | null;
}

/** Entries per page of the edit history. */
export const LOG_PAGE = 50;

/** Every logged edit and delete, newest first, one page at a time; `more` says whether older entries exist. */
export async function loadAuditLog(supabase: SupabaseClient, page: number): Promise<{ entries: LogEntry[]; more: boolean }> {
  const from = page * LOG_PAGE;
  // One row past the page tells whether there is another page.
  const found = await rows<AuditRow>(
    'audit_log',
    supabase
      .from('audit_log')
      .select('id, table_name, row_key, action, changed_at, old_row, new_row')
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + LOG_PAGE),
  );
  return { entries: found.slice(0, LOG_PAGE).map(toLogEntry), more: found.length > LOG_PAGE };
}

function toLogEntry(entry: AuditRow): LogEntry {
  return {
    id: entry.id,
    action: entry.action,
    changedAt: entry.changed_at,
    changes: entry.action === 'update' ? diffRows(entry.old_row, entry.new_row) : [],
    table: entry.table_name,
    rowKey: entry.row_key,
    row: entry.action === 'delete' ? entry.old_row : (entry.new_row ?? entry.old_row),
  };
}

/** The newest logged edits of one table, every row of it: the asset classes' targets, say. */
export async function loadTableLog(supabase: SupabaseClient, table: string): Promise<LogEntry[]> {
  const found = await rows<AuditRow>(
    'audit_log',
    supabase
      .from('audit_log')
      .select('id, table_name, row_key, action, changed_at, old_row, new_row')
      .eq('table_name', table)
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LOG_PAGE),
  );
  return found.map(toLogEntry);
}

export async function loadAuditHistory(supabase: SupabaseClient, table: string, rowKey: string): Promise<AuditEntry[]> {
  const entries = await rows<{ id: number; action: AuditEntry['action']; changed_at: string; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null }>(
    'audit_log',
    supabase.from('audit_log').select('id, action, changed_at, old_row, new_row').eq('table_name', table).eq('row_key', rowKey).order('changed_at', { ascending: false }),
  );
  return entries.map((entry) => ({ id: entry.id, action: entry.action, changedAt: entry.changed_at, changes: diffRows(entry.old_row, entry.action === 'delete' ? null : entry.new_row) }));
}
