/**
 * The words of the combined look-through (F14) and the sector tab (N7): GICS sectors, asset types,
 * and country names in English and Traditional Chinese (from the runtime's own region names).
 */
import type { Bilingual } from './i18n';
import type { AssetType } from './models/look-through';

export const SECTOR: Record<string, Bilingual> = {
  'Information Technology': { en: 'Information Technology', zh: '資訊科技' },
  Financials: { en: 'Financials', zh: '金融' },
  'Health Care': { en: 'Health Care', zh: '醫療保健' },
  'Consumer Discretionary': { en: 'Consumer Discretionary', zh: '非必需消費' },
  'Communication Services': { en: 'Communication Services', zh: '通訊服務' },
  Industrials: { en: 'Industrials', zh: '工業' },
  'Consumer Staples': { en: 'Consumer Staples', zh: '必需消費' },
  Energy: { en: 'Energy', zh: '能源' },
  Materials: { en: 'Materials', zh: '原物料' },
  Utilities: { en: 'Utilities', zh: '公用事業' },
  'Real Estate': { en: 'Real Estate', zh: '不動產' },
  unclassified: { en: 'Not classified', zh: '未分類' },
};

export function sectorText(sector: string | null): Bilingual {
  return SECTOR[sector ?? 'unclassified'] ?? { en: sector ?? '', zh: sector ?? '' };
}

export const ASSET_TYPE: Record<AssetType, Bilingual> = {
  equity: { en: 'Equity', zh: '股票' },
  bond: { en: 'Bonds', zh: '債券' },
  cash: { en: 'Cash and T-bills', zh: '現金與短期國庫券' },
  gold: { en: 'Gold', zh: '黃金' },
  other: { en: 'Other', zh: '其他' },
};

const SPECIAL: Record<string, Bilingual> = {
  whole: { en: 'Funds not looked through', zh: '未展開的基金' },
  gold: { en: 'Gold (no country)', zh: '黃金（無國家）' },
  unknown: { en: 'Not known', zh: '未知' },
};

const names = { en: new Intl.DisplayNames(['en'], { type: 'region' }), zh: new Intl.DisplayNames(['zh-Hant-TW'], { type: 'region' }) };

/** A country by its ISO code, or one of the slices without a country. */
export function countryText(key: string): Bilingual {
  if (SPECIAL[key]) return SPECIAL[key];
  try {
    return { en: names.en.of(key) ?? key, zh: names.zh.of(key) ?? key };
  } catch {
    return { en: key, zh: key };
  }
}

/** A currency slice: its code, or "not known". */
export function currencyText(key: string): Bilingual {
  return key === 'unknown' ? SPECIAL['unknown'] as Bilingual : { en: key, zh: key };
}
