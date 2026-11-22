/**
 * F12 valuation workbench: a stock's assumptions, the settings and the forward P/E consensus.
 */
import { isIsoDate } from '../dates';
import type { Bilingual } from '../i18n';
import { finish, MESSAGES, oneOf, optionalRate, parseNumber, previouslyChecked, ratePercent, text, wholeIn, type FieldErrors, type Parsed, type RawForm } from './core';

// ---------------------------------------------------------------------------
// F12 valuation workbench
// ---------------------------------------------------------------------------

type ScenarioKey = 'bear' | 'base' | 'bull';

const SCENARIO_KEYS: readonly ScenarioKey[] = ['bear', 'base', 'bull'];

type ValuationModel = 'dcf' | 'ddm' | 'multiples';

const VALUATION_MODELS: readonly ValuationModel[] = ['dcf', 'ddm', 'multiples'];

/** Each scenario's rate from `${prefix}_bear` and so on, in percent, in order bear to bull. */
function scenarioRates(raw: RawForm, prefix: string, min: number, max: number, message: Bilingual, errors: FieldErrors<string>): Record<ScenarioKey, number> {
  const out = {} as Record<ScenarioKey, number>;
  for (const scenario of SCENARIO_KEYS) {
    const value = ratePercent(raw[`${prefix}_${scenario}`], min, max);
    if (value === undefined) errors[`${prefix}_${scenario}`] = message;
    out[scenario] = value ?? 0;
  }
  if (!errors[`${prefix}_bear`] && !errors[`${prefix}_base`] && !errors[`${prefix}_bull`] && (out.bear > out.base || out.base > out.bull)) errors[`${prefix}_base`] = MESSAGES.scenarioOrder;
  return out;
}

/** An optional figure typed in millions: blank is null. */
function optionalMillions(raw: string | undefined, positive: boolean): number | null | undefined {
  if (text(raw) === '') return null;
  const value = parseNumber(raw);
  if (value === undefined || (positive && value <= 0)) return undefined;
  return Math.round(value * 1e6);
}

export interface AssumptionsInput {
  active: boolean;
  buy: number | null;
  trim: number | null;
  assumptions: {
    model: ValuationModel;
    years: number;
    growth: Record<ScenarioKey, number>;
    terminal: Record<ScenarioKey, number>;
    overrides: { fcff?: number; netDebt?: number; shares?: number; taxRate?: number; costOfDebt?: number };
    peers: string[];
  };
}

/** A stock's assumptions on its Valuation page; FCFF, net debt and shares in millions of the reporting currency. */
export function parseAssumptionsForm(raw: RawForm, stocks: readonly string[], self: string): Parsed<AssumptionsInput, string> {
  const errors: FieldErrors<string> = {};
  const model = oneOf(raw['model'], VALUATION_MODELS);
  if (!model) errors['model'] = MESSAGES.choice;
  const years = wholeIn(raw['years'], 1, 20);
  if (years === undefined) errors['years'] = MESSAGES.forecastYears;
  const growth = scenarioRates(raw, 'growth', -20, 40, MESSAGES.growth, errors);
  const terminal = scenarioRates(raw, 'terminal', -2, 6, MESSAGES.terminal, errors);
  const overrides: AssumptionsInput['assumptions']['overrides'] = {};
  for (const [field, positive] of [['fcff', true], ['netDebt', false], ['shares', true]] as const) {
    const value = optionalMillions(raw[field], positive);
    if (value === undefined) errors[field] = positive ? MESSAGES.positiveMillions : MESSAGES.millions;
    else if (value !== null) overrides[field] = value;
  }
  for (const field of ['taxRate', 'costOfDebt'] as const) {
    const value = optionalRate(raw[field], 0, 60);
    if (value === undefined) errors[field] = MESSAGES.optionalRate;
    else if (value !== null) overrides[field] = value;
  }
  const peers = [...new Set(text(raw['peers']).toUpperCase().split(/[,\s，、]+/).filter(Boolean))];
  if (peers.length > 8 || peers.some((peer) => peer === self || !stocks.includes(peer))) errors['peers'] = MESSAGES.peers;
  const multiple = (field: string, check: (value: number) => boolean, message: Bilingual): number | null => {
    if (text(raw[field]) === '') return null;
    const value = parseNumber(raw[field]);
    if (value === undefined || !check(value)) {
      errors[field] = message;
      return null;
    }
    return value;
  };
  const buy = multiple('buy', (value) => value > 0 && value < 1, MESSAGES.buyMultiple);
  const trim = multiple('trim', (value) => value > 1 && value <= 5, MESSAGES.trimMultiple);
  return finish(errors, () => ({
    active: raw['active'] === 'on',
    buy,
    trim,
    assumptions: { model: model ?? 'dcf', years: years ?? 5, growth, terminal, overrides, peers },
  }));
}

export interface ValuationSettingsInput {
  model: ValuationModel;
  years: number;
  growth: Record<ScenarioKey, number>;
  terminal: Record<ScenarioKey, number>;
  debtSpread: number;
  taxRate: Record<string, number>;
  historyYears: number;
  minQuarters: number;
  checked: string | null;
}

