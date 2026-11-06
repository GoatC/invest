import type { VolatilityRun } from './job.ts';

/**
 * The run's log lines. Everything in it is public market data (no holdings), so the same lines
 * suit the public GitHub Actions log and a run by hand.
 */
export function volatilitySummary(run: VolatilityRun): string[] {
  const lines = [`Volatility job 波動排程: ${run.status}`];
  for (const [id, loaded] of Object.entries(run.detail.series)) lines.push(`  ${id}: ${loaded.rows} rows from ${loaded.source}, to ${loaded.latest}`);
  const score = run.detail.score;
  if (score) lines.push(`  Score 波動分數 ${score.date}: ${score.score === null ? '—' : score.score.toFixed(1)} / 10 (coverage 涵蓋 ${Math.round(score.coverage * 100)}%)`);
  for (const warning of run.detail.warnings) lines.push(`  warning 警告: ${warning}`);
  for (const error of run.detail.errors) lines.push(`  error 錯誤: ${error}`);
  return lines;
}
