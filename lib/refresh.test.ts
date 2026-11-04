import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { activeRun, dispatch, githubConfig, listRuns, runState, type WorkflowRun } from './refresh';

const run = (created: string, status: string, conclusion: string | null = null): WorkflowRun => ({ created_at: created, status, conclusion, html_url: `https://github.com/run/${created}`, event: 'workflow_dispatch' });
const SINCE = '2026-11-04T10:00:00Z';

describe('refresh button', () => {
  it('waits as queued until GitHub lists a run started since the tap', () => {
    assert.deepEqual(runState([run('2026-11-03T14:23:00Z', 'completed', 'success')], SINCE), { phase: 'queued', since: SINCE });
  });

  it('follows the newest run since the tap, a minute of clock slack allowed', () => {
    assert.equal(runState([run('2026-11-04T09:59:30Z', 'in_progress')], SINCE).phase, 'running');
    assert.equal(runState([run('2026-11-04T10:00:05Z', 'queued')], SINCE).phase, 'queued');
    assert.equal(runState([run('2026-11-04T10:00:05Z', 'completed', 'success'), run('2026-11-03T14:23:00Z', 'completed', 'failure')], SINCE).phase, 'done');
    const failed = runState([run('2026-11-04T10:00:05Z', 'completed', 'failure')], SINCE);
    assert.equal(failed.phase, 'failed');
    assert.equal(failed.detail, 'failure');
    assert.equal(failed.url, 'https://github.com/run/2026-11-04T10:00:05Z');
  });

  it('finds a run still going', () => {
    assert.equal(activeRun([run('a', 'completed', 'success'), run('b', 'queued')])?.created_at, 'b');
    assert.equal(activeRun([run('a', 'completed', 'success')]), undefined);
  });

  it('needs the token; the repository defaults to this one and must look like owner/name', () => {
    assert.equal(githubConfig({}), undefined);
    assert.deepEqual(githubConfig({ GITHUB_DISPATCH_TOKEN: 't' }), { token: 't', repo: 'GoatC/invest' });
    assert.equal(githubConfig({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPOSITORY: 'bad repo' }), undefined);
  });

  it('asks GitHub for the runs and dispatches on main, with the token in the header only', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return init.method === 'POST' ? new Response(null, { status: 204 }) : Response.json({ workflow_runs: [run('x', 'queued')] });
    };
    const config = { token: 'secret', repo: 'GoatC/invest' };
    assert.equal((await listRuns(config, fetcher)).length, 1);
    await dispatch(config, fetcher);
    assert.equal(calls[0]?.url, 'https://api.github.com/repos/GoatC/invest/actions/workflows/nightly.yml/runs?per_page=5');
    assert.equal(calls[1]?.url, 'https://api.github.com/repos/GoatC/invest/actions/workflows/nightly.yml/dispatches');
    assert.equal(calls[1]?.init.body, JSON.stringify({ ref: 'main' }));
    assert.ok(calls.every((call) => !call.url.includes('secret') && (call.init.headers as Record<string, string>)['Authorization'] === 'Bearer secret'));
    await assert.rejects(dispatch(config, async () => new Response('no', { status: 403 })), /HTTP 403/);
  });
});
