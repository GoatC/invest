/**
 * The words of the red-flag indicator (N3): each indicator's name and flag rule, the lights, and why
 * an indicator has no level. Bilingual; the Red flags page, the proposals and the dashboard share them.
 */
import { percent } from './format';
import type { Bilingual } from './i18n';
import type { Indicator, IndicatorResult, Level, RedFlagSettings, Status } from './models/red-flags';

export const INDICATOR: Record<Indicator, Bilingual> = {
  beneish_m: { en: 'Beneish M-Score', zh: '財報操縱（Beneish M）' },
  altman_z: { en: 'Altman Z-Score', zh: '財務危機（Altman Z）' },
  cash_flow_vs_earnings: { en: 'Cash flow vs earnings', zh: '現金流與盈餘背離' },
  auditor_change: { en: 'Auditor change', zh: '更換會計師' },
  going_concern: { en: 'Going-concern opinion', zh: '繼續經營疑慮' },
  restatement: { en: 'Restatement', zh: '財報重編' },
  governance_rating: { en: 'Governance rating', zh: '公司治理評鑑' },
  environmental_penalties: { en: 'Environmental penalties', zh: '環境裁罰' },
  excluded_business: { en: 'Excluded business', zh: '排除產業' },
};

/** Short names for the heatmap's axis, which a phone leaves little room for. */
export const INDICATOR_SHORT: Record<Indicator, Bilingual> = {
  beneish_m: { en: 'Beneish', zh: '操縱' },
  altman_z: { en: 'Altman', zh: '危機' },
  cash_flow_vs_earnings: { en: 'Cash flow', zh: '現金流' },
  auditor_change: { en: 'Auditor', zh: '會計師' },
  going_concern: { en: 'Going concern', zh: '繼續經營' },
  restatement: { en: 'Restated', zh: '重編' },
  governance_rating: { en: 'Governance', zh: '治理' },
  environmental_penalties: { en: 'Environment', zh: '環境' },
  excluded_business: { en: 'Excluded', zh: '排除' },
};

export const STATUS_TEXT: Record<Status, Bilingual> = {
  green: { en: 'Green', zh: '綠燈' },
  amber: { en: 'Amber', zh: '黃燈' },
  red: { en: 'Red', zh: '紅燈' },
  none: { en: 'No data', zh: '無資料' },
  na: { en: 'Does not apply', zh: '不適用' },
};

/** The light as a word, or "no data" without one. */
export function lightText(light: Level | null): Bilingual {
  return light ? STATUS_TEXT[light] : STATUS_TEXT.none;
}

/** The status icon a light takes (the same icons as the drift bars). */
export const LIGHT_ICON: Record<Status, { className: string; icon: string }> = {
  green: { className: 'ok', icon: '✓' },
  amber: { className: 'watch', icon: '!' },
  red: { className: 'rebalance', icon: '✕' },
  none: { className: 'idle', icon: '–' },
  na: { className: 'idle', icon: '·' },
};

/** Each indicator's flag rule, with today's thresholds. */
export function ruleText(indicator: Indicator, settings: RedFlagSettings): Bilingual {
  const years = settings.lookbackYears;
  switch (indicator) {
    case 'beneish_m':
      return { en: `M > ${settings.beneish.redAbove} → red`, zh: `M > ${settings.beneish.redAbove} → 紅燈` };
    case 'altman_z': {
      const { z, z2 } = settings.altman;
      return {
        en: `Z < ${z.redBelow} → red, < ${z.amberBelow} → amber; Z″ (not a manufacturer) < ${z2.redBelow} → red, < ${z2.amberBelow} → amber`,
        zh: `Z < ${z.redBelow} → 紅燈，< ${z.amberBelow} → 黃燈；Z″（非製造業）< ${z2.redBelow} → 紅燈，< ${z2.amberBelow} → 黃燈`,
      };
    }
    case 'cash_flow_vs_earnings':
      return { en: `Operating cash flow < net income for ${settings.cashFlowYears} years → amber`, zh: `營業現金流連續 ${settings.cashFlowYears} 年低於淨利 → 黃燈` };
    case 'auditor_change':
      return { en: `Any change of audit firm in ${years} years → amber`, zh: `${years} 年內更換會計師事務所 → 黃燈` };
    case 'going_concern':
      return { en: 'Present → red', zh: '出現 → 紅燈' };
    case 'restatement':
      return { en: `Any in ${years} years → red`, zh: `${years} 年內有 → 紅燈` };
    case 'governance_rating':
      return { en: `Bottom ${percent(settings.governanceBottomShare, 0)} → amber (Taiwan only)`, zh: `排名後 ${percent(settings.governanceBottomShare, 0)} → 黃燈（僅台股）` };
    case 'environmental_penalties':
      return { en: `Any in ${years} years → amber`, zh: `${years} 年內有 → 黃燈` };
    case 'excluded_business':
      return { en: 'On your exclusion list → red', zh: '在自訂排除清單中 → 紅燈' };
  }
}

const WHY: Record<string, Bilingual> = {
  financial: { en: 'A bank or insurer: its balance sheet fits neither model.', zh: '銀行或保險業：資產負債表不適用此模型。' },
  not_taiwan: { en: 'Taiwan companies only.', zh: '僅適用台股公司。' },
  no_filings: { en: 'No filings yet: the nightly job loads them.', zh: '尚無財報：每夜排程會載入。' },
  no_prior_year: { en: 'Needs the same quarter a year before (or three years of them).', zh: '需要前一年同季的財報（現金流需三年）。' },
  missing: { en: 'The filings miss some figures.', zh: '財報缺少部分數字。' },
  no_feed: { en: 'No feed covers it: type what you found below.', zh: '沒有資料來源：請在下方輸入你查到的結果。' },
  empty_list: { en: 'Your exclusion list is empty.', zh: '排除清單目前是空的。' },
};

/** Why an indicator has no level, or a note on what it read. */
export function whyText(row: IndicatorResult): Bilingual | undefined {
  if (!row.why) return undefined;
  const base = WHY[row.why] ?? { en: row.why, zh: row.why };
  if (row.why === 'missing' && row.missing?.length) return { en: `${base.en} (${row.missing.join(', ')})`, zh: `${base.zh}（${row.missing.join('、')}）` };
  return base;
}

/** "AAPL: green → amber since 2026-10-14 · Altman Z-Score". */
export function flagLine(row: { ticker: string; before: Level | null; light: Level; since: string; fired: readonly Indicator[] }): Bilingual {
  const from = row.before ? lightText(row.before) : { en: 'first scan', zh: '首次掃描' };
  const to = lightText(row.light);
  const fired = row.fired.map((indicator) => INDICATOR[indicator]);
  const list = fired.length > 0 ? { en: ` · ${fired.map((name) => name.en).join(', ')}`, zh: ` · ${fired.map((name) => name.zh).join('、')}` } : { en: '', zh: '' };
  return { en: `${row.ticker}: ${from.en.toLowerCase()} → ${to.en.toLowerCase()} since ${row.since}${list.en}`, zh: `${row.ticker}：${from.zh} → ${to.zh}，自 ${row.since}${list.zh}` };
}
