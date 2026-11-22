/**
 * N7 sector tab settings.
 */
import type { SectorProxy, SectorSettings } from '../models/sectors';
import { finish, MESSAGES, oneOf, previouslyChecked, type FieldErrors, type Parsed, type RawForm } from './core';

export type SectorField = 'colour' | 'tw';

/** config sectors: the colour convention and each Taiwan industry index's GICS sector, "Electronic = Information Technology" per line. */
export function parseSectorForm(raw: RawForm, current: SectorSettings, sectorNames: ReadonlyMap<string, string>, today: string): Parsed<SectorSettings, SectorField> {
  const errors: FieldErrors<SectorField> = {};
  const colour = oneOf(raw['colour'], ['red_up', 'green_up'] as const);
  if (!colour) errors.colour = MESSAGES.choice;
  const known = new Map(current.proxies.filter((proxy) => proxy.market === 'TW').map((proxy) => [proxy.symbol.toLowerCase(), proxy]));
  const tw: SectorProxy[] = [];
  for (const line of (raw['tw'] ?? '').split('\n').map((one) => one.trim()).filter(Boolean)) {
    const match = /^([A-Za-z]+)\s*[=:：]\s*(.+)$/.exec(line);
    const proxy = match ? known.get((match[1] as string).toLowerCase()) : undefined;
    const sector = match ? sectorNames.get((match[2] as string).trim().toLowerCase()) : undefined;
    if (!proxy || !sector) {
      errors.tw = MESSAGES.indexSectors;
      break;
    }
    tw.push({ ...proxy, sector });
  }
  return finish(errors, () => ({ ...current, colour: colour as SectorSettings['colour'], proxies: [...current.proxies.filter((proxy) => proxy.market === 'US'), ...tw], lastVerified: raw['checked'] === 'on' ? today : previouslyChecked(raw) }));
}
