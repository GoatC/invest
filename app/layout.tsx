import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';

import { Bi } from '@/components/bi';
import { DataHealthBanner, hasNotice } from '@/components/data-status';
import { DataToast } from '@/components/data-toast';
import { Preload } from '@/components/preload';
import { ShellSignedOut } from '@/components/shell-bridge';
import { SiteNav, SubNav } from '@/components/site-nav';
import { Splash } from '@/components/splash';
import { TableCards } from '@/components/table-cards';
import { requireSession, signedInUser } from '@/lib/auth';
import { DataError, loadJobRuns, loadSectorSettings, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { dataHealth } from '@/lib/models/data-health';
import { LAUNCH_IMAGES, SPLASH_GROUND } from '@/lib/splash';

import { signOut } from './actions';
import { Banners } from './banner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Long-View Invest 長期投資',
  description: 'A single-user app that runs a 30-year core–satellite portfolio on written rules. 依書面規則運行的 30 年核心／衛星投資組合。',
  // Added to an iPhone home screen, it opens full screen under this name (PRD Section 9: iPhone push).
  // The page runs up under the status bar, whose text is white: a band of the poster's colour stays
  // behind it on every page (globals.css `body::before`, --safe-top).
  appleWebApp: { capable: true, title: '長期投資', statusBarStyle: 'black-translucent', startupImage: LAUNCH_IMAGES.map(({ url, media }) => ({ url, media })) },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The page reaches every edge of the screen; globals.css keeps what matters clear of the notch
  // and the home indicator with the safe-area insets.
  viewportFit: 'cover',
  colorScheme: 'light dark',
  // The poster's colour (--hero-bg in globals.css), light and dark, for the browser's bars.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: SPLASH_GROUND.light },
    { media: '(prefers-color-scheme: dark)', color: SPLASH_GROUND.dark },
  ],
};

// Every page depends on the signed-in session; nothing may be cached or prerendered.
export const dynamic = 'force-dynamic';

/**
 * What no page need wait for, sent after it: the nightly job's status, shown
 * for a moment when the app loads (components/data-toast.tsx), and the colour convention for price
 * moves when it is not the default (config sectors: Taiwan's red up; globals.css `body`).
 */
async function Late() {
  const { supabase } = await requireSession();
  const [jobs, sectors] = await Promise.all([orDataError(loadJobRuns(supabase)), orDataError(loadSectorSettings(supabase))]);
  const health = jobs instanceof DataError ? undefined : dataHealth(jobs.runs, jobs.threshold, taipeiToday());
  const greenUp = sectors !== undefined && !(sectors instanceof DataError) && sectors.colour === 'green_up';
  return (
    <>
      {/* A mark the style sheet reads (`body:has(#green-up)`): no text for the browser and React to disagree on. */}
      {greenUp && <span id="green-up" hidden />}
      {!(jobs instanceof DataError) && health && hasNotice(health) && (
        <DataToast>
          <DataHealthBanner health={health} threshold={jobs.threshold} quiet />
        </DataToast>
      )}
    </>
  );
}

/**
 * The frame of every page. It reads nothing from the database itself: the status notice and the
 * banner follow the page as each is ready, so neither holds the page, or the opening screen that
 * comes with it, back.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const signedIn = (await signedInUser()) !== undefined;

  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body className={signedIn ? 'signed-in' : undefined}>
        <Splash show={signedIn} />
        <header className="site-header">
          <div className="site-header-inner">
            <Link href={signedIn ? '/' : '/login'} className="brand" aria-label="長期投資 Long-View Invest">
              <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
                <rect width="32" height="32" rx="8" fill="var(--accent)" />
                <polyline points="7,21 13,15 18,18 25,10" fill="none" stroke="var(--accent-text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span lang="zh-Hant">長期投資</span>
            </Link>
            {signedIn && (
              <SiteNav
                signOut={
                  <form action={signOut}>
                    <button type="submit" className="sign-out" lang="zh-Hant" aria-label="登出 Sign out">
                      登出
                    </button>
                  </form>
                }
              />
            )}
          </div>
        </header>
        {signedIn && (
          <Suspense fallback={null}>
            <Late />
          </Suspense>
        )}
        {signedIn && <SubNav />}
        {signedIn && (
          <Suspense fallback={null}>
            <Banners slot="layout" />
          </Suspense>
        )}
        {/* The page is not wrapped in a Suspense of its own: with one, a tap on a page not yet kept
            would blank the screen until its answer came, where now the page on screen stays. */}
        <main className="page">{children}</main>
        {signedIn && <TableCards />}
        {signedIn && <Preload />}
        {!signedIn && <ShellSignedOut />}
        <footer className="site-footer">
          <Bi en="This app supports Hugo's own decisions; it is not financial advice." zh="本 App 用於輔助 Hugo 自己的決策，不構成投資建議。" />
        </footer>
      </body>
    </html>
  );
}
