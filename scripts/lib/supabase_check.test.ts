import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifySchemaReply, classifyTableReply, keyProblem } from './supabase_check.ts';

const denied = JSON.stringify({ code: '42501', details: null, hint: null, message: 'permission denied for table transactions' });

describe('classifyTableReply', () => {
  it('counts a permission error as refused', () => {
    assert.equal(classifyTableReply(401, denied).verdict, 'refused');
    assert.equal(classifyTableReply(403, denied).verdict, 'refused');
  });

  it('flags any successful read, even an empty one', () => {
    assert.equal(classifyTableReply(200, '[]').verdict, 'readable');
    assert.equal(classifyTableReply(206, '[{"id":1}]').verdict, 'readable');
  });

  it('says the schema is missing when PostgREST cannot find the table', () => {
    const body = JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.rules' in the schema cache" });
    assert.equal(classifyTableReply(404, body).verdict, 'missing');
  });

  it('points at the key when the gateway rejects it', () => {
    const result = classifyTableReply(401, '{"message":"Invalid API key","hint":"Double check your Supabase `anon` or `service_role` API key."}');
    assert.equal(result.verdict, 'unexpected');
    assert.match(result.detail, /invalid API key/);
  });

  it('reports anything else with its status and code', () => {
    assert.deepEqual(classifyTableReply(500, '{"code":"XX000"}'), { verdict: 'unexpected', detail: 'HTTP 500 XX000' });
    assert.deepEqual(classifyTableReply(502, '<html>'), { verdict: 'unexpected', detail: 'HTTP 502' });
  });
});

describe('classifySchemaReply', () => {
  it('counts PGRST106 as hidden', () => {
    const body = JSON.stringify({ code: 'PGRST106', hint: 'Only the following schemas are exposed: public, graphql_public', message: 'Invalid schema: private' });
    assert.equal(classifySchemaReply(406, body).verdict, 'hidden');
  });

  it('flags a private schema that answers', () => {
    assert.equal(classifySchemaReply(200, '[]').verdict, 'exposed');
  });
});

describe('keyProblem', () => {
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;

  it('accepts the publishable key and the legacy anon key', () => {
    assert.equal(keyProblem('sb_publishable_abc123'), undefined);
    assert.equal(keyProblem(jwt('anon')), undefined);
  });

  it('refuses the secret key and the legacy service_role key', () => {
    assert.match(keyProblem('sb_secret_abc123') ?? '', /secret key/);
    assert.match(keyProblem(jwt('service_role')) ?? '', /secret key/);
  });
});
