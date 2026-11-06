'use server';

import { redirect } from '@/lib/action-redirect';
import { requireSession } from '@/lib/auth';
import { loadVolatilitySettings } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { volatilitySettingsValue } from '@/lib/models/volatility';
import { parseVolatilityForm, type FieldErrors } from '@/lib/validation';

export interface VolatilityFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The volatility settings are missing: run npx supabase db push, then try again.',
  zh: '找不到波動警報設定：請先執行 npx supabase db push，再試一次。',
};

/** config volatility, logged like every setting. */
export async function saveVolatilitySettings(_previous: VolatilityFormState, formData: FormData): Promise<VolatilityFormState> {
  const { supabase } = await requireSession();
  const current = await loadVolatilitySettings(supabase);
  if (!current) return { errors: {}, message: MISSING };
  const parsed = parseVolatilityForm(formFields(formData), current, taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { error } = await supabase.from('config').update({ value: volatilitySettingsValue(parsed.value) }).eq('key', 'volatility');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect('/volatility?saved=settings#settings');
}
