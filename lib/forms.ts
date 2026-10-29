import type { Bilingual } from './i18n';
import type { Shortfall } from './models/positions';
import { quantity } from './format';

/** The text fields of a submitted form; file inputs are ignored. */
export function formFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') fields[key] = value;
  }
  return fields;
}

/** A positive whole-number id, or undefined. */
export function parseId(raw: string | null | undefined): number | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export const ACTION_MESSAGES = {
  checkFields: { en: 'Check the highlighted fields.', zh: '請檢查標示的欄位。' },
  notFound: { en: 'That entry no longer exists.', zh: '這筆資料已不存在。' },
} as const satisfies Record<string, Bilingual>;

export function saveFailed(detail: string): Bilingual {
  return { en: `Could not save: ${detail}`, zh: `無法儲存：${detail}` };
}

/** The state of a delete form: null until a delete is refused. */
export interface DeleteState {
  message: Bilingual | null;
}

/**
 * Where to go once a security is added: back to the trade being edited, to a "close this tab"
 * note for the CSV import (which opens the form in a new tab), else a new trade in that ticker.
 * Only these internal paths are accepted, so the parameter cannot send the browser elsewhere.
 */
export function afterSecurityAdded(next: string | undefined, ticker: string): string {
  if (next && /^\/holdings\/\d+$/.test(next)) return next;
  if (next === 'tab') return `/securities/new?added=${encodeURIComponent(ticker)}`;
  return `/holdings?ticker=${encodeURIComponent(ticker)}#add-trade`;
}

/** Why a sell is impossible: it would sell more than the pool holds on that date. */
export function shortfallMessage(shortfall: Shortfall): Bilingual {
  const missing = quantity(shortfall.missingQty);
  return {
    en: `This leaves the ${shortfall.ticker} sell on ${shortfall.tradeDate} ${missing} units larger than the holding.`,
    zh: `這會讓 ${shortfall.tradeDate} 賣出的 ${shortfall.ticker} 比持有數量多 ${missing} 單位。`,
  };
}
