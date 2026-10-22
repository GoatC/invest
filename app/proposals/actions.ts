'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { DataError, loadProposal, orDataError, runRules } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { ACTION_MESSAGES, formFields, parseId, saveFailed } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { resized } from '@/lib/models/engine';
import { parseOrderSizes, type FieldErrors } from '@/lib/validation';

/** Where each action lands: the proposals page with what happened, at the proposal. */
function back(saved: string, id?: number): never {
  redirect(`/proposals?saved=${saved}${id === undefined ? '' : `#proposal-${id}`}`);
}

/** Evaluates every rule now, as the nightly job does after its refresh (L2 step 1). */
export async function checkRules(): Promise<void> {
  const { supabase } = await requireSession();
  const result = await orDataError(runRules(supabase, taipeiToday(), new Date().toISOString()));
  if (result instanceof DataError) redirect(`/proposals?failed=${encodeURIComponent(result.message)}`);
  redirect(`/proposals?saved=checked&created=${result.created}&closed=${result.closed}`);
}

/**
 * Moves a proposal on: approve an open one; dismiss an open or approved one, with an optional
 * reason; mark an approved one filled once its trades are recorded. A proposal that has moved on
 * since the page loaded (the nightly job closed it, or another tab acted) is left as it is.
 */
async function decide(formData: FormData, to: 'approved' | 'dismissed' | 'filled', from: readonly string[]): Promise<never> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const id = parseId(fields['id']);
  if (id === undefined) back('stale');
  const now = new Date().toISOString();
  const reason = (fields['reason'] ?? '').trim().slice(0, 500);
  const change =
    to === 'filled'
      ? { status: to, filled_at: now }
      : { status: to, decided_at: now, ...(to === 'dismissed' ? { dismiss_reason: reason || null } : {}) };
  const { data, error } = await supabase.from('proposals').update(change).eq('id', id).in('status', from).select('id');
  if (error) redirect(`/proposals?failed=${encodeURIComponent(error.message)}#proposal-${id}`);
  back(data && data.length > 0 ? to : 'stale', id);
}

export async function approveProposal(formData: FormData): Promise<void> {
  await decide(formData, 'approved', ['open']);
}

export async function dismissProposal(formData: FormData): Promise<void> {
  await decide(formData, 'dismissed', ['open', 'approved']);
}

export async function markFilled(formData: FormData): Promise<void> {
  await decide(formData, 'filled', ['approved']);
}

export interface OrdersFormState {
  errors: FieldErrors<string>;
  message: Bilingual | null;
}

const NOT_OPEN: Bilingual = { en: 'This proposal is no longer open.', zh: '這份提案已不是待處理狀態。' };

/** Saves an open proposal's orders with new sizes; it stays open for approval. */
export async function saveOrders(_previous: OrdersFormState, formData: FormData): Promise<OrdersFormState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const id = parseId(fields['id']);
  const proposal = id === undefined ? undefined : await orDataError(loadProposal(supabase, id));
  if (proposal instanceof DataError) return { errors: {}, message: saveFailed(proposal.detail) };
  if (!proposal || proposal.status !== 'open') return { errors: {}, message: NOT_OPEN };
  const { sizes, errors } = parseOrderSizes(fields, proposal.orders);
  if (Object.keys(errors).length > 0) return { errors, message: ACTION_MESSAGES.checkFields };
  const orders = proposal.orders.flatMap((order, index) => resized(order, sizes[index] ?? 0) ?? []);
  const { data, error } = await supabase.from('proposals').update({ orders }).eq('id', proposal.id).eq('status', 'open').select('id');
  if (error) return { errors: {}, message: saveFailed(error.message) };
  if (!data || data.length === 0) return { errors: {}, message: NOT_OPEN };
  back('edited', proposal.id);
}
