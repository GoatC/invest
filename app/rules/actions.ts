'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { DataError, loadRules, orDataError } from '@/lib/data';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { parseEngineSettings, parseRuleForm, type EngineSettingsField, type FieldErrors } from '@/lib/validation';

export interface RuleFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Saves a rule's on/off, cooldown and threshold numbers; rule_changes logs the old and new values. */
export async function saveRule(_previous: RuleFormState, formData: FormData): Promise<RuleFormState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const rules = await orDataError(loadRules(supabase));
  if (rules instanceof DataError) return { errors: {}, message: saveFailed(rules.detail) };
  const rule = rules.find((candidate) => candidate.id === fields['id']);
  if (!rule) return { errors: {}, message: ACTION_MESSAGES.notFound };
  const parsed = parseRuleForm(fields, record(rule.threshold));
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { error } = await supabase
    .from('rules')
    .update({ enabled: parsed.value.enabled, cooldown_days: parsed.value.cooldownDays, threshold: parsed.value.threshold })
    .eq('id', rule.id);
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect(`/rules?saved=${encodeURIComponent(rule.id)}#rule-${rule.id}`);
}

export interface SettingsFormState {
  errors: FieldErrors<EngineSettingsField>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The dca or proposal_expiry_days setting is missing from the database: run npx supabase db push, then try again.',
  zh: '資料庫中找不到 dca 或 proposal_expiry_days 設定：請先執行 npx supabase db push，再試一次。',
};

/** Saves the monthly DCA's amount and debit day (config dca) and how long proposals stay open. */
export async function saveEngineSettings(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const { supabase } = await requireSession();
  const parsed = parseEngineSettings(formFields(formData));
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { data: current, error: readError } = await supabase.from('config').select('value').eq('key', 'dca');
  if (readError) return { errors: {}, message: saveFailed(readError.message) };
  if (!current || current.length === 0) return { errors: {}, message: MISSING };
  // Keep any other entry the dca setting holds.
  const dca = { ...record((current[0] as { value: unknown }).value), amount_twd: parsed.value.dcaAmountTwd, day_of_month: parsed.value.dcaDay };
  const [first, second] = await Promise.all([
    supabase.from('config').update({ value: dca }).eq('key', 'dca').select('key'),
    supabase.from('config').update({ value: parsed.value.expiryDays }).eq('key', 'proposal_expiry_days').select('key'),
  ]);
  const error = first.error ?? second.error;
  if (error) return { errors: {}, message: saveFailed(error.message) };
  if (!first.data?.length || !second.data?.length) return { errors: {}, message: MISSING };
  redirect('/rules?saved=settings#settings');
}
