import type { CallRecord } from './types.ts';

/** Headers that describe quotas or throttling, e.g. X-RateLimit-Remaining or Retry-After. */
const RATE_LIMIT_HEADER = /rate-?limit|quota|remaining|retry-after|throttl/i;

export function pickRateLimitHeaders(headers: Headers): Record<string, string> {
  const picked: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (RATE_LIMIT_HEADER.test(name)) picked[name] = value;
  });
  return picked;
}

export type Redactor = (text: string) => string;

const SECRET_QUERY_PARAM = /([?&](?:api_?key|token|access_token)=)[^&#\s"'<>]+/gi;
/** A reply that names the key it was sent, such as FinMind's {"token_tail": "...abcd1234"}. */
const SECRET_FIELD = /("token_(?:tail|head)"\s*:\s*")[^"]*"/gi;

/** The last characters of a long secret, which a service may echo back to say which key it saw. */
function tails(secret: string): string[] {
  if (secret.length < 20) return [];
  return [12, 11, 10, 9, 8, 7, 6].map((length) => secret.slice(-length));
}

/**
 * Blanks out every secret value, its tail, and any api_key / apikey / token query parameter, so
 * a key can never reach the report, the saved samples or the job's run record. For a User-Agent
 * such as "LongViewInvest me@example.com" the email part is treated as a secret on its own too.
 */
export function makeRedactor(secrets: ReadonlyArray<string | undefined>): Redactor {
  const values = secrets
    .flatMap((secret) => (secret ? [secret, ...tails(secret), ...secret.split(/\s+/).filter((part) => part.includes('@'))] : []))
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const value of values) out = out.split(value).join('***');
    return out.replace(SECRET_QUERY_PARAM, '$1***').replace(SECRET_FIELD, '$1***"');
  };
}

export interface HttpOptions {
  userAgent: string;
  timeoutMs: number;
  redact: Redactor;
  /** Default pause between two requests to the same host. */
  minGapMs: number;
}

export interface GetOptions {
  label: string;
  headers?: Record<string, string>;
  /** Overrides the default per-host pause, e.g. a longer one for Alpha Vantage. */
  minGapMs?: number;
}

export interface HttpResponse {
  call: CallRecord;
  /** Empty when the request never got a response. */
  body: Uint8Array;
}

export class Http {
  private readonly lastRequestAt = new Map<string, number>();

  constructor(private readonly options: HttpOptions) {}

  /** One GET, never retried: a source check must not spend a daily quota twice. */
  async get(url: string, init: GetOptions): Promise<HttpResponse> {
    const { redact } = this.options;
    const host = new URL(url).host;
    await this.waitForTurn(host, init.minGapMs ?? this.options.minGapMs);
    const call: CallRecord = { label: init.label, url: redact(url), status: null, ok: false, ms: 0, bytes: 0, rateLimitHeaders: {} };
    const started = performance.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': this.options.userAgent, Accept: '*/*', ...init.headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      const body = new Uint8Array(await res.arrayBuffer());
      call.status = res.status;
      call.ok = res.ok;
      call.bytes = body.byteLength;
      call.contentType = res.headers.get('content-type') ?? undefined;
      call.lastModified = res.headers.get('last-modified') ?? undefined;
      call.rateLimitHeaders = pickRateLimitHeaders(res.headers);
      if (res.redirected) call.finalUrl = redact(res.url);
      if (!res.ok) call.error = `HTTP ${res.status} ${res.statusText}`.trim();
      return { call, body };
    } catch (err) {
      call.error = redact(describeError(err));
      return { call, body: new Uint8Array() };
    } finally {
      call.ms = Math.round(performance.now() - started);
      this.lastRequestAt.set(host, Date.now());
    }
  }

  private async waitForTurn(host: string, gapMs: number): Promise<void> {
    const last = this.lastRequestAt.get(host);
    if (last === undefined) return;
    const wait = last + gapMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** Node's fetch hides the useful part ("getaddrinfo ENOTFOUND", "CONNECT tunnel failed") in `cause`. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  const detail = cause instanceof Error ? `: ${cause.message}` : '';
  return `${err.name}: ${err.message}${detail}`;
}
