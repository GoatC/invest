'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { readRegressionSettings } from '@/lib/models/regression';
import { parseRegressionForm, type FieldErrors } from '@/lib/validation';

export interface RegressionFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The Regression Lab settings are missing: run npx supabase db push, then try again.',
  zh: '找不到回歸分析的設定：請先執行 npx supabase db push，再試一次。',
};

/** config regression: the defaults the monthly β use, Blume's weight, the risk-free rates; logged like every setting. */
export async function saveRegressionSettings(_previous: RegressionFormState, formData: FormData): Promise<RegressionFormState> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase.from('config').select('value').eq('key', 'regression');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  const current = (data?.[0] as { value?: Record<string, unknown> } | undefined)?.value;
  const settings = readRegressionSettings(current);
  if (!current || !settings) return { errors: {}, message: MISSING };
  const parsed = parseRegressionForm(formFields(formData), settings.windows, taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { freq, windowYears, currency, blumeWeight, riskFree, checked } = parsed.value;
  const riskFreeRow = typeof current['risk_free'] === 'object' && current['risk_free'] !== null ? (current['risk_free'] as Record<string, unknown>) : {};
  const value = {
    ...current,
    defaults: { freq, window_years: windowYears, currency },
    blume: { weight: blumeWeight, prior: settings.blume.prior },
    risk_free: { ...riskFreeRow, TWD: riskFree.TWD, USD: riskFree.USD, last_verified: checked },
  };
  const { error: saveError } = await supabase.from('config').update({ value }).eq('key', 'regression');
  if (saveError) return { errors: {}, message: saveFailed(saveError.message) };
  redirect('/regression?saved=settings#settings');
}
