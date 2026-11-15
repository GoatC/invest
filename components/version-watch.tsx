'use client';

import { useEffect } from 'react';

/** At most one check a minute. */
const EVERY_MS = 60_000;

/**
 * Loads the page again when a newer build of the site is serving than the one it came from (Hugo,
 * 2026-11-16: a fix of the style sheet did not reach the iOS app, whose page had stayed open since
 * before it). Checked whenever the page comes back on screen: the app opened again, the browser tab
 * shown. `version` is the build that served this page (lib/version.ts); "local" never reloads.
 */
export function VersionWatch({ version }: { version: string }) {
  useEffect(() => {
    if (version === 'local') return undefined;
    let last = Date.now();
    const check = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < EVERY_MS) return;
      last = Date.now();
      try {
        const response = await fetch('/shell/version', { cache: 'no-store' });
        if (!response.ok) return;
        const body = (await response.json()) as { v?: string };
        if (body.v && body.v !== version) window.location.reload();
      } catch {
        // Offline: the page stays as it is; the next return checks again.
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
    };
  }, [version]);
  return null;
}
