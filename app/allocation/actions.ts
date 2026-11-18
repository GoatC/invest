'use server';

import { redirect } from '@/lib/action-redirect';
import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClassSettings, loadSecurities, orDataError, refreshCmaEstimates, rescoreQuietly } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { autoCmaValue, readAutoCmaSettings } from '@/lib/models/auto-cma';
import { assumptionsValue } from '@/lib/models/cma';
import { parseAssumptionForm, parseAutoCmaForm, parseTargets, type AutoCmaField, type FieldErrors } from '@/lib/validation';

export interface SettingsFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

const MISSING_SETTING: Bilingual = {
  en: 'The cma setting is missing from the database: run npx supabase db push, then try again.',
  zh: '資料庫中找不到 cma 設定：請先執行 npx supabase db push，再試一次。',
};

/** Saves every class's target and benchmark in one statement, so the targets never stop adding up to 100%. */
export async function saveTargets(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const loaded = await orDataError(Promise.all([loadAssetClassSettings(supabase), loadSecurities(supabase)]));
  if (loaded instanceof DataError) return { errors: {}, message: saveFailed(loaded.detail) };
  const [classes, securities] = loaded;
  const parsed = parseTargets(
    fields,
    classes,
    new Set(securities.map((security) => security.ticker)),
  );
  if (!parsed.ok) return { errors: parsed.errors, message: parsed.errors['total'] ?? ACTION_MESSAGES.checkFields };

  // Every class exists, so the upsert only ever updates; the names ride along because an insert
  // needs them. The audit log keeps each class whose target or benchmark changed.
  const byId = new Map(classes.map((assetClass) => [assetClass.id, assetClass]));
  const { error } = await supabase.from('asset_classes').upsert(
    parsed.value.map((row) => ({
      id: row.id,
      name_en: byId.get(row.id)?.nameEn,
      name_zh: byId.get(row.id)?.nameZh,
      target_weight: row.targetWeight,
      benchmark_ticker: row.benchmarkTicker,
    })),
    { onConflict: 'id' },
  );
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect('/allocation?saved=targets');
}

/** Saves the capital market assumptions as the config row cma, dated today as last reviewed. */
export async function saveAssumptions(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const classes = await orDataError(loadAssetClassSettings(supabase));
  if (classes instanceof DataError) return { errors: {}, message: saveFailed(classes.detail) };
  const parsed = parseAssumptionForm(fields, classes);
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };

  const value = assumptionsValue(Object.fromEntries(parsed.value.map(({ id, ...assumption }) => [id, assumption])));
  const { data, error } = await supabase.from('config').update({ value, last_verified: taipeiToday() }).eq('key', 'cma').select('key');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  if (!data || data.length === 0) return { errors: {}, message: MISSING_SETTING };
  // The satellite estimates read your core assumptions as each market's premium: score them again.
  await rescoreQuietly(supabase, taipeiToday());
  redirect('/allocation?saved=assumptions');
}

export interface AutoCmaFormState {
  errors: FieldErrors<AutoCmaField>;
  message: Bilingual | null;
}

const MISSING_AUTO: Bilingual = {
  en: 'The cma_auto setting is missing from the database: run npx supabase db push, then try again.',
  zh: '資料庫中找不到 cma_auto 設定：請先執行 npx supabase db push，再試一次。',
};

/** config cma_auto (F6 auto-scored assumptions), logged like every setting; the classes are scored again at once. */
export async function saveAutoCma(_previous: AutoCmaFormState, formData: FormData): Promise<AutoCmaFormState> {
  const { supabase } = await requireSession();
  const { data: found, error: readError } = await supabase.from('config').select('value').eq('key', 'cma_auto');
  if (readError) return { errors: {}, message: saveFailed(readError.message) };
  const current = readAutoCmaSettings(found?.[0]?.value);
  if (!current) return { errors: {}, message: MISSING_AUTO };
  const parsed = parseAutoCmaForm(formFields(formData), current);
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { error } = await supabase.from('config').update({ value: autoCmaValue(parsed.value) }).eq('key', 'cma_auto');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  await rescoreQuietly(supabase, taipeiToday());
  redirect('/allocation/assumptions?saved=auto#auto');
}

/** Scores the satellite classes now, as the nightly job does, and says so; a failure is shown. */
export async function rescoreNow(_previous: AutoCmaFormState): Promise<AutoCmaFormState> {
  const { supabase } = await requireSession();
  const done = await orDataError(refreshCmaEstimates(supabase, taipeiToday()));
  if (done instanceof DataError) return { errors: {}, message: saveFailed(done.detail) };
  redirect('/allocation/assumptions?saved=scored#auto');
}
