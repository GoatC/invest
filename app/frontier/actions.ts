'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { loadAssetClasses } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { readFrontierSettings } from '@/lib/models/frontier';
import { parseFrontierForm, type FieldErrors, type FrontierField } from '@/lib/validation';

export interface FrontierFormState {
  errors: FieldErrors<FrontierField>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The frontier setting is missing from the database: run npx supabase db push, then try again.',
  zh: '資料庫中找不到效率前緣設定：請先執行 npx supabase db push，再試一次。',
};

/** config frontier: the risk-free rate, the years of history and the weight bounds, logged like every setting. */
export async function saveFrontier(_previous: FrontierFormState, formData: FormData): Promise<FrontierFormState> {
  const { supabase } = await requireSession();
  const { data: found, error: readError } = await supabase.from('config').select('value, last_verified').eq('key', 'frontier');
  if (readError) return { errors: {}, message: saveFailed(readError.message) };
  const current = readFrontierSettings(found?.[0]?.value, found?.[0]?.last_verified ?? null);
  if (!current) return { errors: {}, message: MISSING };
  const classes = await loadAssetClasses(supabase);
  const parsed = parseFrontierForm(formFields(formData), current, classes.map((entry) => entry.id), taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { value } = parsed;
  const { error } = await supabase
    .from('config')
    .update({
      value: { lookback_years: value.lookbackYears, min_months: value.minMonths, points: value.points, risk_free: value.riskFree, bounds: value.bounds },
      last_verified: value.lastVerified,
    })
    .eq('key', 'frontier');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect('/frontier?saved=settings#settings');
}
