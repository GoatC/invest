import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { describeError, Http, makeRedactor, pickRateLimitHeaders } from './http.ts';

describe('makeRedactor', () => {
  it('blanks secret values wherever they appear', () => {
    const redact = makeRedactor(['ABCD1234SECRET', undefined]);
    assert.equal(redact('Invalid key ABCD1234SECRET, try again'), 'Invalid key ***, try again');
  });

  it('blanks api_key, apikey and token query parameters even for unknown values', () => {
    const redact = makeRedactor([]);
    assert.equal(
      redact('https://x.test/q?symbol=VT&apikey=demo&api_key=zzz&token=t0k3n#frag'),
      'https://x.test/q?symbol=VT&apikey=***&api_key=***&token=***#frag',
    );
  });

  it('treats the email inside a User-Agent as a secret on its own', () => {
    const redact = makeRedactor(['LongViewInvest someone@example.com']);
    assert.equal(redact('contact someone@example.com'), 'contact ***');
  });

  it('ignores values too short to be keys', () => {
    assert.equal(makeRedactor(['abc'])('abc abc'), 'abc abc');
  });
});

describe('pickRateLimitHeaders', () => {
  it('keeps quota and throttling headers only', () => {
    const headers = new Headers({
      'X-RateLimit-Remaining': '598',
      'Retry-After': '60',
      'Content-Type': 'application/json',
      'X-Quota-Used': '2',
    });
    assert.deepEqual(pickRateLimitHeaders(headers), { 'retry-after': '60', 'x-quota-used': '2', 'x-ratelimit-remaining': '598' });
  });
});

describe('describeError', () => {
  it('includes the cause that Node fetch hides', () => {
    const err = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND example.invalid') });
    assert.equal(describeError(err), 'TypeError: fetch failed: getaddrinfo ENOTFOUND example.invalid');
  });
});

describe('Http.get', () => {
  let server: Server;
  let base: string;

  before(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith('/limited')) {
        res.writeHead(429, { 'Retry-After': '30', 'X-RateLimit-Limit': '25' });
        res.end('{"Information":"limit reached"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '9' });
      res.end(JSON.stringify({ agent: req.headers['user-agent'], auth: req.headers['authorization'] ?? null }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const http = () => new Http({ userAgent: 'TestAgent/1', timeoutMs: 5000, redact: makeRedactor(['SECRETKEY99']), minGapMs: 0 });

  it('records status, size, rate-limit headers and a redacted URL', async () => {
    const { call, body } = await http().get(`${base}/ok?apikey=SECRETKEY99`, { label: 'ok', headers: { Authorization: 'Bearer SECRETKEY99' } });
    assert.equal(call.status, 200);
    assert.equal(call.ok, true);
    assert.equal(call.bytes, body.byteLength);
    assert.deepEqual(call.rateLimitHeaders, { 'x-ratelimit-remaining': '9' });
    assert.equal(call.url, `${base}/ok?apikey=***`);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(body)), { agent: 'TestAgent/1', auth: 'Bearer SECRETKEY99' });
  });

  it('keeps the body of a refused call and marks it failed', async () => {
    const { call, body } = await http().get(`${base}/limited`, { label: 'limited' });
    assert.equal(call.status, 429);
    assert.equal(call.ok, false);
    assert.match(call.error ?? '', /HTTP 429/);
    assert.deepEqual(call.rateLimitHeaders, { 'retry-after': '30', 'x-ratelimit-limit': '25' });
    assert.match(new TextDecoder().decode(body), /limit reached/);
  });

  it('turns a network failure into a call record instead of throwing', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const { call, body } = await http().get(`http://127.0.0.1:${port}/`, { label: 'down' });
    assert.equal(call.status, null);
    assert.equal(call.ok, false);
    assert.match(call.error ?? '', /fetch failed/);
    assert.equal(body.byteLength, 0);
  });
});
