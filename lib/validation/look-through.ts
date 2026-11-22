/**
 * F14 look-through settings: the sector map and the funds' countries.
 */
import type { LookThroughSettings } from '../models/look-through';
import { finish, MESSAGES, previouslyChecked, wholeIn, type FieldErrors, type Parsed, type RawForm } from './core';

export type LookThroughField = 'topCompanies' | 'refreshDays' | 'twSectors' | 'fundCountry';

/** "24 = Information Technology", one per line, to {"24": "Information Technology"}; the Chinese sector names are read too. */
export function parseCodeSectors(raw: string | undefined, sectors: ReadonlyMap<string, string>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of (raw ?? '').split('\n').map((one) => one.trim()).filter(Boolean)) {
    const match = /^(\d{1,2})\s*[=:：]\s*(.+)$/.exec(line);
    const sector = match ? sectors.get((match[2] as string).trim().toLowerCase()) : undefined;
    if (!match || !sector) return undefined;
    out[(match[1] as string).padStart(2, '0')] = sector;
  }
  return out;
}

/** "BIL = US", one per line, to {"BIL": "US"}. */
export function parseFundCountries(raw: string | undefined): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of (raw ?? '').split('\n').map((one) => one.trim()).filter(Boolean)) {
    const match = /^([A-Za-z0-9.-]{1,12})\s*[=:：]\s*([A-Za-z]{2})$/.exec(line);
    if (!match) return undefined;
    out[(match[1] as string).toUpperCase()] = (match[2] as string).toUpperCase();
  }
  return out;
}

/** config look_through: companies named, days between holdings files, each TWSE industry's sector, each whole fund's country. */
export function parseLookThroughForm(raw: RawForm, current: LookThroughSettings, sectorNames: ReadonlyMap<string, string>, today: string): Parsed<LookThroughSettings, LookThroughField> {
  const errors: FieldErrors<LookThroughField> = {};
  const topCompanies = wholeIn(raw['topCompanies'], 5, 100);
  if (topCompanies === undefined) errors.topCompanies = MESSAGES.topCompanies;
  const refreshDays = wholeIn(raw['refreshDays'], 1, 90);
  if (refreshDays === undefined) errors.refreshDays = MESSAGES.scanDays;
  const twSectors = parseCodeSectors(raw['twSectors'], sectorNames);
  if (!twSectors) errors.twSectors = MESSAGES.codeSectors;
  const fundCountry = parseFundCountries(raw['fundCountry']);
  if (!fundCountry) errors.fundCountry = MESSAGES.fundCountries;
  return finish(errors, () => ({
    ...current,
    topCompanies: topCompanies as number,
    refreshDays: refreshDays as number,
    twSectors: twSectors as Record<string, string>,
    fundCountry: fundCountry as Record<string, string>,
    lastVerified: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}
