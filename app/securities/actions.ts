'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { DataError, loadAssetClasses, loadHoldingsData, loadSecurities, orDataError, type HoldingsData } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, afterSecurityAdded, formFields, parseId, saveFailed, type DeleteState } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { addedShortfalls, buildPortfolio } from '@/lib/models/portfolio';
import type { Split } from '@/lib/models/splits';
import { parseSecurity, parseSplitForm, type FieldErrors, type SecurityField, type SplitField } from '@/lib/validation';

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
  redirect('/holdings?securities=updated#securities');
}

const IN_USE: Bilingual = {
  en: 'This security is still in use (trades, prices, splits, a benchmark or the watchlist), so it cannot be deleted.',
  zh: '這檔證券仍在使用中（交易、價格、分割、基準或觀察清單），因此無法刪除。',
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
  redirect('/holdings?securities=deleted#securities');
}

// ---------------------------------------------------------------------------
// Stock splits (N5)
// ---------------------------------------------------------------------------

export interface SplitFormState {
  errors: FieldErrors<SplitField>;
  message: Bilingual | null;
}

/** A sell the change would leave larger than the holding: the split or a trade around it is wrong. */
function splitShortfall(data: HoldingsData, splits: readonly Split[]): Bilingual | null {
  const [shortfall] = addedShortfalls(buildPortfolio(data).shortfalls, buildPortfolio({ ...data, splits }).shortfalls);
  return shortfall
    ? {
        en: `This would leave the ${shortfall.tradeDate} sell of ${shortfall.ticker} larger than the holding: check the split's date and numbers.`,
        zh: `這樣會使 ${shortfall.tradeDate} 賣出的 ${shortfall.ticker} 超過持有數量：請檢查分割的日期與股數。`,
      }
    : null;
}

const securityPage = (ticker: string) => `/securities/${encodeURIComponent(ticker)}`;

/** Records a split; trades before its ex-date are then read in the new shares. */
export async function addSplit(_previous: SplitFormState, formData: FormData): Promise<SplitFormState> {
  const { supabase } = await requireSession();
  const data = await orDataError(loadHoldingsData(supabase));
  if (data instanceof DataError) return { errors: {}, message: saveFailed(data.detail) };
  const parsed = parseSplitForm(formFields(formData), data.securities.map((security) => security.ticker), data.splits, taipeiToday());
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };
  const { ticker, exDate, ratio, note } = parsed.value;
  const refused = splitShortfall(data, [...data.splits, { ticker, exDate, ratio }]);
  if (refused) return { errors: {}, message: refused };
  const { error } = await supabase.from('splits').insert({ ticker, ex_date: exDate, ratio, note });
  if (error) return { errors: {}, message: saveFailed(error.message) };
  redirect(`${securityPage(ticker)}?saved=split#splits`);
}

/** Deletes a split (the edit history keeps it) unless a later sell depends on it. */
export async function deleteSplit(_previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const { supabase } = await requireSession();
  const id = parseId(formFields(formData)['id']);
  const data = await orDataError(loadHoldingsData(supabase));
  if (data instanceof DataError) return { message: saveFailed(data.detail) };
  const split = data.splits.find((one) => one.id === id);
  if (id === undefined || !split) return { message: ACTION_MESSAGES.notFound };
  const refused = splitShortfall(data, data.splits.filter((one) => one.id !== id));
  if (refused) return { message: refused };
  const { error } = await supabase.from('splits').delete().eq('id', id);
  if (error) return { message: saveFailed(error.message) };
  redirect(`${securityPage(split.ticker)}?saved=split-deleted#splits`);
}
