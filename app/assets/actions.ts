'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadManualAsset, orDataError } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, parseId, saveFailed, type DeleteState } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { parseManualAsset, type FieldErrors, type ManualAssetField } from '@/lib/validation';

export interface AssetFormState {
  errors: FieldErrors<ManualAssetField>;
  message: Bilingual | null;
}

/** Adds a non-listed asset (gold in grams, a TWD balance), or updates the one whose id the form carries. */
export async function saveAsset(_previous: AssetFormState, formData: FormData): Promise<AssetFormState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const id = parseId(fields['id']);
  const loaded = await orDataError(Promise.all([loadAssetClasses(supabase), id === undefined ? undefined : loadManualAsset(supabase, id)]));
  if (loaded instanceof DataError) return { errors: {}, message: saveFailed(loaded.detail) };
  const [assetClasses, existing] = loaded;
  if (fields['id'] && !existing) return { errors: {}, message: ACTION_MESSAGES.notFound };

  const parsed = parseManualAsset(fields, new Map(assetClasses.map((assetClass) => [assetClass.id, assetClass])), taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const asset = parsed.value;
  const columns = {
    name: asset.name,
    asset_class_id: asset.assetClassId,
    product_type: asset.productType,
    unit: asset.unit,
    quantity: asset.quantity,
    valuation_method: asset.valuationMethod,
    last_value_twd: asset.lastValueTwd,
    valued_on: asset.valuedOn,
    pool: asset.pool,
  };
  const { error } =
    id === undefined ? await supabase.from('manual_assets').insert(columns) : await supabase.from('manual_assets').update(columns).eq('id', id);
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect(`/holdings?saved=${id === undefined ? 'asset-added' : 'asset-updated'}`);
}

/** Deletes a non-listed asset; the audit log keeps the deleted row. */
export async function deleteAsset(_previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const { supabase } = await requireSession();
  const id = parseId(formFields(formData)['id']);
  if (id === undefined) return { message: ACTION_MESSAGES.notFound };
  const { data, error } = await supabase.from('manual_assets').delete().eq('id', id).select('id');
  if (error) return { message: saveFailed(error.message) };
  if (!data || data.length === 0) return { message: ACTION_MESSAGES.notFound };
  redirect('/holdings?saved=asset-deleted');
}
