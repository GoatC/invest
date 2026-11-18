import { NextResponse } from 'next/server';

import { requireSession } from '@/lib/auth';
import { loadLocalReminders, orDataError, DataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';

/**
 * The reminders the iOS shell schedules on the phone for the next 14 days (lib/models/local-reminders.ts),
 * fetched by the page inside the shell each time the app opens (components/shell-bridge.tsx).
 * Signed in only, like every page; never cached.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const { supabase } = await requireSession();
  const found = await orDataError(loadLocalReminders(supabase, new Date(), taipeiToday()));
  const headers = { 'Cache-Control': 'no-store' };
  if (found instanceof DataError) return NextResponse.json({ v: 1, error: found.table }, { status: 503, headers });
  return NextResponse.json({ v: 1, ...found }, { headers });
}
