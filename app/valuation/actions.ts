'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { loadSecurities, loadWorkbench, saveValuation } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { readValuationSettings } from '@/lib/models/intrinsic';
import { parseAssumptionsForm, parseValuationSettingsForm, type FieldErrors } from '@/lib/validation';

export interface ValuationFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The valuation settings are missing: run npx supabase db push, then try again.',
  zh: '找不到估值設定：請先執行 npx supabase db push，再試一次。',
};

const pageOf = (ticker: string) => `/valuation?t=${encodeURIComponent(ticker)}`;

/** Puts a single stock on the watchlist with the defaults, and opens its workbench. */
export async function watchStock(formData: FormData): Promise<void> {
  const { supabase } = await requireSession();
  const ticker = String(formData.get('ticker') ?? '');
  const security = (await loadSecurities(supabase)).find((candidate) => candidate.ticker === ticker && candidate.productType === 'stock');
  if (!security) redirect('/valuation?error=ticker');
  const { error } = await supabase.from('watchlist').upsert({ ticker, active: true }, { onConflict: 'ticker', ignoreDuplicates: true });
  if (error) redirect(`/valuation?error=${encodeURIComponent(error.message.slice(0, 80))}`);
  redirect(pageOf(ticker));
}

/** Takes a stock off the watchlist; its saved values stay, and the edit history keeps its assumptions. */
export async function unwatchStock(formData: FormData): Promise<void> {
  const { supabase } = await requireSession();
  const ticker = String(formData.get('ticker') ?? '');
  const { error } = await supabase.from('watchlist').delete().eq('ticker', ticker);
  if (error) redirect(`${pageOf(ticker)}&error=${encodeURIComponent(error.message.slice(0, 80))}`);
  redirect('/valuation');
}

/** A stock's assumptions and alert multiples, logged; then its valuation is saved as the alerts' basis. */
export async function saveAssumptions(_previous: ValuationFormState, formData: FormData): Promise<ValuationFormState> {
  const { supabase } = await requireSession();
  const raw = formFields(formData);
  const ticker = raw['ticker'] ?? '';
  const today = taipeiToday();
  const stocks = (await loadSecurities(supabase)).filter((security) => security.productType === 'stock').map((security) => security.ticker);
  if (!stocks.includes(ticker)) return { errors: {}, message: { en: 'Unknown stock.', zh: '找不到這檔個股。' } };
  const parsed = parseAssumptionsForm(raw, stocks, ticker);
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { active, buy, trim, assumptions } = parsed.value;
  const { error } = await supabase
    .from('watchlist')
    .upsert({ ticker, active, buy_threshold: buy, trim_threshold: trim, assumptions }, { onConflict: 'ticker' });
  if (error) return { errors: {}, message: saveFailed(error.message) };
  try {
    const bench = (await loadWorkbench(supabase, today, [ticker])).stocks[0];
    if (bench) await saveValuation(supabase, bench, 'edit', today);
  } catch (err) {
    return { errors: {}, message: saveFailed(err instanceof Error ? err.message : String(err)) };
  }
  redirect(`${pageOf(ticker)}&saved=assumptions#assumptions`);
}

/** config valuation: the defaults every stock starts from; logged like every setting. */
export async function saveValuationSettings(_previous: ValuationFormState, formData: FormData): Promise<ValuationFormState> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase.from('config').select('value').eq('key', 'valuation');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  const current = (data?.[0] as { value?: Record<string, unknown> } | undefined)?.value;
  const settings = readValuationSettings(current);
  if (!current || !settings) return { errors: {}, message: MISSING };
  const parsed = parseValuationSettingsForm(formFields(formData), Object.keys(settings.taxRate), taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { model, years, growth, terminal, debtSpread, taxRate, historyYears, minQuarters, checked } = parsed.value;
  const value = { ...current, model, years, growth, terminal, debt_spread: debtSpread, tax_rate: taxRate, history_years: historyYears, min_quarters: minQuarters, last_verified: checked };
  const { error: saveError } = await supabase.from('config').update({ value }).eq('key', 'valuation');
  if (saveError) return { errors: {}, message: saveFailed(saveError.message) };
  redirect('/valuation?saved=settings#settings');
}
