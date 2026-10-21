import type { NextRequest } from 'next/server';

import { updateSession } from './lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Every page and server action, but not static files, images, the web app manifest and
  // robots.txt: a phone fetches the manifest without the session cookie.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
