/**
 * F12's forward P/E check (added 2026-11-04): today's trailing P/E against the forward P/E on the
 * analysts' consensus EPS, set beside the company's own five-year P/E and its expected growth, so
 * a buy can be weighed on what the market's analysts expect next. Display only: no rule, no push;
 * F12's buy and trim zones stay the alerts. Thresholds come from config pe_check.
 *
 *   NTM EPS = w × FY1 + (1 − w) × FY2,  w = days left to FY1's end ÷ 365
 *   Forward P/E = price ÷ NTM EPS;  PEG = forward P/E ÷ (growth × 100),  growth = NTM ÷ TTM − 1
 *   Price at the own median = own five-year median P/E × NTM EPS
 */
import { daysBetween } from '../dates';

/** One fiscal year's consensus EPS, as the nightly job saves it (Alpha Vantage EARNINGS_ESTIMATES) or Hugo types it. */
export interface YearEstimate {
  /** The fiscal year's last day. */
  periodEnd: string;
  mean: number;
  high?: number;
  low?: number;
  analysts?: number;
  /** The mean 30 days ago, for the trend of revisions. */
  mean30?: number;
  up30?: number;
  down30?: number;
}

export interface Ratings {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface Estimates {
  asOf: string;
  source: string;
  /** The currency of the EPS, which must be the price's. */
  currency: string;
  years: YearEstimate[];
  targetPrice?: number;
  ratings?: Ratings;
}

export interface PeCheckSettings {
  /** Forward P/E this far below the own median P/E reads cheap (0.15: 15% below). */
  cheapDiscount: number;
  /** And this far above, rich. */
  richPremium: number;
  /** PEG at or below this reads cheap for its growth. */
  pegCheap: number;
  /** PEG at or above this reads rich for its growth. */
  pegRich: number;
  /** A move of the consensus over 30 days within this band reads flat. */
  revisionBand: number;
  /** Fewer analysts than this: the consensus is thin and the verdict stays neutral. */
  minAnalysts: number;
  /** Signals' score at or above which the verdict is attractive, at or below minus it expensive. */
  score: number;
  /** Estimates older than this many days are stale. */
  staleDays: number;
  /** Days between two loads of a stock's estimates by the nightly job (Alpha Vantage allows 25 requests a day). */
  refreshDays: number;
}

/** config pe_check as seeded. */
export const PE_CHECK_DEFAULTS: PeCheckSettings = { cheapDiscount: 0.15, richPremium: 0.15, pegCheap: 1, pegRich: 2, revisionBand: 0.01, minAnalysts: 3, score: 2, staleDays: 45, refreshDays: 7 };

/** Reads config pe_check; a missing or malformed field keeps its default. */
export function readPeCheckSettings(value: unknown): PeCheckSettings {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const num = (key: string, fallback: number, min: number, max: number) => {
    const found = raw[key];
    return typeof found === 'number' && Number.isFinite(found) && found >= min && found <= max ? found : fallback;
  };
  const d = PE_CHECK_DEFAULTS;
  return {
    cheapDiscount: num('cheap_discount', d.cheapDiscount, 0, 0.9),
    richPremium: num('rich_premium', d.richPremium, 0, 5),
    pegCheap: num('peg_cheap', d.pegCheap, 0, 10),
    pegRich: num('peg_rich', d.pegRich, 0, 10),
    revisionBand: num('revision_band', d.revisionBand, 0, 0.5),
    minAnalysts: num('min_analysts', d.minAnalysts, 0, 100),
    score: num('score', d.score, 1, 4),
    staleDays: num('stale_days', d.staleDays, 1, 365),
    refreshDays: num('refresh_days', d.refreshDays, 1, 90),
  };
}

/** The next twelve months' EPS from the two fiscal years after today: each weighted by its share of the coming year. */
export interface Blend {
  eps: number;
  high?: number;
  low?: number;
  /** The consensus 30 days ago, blended alike. */
  eps30?: number;
  /** FY1's weight. */
  weight: number;
  fy1: YearEstimate;
  fy2?: YearEstimate;
  analysts?: number;
  up30: number;
  down30: number;
}

export function nextTwelveMonths(years: readonly YearEstimate[], today: string): Blend | undefined {
  const ahead = years.filter((year) => year.periodEnd > today && Number.isFinite(year.mean)).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const fy1 = ahead[0];
  if (!fy1) return undefined;
  const fy2 = ahead[1];
  const weight = fy2 ? Math.min(1, daysBetween(today, fy1.periodEnd) / 365) : 1;
  const mix = (a: number | undefined, b: number | undefined) => (a === undefined ? undefined : fy2 === undefined ? a : b === undefined ? undefined : weight * a + (1 - weight) * b);
  const high = mix(fy1.high, fy2?.high);
  const low = mix(fy1.low, fy2?.low);
  const eps30 = mix(fy1.mean30, fy2?.mean30);
  const counts = [fy1.analysts, fy2?.analysts].filter((n): n is number => n !== undefined);
  return {
    eps: mix(fy1.mean, fy2?.mean) as number,
    ...(high !== undefined ? { high } : {}),
    ...(low !== undefined ? { low } : {}),
    ...(eps30 !== undefined ? { eps30 } : {}),
    weight,
    fy1,
    ...(fy2 ? { fy2 } : {}),
    ...(counts.length > 0 ? { analysts: Math.min(...counts) } : {}),
    up30: (fy1.up30 ?? 0) + (fy2?.up30 ?? 0),
    down30: (fy1.down30 ?? 0) + (fy2?.down30 ?? 0),
  };
}

export type SignalId = 'history' | 'peers' | 'peg' | 'revisions' | 'target';
export type Tone = 'good' | 'bad' | 'neutral';

export interface Signal {
  id: SignalId;
  tone: Tone;
  /** The figure the signal reads: the discount to the own median, the PEG, the 30-day move, the target's upside. */
  value: number;
}

export type Verdict = 'attractive' | 'neutral' | 'expensive';

export interface PeCheck {
  price: number;
  trailingPe?: number;
  forwardPe?: number;
  /** The forward P/E at the most bullish analyst's EPS (lowest) and the most bearish (highest). */
  forwardRange?: { low: number; high: number };
  blend?: Blend;
  /** NTM ÷ TTM − 1. */
  growth?: number;
  peg?: number;
  /** The P/E the forward one is set against: the own five-year median, else the peers' median. */
  reference?: { pe: number; from: 'own' | 'peers' };
  /** Forward P/E ÷ reference − 1. */
  discount?: number;
  /** The reference P/E × NTM EPS, and its upside from the price. */
  fairPrice?: number;
  fairUpside?: number;
  targetUpside?: number;
  signals: Signal[];
  score: number;
  verdict: Verdict;
  /** Why the verdict cannot lean either way. */
  caveats: Array<'no_estimates' | 'loss' | 'thin' | 'stale' | 'currency'>;
}

export interface PeCheckInput {
  price: number;
  priceCurrency: string;
  /** The trailing twelve months' EPS from the filings (undefined when not positive). */
  ttmEps?: number;
  /** The own five-year P/E range's median, and the peers' median (F12's multiples). */
  ownMedianPe?: number;
  peersPe?: number;
  estimates?: Estimates;
  today: string;
}

export function peCheck(input: PeCheckInput, settings: PeCheckSettings): PeCheck {
  const { price, estimates } = input;
  const caveats: PeCheck['caveats'] = [];
  const trailingPe = input.ttmEps !== undefined && input.ttmEps > 0 ? price / input.ttmEps : undefined;
  const base = { price, ...(trailingPe !== undefined ? { trailingPe } : {}) };
  if (!estimates) return { ...base, signals: [], score: 0, verdict: 'neutral', caveats: ['no_estimates'] };
  if (estimates.currency !== input.priceCurrency) return { ...base, signals: [], score: 0, verdict: 'neutral', caveats: ['currency'] };
  const blend = nextTwelveMonths(estimates.years, input.today);
  if (!blend) return { ...base, signals: [], score: 0, verdict: 'neutral', caveats: ['no_estimates'] };
  if (daysBetween(estimates.asOf, input.today) > settings.staleDays) caveats.push('stale');
  if (blend.analysts !== undefined && blend.analysts < settings.minAnalysts) caveats.push('thin');
  if (blend.eps <= 0) return { ...base, blend, signals: [], score: 0, verdict: 'neutral', caveats: [...caveats, 'loss'] };

  const forwardPe = price / blend.eps;
  const forwardRange = blend.high !== undefined && blend.low !== undefined && blend.high > 0 && blend.low > 0 ? { low: price / blend.high, high: price / blend.low } : undefined;
  const growth = input.ttmEps !== undefined && input.ttmEps > 0 ? blend.eps / input.ttmEps - 1 : undefined;
  const peg = growth !== undefined && growth > 0 ? forwardPe / (growth * 100) : undefined;
  const reference = input.ownMedianPe !== undefined && input.ownMedianPe > 0 ? { pe: input.ownMedianPe, from: 'own' as const } : input.peersPe !== undefined && input.peersPe > 0 ? { pe: input.peersPe, from: 'peers' as const } : undefined;
  const discount = reference ? forwardPe / reference.pe - 1 : undefined;
  const fairPrice = reference ? reference.pe * blend.eps : undefined;
  const targetUpside = estimates.targetPrice !== undefined && estimates.targetPrice > 0 ? estimates.targetPrice / price - 1 : undefined;

  const signals: Signal[] = [];
  if (reference && discount !== undefined) {
    signals.push({ id: reference.from === 'own' ? 'history' : 'peers', tone: discount <= -settings.cheapDiscount ? 'good' : discount >= settings.richPremium ? 'bad' : 'neutral', value: discount });
  }
  if (growth !== undefined) {
    // No growth, or a fall, makes any P/E rich for its growth.
    const value = peg ?? Number.POSITIVE_INFINITY;
    signals.push({ id: 'peg', tone: value <= settings.pegCheap ? 'good' : value >= settings.pegRich ? 'bad' : 'neutral', value });
  }
  if (blend.eps30 !== undefined && blend.eps30 > 0) {
    const move = blend.eps / blend.eps30 - 1;
    signals.push({ id: 'revisions', tone: move > settings.revisionBand ? 'good' : move < -settings.revisionBand ? 'bad' : 'neutral', value: move });
  }
  // The analysts' target only informs: it is the same people's view of the price, so it does not score.
  if (targetUpside !== undefined) signals.push({ id: 'target', tone: 'neutral', value: targetUpside });

  const score = signals.reduce((sum, signal) => sum + (signal.tone === 'good' ? 1 : signal.tone === 'bad' ? -1 : 0), 0);
  const leaning: Verdict = score >= settings.score ? 'attractive' : score <= -settings.score ? 'expensive' : 'neutral';
  const verdict = caveats.includes('thin') || caveats.includes('stale') ? 'neutral' : leaning;
  return {
    ...base,
    forwardPe,
    ...(forwardRange ? { forwardRange } : {}),
    blend,
    ...(growth !== undefined ? { growth } : {}),
    ...(peg !== undefined ? { peg } : {}),
    ...(reference ? { reference } : {}),
    ...(discount !== undefined ? { discount } : {}),
    ...(fairPrice !== undefined ? { fairPrice, fairUpside: fairPrice / price - 1 } : {}),
    ...(targetUpside !== undefined ? { targetUpside } : {}),
    signals,
    score,
    verdict,
    caveats,
  };
}

/** Whether the nightly job should load a stock's estimates again. */
export function estimatesDue(lastAsOf: string | undefined, today: string, settings: PeCheckSettings): boolean {
  return lastAsOf === undefined || daysBetween(lastAsOf, today) >= settings.refreshDays;
}

/** Reads a saved estimates row's jsonb; undefined when it holds no usable year. */
export function readEstimates(row: { as_of: string; source: string; currency: string; estimates: unknown }): Estimates | undefined {
  const raw = typeof row.estimates === 'object' && row.estimates !== null ? (row.estimates as Record<string, unknown>) : {};
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const years = (Array.isArray(raw['years']) ? raw['years'] : []).flatMap((entry): YearEstimate[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const year = entry as Record<string, unknown>;
    const mean = num(year['mean']);
    const periodEnd = typeof year['periodEnd'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(year['periodEnd']) ? year['periodEnd'] : undefined;
    if (mean === undefined || !periodEnd) return [];
    const out: YearEstimate = { periodEnd, mean };
    for (const key of ['high', 'low', 'analysts', 'mean30', 'up30', 'down30'] as const) {
      const value = num(year[key]);
      if (value !== undefined) out[key] = value;
    }
    return [out];
  });
  if (years.length === 0) return undefined;
  const target = num(raw['targetPrice']);
  const r = typeof raw['ratings'] === 'object' && raw['ratings'] !== null ? (raw['ratings'] as Record<string, unknown>) : undefined;
  const ratings = r ? { strongBuy: num(r['strongBuy']) ?? 0, buy: num(r['buy']) ?? 0, hold: num(r['hold']) ?? 0, sell: num(r['sell']) ?? 0, strongSell: num(r['strongSell']) ?? 0 } : undefined;
  return { asOf: row.as_of, source: row.source, currency: row.currency, years, ...(target !== undefined ? { targetPrice: target } : {}), ...(ratings ? { ratings } : {}) };
}
