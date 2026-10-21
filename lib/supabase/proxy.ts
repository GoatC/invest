import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { supabaseEnv } from '../env';

/** The only page a visitor without a session may open. */
const LOGIN_PATH = '/login';

/** A redirect must carry the refreshed session cookies and cache headers, or the session is lost. */
function carrySession(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  for (const header of ['cache-control', 'expires', 'pragma']) {
    const value = source.headers.get(header);
    if (value) target.headers.set(header, value);
  }
  return target;
}

/**
 * Refreshes the Supabase session before a page renders and sends visitors without one to the login
 * page. Pages and server actions still verify the session themselves, as Next.js and Supabase both
 * advise, so the app stays safe if a route ever falls outside the proxy matcher.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [header, value] of Object.entries(headers)) response.headers.set(header, value);
      },
    },
  });

  // Verifies the token signature and refreshes it when due. Nothing may run between creating the
  // client and this call, or a refreshed token can be lost.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const onLoginPage = request.nextUrl.pathname === LOGIN_PATH;

  if (!signedIn && !onLoginPage) {
    const target = request.nextUrl.clone();
    target.pathname = LOGIN_PATH;
    target.search = '';
    return carrySession(NextResponse.redirect(target), response);
  }
  if (signedIn && onLoginPage) {
    const target = request.nextUrl.clone();
    target.pathname = '/holdings';
    target.search = '';
    return carrySession(NextResponse.redirect(target), response);
  }
  return response;
}
