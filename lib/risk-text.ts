/**
 * The N4 VaR card's wording, in English and Traditional Chinese, from config var: the confidence,
 * the card's horizon and the 1-month toggle (PRD: "95% 1-week VaR: NT$X (Y% of portfolio)" and
 * "In about 1 week in 20, losses could exceed this.").
 */
import type { Bilingual } from './i18n';
import { oneIn, type RiskSettings } from './models/risk';

/** One choice of the card's toggle. */
export interface Horizon {
  /** 1 for the card's week, 4.33 for the month (config var). */
  weeks: number;
  /** The toggle's label: "1 week". */
  tab: Bilingual;
  /** "95% 1-week VaR". */
  label: Bilingual;
  /** "In about 1 week in 20, losses could exceed this." */
  note: Bilingual;
}

/** 0.95 → "95%", 0.975 → "97.5%". */
export function confidenceText(confidence: number): string {
  return `${Number((confidence * 100).toFixed(1))}%`;
}

const NUMBER_ZH = ['', '一', '兩', '三', '四'];

/** The card's horizon in weeks, then the month: 1 week and 1 month as seeded. */
export function riskHorizons(settings: RiskSettings): Horizon[] {
  const level = confidenceText(settings.confidence);
  const n = oneIn(settings.confidence);
  const weeks = settings.horizonWeeks;
  const single = weeks === 1;
  const zhWeeks = NUMBER_ZH[weeks] ?? String(weeks);
  return [
    {
      weeks,
      tab: { en: single ? '1 week' : `${weeks} weeks`, zh: `${weeks} 週` },
      label: { en: `${level} ${weeks}-week VaR`, zh: `${level} ${zhWeeks}週風險值` },
      note: single
        ? { en: `In about 1 week in ${n}, losses could exceed this.`, zh: `每 ${n} 週約有 1 週，損失可能超過此金額。` }
        : { en: `In about 1 in ${n} such ${weeks}-week periods, losses could exceed this.`, zh: `每 ${n} 個 ${weeks} 週期間約有 1 個，損失可能超過此金額。` },
    },
    {
      weeks: settings.monthWeeks,
      tab: { en: '1 month', zh: '1 個月' },
      label: { en: `${level} 1-month VaR`, zh: `${level} 一個月風險值` },
      note: { en: `In about 1 month in ${n}, losses could exceed this.`, zh: `每 ${n} 個月約有 1 個月，損失可能超過此金額。` },
    },
  ];
}
