import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { Http, makeRedactor } from './http.ts';
import { deepRedact, extensionFor, Fetched, type Probe, readEnv, SampleStore, SourceRun } from './probe.ts';
import type { CallRecord } from './types.ts';

const dir = mkdtempSync(join(tmpdir(), 'source-check-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const redact = makeRedactor(['SECRETKEY99']);
const http = new Http({ userAgent: 'test', timeoutMs: 1000, redact, minGapMs: 0 });

function probe(overrides: Partial<Probe> = {}): Probe {
  return {
    id: 'demo',
    name: 'Demo',
    short: 'Demo',
    row: 'Row',
    usedBy: 'F1',
    documentedLimit: 'none',
    auth: () => 'none',
    run: async () => {},
    ...overrides,
  };
}

function call(ok: boolean): CallRecord {
  return { label: 'c', url: 'https://x.test', status: ok ? 200 : 500, ok, ms: 1, bytes: 0, rateLimitHeaders: {} };
}

/** Pushes finished calls into a run without network access. */
function runWith(calls: CallRecord[], overrides: Partial<Probe> = {}): SourceRun {
  const run = new SourceRun(probe(overrides), {}, http, new SampleStore(dir, redact));
  const internal = run as unknown as { result: { calls: CallRecord[] } };
  internal.result.calls.push(...calls);
  return run;
}

describe('SourceRun.finish', () => {
  it('derives the source status from its calls and skips', () => {
    assert.equal(runWith([call(true), call(true)]).finish(redact).status, 'ok');
    assert.equal(runWith([call(true), call(false)]).finish(redact).status, 'partial');
    assert.equal(runWith([call(false)]).finish(redact).status, 'failed');
    const skippedOnly = runWith([]);
    skippedOnly.skip('needs a key');
    assert.equal(skippedOnly.finish(redact).status, 'skipped');
    const okButSkipped = runWith([call(true)]);
    okButSkipped.skip('one sub-check needs a key');
    assert.equal(okButSkipped.finish(redact).status, 'partial');
  });

  it('redacts secrets that reached notes or errors', () => {
    const run = runWith([{ ...call(false), error: 'Invalid key SECRETKEY99' }]);
    run.note('echoed SECRETKEY99');
    const result = run.finish(redact);
    assert.equal(result.calls[0]?.error, 'Invalid key ***');
    assert.deepEqual(result.notes, ['echoed ***']);
  });
});

describe('SourceRun.coverFromListing', () => {
  it('marks in-scope tickers by listing membership', () => {
    const run = runWith([], { coverageMarkets: ['TW'] });
    run.coverFromListing(['TW'], new Map([['00692', 'twse ETF'], ['2330', '']]));
    const { coverage } = run.finish(redact);
    assert.deepEqual(coverage['00692'], { mark: 'yes', detail: 'twse ETF' });
    assert.deepEqual(coverage['2330'], { mark: 'yes' });
    assert.deepEqual(coverage['009816'], { mark: 'no' });
    assert.equal(coverage['VT'], undefined);
  });

  it('leaves tickers outside the source kinds unmarked and flags a failed listing', () => {
    const run = runWith([], { coverageMarkets: ['TW'], coverageKinds: ['stock'] });
    run.coverFromListing(['TW'], undefined);
    const { coverage } = run.finish(redact);
    assert.deepEqual(coverage['2330'], { mark: 'failed' });
    assert.equal(coverage['0050'], undefined);
    assert.equal(coverage['00692'], undefined);
  });
});

describe('Fetched', () => {
  it('marks a non-JSON success as failed when JSON was expected', () => {
    const fetched = new Fetched(call(true), new TextEncoder().encode('<html>blocked</html>'));
    assert.equal(fetched.json(), undefined);
    assert.equal(fetched.ok, false);
    assert.equal(fetched.call.error, 'reply is not valid JSON');
  });

  it('appends refusal reasons to an existing error', () => {
    const fetched = new Fetched({ ...call(false), error: 'HTTP 402' }, new Uint8Array());
    fetched.fail('FinMind: quota used up');
    assert.equal(fetched.call.error, 'HTTP 402; FinMind: quota used up');
  });
});

describe('SampleStore', () => {
  it('redacts text samples and keeps binary samples byte for byte', () => {
    const store = new SampleStore(dir, redact);
    const textPath = store.save('demo', 'Quote VT!', new TextEncoder().encode('{"key":"SECRETKEY99"}'), 'application/json');
    assert.equal(textPath, join('samples', 'demo', '01-quote-vt.json'));
    assert.equal(readFileSync(join(dir, textPath), 'utf8'), '{"key":"***"}');
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0xff]);
    const binPath = store.save('demo', 'factors', zip, undefined);
    assert.ok(binPath.endsWith('02-factors.zip'));
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, binPath))), zip);
  });

  it('picks extensions from content type, then magic bytes', () => {
    assert.equal(extensionFor('text/csv; charset=utf-8', new Uint8Array()), 'csv');
    assert.equal(extensionFor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Uint8Array()), 'xlsx');
    assert.equal(extensionFor('application/octet-stream', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0])), 'xls');
  });
});

describe('readEnv', () => {
  it('trims values, strips one pair of quotes and ignores empty or unknown names', () => {
    const env = readEnv({ SEC_USER_AGENT: ' "LongViewInvest me@example.com" ', FINMIND_TOKEN: "'abc123'", FRED_API_KEY: '  ', OTHER: 'x' });
    assert.deepEqual(env, { FINMIND_TOKEN: 'abc123', SEC_USER_AGENT: 'LongViewInvest me@example.com' });
  });
});

describe('deepRedact', () => {
  it('reaches nested strings', () => {
    assert.deepEqual(deepRedact({ a: ['x SECRETKEY99'], b: { c: 'SECRETKEY99' }, n: 3 }, redact), { a: ['x ***'], b: { c: '***' }, n: 3 });
  });
});
