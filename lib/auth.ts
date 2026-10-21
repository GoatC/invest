import { redirect } from 'next/navigation';

import { createClient } from './supabase/server';

/**
 * The Supabase client for a signed-in request; anyone else is sent to the login page. Every page
 * and server action calls this first. getClaims() verifies the token instead of trusting the
 * cookie, and row-level security in the database lets only the owner see any row.
 */
export async function requireSession() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/login');
  return { supabase, userId: data.claims.sub };
}

export type Session = Awaited<ReturnType<typeof requireSession>>;
