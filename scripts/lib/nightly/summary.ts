/**
 * What the nightly job prints. On GitHub Actions the log of a public repository is public, so it
 * shows counts and database errors only; which tickers were loaded stays in job_runs, behind
 * row-level security, and the app shows it. A run by hand prints everything.
 */
import { ATTRIBUTION_ERROR, BETAS_ERROR, MONTE_CARLO_ERROR, RED_FLAGS_ERROR, RISK_ERROR, RULES_ERROR, SNAPSHOT_ERROR, VALUATIONS_ERROR } from '../../../lib/models/data-health.ts';
import { DATABASE_ERRORS, type JobRun } from './job.ts';

export function fullSummary(run: JobRun): string[] {
  const { detail } = run;
  const lines = [`Nightly prices: ${run.status} 每夜價格：${run.status}`, `Window 期間: ${detail.window.start} → ${detail.window.end}`];
  for (const [key, loaded] of Object.entries({ ...detail.prices, ...detail.rates, ...detail.series, ...detail.indices })) {
    lines.push(`  ${key.padEnd(11)} ${loaded.source.padEnd(12)} ${String(loaded.rows).padStart(5)} rows, latest ${loaded.latest}`);
  }
  for (const [key, loaded] of Object.entries(detail.filings ?? {})) {
    lines.push(`  ${`${key} filings`.padEnd(11)} ${loaded.source.padEnd(12)} ${String(loaded.rows).padStart(5)} quarters, latest ${loaded.latest}`);
  }
  if (detail.snapshots) {
    const risk = detail.snapshots.valueAtRisk;
    const withVar = risk === undefined ? '' : `; with a 1-week VaR 含一週風險值: ${risk} days 天`;
    lines.push(`NAV snapshots 淨值快照: ${detail.snapshots.days} days 天, ${detail.snapshots.from} → ${detail.snapshots.to}${withVar}`);
  }
  if (detail.rules) lines.push(`Rules 規則: ${detail.rules.created} proposals drafted 新提案, ${detail.rules.closed} closed 關閉`);
  if (detail.betas) lines.push(`Betas β: ${detail.betas.saved} saved for the month 已存入本月 β`);
  if (detail.monteCarlo) lines.push('Monte Carlo 蒙地卡羅: re-run for the month 本月重新模擬');
  if (detail.attribution) lines.push(`Attribution 績效歸因: ${detail.attribution.months} month(s) saved 已存入 ${detail.attribution.months} 個月`);
  if (detail.valued) lines.push(`Valuations 估值: ${detail.valued.join(', ')} valued after a new filing 依新財報重新估值`);
  if (detail.redFlags) lines.push(`Red flags 紅旗: ${detail.redFlags.scanned.join(', ') || 'none due 無'} scanned 已掃描, ${detail.redFlags.events} events found 找到事件`);
  for (const warning of detail.warnings) lines.push(`  warning 警告: ${warning}`);
  for (const error of detail.errors) lines.push(`  error 錯誤: ${error}`);
  return lines;
}

/** Errors about the database, the snapshots, their VaR, the rules, the β or the red-flag scan name no tickers or amounts, so the public log can show them. */
const isDatabaseError = (line: string) => [...DATABASE_ERRORS, SNAPSHOT_ERROR, RISK_ERROR, RULES_ERROR, BETAS_ERROR, MONTE_CARLO_ERROR, ATTRIBUTION_ERROR, VALUATIONS_ERROR, RED_FLAGS_ERROR].some((label) => line.startsWith(`${label}:`));

/** Lines with GitHub annotations, so a failed or partial run is flagged on the run's page. */
export function publicSummary(run: JobRun): string[] {
  const { detail } = run;
  const securities = Object.keys(detail.prices).length;
  const rates = Object.keys(detail.rates).length;
  const series = Object.keys(detail.series ?? {}).length;
  const indices = Object.keys(detail.indices ?? {}).length;
  const filings = Object.keys(detail.filings ?? {}).length;
  const fallbacks = detail.warnings.length;
  const errors = detail.errors.length;
  const level = run.status === 'failed' ? 'error' : errors > 0 ? 'warning' : 'notice';
  // Whether the VaR was saved, never its figure or for how many days.
  const snapshots = !detail.snapshots
    ? { en: '', zh: '' }
    : detail.snapshots.valueAtRisk
      ? { en: ' NAV snapshots and VaR updated.', zh: '淨值快照與風險值已更新。' }
      : { en: ' NAV snapshots updated.', zh: '淨值快照已更新。' };
  // That the rules ran, never what they proposed.
  const rules = detail.rules ? { en: ' Rules checked.', zh: '規則已檢查。' } : { en: '', zh: '' };
  return [
    `::${level}::Nightly prices: ${run.status}. Loaded ${securities} securities, ${rates} rates, ${series} market series, ${indices} indices and ${filings} companies' filings; ${fallbacks} fallbacks, ${errors} errors.${snapshots.en}${rules.en} The app's data status lists them.` +
      ` 每夜價格：${run.status}。載入 ${securities} 檔證券、${rates} 組匯率、${series} 項市場資料、${indices} 個指數、${filings} 家公司財報；使用備援 ${fallbacks} 次，錯誤 ${errors} 項。${snapshots.zh}${rules.zh}明細見 App 的資料狀態。`,
    ...detail.errors.filter(isDatabaseError).map((line) => `::error::${line}`),
  ];
}
