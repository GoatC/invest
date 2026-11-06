/**
 * The volatility job (N8, added 2026-11-06). GitHub Actions runs it twice a day
 * (.github/workflows/volatility.yml): after Taiwan's close, for TAIEX and Taiwan's VIX, and after
 * the US close, for the VIX. It loads each series of the score into index_prices (each with its
 * fallback), TAIEX's and the S&P 500's last two weeks too (the nightly job keeps their history, but
 * runs only at 22:23), scores the day (lib/models/volatility) and saves the score in
 * volatility_scores, then records the run in job_runs as job "volatility". The data-failure alert
 * reads the nightly job's runs only, so a missed volatility run never raises it.
 */
import { addDays } from '../../../lib/dates.ts';
import { volatilityScore, VOLATILITY_SERIES, type Close, type ComponentReading, type VolatilitySettings } from '../../../lib/models/volatility.ts';
import { FinMind } from '../feeds/finmind.ts';
import { indexAttempts, type IndexAttempt, type IndexClose } from '../feeds/indices.ts';
import type { MarketEvent } from '../../../lib/models/events.ts';
import { FED_CALENDAR, fomcEvents, FRED_RELEASES, fredCalendarEvents, fredCalendarUrl } from '../feeds/events.ts';
import type { Get } from '../feeds/types.ts';
import { volatilityAttempts } from '../feeds/volatility.ts';

export const JOB = 'volatility';

/** TAIEX and the S&P 500: the days loaded on each run, enough to bring in the session the nightly job has not loaded yet. */
export const INDEX_DAYS = 14;

export interface ScoreRow {
  date: string;
  score: number;
  mean: number;
  coverage: number;
  components: Array<{ id: string; value: number | null; date: string | null; sub_score: number | null; weight: number; status: string }>;
}

type Loaded = { source: string; rows: number; latest: string };

export interface VolatilityRunDetail {
  series: Record<string, Loaded>;
  score?: { date: string; score: number | null; coverage: number };
  /** The calendar's events from today on, by kind (N8 step 2). */
  events?: Record<string, number>;
  /** Proposals the rules drafted and closed on the new score (step 3). */
  rules?: { created: number; closed: number };
  warnings: string[];
  errors: string[];
}

export interface VolatilityRun {
  job: string;
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'partial' | 'failed';
  detail: VolatilityRunDetail;
}

export interface VolatilityStore {
  /** config volatility; undefined before its migration or when malformed. */
  settings(): Promise<VolatilitySettings | undefined>;
  /** Upserts daily closes (index_prices); fillOnly adds missing days only. */
  saveIndexPrices(rows: readonly IndexClose[], options?: { fillOnly?: boolean }): Promise<void>;
  /** Each id's closes from `from` on, oldest first. */
  series(ids: readonly string[], from: string): Promise<Map<string, Close[]>>;
  /** Upserts the day's score (volatility_scores). */
  saveScore(row: ScoreRow): Promise<void>;
  /** Replaces a feed's events from `from` on with these (market_events): a rescheduled meeting moves. */
  replaceEvents(source: 'fed' | 'fred', from: string, rows: readonly MarketEvent[]): Promise<void>;
  recordRun(run: VolatilityRun): Promise<void>;
  /** Evaluates every rule as of `now` and saves the proposals (runRules in lib/data), so the alert reads the new score at once. */
  evaluateRules(today: string, now: string): Promise<{ created: number; closed: number }>;
}

