/** The two public Supabase values from .env.local; both are safe to ship to the browser. */
export function supabaseEnv(): { url: string; key: string } {
  // Written out in full so Next.js can inline them into the browser bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local (docs/supabase-setup.md). ' +
        '請在 .env.local 設定 Supabase 專案網址與 publishable key。',
    );
  }
  return { url, key };
}
