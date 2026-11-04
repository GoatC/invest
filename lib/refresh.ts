/**
 * The refresh button (the More menu): it starts the nightly job on GitHub Actions now
 * (workflow_dispatch on .github/workflows/nightly.yml) and follows that run until it is done. The
 * server action holds GITHUB_DISPATCH_TOKEN, a fine-grained token that may only run this
 * repository's workflows (docs/nightly-job.md); the browser never sees it.
 */

export const WORKFLOW = 'nightly.yml';

export type RefreshPhase = 'unset' | 'queued' | 'running' | 'done' | 'failed';

export interface RefreshState {
  phase: RefreshPhase;
  /** When the run was asked for (ISO), to find it among the workflow's runs. */
  since?: string;
  /** The run's page on GitHub, once found. */
  url?: string;
  /** What went wrong, for phase failed (no token is ever in it). */
  detail?: string;
}

/** One run as GitHub's REST API lists it (GET /repos/{repo}/actions/workflows/{file}/runs). */
export interface WorkflowRun {
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
  event: string;
}

/** Runs asked for this long before `since` still count: GitHub's clock and ours differ a little. */
const SLACK_MS = 60_000;

/**
 * The state of the run asked for at `since`: the newest run created since then; queued until
 * GitHub lists it. A run already going when the button was tapped also counts, as the job's
 * concurrency group would queue a second one behind it anyway.
 */
export function runState(runs: readonly WorkflowRun[], since: string): RefreshState {
  const start = Date.parse(since) - SLACK_MS;
  const mine = runs.filter((run) => Date.parse(run.created_at) >= start).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!mine) return { phase: 'queued', since };
  if (mine.status !== 'completed') return { phase: mine.status === 'in_progress' ? 'running' : 'queued', since, url: mine.html_url };
  return mine.conclusion === 'success' ? { phase: 'done', since, url: mine.html_url } : { phase: 'failed', since, url: mine.html_url, detail: mine.conclusion ?? 'unknown' };
}

/** A run of the workflow that has not finished, if any. */
export function activeRun(runs: readonly WorkflowRun[]): WorkflowRun | undefined {
  return runs.find((run) => run.status !== 'completed');
}

export interface GitHubConfig {
  token: string;
  repo: string;
}

/** The token and repository from the server's environment; undefined when the token is not set. */
export function githubConfig(env: Readonly<Record<string, string | undefined>> = process.env): GitHubConfig | undefined {
  const token = env['GITHUB_DISPATCH_TOKEN'];
  const repo = env['GITHUB_REPOSITORY'] || 'GoatC/invest';
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return undefined;
  return { token, repo };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function api(config: GitHubConfig, path: string): string {
  return `https://api.github.com/repos/${config.repo}/actions/workflows/${WORKFLOW}${path}`;
}

function headers(config: GitHubConfig): Record<string, string> {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'LongViewInvest-Refresh' };
}

/** The workflow's newest runs. */
export async function listRuns(config: GitHubConfig, fetcher: Fetch = fetch): Promise<WorkflowRun[]> {
  const res = await fetcher(api(config, '/runs?per_page=5'), { headers: headers(config), cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const body = (await res.json()) as { workflow_runs?: WorkflowRun[] };
  return body.workflow_runs ?? [];
}

/** Starts the workflow on the default branch (GitHub answers 204 with no body). */
export async function dispatch(config: GitHubConfig, fetcher: Fetch = fetch): Promise<void> {
  const res = await fetcher(api(config, '/dispatches'), { method: 'POST', headers: { ...headers(config), 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }), signal: AbortSignal.timeout(10_000) });
  if (res.status !== 204) throw new Error(`GitHub HTTP ${res.status}`);
}
