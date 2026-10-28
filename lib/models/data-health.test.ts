import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dataHealth, failureThreshold, parseRunDetail, type JobRun, type RunStatus } from './data-health';

/** A run that finished at 22:24 Taipei time on the given date. */
function run(id: number, date: string, status: RunStatus): JobRun {
  return { id, startedAt: `${date}T14:23:00Z`, finishedAt: `${date}T14:24:10Z`, status, detail: parseRunDetail({}) };
}

describe('failureThreshold', () => {
  it('reads the DATA_FAILURE threshold, and is off when the rule is', () => {
    assert.equal(failureThreshold({ threshold: { failures: 2 }, enabled: true }), 2);
    assert.equal(failureThreshold({ threshold: { failures: 2 }, enabled: false }), null);
    assert.equal(failureThreshold(undefined), null);
    for (const threshold of [{}, { failures: 0 }, { failures: 1.5 }, { failures: '2' }, null]) assert.equal(failureThreshold({ threshold, enabled: true }), null);
  });
});

describe('dataHealth', () => {
  it('has nothing to report before the first run', () => {
    assert.deepEqual(dataHealth([], 2, '2026-10-22'), { latest: undefined, misses: 0, alert: false });
  });

  it("counts no miss while last night's run worked, even before tonight's has started", () => {
    const health = dataHealth([run(3, '2026-10-21', 'ok'), run(2, '2026-10-20', 'failed')], 2, '2026-10-22');
    assert.deepEqual([health.latest?.id, health.misses, health.alert], [3, 0, false]);
  });

  it('alerts after two failed runs in a row (DATA_FAILURE {"failures": 2})', () => {
    const runs = [run(3, '2026-10-21', 'failed'), run(2, '2026-10-20', 'failed'), run(1, '2026-10-19', 'ok')];
    assert.deepEqual([dataHealth(runs, 2, '2026-10-21').misses, dataHealth(runs, 2, '2026-10-21').alert], [2, true]);
    assert.equal(dataHealth(runs.slice(1), 2, '2026-10-20').alert, false);
  });

  it('counts nights with no run at all, such as a schedule GitHub turned off', () => {
    assert.deepEqual([dataHealth([run(1, '2026-10-19', 'ok')], 2, '2026-10-21').misses, dataHealth([run(1, '2026-10-19', 'ok')], 2, '2026-10-22').alert], [1, true]);
    // A failed run, then a night without one.
    assert.equal(dataHealth([run(1, '2026-10-20', 'failed')], 2, '2026-10-22').alert, true);
  });

  it('treats a partial run as a run that worked, and never alerts with the rule off', () => {
    assert.equal(dataHealth([run(2, '2026-10-21', 'partial'), run(1, '2026-10-20', 'failed')], 2, '2026-10-22').misses, 0);
    assert.equal(dataHealth([run(2, '2026-10-21', 'failed'), run(1, '2026-10-20', 'failed')], null, '2026-10-22').alert, false);
  });
});

describe('parseRunDetail', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const detail = parseRunDetail({
      window: { start: '2023-10-07', end: '2026-10-21' },
      prices: { VT: { source: 'finmind', rows: 752, latest: '2026-10-20' }, BAD: { source: 1 } },
      rates: [],
      series: { us_cape: { source: 'shiller', rows: 1869, latest: '2026-10' } },
      warnings: ['VT: finmind: HTTP 503', 7],
      errors: 'none',
      snapshots: { days: 168, from: '2026-05-07', to: '2026-10-21', valueAtRisk: 160 },
      rules: { created: 2, closed: 0 },
      indices: { TAIEX: { source: 'finmind', rows: 1249, latest: '2026-10-27' } },
      betas: { saved: 8, runDate: '2026-11-02' },
      filings: { AAPL: { source: 'sec', rows: 28, latest: '2026-06-27' } },
      valued: ['AAPL', 3],
    });
    assert.deepEqual(detail, {
      window: { start: '2023-10-07', end: '2026-10-21' },
      prices: { VT: { source: 'finmind', rows: 752, latest: '2026-10-20' } },
      rates: {},
      series: { us_cape: { source: 'shiller', rows: 1869, latest: '2026-10' } },
      indices: { TAIEX: { source: 'finmind', rows: 1249, latest: '2026-10-27' } },
      warnings: ['VT: finmind: HTTP 503'],
      errors: [],
      snapshots: { days: 168, from: '2026-05-07', to: '2026-10-21', valueAtRisk: 160 },
      rules: { created: 2, closed: 0 },
      betas: { saved: 8, runDate: '2026-11-02' },
      filings: { AAPL: { source: 'sec', rows: 28, latest: '2026-06-27' } },
      valued: ['AAPL'],
    });
  });

  it('reads a run from before the valuation workbench (Phase 2, step 4) as one with no filings', () => {
    assert.deepEqual(parseRunDetail({}).filings, {});
    assert.equal(parseRunDetail({}).valued, null);
  });

  it('reads a run from before the Regression Lab (Phase 2, step 2) as one with no indices or β', () => {
    const detail = parseRunDetail({});
    assert.deepEqual(detail.indices, {});
    assert.equal(detail.betas, null);
  });

  it('reads a run from before the rules engine (step 9) as one that evaluated none', () => {
    assert.equal(parseRunDetail({}).rules, null);
    assert.equal(parseRunDetail({ rules: { created: '2' } }).rules, null);
  });

  it('reads a run from before the VaR (step 7) as one whose snapshots carry none', () => {
    assert.deepEqual(parseRunDetail({ snapshots: { days: 168, from: '2026-05-07', to: '2026-10-21' } }).snapshots, { days: 168, from: '2026-05-07', to: '2026-10-21', valueAtRisk: null });
  });

  it('reads a run from before the NAV snapshots as having saved none', () => {
    assert.equal(parseRunDetail({ snapshots: { days: '168' } }).snapshots, null);
    assert.equal(parseRunDetail({}).snapshots, null);
  });
});
