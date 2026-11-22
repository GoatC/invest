/**
 * N7 sector tab: sector closes and the settings, on F14's exposure.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { addDays } from '../dates';
import type { Exposure } from '../models/look-through';
import { readSectorSettings, SECTOR_DAYS, sectorView, type Close as SectorClose, type SectorSettings, type SectorView } from '../models/sectors';
import type { Pool } from '../models/types';
import { allRows, rows } from './core';
import { loadLookThroughData } from './look-through';

async function loadSectorSettingsUncached(supabase: SupabaseClient): Promise<SectorSettings | undefined> {
  const found = await rows<{ value: unknown }>('config', supabase.from('config').select('value').eq('key', 'sectors'));
  return readSectorSettings(found[0]?.value);
}

export interface SectorData {
  settings: SectorSettings | undefined;
  view?: SectorView;
  /** The look-through's exposures, for the companies behind a sector. */
  exposures?: Exposure[];
}

/** Each sector's returns and volatility from its proxies' closes, and the portfolio's exposure from the look-through. */
export async function loadSectorData(supabase: SupabaseClient, today: string, pool?: Pool): Promise<SectorData> {
  const [settings, look] = await Promise.all([loadSectorSettings(supabase), loadLookThroughData(supabase, undefined, pool)]);
  if (!settings || !look.result) return { settings };
  const ids = settings.proxies.map((proxy) => proxy.id);
  const found = await allRows<{ index_id: string; price_date: string; close: number }>('index_prices', (from, to) =>
    supabase.from('index_prices').select('index_id, price_date, close').in('index_id', ids).gte('price_date', addDays(today, -SECTOR_DAYS)).order('index_id').order('price_date').range(from, to),
  );
  const closes = new Map<string, SectorClose[]>();
  for (const row of found) closes.set(row.index_id, [...(closes.get(row.index_id) ?? []), { date: row.price_date, close: Number(row.close) }]);
  return { settings, view: sectorView(settings.proxies, closes, look.result.exposures, today), exposures: look.result.exposures };
}

// One read per request (core.ts).
export const loadSectorSettings = cache(loadSectorSettingsUncached);
