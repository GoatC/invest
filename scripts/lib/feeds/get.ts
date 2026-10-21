import { describeError, type Redactor } from '../http.ts';
import { FeedError, type Get } from './types.ts';

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
 * reply, and error messages with every key blanked out.
 */
export function makeGet(options: GetOptions): Get {
  const once = async (url: string, headers: Record<string, string>): Promise<{ status: number; text: string }> => {
    const res = await fetch(url, { headers: { 'User-Agent': options.userAgent, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(options.timeoutMs) });
    return { status: res.status, text: await res.text() };
  };
  return async (url, headers = {}) => {
    const where = options.redact(url);
    for (let attempt = 1; ; attempt++) {
      try {
        const { status, text } = await once(url, headers);
        if (status >= 200 && status < 300) return text;
        if (attempt === 1 && retryable(status)) {
          await new Promise((resolve) => setTimeout(resolve, options.retryAfterMs));
          continue;
        }
        throw new FeedError(`HTTP ${status} from ${where}: ${options.redact(text.slice(0, 160))}`);
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
