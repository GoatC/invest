'use server';

import { redirect } from '@/lib/action-redirect';
import { requireSession } from '@/lib/auth';
import { DataError, loadHoldingsData, orDataError, rescoreQuietly, transactionColumns } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, parseId, saveFailed, shortfallMessage, type DeleteState } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { addedShortfalls, previewTrade } from '@/lib/models/portfolio';
import { buildPositions } from '@/lib/models/positions';
import { restateTrades } from '@/lib/models/splits';
import { parseTrade, type FieldErrors, type TradeField } from '@/lib/validation';

export interface TradeFormState {
  errors: FieldErrors<TradeField>;
  message: Bilingual | null;
}

/**
 * Adds a trade, or updates the one whose id the form carries. R1 / R2 breaches only warn (the
 * form shows them before saving and the holdings page after); a sell larger than the holding is
 * a data error and is refused.
 */
export async function saveTrade(_previous: TradeFormState, formData: FormData): Promise<TradeFormState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const data = await orDataError(loadHoldingsData(supabase));
  if (data instanceof DataError) return { errors: {}, message: saveFailed(data.detail) };
  // Editing a trade saved at a leverage above today's maximum keeps that leverage valid.
  const editing = data.trades.find((trade) => trade.id === parseId(fields['id']));
  const maxLeverage = Math.max(data.leverage.max, editing?.leverage ?? 1);
  const parsed = parseTrade(fields, new Map(data.securities.map((security) => [security.ticker, security])), taipeiToday(), maxLeverage);
  if (!parsed.ok) return { errors: parsed.errors, message: ACTION_MESSAGES.checkFields };

  const id = parseId(fields['id']);
  if (fields['id'] && (id === undefined || !data.trades.some((trade) => trade.id === id))) {
    return { errors: {}, message: ACTION_MESSAGES.notFound };
  }
  const preview = previewTrade(data, { ...parsed.value, id }, data.caps);
  const [shortfall] = preview.shortfalls;
  if (shortfall) return { errors: { qty: shortfallMessage(shortfall) }, message: ACTION_MESSAGES.checkFields };

  const columns = transactionColumns(parsed.value);
  const { error } =
    id === undefined
      ? await supabase.from('transactions').insert({ ...columns, source: 'manual' })
      : await supabase.from('transactions').update(columns).eq('id', id);
  if (error) return { errors: {}, message: saveFailed(error.message) };
  // A trade in a satellite class scores its assumption again (F6 auto), so the frontier counts it now.
  const tickers = new Set([parsed.value.ticker, ...(editing ? [editing.ticker] : [])]);
  if (inSatellite(data.securities, tickers)) await rescoreQuietly(supabase, taipeiToday());
  // The holdings page then offers this ticker's analyses as the next step.
  redirect(`/holdings?saved=${id === undefined ? 'added' : 'updated'}&t=${encodeURIComponent(parsed.value.ticker)}`);
}

/** Deletes a trade unless a later sell depends on it; the audit log keeps the deleted row. */
export async function deleteTrade(_previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const { supabase } = await requireSession();
  const id = parseId(formFields(formData)['id']);
  const data = await orDataError(loadHoldingsData(supabase));
  if (data instanceof DataError) return { message: saveFailed(data.detail) };
  if (id === undefined || !data.trades.some((trade) => trade.id === id)) return { message: ACTION_MESSAGES.notFound };

  const trades = restateTrades(data.trades, data.splits);
  const [shortfall] = addedShortfalls(buildPositions(trades).shortfalls, buildPositions(trades.filter((trade) => trade.id !== id)).shortfalls);
  if (shortfall) return { message: shortfallMessage(shortfall) };

  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) return { message: saveFailed(error.message) };
  const deleted = data.trades.find((trade) => trade.id === id);
  if (deleted && inSatellite(data.securities, [deleted.ticker])) await rescoreQuietly(supabase, taipeiToday());
  redirect('/holdings?saved=deleted');
}

/** Whether any of the tickers sits in a satellite class, whose auto-scored assumption reads its holdings. */
function inSatellite(securities: ReadonlyArray<{ ticker: string; sleeve: string }>, tickers: Iterable<string>): boolean {
  const wanted = new Set(tickers);
  return securities.some((security) => wanted.has(security.ticker) && security.sleeve === 'satellite');
}
