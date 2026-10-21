'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadSecurities, orDataError } from '@/lib/data';
import { ACTION_MESSAGES, afterSecurityAdded, formFields, saveFailed, type DeleteState } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { parseSecurity, type FieldErrors, type SecurityField } from '@/lib/validation';

export interface SecurityFormState {
  errors: FieldErrors<SecurityField>;
  message: Bilingual | null;
}

/** Adds a listed security; its sleeve follows the asset class (a database trigger fills it in). */
export async function addSecurity(_previous: SecurityFormState, formData: FormData): Promise<SecurityFormState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const loaded = await orDataError(Promise.all([loadSecurities(supabase), loadAssetClasses(supabase)]));
  if (loaded instanceof DataError) return { errors: {}, message: saveFailed(loaded.detail) };
  const [securities, assetClasses] = loaded;
  const parsed = parseSecurity(
    fields,
    new Set(securities.map((security) => security.ticker)),
    new Map(assetClasses.map((assetClass) => [assetClass.id, assetClass])),
  );
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };

  const security = parsed.value;
  const { error } = await supabase.from('securities').insert({
    ticker: security.ticker,
    name: security.name,
    market: security.market,
    product_type: security.productType,
    asset_class_id: security.assetClassId,
    currency: security.currency,
    domicile: security.domicile,
  });
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect(afterSecurityAdded(fields['next'], security.ticker));
}

/** Updates a security's details; the ticker itself stays, since every trade refers to it. */
export async function updateSecurity(_previous: SecurityFormState, formData: FormData): Promise<SecurityFormState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const ticker = (fields['ticker'] ?? '').trim().toUpperCase();
  const loaded = await orDataError(Promise.all([loadSecurities(supabase), loadAssetClasses(supabase)]));
  if (loaded instanceof DataError) return { errors: {}, message: saveFailed(loaded.detail) };
  const [securities, assetClasses] = loaded;
  if (!securities.some((security) => security.ticker === ticker)) return { errors: {}, message: ACTION_MESSAGES.notFound };
  const parsed = parseSecurity(
    fields,
    new Set(securities.map((security) => security.ticker).filter((other) => other !== ticker)),
    new Map(assetClasses.map((assetClass) => [assetClass.id, assetClass])),
  );
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };

  const security = parsed.value;
  // The sleeve follows a new asset class through the database trigger.
  const { error } = await supabase
    .from('securities')
    .update({
      name: security.name,
      market: security.market,
      product_type: security.productType,
      asset_class_id: security.assetClassId,
      currency: security.currency,
      domicile: security.domicile,
    })
    .eq('ticker', ticker);
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect('/securities?saved=updated');
}

const IN_USE: Bilingual = {
  en: 'This security is still in use (trades, prices, a benchmark or the watchlist), so it cannot be deleted.',
  zh: '這檔證券仍在使用中（交易、價格、基準或觀察清單），因此無法刪除。',
};

/** Deletes a security nothing refers to; the database refuses one that trades or prices still use. */
export async function deleteSecurity(_previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const { supabase } = await requireSession();
  const ticker = (formFields(formData)['id'] ?? '').trim().toUpperCase();
  if (!ticker) return { message: ACTION_MESSAGES.notFound };
  const { data, error } = await supabase.from('securities').delete().eq('ticker', ticker).select('ticker');
  // 23503: a foreign key still points at it.
  if (error) return { message: error.code === '23503' ? IN_USE : saveFailed(error.message) };
  if (!data || data.length === 0) return { message: ACTION_MESSAGES.notFound };
  redirect('/securities?saved=deleted');
}
