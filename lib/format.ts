/** Number formats used across the app; en-US grouping so server and browser render the same text. */

const DASH = '—';

function grouped(value: number, digits: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** NT$1,234,567, rounded to the dollar. */
export function twd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const rounded = Math.round(value);
  return `${rounded < 0 ? '−' : ''}NT$${grouped(Math.abs(rounded), 0)}`;
}

/** A TWD difference with its sign: +NT$1,200, −NT$350; one that rounds to zero has none. */
export function signedTwd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const rounded = Math.round(value);
  return rounded > 0 ? `+${twd(rounded)}` : twd(rounded === 0 ? 0 : rounded);
}

/** An amount in its own currency, e.g. "1,234.50 USD". */
export function money(value: number | null | undefined, currency: string, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `${grouped(value, digits)} ${currency}`;
}

/** A quantity with up to four decimals and no trailing zeros. */
export function quantity(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/** A fraction as a percentage: 0.055 → "5.5%". */
export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `${(value * 100).toFixed(digits)}%`;
}

/** A return with its sign: 0.055 → "+5.5%", −0.02 → "−2.0%"; one that rounds to zero has none. */
export function signedPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const text = Math.abs(value * 100).toFixed(digits);
  if (Number(text) === 0) return `${text}%`;
  return `${value > 0 ? '+' : '−'}${text}%`;
}

/** A difference of fractions in percentage points: 0.032 → "+3.2 pp". */
export function points(value: number, digits = 1): string {
  const scaled = value * 100;
  const text = Math.abs(scaled).toFixed(digits);
  if (Number(text) === 0) return `0.${'0'.repeat(digits)} pp`;
  return `${scaled > 0 ? '+' : '−'}${text} pp`;
}

const TAIPEI_TIME = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short', hour12: false });

/** A timestamp as a date and time in Taipei, e.g. "2026-10-21, 22:24". */
export function taipeiDateTime(at: string): string {
  return TAIPEI_TIME.format(new Date(at));
}