export interface VolatilityDeps {
  get: Get;
  store: VolatilityStore;
  /** For TAIEX and the S&P 500 (FinMind, as the nightly job loads them). */
  finmindToken: string;
  /** Today's date in Taipei. */
  today: string;
  now: () => Date;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function latest(rows: ReadonlyArray<{ date: string }>): string {
  return rows.reduce((max, row) => (row.date > max ? row.date : max), '');
}

/** The rows a saved score keeps of each component. */
export function scoreRow(date: string, score: number, mean: number, coverage: number, components: readonly ComponentReading[]): ScoreRow {
  const round = (value: number | null, digits: number) => (value === null ? null : Number(value.toFixed(digits)));
  return {
    date,
    score,
    mean: Number(mean.toFixed(4)),
    coverage: Number(coverage.toFixed(4)),
    components: components.map((row) => ({ id: row.id, value: round(row.value, 6), date: row.date, sub_score: round(row.subScore, 3), weight: row.weight, status: row.status })),
  };
}

export async function runVolatility(deps: VolatilityDeps): Promise<VolatilityRun> {
  const startedAt = deps.now().toISOString();
  const { get, store, today } = deps;
  const detail: VolatilityRunDetail = { series: {}, warnings: [], errors: [] };
  const finish = async (status: VolatilityRun['status']): Promise<VolatilityRun> => {
    const run: VolatilityRun = { job: JOB, startedAt, finishedAt: deps.now().toISOString(), status, detail };
    await store.recordRun(run);
    return run;
  };

  let settings: VolatilitySettings | undefined;
  try {
    settings = await store.settings();
  } catch (err) {
    detail.errors.push(`reading the database: ${message(err)}`);
    return finish('failed');
  }
  if (!settings) {
    detail.errors.push('config volatility is missing or malformed: apply the migration (npx supabase db push)');
    return finish('failed');
  }

  const start = addDays(today, -settings.historyDays);
  const span = { start: addDays(today, -INDEX_DAYS), end: today };
  const finmind = new FinMind(get, deps.finmindToken);
  const plan: Array<[string, IndexAttempt[]]> = [
    ...['VIX', 'VIX3M', 'TWVIX', 'EPU', 'HY_OAS'].map((id): [string, IndexAttempt[]] => [id, volatilityAttempts(id, get, start, today)]),
    ...['SPX', 'TAIEX'].map((id): [string, IndexAttempt[]] => [id, indexAttempts(id, finmind, get, span)]),
  ];
  for (const [id, attempts] of plan) {
    const failures: string[] = [];
    let saved = false;
    for (const attempt of attempts) {
      try {
        const rows = await attempt.load();
        if (rows.length === 0) {
          failures.push(`${id}: ${attempt.source} returned no data`);
          continue;
        }
        await store.saveIndexPrices(rows, { fillOnly: attempt.fillOnly ?? false });
        detail.series[id] = { source: attempt.source, rows: rows.length, latest: latest(rows) };
        detail.warnings.push(...failures);
        saved = true;
        break;
      } catch (err) {
        failures.push(`${id}: ${attempt.source}: ${message(err)}`);
      }
    }
    // TAIEX and the S&P 500 have the nightly job's history to fall back on: a miss here is a warning.
    if (!saved) (id === 'SPX' || id === 'TAIEX' ? detail.warnings : detail.errors).push(...(failures.length > 0 ? failures : [`${id}: no feed covers it`]));
  }

  // The event calendar (step 2): a feed that fails keeps its saved events and is only a warning.
  detail.events = {};
  const loads: Array<{ source: 'fed' | 'fred'; label: string; load: () => Promise<MarketEvent[]> }> = [
    { source: 'fed', label: 'FOMC', load: async () => fomcEvents(await get(FED_CALENDAR)) },
    {
      source: 'fred',
      label: 'CPI and payrolls',
      load: async () => {
        const year = Number(today.slice(0, 4));
        const rows: MarketEvent[] = [];
        for (const [kind, release] of Object.entries(FRED_RELEASES) as Array<['cpi' | 'payrolls', number]>) {
          for (const y of [year, year + 1]) rows.push(...fredCalendarEvents(await get(fredCalendarUrl(release, y)), kind));
        }
        return rows;
      },
    },
  ];
  for (const feed of loads) {
    try {
      const rows = (await feed.load()).filter((event) => event.date >= today);
      if (rows.length === 0) {
        detail.warnings.push(`events: ${feed.label}: no event from today on`);
        continue;
      }
      await store.replaceEvents(feed.source, today, rows);
      for (const event of rows) detail.events[event.kind] = (detail.events[event.kind] ?? 0) + 1;
    } catch (err) {
      detail.warnings.push(`events: ${feed.label}: ${message(err)}`);
    }
  }

  try {
    const series = await store.series(VOLATILITY_SERIES, addDays(today, -(settings.drawdownDays + 30)));
    const result = volatilityScore(series, settings, today);
    detail.score = { date: today, score: result.score, coverage: Number(result.coverage.toFixed(4)) };
    if (result.score === null || result.mean === null) {
      detail.errors.push(`score: the figures cover ${Math.round(result.coverage * 100)}% of the weight, under the ${Math.round(settings.minCoverage * 100)}% needed`);
      return finish('failed');
    }
    await store.saveScore(scoreRow(today, result.score, result.mean, result.coverage, result.components));
  } catch (err) {
    detail.errors.push(`saving: ${message(err)}`);
    return finish('failed');
  }
  // Step 3: the alert and the hedge read the score just saved; the workflow then sends the pushes.
  try {
    detail.rules = await store.evaluateRules(today, deps.now().toISOString());
  } catch (err) {
    detail.errors.push(`rules: ${message(err)}`);
  }
  return finish(detail.errors.length > 0 ? 'partial' : 'ok');
}
