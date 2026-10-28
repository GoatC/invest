'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { readCapmSettings } from '@/lib/models/capm';
import { parseCapmForm, type FieldErrors } from '@/lib/validation';

export interface CapmFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The cost of equity settings are missing: run npx supabase db push, then try again.',
  zh: '找不到權益成本的設定：請先執行 npx supabase db push，再試一次。',
};

/** config capm: the β used, the ERP's source and value, each market's fallback yield and country premium; logged like every setting. */
export async function saveCapmSettings(_previous: CapmFormState, formData: FormData): Promise<CapmFormState> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase.from('config').select('value').eq('key', 'capm');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  const current = (data?.[0] as { value?: Record<string, unknown> } | undefined)?.value;
  const settings = readCapmSettings(current);
  if (!current || !settings) return { errors: {}, message: MISSING };
  const parsed = parseCapmForm(formFields(formData), Object.keys(settings.markets), taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { beta, erpSource, erpManual, markets, checked } = parsed.value;
  const currentMarkets = current['markets'] as Record<string, Record<string, unknown>>;
  const value = {
    ...current,
    beta,
    erp: { source: erpSource, manual: erpManual },
    markets: Object.fromEntries(Object.entries(currentMarkets).map(([market, entry]) => [market, { ...entry, risk_free: markets[market]?.riskFree ?? entry['risk_free'], country_premium: markets[market]?.countryPremium ?? entry['country_premium'] }])),
    last_verified: checked,
  };
  const { error: saveError } = await supabase.from('config').update({ value }).eq('key', 'capm');
  if (saveError) return { errors: {}, message: saveFailed(saveError.message) };
  redirect('/capm?saved=settings#settings');
}
