/**
 * The dashboard poster's glow setting and the last milestone it celebrated.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { readGlowSettings, type GlowSettings } from '../models/glow';
import { rows } from './core';

/** config glow, read for the dashboard poster and the tab headline washes; undefined before its migration. */
export async function loadGlowSettings(supabase: SupabaseClient): Promise<GlowSettings | undefined> {
  const found = await rows<{ key: string; value: unknown }>('config', supabase.from('config').select('key, value').eq('key', 'glow'));
  return readGlowSettings(found[0]?.value);
}

/**
 * The last milestone step celebrated on the poster (app_state 'milestone', docs/design-handoff/04-motion.md); null
 * before the first time.
 */
export async function loadMilestoneStep(supabase: SupabaseClient): Promise<number | null> {
  const found = await rows<{ value: unknown }>('app_state', supabase.from('app_state').select('value').eq('key', 'milestone'));
  const step = (found[0]?.value as { step?: unknown } | undefined)?.step;
  return typeof step === 'number' && Number.isFinite(step) ? step : null;
}
