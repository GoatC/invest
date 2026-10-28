'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { loadRedFlagData, loadRedFlagSettings, scanRedFlags } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, parseId, saveFailed, type DeleteState } from '@/lib/forms';
import { formFields } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { redFlagSettingsValue } from '@/lib/models/red-flags';
import { parseFlagEntryForm, parseFlagSettingsForm, type FieldErrors } from '@/lib/validation';

export interface FlagFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The red-flag settings are missing: run npx supabase db push, then try again.',
  zh: '找不到紅旗指標設定：請先執行 npx supabase db push，再試一次。',
};

const pageOf = (ticker: string) => `/red-flags?t=${encodeURIComponent(ticker)}`;

/** Re-saves today's scan of one company, so the rules see an entry at once rather than at the next weekly scan. */
async function rescan(supabase: Parameters<typeof scanRedFlags>[0], ticker: string): Promise<void> {
  await scanRedFlags(supabase, taipeiToday(), [ticker]);
}

/** One of the owner's entries for a company, then today's scan of it again. */
export async function addFlagEntry(_previous: FlagFormState, formData: FormData): Promise<FlagFormState> {
  const { supabase } = await requireSession();
  const today = taipeiToday();
  const data = await loadRedFlagData(supabase, today);
  if (!data.settings) return { errors: {}, message: MISSING };
  const parsed = parseFlagEntryForm(formFields(formData), data.companies.map((company) => company.security.ticker), today);
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { ticker, indicator, asOf, value, note } = parsed.value;
  const { error } = await supabase.from('red_flag_entries').insert({ ticker, indicator, as_of: asOf, value, note });
  if (error) return { errors: {}, message: saveFailed(error.message) };
  try {
    await rescan(supabase, ticker);
  } catch (err) {
    return { errors: {}, message: saveFailed(err instanceof Error ? err.message : String(err)) };
  }
  redirect(`${pageOf(ticker)}&saved=entry#entries`);
}

/** Deletes an entry (the edit history keeps it), then scans the company again. */
export async function deleteFlagEntry(_previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const { supabase } = await requireSession();
  const id = parseId(String(formData.get('id') ?? ''));
  if (id === undefined) return { message: ACTION_MESSAGES.notFound };
  const { data, error } = await supabase.from('red_flag_entries').delete().eq('id', id).select('ticker');
  if (error) return { message: saveFailed(error.message) };
  const ticker = (data?.[0] as { ticker?: string } | undefined)?.ticker;
  if (!ticker) return { message: ACTION_MESSAGES.notFound };
  try {
    await rescan(supabase, ticker);
  } catch (err) {
    return { message: saveFailed(err instanceof Error ? err.message : String(err)) };
  }
  redirect(`${pageOf(ticker)}&saved=deleted#entries`);
}

/** config red_flags, logged like every setting. */
export async function saveFlagSettings(_previous: FlagFormState, formData: FormData): Promise<FlagFormState> {
  const { supabase } = await requireSession();
  const current = await loadRedFlagSettings(supabase);
  if (!current) return { errors: {}, message: MISSING };
  const parsed = parseFlagSettingsForm(formFields(formData), current, taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { error } = await supabase.from('config').update({ value: redFlagSettingsValue(parsed.value) }).eq('key', 'red_flags');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect('/red-flags?saved=settings#settings');
}
