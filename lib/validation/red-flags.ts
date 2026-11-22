/**
 * N3 red-flag indicator: a manual entry and the settings.
 */
import { isIsoDate } from '../dates';
import { GOVERNANCE_TIERS, MANUAL_INDICATORS, type ManualIndicator, type RedFlagSettings } from '../models/red-flags';
import { finish, MESSAGES, oneOf, parseNumber, percentField, previouslyChecked, text, wholeIn, type FieldErrors, type Parsed, type RawForm } from './core';

export interface FlagEntryInput {
  ticker: string;
  indicator: ManualIndicator;
  asOf: string;
  value: number;
  note: string;
}

export type FlagEntryField = keyof FlagEntryInput;

/** An owner's entry: events found as of a date (0 for checked, none), or the governance evaluation tier. */
export function parseFlagEntryForm(raw: RawForm, tickers: readonly string[], today: string): Parsed<FlagEntryInput, FlagEntryField> {
  const errors: FieldErrors<FlagEntryField> = {};
  const ticker = oneOf(raw['ticker'], tickers);
  if (!ticker) errors.ticker = MESSAGES.choice;
  const indicator = oneOf(raw['indicator'], MANUAL_INDICATORS);
  if (!indicator) errors.indicator = MESSAGES.choice;
  const asOf = text(raw['asOf']);
  if (!isIsoDate(asOf)) errors.asOf = MESSAGES.date;
  else if (asOf > today) errors.asOf = MESSAGES.future;
  const value = parseNumber(raw['value']);
  if (indicator === 'governance_rating') {
    if (value === undefined || !(GOVERNANCE_TIERS as readonly number[]).includes(value)) errors.value = MESSAGES.choice;
  } else if (value === undefined || !Number.isInteger(value) || value < 0 || value > 999) {
    errors.value = MESSAGES.wholeNumber;
  }
  const note = text(raw['note']);
  if (note.length > 300) errors.note = MESSAGES.tooLong;
  return finish(errors, () => ({ ticker: ticker as string, indicator: indicator as ManualIndicator, asOf, value: value as number, note }));
}

/** A list typed one per line or separated by commas, blanks dropped. */
export function listField(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(/[\n,，、]/).map((entry) => entry.trim()).filter(Boolean))];
}

export type FlagSettingsField =
  | 'lookbackYears'
  | 'scanDays'
  | 'beneish'
  | 'zRed'
  | 'zAmber'
  | 'z2Red'
  | 'z2Amber'
  | 'cashFlowYears'
  | 'governance'
  | 'manufacturing'
  | 'financial'
  | 'industries'
  | 'tickers';

function score(raw: string | undefined, min: number, max: number): number | undefined {
  const value = parseNumber(raw);
  return value !== undefined && value >= min && value <= max ? Math.round(value * 1000) / 1000 : undefined;
}

/** config red_flags: thresholds, the Taiwan industries counted as manufacturers and as financial, and the exclusion list. */
export function parseFlagSettingsForm(raw: RawForm, current: RedFlagSettings, today: string): Parsed<RedFlagSettings, FlagSettingsField> {
  const errors: FieldErrors<FlagSettingsField> = {};
  const lookbackYears = wholeIn(raw['lookbackYears'], 1, 10);
  if (lookbackYears === undefined) errors.lookbackYears = MESSAGES.historyYears;
  const scanDays = wholeIn(raw['scanDays'], 1, 90);
  if (scanDays === undefined) errors.scanDays = MESSAGES.scanDays;
  const beneish = score(raw['beneish'], -10, 10);
  if (beneish === undefined) errors.beneish = MESSAGES.score;
  const zone = (redKey: FlagSettingsField, amberKey: FlagSettingsField) => {
    const [red, amber] = [score(raw[redKey], 0, 10), score(raw[amberKey], 0, 10)];
    if (red === undefined) errors[redKey] = MESSAGES.score;
    if (amber === undefined) errors[amberKey] = MESSAGES.score;
    else if (red !== undefined && amber < red) errors[amberKey] = MESSAGES.ascending;
    return { redBelow: red ?? 0, amberBelow: amber ?? 0 };
  };
  const z = zone('zRed', 'zAmber');
  const z2 = zone('z2Red', 'z2Amber');
  const cashFlowYears = wholeIn(raw['cashFlowYears'], 1, 10);
  if (cashFlowYears === undefined) errors.cashFlowYears = MESSAGES.historyYears;
  const bottom = percentField(raw['governance'], 1, 99);
  if (bottom === undefined) errors.governance = MESSAGES.percent;
  const codes = (key: FlagSettingsField) => {
    const list = listField(raw[key]).map((code) => code.padStart(2, '0'));
    if (list.some((code) => !/^\d{2}$/.test(code))) errors[key] = MESSAGES.industryCodes;
    return list;
  };
  const manufacturing = codes('manufacturing');
  const financial = codes('financial');
  const industries = listField(raw['industries']);
  if (industries.some((entry) => entry.length > 60) || industries.length > 50) errors.industries = MESSAGES.tooLong;
  const tickers = listField(raw['tickers']).map((ticker) => ticker.toUpperCase());
  if (tickers.some((ticker) => !/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker))) errors.tickers = MESSAGES.tickerFormat;
  return finish(errors, () => ({
    ...current,
    lookbackYears: lookbackYears as number,
    scanDays: scanDays as number,
    beneish: { redAbove: beneish as number },
    altman: { z, z2 },
    cashFlowYears: cashFlowYears as number,
    governanceBottomShare: bottom as number,
    manufacturing: { ...current.manufacturing, twIndustries: manufacturing },
    financial: { ...current.financial, twIndustries: financial },
    excluded: { industries, tickers },
    lastVerified: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}
