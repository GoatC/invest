import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { taipeiToday } from '@/lib/dates';
import { supabaseEnv } from '@/lib/env';
import { readBearer, widgetReply } from '@/lib/widget-api';

/**
 * The iPhone widget's figures (ios/Widget, docs/superpowers/specs/2026-11-18-ios-widget-design.md):
 * the portfolio's value at the last close, the 7-day change and the line, for the key in
 * `Authorization: Bearer`. The widget has no session, so this address is left out of the sign-in
 * check (proxy.ts); the key is checked by the database (widget_figures), which hands out these
 * figures and nothing else. Never cached.
 */
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const key = readBearer(request.headers.get('authorization'));
  if (!key) return NextResponse.json({ error: 'key' }, { status: 401, headers: HEADERS });
  const { url, key: publishable } = supabaseEnv();
  const supabase = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc('widget_figures', { key });
  if (error) return NextResponse.json({ error: 'database' }, { status: 502, headers: HEADERS });
  const reply = widgetReply(data, taipeiToday());
  return NextResponse.json(reply.body, { status: reply.status, headers: HEADERS });
}
