/**
 * The volatility alert's score (N8, added 2026-11-06): how stressed the markets are today, on a
 * scale of 1 (calm) to 10 (panic), from free daily series only.
 *
 * - Each component reads one figure from its series as of a day: the VIX, the VIX over the VIX3M
 *   (above 1 the curve is inverted: short-term fear above long-term), Taiwan's VIX, the S&P 500's
 *   and TAIEX's fall from their 52-week high, TAIEX's fall over the last 5 sessions, the US
 *   high-yield spread, and the US daily policy-uncertainty index (a news count) over 7 days.
 * - Its sub-score is linear between two settings: 0 at or below `calm`, 10 at or above `panic`.
 * - The score is 1 + 0.9 × the weighted mean of the sub-scores, so all calm reads 1 and all at
 *   panic reads 10, rounded to 0.1. A component with no figure, or one older than
 *   `max_age_days`, is left out and the others re-weighted; below `min_coverage` of the weight
 *   there is no score.
 * Thresholds live in config volatility. Pure functions; lib/data and the volatility job load the
 * series from index_prices.
 */
import { addDays } from '../dates';
import { eventSettingsValue, readEventSettings, type EventSettings } from './events';

export const COMPONENTS = ['vix', 'vix_term', 'tw_vix', 'spx_drawdown', 'taiex_drawdown', 'taiex_fall', 'hy_spread', 'epu'] as const;
export type ComponentId = (typeof COMPONENTS)[number];

/** The index_prices ids the score reads; the volatility job loads every one but SPX and TAIEX's history (the nightly job's). */
export const VOLATILITY_SERIES = ['VIX', 'VIX3M', 'TWVIX', 'SPX', 'TAIEX', 'HY_OAS', 'EPU'] as const;
export type SeriesId = (typeof VOLATILITY_SERIES)[number];

/** The series each component reads. */
export const COMPONENT_SERIES: Record<ComponentId, readonly SeriesId[]> = {
  vix: ['VIX'],
  vix_term: ['VIX', 'VIX3M'],
  tw_vix: ['TWVIX'],
  spx_drawdown: ['SPX'],
  taiex_drawdown: ['TAIEX'],
  taiex_fall: ['TAIEX'],
  hy_spread: ['HY_OAS'],
  epu: ['EPU'],
};

/** How a component's figure is shown: an index level, a ratio, a share (a fall), or percent a year (a spread). */
export type ComponentUnit = 'level' | 'ratio' | 'share' | 'percent';
export const COMPONENT_UNIT: Record<ComponentId, ComponentUnit> = {
  vix: 'level',
  vix_term: 'ratio',
  tw_vix: 'level',
  spx_drawdown: 'share',
  taiex_drawdown: 'share',
  taiex_fall: 'share',
  hy_spread: 'percent',
  epu: 'level',
};

export interface ComponentSetting {
  id: ComponentId;
  /** The figure at or below which the sub-score is 0. */
  calm: number;
  /** The figure at or above which the sub-score is 10; above calm. */
  panic: number;
  /** Its weight in the mean; 0 leaves it out. */
  weight: number;
}

