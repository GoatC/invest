import type { AlertItem } from './alerts';
import type { Bilingual } from './i18n';
import { POOL } from './i18n';
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
  // Added from the new trade in the iOS shell's sheet: back to that sheet, the ticker filled in.
  if (next === 'sheet') return `/holdings?sheet=trade&ticker=${encodeURIComponent(ticker)}`;
  return `/holdings?ticker=${encodeURIComponent(ticker)}#add-trade`;
}

/** Why a sell is impossible: it would sell more than the pool holds on that date. */
export function shortfallMessage(shortfall: Shortfall): Bilingual {
  const missing = quantity(shortfall.missingQty);
  if (shortfall.direction === 'short') {
    return {
      en: `This leaves the ${shortfall.ticker} buy to cover on ${shortfall.tradeDate} ${missing} units larger than the short position.`,
      zh: `這會讓 ${shortfall.tradeDate} 回補的 ${shortfall.ticker} 比放空數量多 ${missing} 單位。`,
    };
  }
  return {
    en: `This leaves the ${shortfall.ticker} sell on ${shortfall.tradeDate} ${missing} units larger than the holding.`,
    zh: `這會讓 ${shortfall.tradeDate} 賣出的 ${shortfall.ticker} 比持有數量多 ${missing} 單位。`,
  };
}

/** A sell (or a cover) larger than what was held, as a tile: the ticker, the units over, the date and the pool. */
export function shortfallAlert(shortfall: Shortfall): AlertItem {
  const cover = shortfall.direction === 'short';
  return {
    key: `${shortfall.pool}:${shortfall.ticker}:${shortfall.tradeDate}:${shortfall.direction ?? 'long'}`,
    tone: 'alert',
    title: { en: shortfall.ticker, zh: shortfall.ticker },
    value: `+${quantity(shortfall.missingQty)}`,
    chips: [
      { label: cover ? { en: 'Cover over the short', zh: '回補超過放空' } : { en: 'Sell over the holding', zh: '賣出超過持有' }, value: `${quantity(shortfall.missingQty)} 單位` },
      { label: { en: 'Date', zh: '日期' }, value: shortfall.tradeDate },
      { label: { en: 'Pool', zh: '資金池' }, value: POOL[shortfall.pool].zh },
    ],
  };
}
