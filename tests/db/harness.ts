import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite, type Transaction } from '@electric-sql/pglite';

import { migrationFiles } from '../../scripts/lib/migrations.ts';

export { publicTables } from '../../scripts/lib/migrations.ts';

const ROOT = join(import.meta.dirname, '..', '..');

export const OWNER_ID = '00000000-0000-4000-8000-000000000001';
export const STRANGER_ID = '00000000-0000-4000-8000-000000000002';

/** Projects created before 2026-05-30 grant every role full access to new public objects. */
const LEGACY_DEFAULT_GRANTS = `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export interface DatabaseOptions {
  /** Load supabase/seed.sql after the migrations. */
  seed?: boolean;
  /** Start from an older project's default grants, to show the migrations revoke them. */
  legacyGrants?: boolean;
}

/** An in-memory database with the Supabase stand-in, every migration, an owner and a stranger. */
export async function freshDatabase(options: DatabaseOptions = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, 'supabase_stub.sql'), 'utf8'));
  if (options.legacyGrants) await db.exec(LEGACY_DEFAULT_GRANTS);
  for (const file of migrationFiles()) await db.exec(readFileSync(file, 'utf8'));
  if (options.seed) await db.exec(readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8'));
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [OWNER_ID, 'owner@example.com', STRANGER_ID, 'stranger@example.com']);
  await db.query('insert into private.app_owner (user_id) values ($1)', [OWNER_ID]);
  return db;
}

export type Caller = 'owner' | 'stranger' | 'anon' | 'service_role';

const CALLERS: Record<Caller, { role: string; sub?: string }> = {
  owner: { role: 'authenticated', sub: OWNER_ID },
  stranger: { role: 'authenticated', sub: STRANGER_ID },
  anon: { role: 'anon' },
  service_role: { role: 'service_role' },
};

/**
 * Runs `work` as one kind of Supabase caller, the way the Data API does: the JWT claims go into
 * request.jwt.claims and the role is switched for the transaction. Always rolled back, so tests
 * never see each other's writes.
 */
export async function as<T>(db: PGlite, caller: Caller, work: (tx: Transaction) => Promise<T>): Promise<T> {
  const { role, sub } = CALLERS[caller];
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { role, sub } : { role })]);
    await tx.exec(`set local role ${role}`);
    const result = await work(tx);
    await tx.rollback();
    return result;
  });
}

/** The SQLSTATE a statement fails with, or undefined when it succeeds. */
export async function errorCode(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code ?? 'no code';
  }
}
