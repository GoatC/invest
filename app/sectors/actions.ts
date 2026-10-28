'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { loadSectorSettings } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { SECTOR } from '@/lib/look-through-text';
import { GICS_SECTORS } from '@/lib/models/look-through';
import { sectorSettingsValue } from '@/lib/models/sectors';
import { parseSectorForm, type FieldErrors } from '@/lib/validation';

export interface SectorFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The sector settings are missing: run npx supabase db push, then try again.',
  zh: '找不到產業熱圖設定：請先執行 npx supabase db push，再試一次。',
};

const SECTOR_NAMES = new Map(GICS_SECTORS.flatMap((sector) => [[sector.toLowerCase(), sector] as [string, string], [(SECTOR[sector]?.zh ?? sector).toLowerCase(), sector] as [string, string]]));

/** config sectors, logged like every setting. */
export async function saveSectorSettings(_previous: SectorFormState, formData: FormData): Promise<SectorFormState> {
  const { supabase } = await requireSession();
  const current = await loadSectorSettings(supabase);
  if (!current) return { errors: {}, message: MISSING };
  const parsed = parseSectorForm(formFields(formData), current, SECTOR_NAMES, taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { error } = await supabase.from('config').update({ value: sectorSettingsValue(parsed.value) }).eq('key', 'sectors');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect('/sectors?saved=settings#settings');
}
