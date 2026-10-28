'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClassSettings, loadMarketSeries, loadRules, loadSecurities, orDataError, windfallSettingsValue } from '@/lib/data';
import { ACTION_MESSAGES, formFields, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { capePercentile, readPace, schedule, trancheCount } from '@/lib/models/windfall';
import { parsePaceForm, parsePlanStart, parseWindfallSettingsForm, type FieldErrors } from '@/lib/validation';

export interface WindfallFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

type Supabase = Awaited<ReturnType<typeof requireSession>>['supabase'];

const MISSING: Bilingual = {
  en: 'The windfall settings are missing from the database: run npx supabase db push, then try again.',
  zh: '資料庫中找不到大額資金的設定：請先執行 npx supabase db push，再試一次。',
};

const NO_CAPE: Bilingual = {
  en: 'No CAPE is loaded for that month yet: the nightly job loads Shiller’s data; run it once (Actions → Nightly prices → Run workflow), then try again.',
  zh: '尚未載入該月份的 CAPE：每夜排程會載入 Shiller 的資料；請先執行一次（Actions → Nightly prices → Run workflow），再試一次。',
};

async function readConfig(supabase: Supabase, key: string): Promise<{ value: unknown } | WindfallFormState> {
  const { data, error } = await supabase.from('config').select('value').eq('key', key);
  if (error) return { errors: {}, message: saveFailed(error.message) };
  const row = data?.[0] as { value: unknown } | undefined;
  return row ?? { errors: {}, message: MISSING };
}

/**
 * Starts the plan (F3): the CAPE percentile of the start month sets the tranche count (config
 * windfall_pace), and the tranches fall due monthly from the start date. A plan already there is
 * replaced, its tranches with it; proposals already drafted stay as they are.
 */
export async function startPlan(_previous: WindfallFormState, formData: FormData): Promise<WindfallFormState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const parsed = parsePlanStart(fields);
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const [market, paceRow] = await Promise.all([orDataError(loadMarketSeries(supabase)), readConfig(supabase, 'windfall_pace')]);
  if (market instanceof DataError) return { errors: {}, message: saveFailed(market.detail) };
  if (!('value' in paceRow)) return paceRow;
  const pace = readPace(paceRow.value);
  if (!pace) return { errors: {}, message: { en: 'config windfall_pace is malformed: fix the pace below.', zh: 'config 的 windfall_pace 格式錯誤：請在下方修正分批節奏。' } };
  const gauge = capePercentile(market.series['us_cape'] ?? [], parsed.value.startDate.slice(0, 7));
  if (!gauge) return { errors: {}, message: NO_CAPE };
  const count = trancheCount(gauge.percentile, pace);
  const { error: clearError } = await supabase.from('windfall_plan').delete().gt('id', 0);
  if (clearError) return { errors: {}, message: saveFailed(clearError.message) };
  const { data, error } = await supabase
    .from('windfall_plan')
    .insert({ total_twd: parsed.value.totalTwd, received_on: parsed.value.startDate, cape_percentile: Math.round(gauge.percentile * 100) / 100, tranche_count: count })
    .select('id');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  const planId = (data?.[0] as { id: number } | undefined)?.id;
  if (planId === undefined) return { errors: {}, message: saveFailed('the plan was not saved') };
  const tranches = schedule(parsed.value.totalTwd, parsed.value.startDate, count).map((tranche) => ({ plan_id: planId, due_date: tranche.dueDate, amount_twd: tranche.amountTwd }));
  const { error: tranchesError } = await supabase.from('windfall_tranches').insert(tranches);
  if (tranchesError) return { errors: {}, message: saveFailed(tranchesError.message) };
  redirect('/windfall?saved=plan#plan');
}

/** Removes the plan and its tranches; the edit history keeps them. */
export async function deletePlan(_previous: { message: Bilingual | null }, _formData: FormData): Promise<{ message: Bilingual | null }> {
  const { supabase } = await requireSession();
  const { error } = await supabase.from('windfall_plan').delete().gt('id', 0);
  if (error) return { message: saveFailed(error.message) };
  redirect('/windfall?saved=deleted#plan');
}

/** config windfall: each core class's vehicle, the waiting cash's yearly return, the backtest's first year and horizon. */
export async function saveWindfallSettings(_previous: WindfallFormState, formData: FormData): Promise<WindfallFormState> {
  const { supabase } = await requireSession();
  const [classes, securities] = await Promise.all([orDataError(loadAssetClassSettings(supabase)), orDataError(loadSecurities(supabase))]);
  if (classes instanceof DataError) return { errors: {}, message: saveFailed(classes.detail) };
  if (securities instanceof DataError) return { errors: {}, message: saveFailed(securities.detail) };
  const choices = new Map(classes.filter((assetClass) => assetClass.sleeve === 'core').map((assetClass) => [assetClass.id, securities.filter((security) => security.assetClassId === assetClass.id).map((security) => security.ticker)]));
  const parsed = parseWindfallSettingsForm(formFields(formData), choices);
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { data, error } = await supabase.from('config').update({ value: windfallSettingsValue(parsed.value) }).eq('key', 'windfall').select('key');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  if (!data || data.length === 0) return { errors: {}, message: MISSING };
  redirect('/windfall?saved=settings#settings');
}

/** The pace (config windfall_pace) and the acceleration tiers (rule WINDFALL_ACCELERATION's threshold, logged in rule_changes). */
export async function savePace(_previous: WindfallFormState, formData: FormData): Promise<WindfallFormState> {
  const { supabase } = await requireSession();
  const parsed = parsePaceForm(formFields(formData));
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const [paceRow, rules] = await Promise.all([readConfig(supabase, 'windfall_pace'), orDataError(loadRules(supabase))]);
  if (!('value' in paceRow)) return paceRow;
  if (rules instanceof DataError) return { errors: {}, message: saveFailed(rules.detail) };
  const rule = rules.find((candidate) => candidate.id === 'WINDFALL_ACCELERATION');
  if (!rule) return { errors: {}, message: ACTION_MESSAGES.notFound };
  const keep = (value: unknown) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
  const pace = { ...keep(paceRow.value), cutoffs: parsed.value.cutoffs, tranches: parsed.value.tranches };
  const [first, second, third] = parsed.value.tiers;
  const threshold = {
    ...keep(rule.threshold),
    tiers: [
      { drawdown: first.drawdown, deploy: 'next_tranche' },
      { drawdown: second.drawdown, deploy_share_of_remaining: second.share },
      { drawdown: third.drawdown, deploy_share_of_remaining: third.share },
    ],
  };
  const paceSave = await supabase.from('config').update({ value: pace }).eq('key', 'windfall_pace').select('key');
  if (paceSave.error) return { errors: {}, message: saveFailed(paceSave.error.message) };
  const ruleSave = await supabase.from('rules').update({ threshold }).eq('id', rule.id).select('id');
  if (ruleSave.error) return { errors: {}, message: saveFailed(ruleSave.error.message) };
  redirect('/windfall?saved=pace#pace');
}
