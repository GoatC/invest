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

/** Tables the migrations create in the public schema, read from the SQL itself. */
export function publicTables(dir = MIGRATIONS_DIR): string[] {
  return migrationFiles(dir).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/^create table public\.(\w+)/gm)].map((match) => match[1] ?? ''),
  );
}
