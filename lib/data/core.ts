/**
 * Shared by every data module: the DataError a failed read throws, and paged reads.
 *
 * One read per request: a page reads the same tables through several loaders (the dashboard reads
 * the holdings for the allocation, the risk, the plan and the watchlist), so the loaders wrapped in
 * React's `cache` run once per server render for the same client and arguments, and their callers
 * share the result. Outside a render (server actions, the nightly job) `cache` runs the loader every time.
 */

/** A query failed; the table name tells which part of the database to look at. */
export class DataError extends Error {
  constructor(
    readonly table: string,
    readonly detail: string,
  ) {
    super(`${table}: ${detail}`);
    this.name = 'DataError';
  }
}

/** The result, or the DataError a failed read threw, so a form can show it instead of an error page. */
export async function orDataError<T>(promise: Promise<T>): Promise<T | DataError> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof DataError) return err;
    throw err;
  }
}

type Result<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function rows<T>(table: string, query: Result<T>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new DataError(table, error.message);
  return data ?? [];
}

/** The Data API returns at most 1,000 rows per request by default, so long tables are read in pages. */
const PAGE = 1000;

/** Pages asked for at once after a full first page: a long table costs one round trip per few pages, not per page. */
const AHEAD = 4;

export async function allRows<T>(table: string, page: (from: number, to: number) => Result<T>): Promise<T[]> {
  const all: T[] = [];
  const first = await rows(table, page(0, PAGE - 1));
  all.push(...first);
  if (first.length < PAGE) return all;
  for (let from = PAGE; ; from += AHEAD * PAGE) {
    const batches = await Promise.all(Array.from({ length: AHEAD }, (_, i) => rows(table, page(from + i * PAGE, from + (i + 1) * PAGE - 1))));
    for (const batch of batches) {
      all.push(...batch);
      if (batch.length < PAGE) return all;
    }
  }
}

export function setting(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** A missing table (its migration not applied yet) reads as nothing, so pages and pushes keep working. */
export function missingTable(table: string, message: string): boolean {
  return message.includes(table) && /(does not exist|schema cache|not find)/i.test(message);
}
