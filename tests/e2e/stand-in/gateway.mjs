// Plays the Supabase API gateway: /rest/v1 goes to PostgREST and /auth/v1 to Supabase Auth.
// A request carrying the publishable key but no user token runs as the anon role, as on a hosted
// project; any other API key is refused.
import http from 'node:http';

import { sign } from './jwt.mjs';

const { GATEWAY_PORT, REST_PORT, AUTH_PORT, JWT_SECRET, PUBLISHABLE_KEY } = process.env;
const anon = sign({ role: 'anon', iss: 'supabase' }, JWT_SECRET);
const isJwt = (token) => token.split('.').length === 3;

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://gateway');
    const [prefix, port] = url.pathname.startsWith('/rest/v1') ? ['/rest/v1', REST_PORT] : url.pathname.startsWith('/auth/v1') ? ['/auth/v1', AUTH_PORT] : [];
    if (!prefix) return void res.writeHead(404).end('no route');
    const apikey = String(req.headers['apikey'] ?? '');
    if (apikey !== PUBLISHABLE_KEY && !isJwt(apikey)) {
      return void res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'Invalid API key' }));
    }
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    const bearer = String(req.headers['authorization'] ?? '').replace(/^Bearer /i, '');
    if (!isJwt(bearer)) {
      if (prefix === '/rest/v1') headers['authorization'] = `Bearer ${anon}`;
      else delete headers['authorization'];
    }
    const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: url.pathname.slice(prefix.length) + url.search || '/', headers }, (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    });
    upstream.on('error', (err) => res.writeHead(502).end(String(err)));
    req.pipe(upstream);
  })
  .listen(Number(GATEWAY_PORT), '127.0.0.1', () => console.log(`gateway on ${GATEWAY_PORT}`));
