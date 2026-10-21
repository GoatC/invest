// HS256 tokens like those Supabase signs with a project's JWT secret.
import { createHmac } from 'node:crypto';

const encode = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

export function sign(payload, secret) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iat: now, exp: now + 24 * 3600, ...payload })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
