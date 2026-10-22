/**
 * What the nightly job prints. On GitHub Actions the log of a public repository is public, so it
 * shows counts and database errors only; which tickers were loaded stays in job_runs, behind
 * row-level security, and the app shows it. A run by hand prints everything.
 */
import { RISK_ERROR, SNAPSHOT_ERROR } from '../../../lib/models/data-health.ts';
import { DATABASE_ERRORS, type JobRun } from './job.ts';

export function fullSummary(run: JobRun): string[] {
  const { detail } = run;
  const lines = [`Nightly prices: ${run.status} 每夜價格：${run.status}`, `Window 期間: ${detail.window.start} → ${detail.window.end}`];
  for (const [key, loaded] of Object.entries({ ...detail.prices, ...detail.rates })) {
    lines.push(`  ${key.padEnd(8)} ${loaded.source.padEnd(12)} ${String(loaded.rows).padStart(5)} rows, latest ${loaded.latest}`);
  }
  if (detail.snapshots) {
    const risk = detail.snapshots.valueAtRisk;
    const withVar = risk === undefined ? '' : `; with a 1-week VaR 含一週風險值: ${risk} days 天`;
    lines.push(`NAV snapshots 淨值快照: ${detail.snapshots.days} days 天, ${detail.snapshots.from} → ${detail.snapshots.to}${withVar}`);
  }
  for (const warning of detail.warnings) lines.push(`  warning 警告: ${warning}`);
  for (const error of detail.errors) lines.push(`  error 錯誤: ${error}`);
  return lines;
}

/** Errors about the database, the snapshots or their VaR name no tickers or amounts, so the public log can show them. */
const isDatabaseError = (line: string) => [...DATABASE_ERRORS, SNAPSHOT_ERROR, RISK_ERROR].some((label) => line.startsWith(`${label}:`));

/** Lines with GitHub annotations, so a failed or partial run is flagged on the run's page. */
export function publicSummary(run: JobRun): string[] {
  const { detail } = run;
  const securities = Object.keys(detail.prices).length;
  const rates = Object.keys(detail.rates).length;
  const fallbacks = detail.warnings.length;
  const errors = detail.errors.length;
  const level = run.status === 'failed' ? 'error' : errors > 0 ? 'warning' : 'notice';
  // Whether the VaR was saved, never its figure or for how many days.
  const snapshots = !detail.snapshots
    ? { en: '', zh: '' }
    : detail.snapshots.valueAtRisk
      ? { en: ' NAV snapshots and VaR updated.', zh: '淨值快照與風險值已更新。' }
      : { en: ' NAV snapshots updated.', zh: '淨值快照已更新。' };
  return [
    `::${level}::Nightly prices: ${run.status}. Loaded ${securities} securities and ${rates} rates; ${fallbacks} fallbacks, ${errors} errors.${snapshots.en} The app's data status lists them.` +
      ` 每夜價格：${run.status}。載入 ${securities} 檔證券、${rates} 組匯率；使用備援 ${fallbacks} 次，錯誤 ${errors} 項。${snapshots.zh}明細見 App 的資料狀態。`,
    ...detail.errors.filter(isDatabaseError).map((line) => `::error::${line}`),
  ];
}
