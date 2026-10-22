import type { NextRequest } from 'next/server';

import { updateSession } from './lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Every page and server action, but not static files, images, the web app manifest, robots.txt
  // and the service worker: a phone fetches the manifest and the worker without the session cookie.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
