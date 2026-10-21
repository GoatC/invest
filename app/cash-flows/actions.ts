'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { cashFlowColumns, DataError, loadCashFlow, loadSecurities, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, parseId, saveFailed, type DeleteState } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { parseCashFlow, type CashFlowField, type FieldErrors } from '@/lib/validation';

export interface CashFlowFormState {
  errors: FieldErrors<CashFlowField>;
  message: Bilingual | null;
}

/** Adds a cash flow, or updates the one whose id the form carries. */
export async function saveCashFlow(_previous: CashFlowFormState, formData: FormData): Promise<CashFlowFormState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const id = parseId(fields['id']);
  const loaded = await orDataError(Promise.all([loadSecurities(supabase), id === undefined ? undefined : loadCashFlow(supabase, id)]));
  if (loaded instanceof DataError) return { errors: {}, message: saveFailed(loaded.detail) };
  const [securities, existing] = loaded;
  if (fields['id'] && !existing) return { errors: {}, message: ACTION_MESSAGES.notFound };

  const parsed = parseCashFlow(fields, new Map(securities.map((security) => [security.ticker, security])), taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const columns = cashFlowColumns(parsed.value);
  const { error } =
    id === undefined ? await supabase.from('cash_flows').insert(columns) : await supabase.from('cash_flows').update(columns).eq('id', id);
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect(`/holdings?saved=${id === undefined ? 'flow-added' : 'flow-updated'}#cash-flows`);
}

/** Deletes a cash flow; the audit log keeps the deleted row. */
export async function deleteCashFlow(_previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const { supabase } = await requireSession();
  const id = parseId(formFields(formData)['id']);
  if (id === undefined) return { message: ACTION_MESSAGES.notFound };
  const { data, error } = await supabase.from('cash_flows').delete().eq('id', id).select('id');
  if (error) return { message: saveFailed(error.message) };
  if (!data || data.length === 0) return { message: ACTION_MESSAGES.notFound };
  redirect('/holdings?saved=flow-deleted#cash-flows');
}
