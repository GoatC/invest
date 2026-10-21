import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { supabaseEnv } from '../env';

/**
 * A Supabase client for one server request (page, layout or server action). Create a new one per
 * request and never keep it in a module variable: it carries that request's session cookies.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; proxy.ts has already refreshed the session.
        }
      },
    },
  });
}
