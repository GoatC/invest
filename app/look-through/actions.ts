'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { loadLookThroughSettings } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { SECTOR } from '@/lib/look-through-text';
import { GICS_SECTORS, lookThroughSettingsValue } from '@/lib/models/look-through';
import { parseLookThroughForm, type FieldErrors } from '@/lib/validation';

export interface LookThroughFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The look-through settings are missing: run npx supabase db push, then try again.',
  zh: '找不到合併透視設定：請先執行 npx supabase db push，再試一次。',
};

/** Each GICS sector by its English and Chinese name, lower case. */
const SECTOR_NAMES = new Map(GICS_SECTORS.flatMap((sector) => [[sector.toLowerCase(), sector] as [string, string], [(SECTOR[sector]?.zh ?? sector).toLowerCase(), sector] as [string, string]]));

/** config look_through, logged like every setting. */
export async function saveLookThroughSettings(_previous: LookThroughFormState, formData: FormData): Promise<LookThroughFormState> {
  const { supabase } = await requireSession();
  const current = await loadLookThroughSettings(supabase);
  if (!current) return { errors: {}, message: MISSING };
  const parsed = parseLookThroughForm(formFields(formData), current, SECTOR_NAMES, taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { error } = await supabase.from('config').update({ value: lookThroughSettingsValue(parsed.value) }).eq('key', 'look_through');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect('/look-through?saved=settings#settings');
}
