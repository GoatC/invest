import { siteVersion } from '@/lib/version';

/** The build now serving (lib/version.ts), for a page open since an older one (components/version-watch.tsx). */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ v: siteVersion() }, { headers: { 'cache-control': 'no-store' } });
}
