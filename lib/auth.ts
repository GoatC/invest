import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { VERIFIED_USER } from './supabase/proxy';
import { createClient } from './supabase/server';

/**
 * The Supabase client for a signed-in request; anyone else is sent to the login page. Every page
 * and server action calls this first. The proxy (proxy.ts) has verified the token with getClaims()
 * on this same request and passes the user on in a header it sets itself; without that header (a
 * route outside the proxy's matcher) the token is verified here. Row-level security in the database
 * lets only the owner see any row either way. One client per request: the layout, the page and its
 * parts share it, so their reads can be shared too (lib/data.ts).
 */
export const requireSession = cache(async () => {
  const supabase = await createClient();
  const verified = (await headers()).get(VERIFIED_USER);
  if (verified) return { supabase, userId: verified };
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/login');
  return { supabase, userId: data.claims.sub };
});

/** The signed-in user's id, or undefined (the layout, which also renders the login page). */
export const signedInUser = cache(async (): Promise<string | undefined> => {
  const verified = (await headers()).get(VERIFIED_USER);
  if (verified) return verified;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub;
});

export type Session = Awaited<ReturnType<typeof requireSession>>;
