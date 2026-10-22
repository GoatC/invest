'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadCostConfig, orDataError, type CostConfig } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, saveFailed, type DeleteState } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { brokerValue, feeSettingsValue, fundCostValue, taxSettingsValue } from '@/lib/models/costs';
import { parseBrokerForm, parseFeeForm, parseFundForm, parseTaxForm, type FieldErrors } from '@/lib/validation';

/** What every costs-page form gets back when it does not save. */
export interface CostFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

const MISSING: Bilingual = {
  en: 'The fees, brokers, fund_costs or tax setting is missing from the database: run npx supabase db push, then try again.',
  zh: '資料庫中找不到 fees、brokers、fund_costs 或 tax 設定：請先執行 npx supabase db push，再試一次。',
};

type Supabase = Awaited<ReturnType<typeof requireSession>>['supabase'];

/** Writes one config row; the audit log keeps the old value. */
async function writeConfig(supabase: Supabase, key: string, value: unknown, lastVerified?: string): Promise<Bilingual | null> {
  const { data, error } = await supabase
    .from('config')
    .update({ value, ...(lastVerified ? { last_verified: lastVerified } : {}) })
    .eq('key', key)
    .select('key');
  if (error) return saveFailed(error.message);
  return data && data.length > 0 ? null : MISSING;
}

async function config(supabase: Supabase): Promise<CostConfig | CostFormState> {
  const found = await orDataError(loadCostConfig(supabase));
  if (found instanceof DataError) return { errors: {}, message: saveFailed(found.detail) };
  return found.applied ? found : { errors: {}, message: MISSING };
}

/** config fees: the 複委託 broker the estimates use, the Taiwan commission and the default FX spread. */
export async function saveFees(_previous: CostFormState, formData: FormData): Promise<CostFormState> {
  const { supabase } = await requireSession();
  const current = await config(supabase);
  if (!('applied' in current)) return current;
  const parsed = parseFeeForm(formFields(formData), current.brokers.map((broker) => broker.id));
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const failed = await writeConfig(supabase, 'fees', feeSettingsValue(parsed.value));
  if (failed) return { errors: {}, message: failed };
  redirect('/costs?saved=fees#brokers');
}

/** config tax; ticking "checked" records today as last_verified. */
export async function saveTax(_previous: CostFormState, formData: FormData): Promise<CostFormState> {
  const { supabase } = await requireSession();
  const current = await config(supabase);
  if (!('applied' in current)) return current;
  const domiciles = Object.keys(current.tax?.withholding ?? { US: 0, IE: 0, TW: 0 });
  const parsed = parseTaxForm(formFields(formData), domiciles);
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const failed = await writeConfig(supabase, 'tax', taxSettingsValue(parsed.value.tax), parsed.value.checked ? taipeiToday() : undefined);
  if (failed) return { errors: {}, message: failed };
  redirect('/costs?saved=tax#tax-settings');
}

/** Adds a broker (no `editing` field) or replaces one, keeping the list's order. */
export async function saveBroker(_previous: CostFormState, formData: FormData): Promise<CostFormState> {
  const { supabase } = await requireSession();
  const current = await config(supabase);
  if (!('applied' in current)) return current;
  const fields = formFields(formData);
  const editing = fields['editing'] || null;
  if (editing && !current.brokers.some((broker) => broker.id === editing)) return { errors: {}, message: ACTION_MESSAGES.notFound };
  const parsed = parseBrokerForm(fields, current.brokers.map((broker) => broker.id), editing, taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const brokers = editing ? current.brokers.map((broker) => (broker.id === editing ? parsed.value : broker)) : [...current.brokers, parsed.value];
  const failed = await writeConfig(supabase, 'brokers', brokers.map(brokerValue));
  if (failed) return { errors: {}, message: failed };
  redirect(`/costs?saved=broker#broker-${parsed.value.id}`);
}

/** Removes a broker; the one the estimates use is refused until another is chosen. */
export async function deleteBroker(_previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const { supabase } = await requireSession();
  const current = await config(supabase);
  if (!('applied' in current)) return { message: current.message };
  const id = String(formData.get('id') ?? '');
  if (!current.brokers.some((broker) => broker.id === id)) return { message: ACTION_MESSAGES.notFound };
  if (current.fees.brokerId === id) {
    return { message: { en: 'The fee estimates use this broker: choose another one first.', zh: '費用估算正在使用這家券商：請先選擇另一家。' } };
  }
  const failed = await writeConfig(supabase, 'brokers', current.brokers.filter((broker) => broker.id !== id).map(brokerValue));
  if (failed) return { message: failed };
  redirect('/costs?saved=deleted#brokers');
}

/** Adds a fund (no `editing` field) or replaces one. */
export async function saveFund(_previous: CostFormState, formData: FormData): Promise<CostFormState> {
  const { supabase } = await requireSession();
  const current = await config(supabase);
  if (!('applied' in current)) return current;
  const classes = await orDataError(loadAssetClasses(supabase));
  if (classes instanceof DataError) return { errors: {}, message: saveFailed(classes.detail) };
  const fields = formFields(formData);
  const editing = fields['editing'] || null;
  if (editing && !current.funds.some((fund) => fund.ticker === editing)) return { errors: {}, message: ACTION_MESSAGES.notFound };
  const parsed = parseFundForm(
    fields,
    current.funds.map((fund) => fund.ticker),
    editing,
    new Set(classes.map((assetClass) => assetClass.id)),
    taipeiToday(),
  );
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const funds = editing ? current.funds.map((fund) => (fund.ticker === editing ? parsed.value : fund)) : [...current.funds, parsed.value];
  const failed = await writeConfig(supabase, 'fund_costs', funds.map(fundCostValue));
  if (failed) return { errors: {}, message: failed };
  redirect(`/costs?saved=fund#fund-${parsed.value.ticker}`);
}

export async function deleteFund(_previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const { supabase } = await requireSession();
  const current = await config(supabase);
  if (!('applied' in current)) return { message: current.message };
  const ticker = String(formData.get('id') ?? '');
  if (!current.funds.some((fund) => fund.ticker === ticker)) return { message: ACTION_MESSAGES.notFound };
  const failed = await writeConfig(supabase, 'fund_costs', current.funds.filter((fund) => fund.ticker !== ticker).map(fundCostValue));
  if (failed) return { message: failed };
  redirect('/costs?saved=deleted#fund-costs');
}