export interface VolatilitySettings {
  components: ComponentSetting[];
  /** A figure older than this many days on the day scored is left out. */
  maxAgeDays: number;
  /** The share of the total weight the figures must cover for a score. */
  minCoverage: number;
  /** The window of the 52-week high, in days. */
  drawdownDays: number;
  /** The sessions TAIEX's short fall is measured over. */
  fallSessions: number;
  /** The days the policy-uncertainty index is averaged over (it is noisy day to day). */
  epuDays: number;
  /** Days of each series the job keeps loading and the page reads. */
  historyDays: number;
  /** The event calendar's reminders (step 2); the defaults before its migration. */
  events: EventSettings;
  lastVerified: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function wholeIn(value: unknown, min: number, max: number): number | undefined {
  const number = finite(value);
  return number !== undefined && Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

/** config volatility read defensively; undefined when missing or malformed. */
export function readVolatilitySettings(value: unknown): VolatilitySettings | undefined {
  const row = record(value);
  const raw = record(row['components']);
  const components: ComponentSetting[] = [];
  for (const id of COMPONENTS) {
    const entry = record(raw[id]);
    const [calm, panic, weight] = [finite(entry['calm']), finite(entry['panic']), finite(entry['weight'])];
    if (calm === undefined || panic === undefined || weight === undefined || panic <= calm || weight < 0) return undefined;
    components.push({ id, calm, panic, weight });
  }
  if (!components.some((component) => component.weight > 0)) return undefined;
  const maxAgeDays = wholeIn(row['max_age_days'], 1, 30);
  const minCoverage = finite(row['min_coverage']);
  const drawdownDays = wholeIn(row['drawdown_days'], 30, 1000);
  const fallSessions = wholeIn(row['fall_sessions'], 1, 60);
  const epuDays = wholeIn(row['epu_days'], 1, 60);
  const historyDays = wholeIn(row['history_days'], 30, 4000);
  if (maxAgeDays === undefined || minCoverage === undefined || minCoverage <= 0 || minCoverage > 1) return undefined;
  if (drawdownDays === undefined || fallSessions === undefined || epuDays === undefined || historyDays === undefined) return undefined;
  const events = readEventSettings(row['events']);
  if (!events) return undefined;
  const verified = row['last_verified'];
  return { components, maxAgeDays, minCoverage, drawdownDays, fallSessions, epuDays, historyDays, events, lastVerified: typeof verified === 'string' ? verified : null };
}

export function volatilitySettingsValue(settings: VolatilitySettings): Record<string, unknown> {
  return {
    components: Object.fromEntries(settings.components.map((component) => [component.id, { calm: component.calm, panic: component.panic, weight: component.weight }])),
    max_age_days: settings.maxAgeDays,
    min_coverage: settings.minCoverage,
    drawdown_days: settings.drawdownDays,
    fall_sessions: settings.fallSessions,
    epu_days: settings.epuDays,
    history_days: settings.historyDays,
    events: eventSettingsValue(settings.events),
    last_verified: settings.lastVerified,
  };
}

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

export interface Close {
  date: string;
  close: number;
}

/** 0 at or below calm, 10 at or above panic, linear between. */
export function subScore(value: number, calm: number, panic: number): number {
  return Math.min(10, Math.max(0, (10 * (value - calm)) / (panic - calm)));
}

/** The 1-to-10 score of a weighted mean of sub-scores (each 0 to 10), rounded to 0.1. */
export function scoreOf(mean: number): number {
  return Math.round((1 + 0.9 * Math.min(10, Math.max(0, mean))) * 10) / 10;
}

/** The index of the newest close on or before `date` in closes sorted oldest first; −1 when none. */
export function indexAt(closes: readonly Close[], date: string): number {
  let low = 0;
  let high = closes.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((closes[mid] as Close).date <= date) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** The fall of the close at `index` from the highest close in the `days` up to it, as a share (0 at a new high). */
export function drawdownAt(closes: readonly Close[], index: number, days: number): number {
  const latest = closes[index] as Close;
  const from = addDays(latest.date, -days);
  let high = latest.close;
  for (let i = index; i >= 0 && (closes[i] as Close).date > from; i--) high = Math.max(high, (closes[i] as Close).close);
  return 1 - latest.close / high;
}

/** The fall over the last `sessions` closes up to `index`, as a share; 0 after a rise; undefined without enough closes. */
export function fallAt(closes: readonly Close[], index: number, sessions: number): number | undefined {
  const base = closes[index - sessions];
  if (!base) return undefined;
  return Math.max(0, 1 - (closes[index] as Close).close / base.close);
}

/** The mean of the closes in the `days` up to the one at `index`. */
export function meanAt(closes: readonly Close[], index: number, days: number): number {
  const from = addDays((closes[index] as Close).date, -days);
  let sum = 0;
  let count = 0;
  for (let i = index; i >= 0 && (closes[i] as Close).date > from; i--) {
    sum += (closes[i] as Close).close;
    count++;
  }
  return sum / count;
}

/** A component's figure on a day, and the date of the newest close it read. */
export function figureAt(id: ComponentId, series: ReadonlyMap<string, readonly Close[]>, settings: VolatilitySettings, asOf: string): { value: number; date: string } | undefined {
  const closes = (key: SeriesId) => series.get(key) ?? [];
  const latest = (key: SeriesId) => {
    const list = closes(key);
    const at = indexAt(list, asOf);
    return at < 0 ? undefined : { list, at, close: list[at] as Close };
  };
  switch (id) {
    case 'vix':
    case 'tw_vix':
    case 'hy_spread': {
      const found = latest(id === 'vix' ? 'VIX' : id === 'tw_vix' ? 'TWVIX' : 'HY_OAS');
      return found && { value: found.close.close, date: found.close.date };
    }
    case 'vix_term': {
      // The newest day both have a close.
      const vix = closes('VIX');
      const longer = latest('VIX3M');
      if (!longer) return undefined;
      for (let i = longer.at; i >= 0 && i > longer.at - 10; i--) {
        const day = longer.list[i] as Close;
        const short = vix[indexAt(vix, day.date)];
        if (short && short.date === day.date) return { value: short.close / day.close, date: day.date };
      }
      return undefined;
    }
    case 'spx_drawdown':
    case 'taiex_drawdown': {
      const found = latest(id === 'spx_drawdown' ? 'SPX' : 'TAIEX');
      return found && { value: drawdownAt(found.list, found.at, settings.drawdownDays), date: found.close.date };
    }
    case 'taiex_fall': {
      const found = latest('TAIEX');
      const value = found && fallAt(found.list, found.at, settings.fallSessions);
      return found && value !== undefined ? { value, date: found.close.date } : undefined;
    }
    case 'epu': {
      const found = latest('EPU');
      return found && { value: meanAt(found.list, found.at, settings.epuDays), date: found.close.date };
    }
  }
}

export type ReadingStatus = 'ok' | 'stale' | 'missing';

export interface ComponentReading extends ComponentSetting {
  /** The figure, in its unit (COMPONENT_UNIT); null when missing. */
  value: number | null;
  /** The newest close it read. */
  date: string | null;
  /** 0 to 10; null when missing. */
  subScore: number | null;
  /** ok counts; stale is older than max_age_days; missing has no figure. A weight of 0 is never counted. */
  status: ReadingStatus;
}

export interface VolatilityScore {
  asOf: string;
  /** 1 to 10, to 0.1; null below the coverage needed. */
  score: number | null;
  /** The weighted mean of the counted sub-scores, 0 to 10. */
  mean: number | null;
  /** The share of the total weight counted. */
  coverage: number;
  components: ComponentReading[];
}

/** The score on a day from the series sorted oldest first (index_prices ids). */
export function volatilityScore(series: ReadonlyMap<string, readonly Close[]>, settings: VolatilitySettings, asOf: string): VolatilityScore {
  const oldest = addDays(asOf, -settings.maxAgeDays);
  const components = settings.components.map((component): ComponentReading => {
    const figure = figureAt(component.id, series, settings, asOf);
    if (!figure) return { ...component, value: null, date: null, subScore: null, status: 'missing' };
    return { ...component, value: figure.value, date: figure.date, subScore: subScore(figure.value, component.calm, component.panic), status: figure.date < oldest ? 'stale' : 'ok' };
  });
  const total = components.reduce((sum, row) => sum + row.weight, 0);
  const counted = components.filter((row) => row.status === 'ok' && row.weight > 0);
  const weight = counted.reduce((sum, row) => sum + row.weight, 0);
  const coverage = total > 0 ? weight / total : 0;
  if (weight === 0 || coverage + 1e-9 < settings.minCoverage) return { asOf, score: null, mean: null, coverage, components };
  const mean = counted.reduce((sum, row) => sum + row.weight * (row.subScore as number), 0) / weight;
  return { asOf, score: scoreOf(mean), mean, coverage, components };
}

/** The score on each day from `from` to `to` on which any series has a close, for the page's chart. */
export function scoreHistory(series: ReadonlyMap<string, readonly Close[]>, settings: VolatilitySettings, from: string, to: string): Array<{ date: string; score: number | null; coverage: number }> {
  const days = new Set<string>();
  for (const closes of series.values()) for (const close of closes) if (close.date >= from && close.date <= to) days.add(close.date);
  return [...days].sort().map((date) => {
    const result = volatilityScore(series, settings, date);
    return { date, score: result.score, coverage: result.coverage };
  });
}

// ---------------------------------------------------------------------------
// Runs of the saved score (step 3: the alert and the hedge)
// ---------------------------------------------------------------------------

export interface SavedScore {
  date: string;
  score: number;
}

/**
 * The current run of a condition on the saved daily scores (oldest first): when the newest score,
 * on or before `today` and no older than `maxAgeDays`, meets `inside`, walk back while each score
 * meets `holds` (a looser test, so a score wobbling around the line does not start a new run) and
 * return the first day of that stretch on which `inside` held. Undefined when the newest score
 * does not meet `inside`; null when there is no fresh score.
 */
export function runStart(
  scores: readonly SavedScore[],
  today: string,
  maxAgeDays: number,
  inside: (score: number) => boolean,
  holds: (score: number) => boolean,
): { since: string; latest: SavedScore } | undefined | null {
  const upTo = scores.filter((row) => row.date <= today);
  const latest = upTo[upTo.length - 1];
  if (!latest || latest.date < addDays(today, -maxAgeDays)) return null;
  if (!inside(latest.score)) return undefined;
  let since = latest.date;
  for (let i = upTo.length - 1; i >= 0; i--) {
    const row = upTo[i] as SavedScore;
    if (!holds(row.score)) break;
    if (inside(row.score)) since = row.date;
  }
  return { since, latest };
}
