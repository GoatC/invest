import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { JobRun } from './job.ts';
import { fullSummary, publicSummary } from './summary.ts';

const run = (status: JobRun['status'], errors: string[]): JobRun => ({
  job: 'nightly_prices',
  startedAt: '2026-10-21T14:23:00.000Z',
  finishedAt: '2026-10-21T14:24:10.000Z',
  status,
  detail: {
    window: { start: '2023-10-07', end: '2026-10-21' },
    prices: { '2330': { source: 'finmind', rows: 740, latest: '2026-10-21' }, VT: { source: 'finmind', rows: 752, latest: '2026-10-20' } },
    rates: { 'USD/TWD': { source: 'finmind', rows: 740, latest: '2026-10-21' } },
    warnings: ['2330: finmind: HTTP 503'],
    errors,
    snapshots: { days: 168, from: '2026-05-07', to: '2026-10-21', valueAtRisk: 161 },
  },
});

describe('nightly summaries', () => {
  it('prints every ticker and the snapshot days in a run by hand', () => {
    const text = fullSummary(run('partial', ['NVDA: finmind: HTTP 503'])).join('\n');
    for (const piece of ['2330', 'VT', 'USD/TWD', 'NVDA', '168 days 天, 2026-05-07 → 2026-10-21', 'VaR 含一週風險值: 161 days 天']) assert.ok(text.includes(piece), piece);
  });

  it('keeps tickers out of the public Actions log, flagging the run by its status', () => {
    const partial = publicSummary(run('partial', ['NVDA: finmind: HTTP 503']));
    assert.equal(partial.length, 1);
    assert.match(partial[0] ?? '', /^::warning::Nightly prices: partial\. Loaded 2 securities and 1 rates; 1 fallbacks, 1 errors\. NAV snapshots and VaR updated\./);
    // Nor when the snapshots start, which would tell when the investing began, nor how many have a VaR.
    for (const piece of ['2330', 'VT', 'NVDA', '168', '161', '2026-05-07']) assert.ok(!partial.join('\n').includes(piece), piece);
    assert.match(publicSummary(run('ok', []))[0] ?? '', /^::notice::/);
  });

  it('shows database errors, which name no tickers, so a setup mistake can be fixed from the log', () => {
    const lines = publicSummary(
      run('failed', ['reading the database: Invalid API key', 'saving: prices: permission denied', 'NAV snapshots: nav_snapshots: permission denied', 'VaR: weekly_prices: permission denied']),
    );
    assert.match(lines[0] ?? '', /^::error::Nightly prices: failed/);
    assert.deepEqual(lines.slice(1), [
      '::error::reading the database: Invalid API key',
      '::error::saving: prices: permission denied',
      '::error::NAV snapshots: nav_snapshots: permission denied',
      '::error::VaR: weekly_prices: permission denied',
    ]);
  });
});
