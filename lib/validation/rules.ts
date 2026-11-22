/**
 * The rules page: a rule's threshold and the engine's settings.
 */
import { finish, MESSAGES, parseNumber, text, type FieldErrors, type Parsed, type RawForm } from './core';

/** Field name of a threshold's number. */
export function thresholdField(key: string): string {
  return `threshold_${key}`;
}

export interface RuleInput {
  enabled: boolean;
  cooldownDays: number;
  /** The threshold with its numbers replaced; other entries (lists, words) kept as they are. */
  threshold: Record<string, unknown>;
}

/**
 * A rule's edit: on or off, its cooldown, each switch and each number in its threshold. A whole number stays
 * whole, a share (between 0 and 1) stays one, and any other number stays above 0 (a multiple such as 1.25).
 */
export function parseRuleForm(raw: RawForm, threshold: Record<string, unknown>): Parsed<RuleInput, string> {
  const errors: FieldErrors<string> = {};
  const cooldownDays = parseNumber(raw['cooldownDays']);
  if (cooldownDays === undefined || !Number.isInteger(cooldownDays) || cooldownDays < 0 || cooldownDays > 365) errors['cooldownDays'] = MESSAGES.cooldown;
  const next: Record<string, unknown> = { ...threshold };
  for (const [key, was] of Object.entries(threshold)) {
    // A switch (push_in_quiet_hours) is a checkbox: on, or off when left out.
    if (typeof was === 'boolean') {
      next[key] = raw[thresholdField(key)] === 'on';
      continue;
    }
    if (typeof was !== 'number') continue;
    const name = thresholdField(key);
    const value = parseNumber(raw[name]);
    if (Number.isInteger(was)) {
      if (value === undefined || value < 0 || !Number.isInteger(value)) errors[name] = MESSAGES.wholeNumber;
    } else if (was > 0 && was < 1) {
      if (value === undefined || value <= 0 || value >= 1) errors[name] = MESSAGES.fraction;
    } else if (value === undefined || value <= 0) {
      errors[name] = MESSAGES.positive;
    }
    if (value !== undefined) next[key] = value;
  }
  return finish(errors, () => ({ enabled: raw['enabled'] === 'on', cooldownDays: cooldownDays ?? 0, threshold: next }));
}

export interface EngineSettingsInput {
  dcaAmountTwd: number;
  dcaDay: number | null;
  expiryDays: number;
  /** config orders: US and UK share counts in fractions, and to how many decimals. */
  fractionalUs: boolean;
  fractionalUk: boolean;
  shareDecimals: number;
}

export type EngineSettingsField = keyof EngineSettingsInput;

/** The monthly DCA (config dca), how many days after the debit its warning still fires (config proposal_expiry_days) and how orders round shares (config orders). */
export function parseEngineSettings(raw: RawForm): Parsed<EngineSettingsInput, EngineSettingsField> {
  const errors: FieldErrors<EngineSettingsField> = {};
  const dcaAmountTwd = parseNumber(raw['dcaAmountTwd']);
  if (dcaAmountTwd === undefined || dcaAmountTwd < 0) errors.dcaAmountTwd = MESSAGES.nonNegative;
  const dayText = text(raw['dcaDay']);
  const dcaDay = dayText === '' ? null : parseNumber(dayText);
  if (dcaDay === undefined || (dcaDay !== null && (!Number.isInteger(dcaDay) || dcaDay < 1 || dcaDay > 31))) errors.dcaDay = MESSAGES.dcaDay;
  const expiryDays = parseNumber(raw['expiryDays']);
  if (expiryDays === undefined || !Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 365) errors.expiryDays = MESSAGES.expiryDays;
  const fractionalUs = raw['fractionalUs'] === 'on';
  const fractionalUk = raw['fractionalUk'] === 'on';
  const shareDecimals = parseNumber(raw['shareDecimals']);
  if (shareDecimals === undefined || !Number.isInteger(shareDecimals) || shareDecimals < 1 || shareDecimals > 4) errors.shareDecimals = MESSAGES.shareDecimals;
  return finish(errors, () => ({ dcaAmountTwd: dcaAmountTwd ?? 0, dcaDay: dcaDay ?? null, expiryDays: expiryDays ?? 14, fractionalUs, fractionalUk, shareDecimals: shareDecimals ?? 4 }));
}