/** config valuation: the defaults a stock starts from. */
export function parseValuationSettingsForm(raw: RawForm, markets: readonly string[], today: string): Parsed<ValuationSettingsInput, string> {
  const errors: FieldErrors<string> = {};
  const model = oneOf(raw['model'], VALUATION_MODELS);
  if (!model) errors['model'] = MESSAGES.choice;
  const years = wholeIn(raw['years'], 1, 20);
  if (years === undefined) errors['years'] = MESSAGES.forecastYears;
  const growth = scenarioRates(raw, 'growth', -20, 40, MESSAGES.growth, errors);
  const terminal = scenarioRates(raw, 'terminal', -2, 6, MESSAGES.terminal, errors);
  const debtSpread = ratePercent(raw['debtSpread'], 0, 20);
  if (debtSpread === undefined) errors['debtSpread'] = MESSAGES.premium;
  const taxRate: Record<string, number> = {};
  for (const market of markets) {
    const value = ratePercent(raw[`tax_${market}`], 0, 60);
    if (value === undefined) errors[`tax_${market}`] = MESSAGES.optionalRate;
    taxRate[market] = value ?? 0;
  }
  const historyYears = wholeIn(raw['historyYears'], 1, 10);
  if (historyYears === undefined) errors['historyYears'] = MESSAGES.historyYears;
  const minQuarters = wholeIn(raw['minQuarters'], 1, 40);
  if (minQuarters === undefined) errors['minQuarters'] = MESSAGES.quarters;
  return finish(errors, () => ({
    model: model ?? 'dcf',
    years: years ?? 5,
    growth,
    terminal,
    debtSpread: debtSpread ?? 0,
    taxRate,
    historyYears: historyYears ?? 5,
    minQuarters: minQuarters ?? 8,
    checked: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

// ---------------------------------------------------------------------------
// F12 forward P/E: the analysts' consensus typed in (Taiwan has no free feed)
// ---------------------------------------------------------------------------

export type EstimatesField = 'fy1_end' | 'fy1_eps' | 'fy1_high' | 'fy1_low' | 'fy2_end' | 'fy2_eps' | 'analysts' | 'target';

export interface EstimatesInput {
  years: Array<{ periodEnd: string; mean: number; high?: number; low?: number; analysts?: number }>;
  targetPrice?: number;
}

const ESTIMATE_MESSAGES = {
  eps: { en: 'Enter the EPS, e.g. 45.2 (a loss with a minus sign).', zh: '請輸入每股盈餘，例如 45.2（虧損請加負號）。' },
  order: { en: 'The second fiscal year must end after the first.', zh: '第二個會計年度須在第一個之後結束。' },
  both: { en: 'Give the second year its end and its EPS, or neither.', zh: '第二個會計年度的結束日與 EPS 請一起填，或都不填。' },
  range: { en: 'Keep low ≤ mean ≤ high.', zh: '請保持最低 ≤ 平均 ≤ 最高。' },
  analysts: { en: 'Enter a whole number of analysts from 1 to 200.', zh: '請輸入 1 到 200 之間的整數分析師人數。' },
} satisfies Record<string, Bilingual>;

/** The consensus form on a stock's Valuation page: one or two fiscal years, the analysts and the target price. */
export function parseEstimatesForm(raw: RawForm): Parsed<EstimatesInput, EstimatesField> {
  const errors: FieldErrors<EstimatesField> = {};
  const text = (key: EstimatesField) => (raw[key] ?? '').trim();
  const number = (key: EstimatesField, message: Bilingual, check: (n: number) => boolean = Number.isFinite) => {
    const value = text(key);
    if (value === '') return undefined;
    const n = Number(value.replace(/,/g, ''));
    if (!Number.isFinite(n) || !check(n)) {
      errors[key] = message;
      return undefined;
    }
    return n;
  };
  const date = (key: EstimatesField, required: boolean) => {
    const value = text(key);
    if (value === '') {
      if (required) errors[key] = MESSAGES.required;
      return undefined;
    }
    if (!isIsoDate(value)) {
      errors[key] = MESSAGES.date;
      return undefined;
    }
    return value;
  };
  const fy1End = date('fy1_end', true);
  const fy1Eps = number('fy1_eps', ESTIMATE_MESSAGES.eps);
  if (text('fy1_eps') === '') errors.fy1_eps = MESSAGES.required;
  const high = number('fy1_high', ESTIMATE_MESSAGES.eps);
  const low = number('fy1_low', ESTIMATE_MESSAGES.eps);
  if (fy1Eps !== undefined && ((high !== undefined && high < fy1Eps) || (low !== undefined && low > fy1Eps))) errors[high !== undefined && high < fy1Eps ? 'fy1_high' : 'fy1_low'] = ESTIMATE_MESSAGES.range;
  const fy2End = date('fy2_end', false);
  const fy2Eps = number('fy2_eps', ESTIMATE_MESSAGES.eps);
  if ((text('fy2_end') === '') !== (text('fy2_eps') === '')) errors[text('fy2_end') === '' ? 'fy2_end' : 'fy2_eps'] = ESTIMATE_MESSAGES.both;
  else if (fy1End && fy2End && fy2End <= fy1End) errors.fy2_end = ESTIMATE_MESSAGES.order;
  const analysts = number('analysts', ESTIMATE_MESSAGES.analysts, (n) => Number.isInteger(n) && n >= 1 && n <= 200);
  const targetPrice = number('target', MESSAGES.positive, (n) => n > 0);
  if (Object.keys(errors).length > 0 || !fy1End || fy1Eps === undefined) return { ok: false, errors };
  const years: EstimatesInput['years'] = [{ periodEnd: fy1End, mean: fy1Eps, ...(high !== undefined ? { high } : {}), ...(low !== undefined ? { low } : {}), ...(analysts !== undefined ? { analysts } : {}) }];
  if (fy2End && fy2Eps !== undefined) years.push({ periodEnd: fy2End, mean: fy2Eps, ...(analysts !== undefined ? { analysts } : {}) });
  return { ok: true, value: { years, ...(targetPrice !== undefined ? { targetPrice } : {}) } };
}
