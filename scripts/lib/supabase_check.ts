/** What a stranger holding the public publishable key gets back from one Data API request. */
export type TableVerdict = 'refused' | 'readable' | 'missing' | 'unexpected';
export type SchemaVerdict = 'hidden' | 'exposed' | 'unexpected';

export interface Verdict<V> {
  verdict: V;
  detail: string;
}

function errorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

/** The Supabase gateway answers a wrong key with a bare message instead of a Postgres code. */
function badKey(status: number, body: string): boolean {
  return status === 401 && /invalid api key/i.test(body);
}

/** Classifies the reply to an anonymous `GET /rest/v1/<table>`. */
export function classifyTableReply(status: number, body: string): Verdict<TableVerdict> {
  const code = errorCode(body);
  if (status >= 200 && status < 300) return { verdict: 'readable', detail: `HTTP ${status}: anyone with the publishable key can read it 任何人都讀得到` };
  if (code === '42501') return { verdict: 'refused', detail: `HTTP ${status} permission denied 拒絕存取` };
  if (code === 'PGRST205') return { verdict: 'missing', detail: 'table not found: run npx supabase db push first 找不到資料表，請先執行 db push' };
  if (badKey(status, body)) return { verdict: 'unexpected', detail: 'invalid API key: check NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 金鑰錯誤' };
  return { verdict: 'unexpected', detail: `HTTP ${status}${code ? ` ${code}` : ''}` };
}

/** Classifies the reply to a request that asks for the private schema through Accept-Profile. */
export function classifySchemaReply(status: number, body: string): Verdict<SchemaVerdict> {
  const code = errorCode(body);
  if (code === 'PGRST106') return { verdict: 'hidden', detail: 'not exposed through the Data API 未對外開放' };
  if (status >= 200 && status < 300) return { verdict: 'exposed', detail: `HTTP ${status}: the private schema is reachable 私有 schema 被開放了` };
  if (badKey(status, body)) return { verdict: 'unexpected', detail: 'invalid API key: check NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 金鑰錯誤' };
  return { verdict: 'unexpected', detail: `HTTP ${status}${code ? ` ${code}` : ''}` };
}

/**
 * A secret or service-role key bypasses row-level security, so with one the check would see
 * everything instead of what a stranger sees; it also must never sit in a NEXT_PUBLIC_ variable.
 */
export function keyProblem(key: string): string | undefined {
  const secret = 'This is a secret key: use the publishable key (sb_publishable_...) instead, and keep the secret one out of NEXT_PUBLIC_ variables. 這是 secret key，請改用 publishable key。';
  if (key.startsWith('sb_secret_')) return secret;
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString('utf8')) as { role?: unknown };
      if (payload.role === 'service_role') return secret;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
