/**
 * Is the market data current? The nightly job (scripts/nightly.ts) records each run in job_runs;
 * the DATA_FAILURE rule says how many misses in a row call for an alert (PRD Section 9: "failure
 * push after two misses"). The push itself arrives with Web Push in step 10; until then the app
 * shows the alert on screen.
 */
import { taipeiToday } from '../dates';
import { daysBetween } from './fx';

/** The job name the nightly price job records (JOB in scripts/lib/nightly/job.ts). */
export const NIGHTLY_JOB = 'nightly_prices';
/** How the job labels the error when the NAV snapshots could not be saved. */
export const SNAPSHOT_ERROR = 'NAV snapshots';
/** …and when the snapshots were saved without their N4 VaR. */
export const RISK_ERROR = 'VaR';
/** …and when the rules could not be evaluated after the refresh (step 9). */
export const RULES_ERROR = 'Rules';

export type RunStatus = 'ok' | 'partial' | 'failed';

/** What one run loaded for a ticker or a rate pair. */
export interface Loaded {
  source: string;
  rows: number;
  latest: string;
}

export interface RunDetail {
  window: { start: string; end: string } | null;
  prices: Record<string, Loaded>;
  rates: Record<string, Loaded>;
  /** Primary feeds that failed while a fallback covered for them. */
  warnings: string[];
  /** Data that could not be loaded at all. */
  errors: string[];
  /** The daily NAV snapshots the run saved (F18), and how many carry a VaR (N4; null before step 7); null when it saved none. */
  snapshots: { days: number; from: string; to: string; valueAtRisk: number | null } | null;
  /** The rules evaluated after the refresh: proposals drafted and closed (step 9); null before. */
  rules: { created: number; closed: number } | null;
}

export interface JobRun {
  id: number;
  startedAt: string;
  finishedAt: string;
  status: RunStatus;
  detail: RunDetail;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function loadedMap(value: unknown): Record<string, Loaded> {
  const out: Record<string, Loaded> = {};
  for (const [key, entry] of Object.entries(record(value))) {
    const { source, rows, latest } = record(entry);
    if (typeof source === 'string' && typeof rows === 'number' && typeof latest === 'string') out[key] = { source, rows, latest };
  }
  return out;
}

function lines(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string') : [];
}

/** job_runs.detail as the job writes it, read defensively: it is free-form jsonb. */
export function parseRunDetail(value: unknown): RunDetail {
  const detail = record(value);
  const window = record(detail['window']);
  const { days, from, to, valueAtRisk } = record(detail['snapshots']);
  const { created, closed } = record(detail['rules']);
  return {
    window: typeof window['start'] === 'string' && typeof window['end'] === 'string' ? { start: window['start'], end: window['end'] } : null,
    prices: loadedMap(detail['prices']),
    rates: loadedMap(detail['rates']),
    warnings: lines(detail['warnings']),
    errors: lines(detail['errors']),
    snapshots:
      typeof days === 'number' && typeof from === 'string' && typeof to === 'string'
        ? { days, from, to, valueAtRisk: typeof valueAtRisk === 'number' ? valueAtRisk : null }
        : null,
    rules: typeof created === 'number' && typeof closed === 'number' ? { created, closed } : null,
  };
}

/** The DATA_FAILURE rule's misses-in-a-row threshold; null when the rule is off or malformed. */
export function failureThreshold(rule: { threshold: unknown; enabled: boolean } | undefined): number | null {
  const failures = rule?.enabled ? record(rule.threshold)['failures'] : undefined;
  return typeof failures === 'number' && Number.isInteger(failures) && failures > 0 ? failures : null;
}

export interface DataHealth {
  /** The newest run, if the job has ever run. */
  latest: JobRun | undefined;
  /** Failed runs in a row, newest first, plus the nights since the newest run that had no run at all. */
  misses: number;
  /** misses reached the DATA_FAILURE threshold. */
  alert: boolean;
}

/**
 * runs: newest first. A night counts as missed once its Taipei date is over with no run, so a run
 * GitHub starts a little late is not a miss.
 */
export function dataHealth(runs: readonly JobRun[], threshold: number | null, today: string): DataHealth {
  const latest = runs[0];
  if (!latest) return { latest, misses: 0, alert: false };
  const failed = runs.findIndex((run) => run.status !== 'failed');
  const failedInARow = failed === -1 ? runs.length : failed;
  const nightsWithoutRun = Math.max(0, daysBetween(taipeiToday(new Date(latest.finishedAt)), today) - 1);
  const misses = failedInARow + nightsWithoutRun;
  return { latest, misses, alert: threshold !== null && misses >= threshold };
}
