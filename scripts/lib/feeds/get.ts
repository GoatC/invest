import { describeError, type Redactor } from '../http.ts';
import { FeedError, type Get, type GetBytes } from './types.ts';

export interface GetOptions {
  userAgent: string;
  timeoutMs: number;
  redact: Redactor;
  /** Pause before the one retry. */
  retryAfterMs: number;
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * The real fetch for the nightly job: a timeout, one retry after a network error or a 429 / 5xx
 * reply, and error messages with every key blanked out. `read` turns the reply's body into what
 * the caller wants (text, or bytes for a spreadsheet).
 */
function makeFetch<T>(options: GetOptions, read: (res: Response) => Promise<T>, preview: (body: T) => string) {
  const once = async (url: string, headers: Record<string, string>): Promise<{ status: number; body: T }> => {
    const res = await fetch(url, { headers: { 'User-Agent': options.userAgent, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(options.timeoutMs) });
    return { status: res.status, body: await read(res) };
  };
  return async (url: string, headers: Record<string, string> = {}): Promise<T> => {
    const where = options.redact(url);
    for (let attempt = 1; ; attempt++) {
      try {
        const { status, body } = await once(url, headers);
        if (status >= 200 && status < 300) return body;
        if (attempt === 1 && retryable(status)) {
          await new Promise((resolve) => setTimeout(resolve, options.retryAfterMs));
          continue;
        }
        throw new FeedError(`HTTP ${status} from ${where}: ${options.redact(preview(body).slice(0, 160))}`);
      } catch (err) {
        if (err instanceof FeedError) throw err;
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, options.retryAfterMs));
          continue;
        }
        throw new FeedError(`${options.redact(describeError(err))} (${where})`);
      }
    }
  };
}

export function makeGet(options: GetOptions): Get {
  return makeFetch(options, (res) => res.text(), (text) => text);
}

export function makeGetBytes(options: GetOptions): GetBytes {
  return makeFetch(options, async (res) => new Uint8Array(await res.arrayBuffer()), () => '(binary reply)');
}
