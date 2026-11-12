'use server';

import { redirect, refreshPages } from '@/lib/action-redirect';
import { requireSession } from '@/lib/auth';
import { loadBannerSnooze, orDataError, DataError } from '@/lib/data';
import { addDays, taipeiToday } from '@/lib/dates';
import { formFields, parseId } from '@/lib/forms';

/** Only a path inside the app, so a form cannot send the browser elsewhere. */
function backTo(raw: string | undefined): string | undefined {
  return raw && /^\/(?!\/)[^\s\\]*$/.test(raw) ? raw : undefined;
}

/** ✕ on an in-app banner: hidden until config banners.snooze_days from today, on every device. */
export async function dismissBanner(formData: FormData): Promise<void> {
  const { supabase } = await requireSession();
  const key = (formFields(formData)['key'] ?? '').trim();
  const snooze = await orDataError(loadBannerSnooze(supabase));
  if (key && key.length <= 120 && typeof snooze === 'number') {
    await supabase.from('banner_dismissals').upsert({ key, until: addDays(taipeiToday(), snooze) }, { onConflict: 'key' });
  }
  refreshPages();
}

/** "Skip" on a dividend prompt: that pool's share of the dividend is not asked about again. */
export async function skipDividend(formData: FormData): Promise<void> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const id = parseId(fields['event']);
  const pool = fields['pool'] === 'windfall' ? 'windfall' : fields['pool'] === 'regular' ? 'regular' : undefined;
  if (id !== undefined && pool) {
    const { data } = await supabase.from('dividend_events').select('skipped_pools').eq('id', id);
    const saved = (data?.[0] as { skipped_pools?: string[] | null } | undefined)?.skipped_pools;
    if (saved !== undefined && !(saved ?? []).includes(pool)) {
      await supabase.from('dividend_events').update({ skipped_pools: [...(saved ?? []), pool] }).eq('id', id);
    }
  }
  const back = backTo(fields['back']);
  if (back) redirect(back);
  refreshPages();
}

/** Whether a security's income is reinvested by itself (securities.dividends_reinvested): then no dividend is asked about. */
export async function setReinvested(formData: FormData): Promise<void> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const ticker = (fields['ticker'] ?? '').trim().toUpperCase();
  if (/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)) {
    const { error } = await supabase.from('securities').update({ dividends_reinvested: fields['reinvested'] === '1' }).eq('ticker', ticker);
    if (error) throw new DataError('securities', error.message);
  }
  redirect('/holdings?saved=dividend-setting#dividend-settings');
}
