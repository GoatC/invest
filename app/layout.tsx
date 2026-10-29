import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Bi } from '@/components/bi';
import { LABELS } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';

import { signOut } from './actions';
import './globals.css';

export const metadata: Metadata = {
  title: 'Long-View Invest 長期投資',
  description: 'A single-user app that runs a 30-year core–satellite portfolio on written rules. 依書面規則運行的 30 年核心／衛星投資組合。',
  // Added to an iPhone home screen, it opens full screen under this name (PRD Section 9: iPhone push).
  appleWebApp: { capable: true, title: '長期投資', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  // The header colour (--surface in globals.css), light and dark, for the phone's status bar.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1a2029' },
  ],
};

// Every page depends on the signed-in session; nothing may be cached or prerendered.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href={signedIn ? '/' : '/login'} className="brand">
            <Bi {...LABELS.appName} />
          </Link>
          {signedIn && (
            <nav className="site-nav" aria-label="Main 主選單">
              <Link href="/">
                <Bi {...LABELS.dashboard} />
              </Link>
              <Link href="/holdings">
                <Bi {...LABELS.holdings} />
              </Link>
              <Link href="/performance">
                <Bi {...LABELS.performance} />
              </Link>
              <Link href="/allocation">
                <Bi {...LABELS.allocation} />
              </Link>
              <Link href="/risk">
                <Bi {...LABELS.risk} />
              </Link>
              <Link href="/plan">
                <Bi {...LABELS.calculator} />
              </Link>
              <Link href="/timeline">
                <Bi {...LABELS.timeline} />
              </Link>
              <Link href="/monte-carlo">
                <Bi {...LABELS.monteCarlo} />
              </Link>
              <Link href="/stress">
                <Bi {...LABELS.stress} />
              </Link>
              <Link href="/frontier">
                <Bi {...LABELS.frontier} />
              </Link>
              <Link href="/attribution">
                <Bi {...LABELS.attribution} />
              </Link>
              <Link href="/costs">
                <Bi {...LABELS.costs} />
              </Link>
              <Link href="/windfall">
                <Bi {...LABELS.windfall} />
              </Link>
              <Link href="/regression">
                <Bi {...LABELS.regression} />
              </Link>
              <Link href="/sectors">
                <Bi {...LABELS.sectors} />
              </Link>
              <Link href="/capm">
                <Bi {...LABELS.costOfEquity} />
              </Link>
              <Link href="/valuation">
                <Bi {...LABELS.valuation} />
              </Link>
              <Link href="/red-flags">
                <Bi {...LABELS.redFlags} />
              </Link>
              <Link href="/look-through">
                <Bi {...LABELS.lookThrough} />
              </Link>
              <Link href="/proposals">
                <Bi {...LABELS.proposals} />
              </Link>
              <Link href="/holdings/new">
                <Bi {...LABELS.addTrade} />
              </Link>
              <Link href="/import">
                <Bi {...LABELS.importCsv} />
              </Link>
              <Link href="/securities">
                <Bi {...LABELS.securities} />
              </Link>
              <Link href="/data">
                <Bi {...LABELS.dataStatus} />
              </Link>
              <form action={signOut}>
                <button type="submit" className="link-button">
                  <Bi {...LABELS.signOut} />
                </button>
              </form>
            </nav>
          )}
        </header>
        <main className="page">{children}</main>
        <footer className="site-footer">
          <Bi en="This app supports Hugo's own decisions; it is not financial advice." zh="本 App 用於輔助 Hugo 自己的決策，不構成投資建議。" />
        </footer>
      </body>
    </html>
  );
}
