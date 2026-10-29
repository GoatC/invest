'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { mcSettingsValue, readMcSettings } from '@/lib/models/monte-carlo';
import { parseMonteCarloForm, type FieldErrors, type McField } from '@/lib/validation';

export interface McFormState {
  errors: FieldErrors<McField>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The Monte Carlo setting is missing from the database: run npx supabase db push, then try again.',
  zh: '資料庫中找不到蒙地卡羅設定：請先執行 npx supabase db push，再試一次。',
};

/** The goal and the expected windfall (config monte_carlo), logged like every setting. */
export async function saveMonteCarlo(_previous: McFormState, formData: FormData): Promise<McFormState> {
  const { supabase } = await requireSession();
  const { data: found, error: readError } = await supabase.from('config').select('value').eq('key', 'monte_carlo');
  if (readError) return { errors: {}, message: saveFailed(readError.message) };
  const current = readMcSettings(found?.[0]?.value);
  if (!current) return { errors: {}, message: MISSING };
  const parsed = parseMonteCarloForm(formFields(formData), current);
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { error } = await supabase.from('config').update({ value: mcSettingsValue(parsed.value) }).eq('key', 'monte_carlo');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect('/monte-carlo?saved=settings#settings');
}
