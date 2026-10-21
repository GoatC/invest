'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadSecurities, orDataError } from '@/lib/data';
import { ACTION_MESSAGES, afterSecurityAdded, formFields, saveFailed } from '@/lib/forms';
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
