/**
 * Research settings: N1 Regression Lab and F11 cost of equity.
 */
import { finish, MESSAGES, oneOf, parseNumber, previouslyChecked, ratePercent, type FieldErrors, type Parsed, type RawForm } from './core';

// ---------------------------------------------------------------------------
// N1 Regression Lab
// ---------------------------------------------------------------------------

export const REGRESSION_FIELDS = ['freq', 'windowYears', 'currency', 'blumeWeight', 'rfTWD', 'rfUSD'] as const;

export type RegressionField = (typeof REGRESSION_FIELDS)[number];

export interface RegressionSettingsInput {
  freq: 'daily' | 'weekly' | 'monthly';
  windowYears: number;
  currency: 'local' | 'TWD';
  blumeWeight: number;
  /** Yearly risk-free rates as fractions. */
  riskFree: { TWD: number; USD: number };
  /** Today when "checked today" is ticked, else the date it was checked before. */
  checked: string | null;
}

/** The lab's defaults (the monthly β use them), Blume's weight, and the risk-free rates in percent. */
export function parseRegressionForm(raw: RawForm, windows: readonly number[], today: string): Parsed<RegressionSettingsInput, RegressionField> {
  const errors: FieldErrors<RegressionField> = {};
  const freq = oneOf(raw['freq'], ['daily', 'weekly', 'monthly'] as const);
  if (!freq) errors.freq = MESSAGES.choice;
  const windowYears = parseNumber(raw['windowYears']);
  if (windowYears === undefined || !windows.includes(windowYears)) errors.windowYears = MESSAGES.choice;
  const currency = oneOf(raw['currency'], ['local', 'TWD'] as const);
  if (!currency) errors.currency = MESSAGES.choice;
  const blumeWeight = parseNumber(raw['blumeWeight']);
  if (blumeWeight === undefined || blumeWeight < 0 || blumeWeight > 1) errors.blumeWeight = MESSAGES.blume;
  const twd = ratePercent(raw['rfTWD'], -5, 30);
  if (twd === undefined) errors.rfTWD = MESSAGES.riskFree;
  const usd = ratePercent(raw['rfUSD'], -5, 30);
  if (usd === undefined) errors.rfUSD = MESSAGES.riskFree;
  return finish(errors, () => ({
    freq: freq ?? 'weekly',
    windowYears: windowYears ?? 2,
    currency: currency ?? 'local',
    blumeWeight: blumeWeight ?? 0.67,
    riskFree: { TWD: twd ?? 0, USD: usd ?? 0 },
    checked: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

// ---------------------------------------------------------------------------
// F11 CAPM cost of equity
// ---------------------------------------------------------------------------

export interface CapmSettingsInput {
  beta: 'adjusted' | 'raw';
  erpSource: 'damodaran' | 'manual';
  /** Fractions a year. */
  erpManual: number;
  /** By market: the yield used until its series loads, and the country risk premium. */
  markets: Record<string, { riskFree: number; countryPremium: number }>;
  /** Today when "checked today" is ticked, else the date it was checked before. */
  checked: string | null;
}

/** The cost of equity's settings in percent: the ERP and, per market, the fallback yield (rf_US) and the country premium (crp_US). */
export function parseCapmForm(raw: RawForm, markets: readonly string[], today: string): Parsed<CapmSettingsInput, string> {
  const errors: FieldErrors<string> = {};
  const beta = oneOf(raw['beta'], ['adjusted', 'raw'] as const);
  if (!beta) errors['beta'] = MESSAGES.choice;
  const erpSource = oneOf(raw['erpSource'], ['damodaran', 'manual'] as const);
  if (!erpSource) errors['erpSource'] = MESSAGES.choice;
  const erpManual = ratePercent(raw['erpManual'], 0, 20);
  if (erpManual === undefined || erpManual <= 0) errors['erpManual'] = MESSAGES.premium;
  const values: CapmSettingsInput['markets'] = {};
  for (const market of markets) {
    const riskFree = ratePercent(raw[`rf_${market}`], -5, 30);
    if (riskFree === undefined) errors[`rf_${market}`] = MESSAGES.riskFree;
    const countryPremium = ratePercent(raw[`crp_${market}`], 0, 20);
    if (countryPremium === undefined) errors[`crp_${market}`] = MESSAGES.premium;
    values[market] = { riskFree: riskFree ?? 0, countryPremium: countryPremium ?? 0 };
  }
  return finish(errors, () => ({
    beta: beta ?? 'adjusted',
    erpSource: erpSource ?? 'damodaran',
    erpManual: erpManual ?? 0,
    markets: values,
    checked: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}
