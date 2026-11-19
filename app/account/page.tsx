import Link from 'next/link';

import { ThemeSwitch } from '@/components/theme-switch';
import { requireSession } from '@/lib/auth';

import { signOut } from '../actions';

/**
 * 帳號 (Ink design, Hugo 2026-11-18; docs/design-handoff/02-components.md): what the dashboard's person button opens,
 * in a sheet inside the iOS shell. The signed-in address, where each preference is set, and 家人共用 shown as not yet
 * open: sharing is a later phase, since the app is single-user with row-level security on every table (CLAUDE.md).
 */
export default async function AccountPage() {
  const { supabase } = await requireSession();
  const [{ data: claims }, { data: sectors }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from('config').select('value').eq('key', 'sectors').maybeSingle(),
  ]);
  const email = typeof claims?.claims.email === 'string' ? claims.claims.email : '';
  const initial = (email.trim()[0] ?? '?').toUpperCase();
  const colour = (sectors?.value as { colour?: unknown } | null)?.colour === 'green_up' ? '綠漲紅跌' : '紅漲綠跌';

  return (
    <>
      <section className="card account-head">
        <span className="account-avatar" aria-hidden="true">
          {initial}
        </span>
        <h1 lang="zh-Hant" aria-label="帳號 Account">
          帳號
        </h1>
        {email && <span className="muted">{email}</span>}
        <span className="account-chip">擁有者 · 單人帳號</span>
      </section>

      <section className="card form account-group" aria-labelledby="account-prefs">
        <h2 id="account-prefs">偏好</h2>
        <ul className="link-rows">
          <li>
            <ThemeSwitch />
          </li>
          <li>
            <Link href="/sectors#settings" prefetch>
              <span>漲跌顏色</span>
              <span className="muted">{colour}</span>
            </Link>
          </li>
          <li>
            <Link href="/notifications" prefetch>
              <span>推播設定</span>
            </Link>
          </li>
        </ul>
      </section>

      <section className="card form account-group" aria-labelledby="account-family">
        <h2 id="account-family">家人共用</h2>
        <ul className="link-rows">
          <li>
            <span className="link-row-off">
              <span>邀請家人</span>
              <span className="account-chip">尚未開放</span>
            </span>
          </li>
        </ul>
        <p className="muted small">目前是單人帳號。開放後每位家人有自己的帳號與資料，彼此看不到。</p>
      </section>

      <section className="card form account-group" aria-labelledby="account-data">
        <h2 id="account-data">資料</h2>
        <ul className="link-rows">
          <li>
            <Link href="/data" prefetch>
              <span>資料狀態</span>
            </Link>
          </li>
          <li>
            <Link href="/import" prefetch>
              <span>匯入 CSV</span>
            </Link>
          </li>
        </ul>
      </section>

      <form action={signOut} className="card account-signout">
        <button type="submit" lang="zh-Hant" aria-label="登出 Sign out">
          登出
        </button>
      </form>
    </>
  );
}
