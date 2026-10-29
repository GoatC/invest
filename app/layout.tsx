import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Bi } from '@/components/bi';
import { SiteNav } from '@/components/site-nav';
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
    { media: '(prefers-color-scheme: light)', color: '#fbfcfe' },
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
      <body className={signedIn ? 'signed-in' : undefined}>
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
        <main className="page">{children}</main>
        <footer className="site-footer">
          <Bi en="This app supports Hugo's own decisions; it is not financial advice." zh="本 App 用於輔助 Hugo 自己的決策，不構成投資建議。" />
        </footer>
      </body>
    </html>
  );
}
