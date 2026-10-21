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
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
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
          <Link href={signedIn ? '/holdings' : '/login'} className="brand">
            <Bi {...LABELS.appName} />
          </Link>
          {signedIn && (
            <nav className="site-nav" aria-label="Main 主選單">
              <Link href="/holdings">
                <Bi {...LABELS.holdings} />
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
