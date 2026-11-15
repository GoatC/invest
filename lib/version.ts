/**
 * Which build of the site is serving: the commit Vercel built it from, or "local" off Vercel (the
 * e2e stand-in, a laptop), where nothing ever reloads for it (components/version-watch.tsx).
 */
export function siteVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? 'local';
}
