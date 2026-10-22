'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { planValue } from '@/lib/models/projection';
import { parsePlanForm, type FieldErrors, type PlanField } from '@/lib/validation';

export interface PlanFormState {
  errors: FieldErrors<PlanField>;
  message: Bilingual | null;
}

const MISSING_SETTING: Bilingual = {
  en: 'The projection setting is missing from the database: run npx supabase db push, then try again.',
  zh: '資料庫中找不到 projection 設定：請先執行 npx supabase db push，再試一次。',
};

/** Saves the calculator's inputs as the plan (config projection), which the actual regular pool is compared with. */
export async function savePlan(_previous: PlanFormState, formData: FormData): Promise<PlanFormState> {
  const { supabase } = await requireSession();
  const parsed = parsePlanForm(formFields(formData));
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };

  const { data, error } = await supabase.from('config').update({ value: planValue(parsed.value) }).eq('key', 'projection').select('key');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  if (!data || data.length === 0) return { errors: {}, message: MISSING_SETTING };
  redirect('/plan?saved=plan');
}
