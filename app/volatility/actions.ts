'use server';

import { redirect } from '@/lib/action-redirect';
import { requireSession } from '@/lib/auth';
import { loadVolatilitySettings } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, parseId, saveFailed, type DeleteState } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { volatilitySettingsValue } from '@/lib/models/volatility';
import { parseEventForm, parseVolatilityForm, type FieldErrors } from '@/lib/validation';

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

/** A typed event (N8 step 2): Taiwan's central bank meeting or another, such as an election. */
export async function addMarketEvent(_previous: VolatilityFormState, formData: FormData): Promise<VolatilityFormState> {
  const { supabase } = await requireSession();
  const parsed = parseEventForm(formFields(formData));
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const event = parsed.value;
  const { error } = await supabase
    .from('market_events')
    .insert({ kind: event.kind, event_date: event.date, event_time: event.time, name_en: event.name.en, name_zh: event.name.zh, source: 'typed', note: event.note });
  if (error) {
    const taken = /duplicate key|unique/i.test(error.message);
    return { errors: {}, message: taken ? { en: 'That event is already on that day.', zh: '當天已有同名事件。' } : saveFailed(error.message) };
  }
  redirect('/volatility?saved=event#events');
}

/** Deletes a typed event; the feeds' events are the job's, and row-level security refuses them. */
export async function deleteMarketEvent(_previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const { supabase } = await requireSession();
  const id = parseId(formFields(formData)['id']);
  if (id === undefined) return { message: ACTION_MESSAGES.notFound };
  const { data, error } = await supabase.from('market_events').delete().eq('id', id).eq('source', 'typed').select('id');
  if (error) return { message: saveFailed(error.message) };
  if (!data || data.length === 0) return { message: ACTION_MESSAGES.notFound };
  redirect('/volatility?saved=event-deleted#events');
}
