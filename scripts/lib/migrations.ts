import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

/** Migration files, as paths, in the order Supabase applies them (by their timestamp prefix). */
export function migrationFiles(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(dir, name));
}

function created(kind: 'table' | 'view', dir: string): string[] {
  const pattern = new RegExp(`^create ${kind} public\\.(\\w+)`, 'gm');
  return migrationFiles(dir).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(pattern)].map((match) => match[1] ?? ''));
}

/** Tables the migrations create in the public schema, read from the SQL itself. */
export function publicTables(dir = MIGRATIONS_DIR): string[] {
  return created('table', dir);
}

/** Views the migrations create in the public schema; the Data API serves them like tables. */
export function publicViews(dir = MIGRATIONS_DIR): string[] {
  return created('view', dir);
}
