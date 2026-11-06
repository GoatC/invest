/** The volatility page's words (N8): each component's name, what it reads and where from; the score's band. */
import type { Bilingual } from './i18n';
import { COMPONENT_UNIT, type ComponentId, type ReadingStatus } from './models/volatility';

export const COMPONENT_TEXT: Record<ComponentId, { name: Bilingual; source: string }> = {
  vix: { name: { en: 'VIX (S&P 500 options)', zh: 'VIX 恐慌指數（標普 500 選擇權）' }, source: 'CBOE · FRED VIXCLS' },
  vix_term: { name: { en: 'VIX ÷ VIX3M (above 1: inverted)', zh: 'VIX ÷ VIX3M（大於 1 為倒掛）' }, source: 'CBOE · FRED VXVCLS' },
  tw_vix: { name: { en: "Taiwan's VIX", zh: '臺指選擇權波動率指數' }, source: 'TAIFEX 期交所' },
  spx_drawdown: { name: { en: 'S&P 500 below its 52-week high', zh: '標普 500 距 52 週高點跌幅' }, source: 'FinMind · FRED SP500' },
  taiex_drawdown: { name: { en: 'TAIEX below its 52-week high', zh: '加權報酬指數距 52 週高點跌幅' }, source: 'FinMind · TWSE' },
  taiex_fall: { name: { en: 'TAIEX fall over 5 sessions', zh: '加權報酬指數 5 日跌幅' }, source: 'FinMind · TWSE' },
  hy_spread: { name: { en: 'US high-yield spread', zh: '美國高收益債利差' }, source: 'FRED BAMLH0A0HYM2' },
  epu: { name: { en: 'Policy uncertainty (news), 7-day mean', zh: '政策不確定性（新聞），7 日平均' }, source: 'policyuncertainty.com · FRED USEPUINDXD' },
};

export const STATUS_TEXT: Record<ReadingStatus, Bilingual> = {
  ok: { en: 'Counted', zh: '計入' },
  stale: { en: 'Too old', zh: '資料過舊' },
  missing: { en: 'No data', zh: '無資料' },
};

/** A component's figure as it is shown and typed: a fall in percent, a spread in percent a year, an index or ratio as it is. */
export function figureText(id: ComponentId, value: number | null): string {
  if (value === null) return '—';
  switch (COMPONENT_UNIT[id]) {
    case 'share':
      return `${(value * 100).toFixed(1)}%`;
    case 'percent':
      return `${value.toFixed(2)}%`;
    case 'ratio':
      return value.toFixed(3);
    case 'level':
      return value.toFixed(2);
  }
}

/** The figure as the settings form takes it: a fall in percent, the rest as stored. */
export function formFigure(id: ComponentId, value: number): string {
  return String(COMPONENT_UNIT[id] === 'share' ? Number((value * 100).toFixed(4)) : value);
}

/** The unit beside a form's field. */
export function unitText(id: ComponentId): string {
  return COMPONENT_UNIT[id] === 'share' || COMPONENT_UNIT[id] === 'percent' ? '%' : '';
}

/** The score's band, as the alert (step 3) proposes by it: 1–3 calm, 4–5 normal, 6–7 tense, 8–10 panic. */
export function bandOf(score: number): { label: Bilingual; tone: 'ok' | 'none' | 'watch' | 'alert' } {
  if (score < 4) return { label: { en: 'Calm', zh: '平靜' }, tone: 'ok' };
  if (score < 6) return { label: { en: 'Normal', zh: '一般' }, tone: 'none' };
  if (score < 8) return { label: { en: 'Tense', zh: '緊張' }, tone: 'watch' };
  return { label: { en: 'Panic', zh: '恐慌' }, tone: 'alert' };
}
