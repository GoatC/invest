'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { loadTimelineSettings } from '@/lib/data';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { timelineSettingsValue } from '@/lib/models/timeline';
import { parseTimelineForm, type FieldErrors, type TimelineField } from '@/lib/validation';

export interface TimelineFormState {
  errors: FieldErrors<TimelineField>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The timeline setting is missing from the database: run npx supabase db push, then try again.',
  zh: '資料庫中找不到時間軸設定：請先執行 npx supabase db push，再試一次。',
};

/** The later goals (config timeline), logged like every setting. */
export async function saveTimeline(_previous: TimelineFormState, formData: FormData): Promise<TimelineFormState> {
  const { supabase } = await requireSession();
  if (!(await loadTimelineSettings(supabase))) return { errors: {}, message: MISSING };
  const parsed = parseTimelineForm(formFields(formData));
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { error } = await supabase.from('config').update({ value: timelineSettingsValue(parsed.value) }).eq('key', 'timeline');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect('/timeline?saved=goals#goals');
}
