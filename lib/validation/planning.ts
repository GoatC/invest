/**
 * Life planning forms: the F2 plan, F3 windfall settings and pace, F5 Monte Carlo, F1 goals.
 */
import { isIsoDate, isMonth } from '../dates';
import type { McSettings } from '../models/monte-carlo';
import type { SavedPlan } from '../models/projection';
import { MAX_GOALS, type Goal, type TimelineSettings } from '../models/timeline';
import { finish, MESSAGES, parseNumber, percentField, ratePercent, text, wholeTwd, type FieldErrors, type Parsed, type RawForm } from './core';

// ---------------------------------------------------------------------------
// F2 compounding plan (calculator fields)
// ---------------------------------------------------------------------------

export type PlanField = keyof SavedPlan;

/** The calculator's inputs: amounts in TWD, rates in percent, whole years. */
export function parsePlanForm(raw: RawForm): Parsed<SavedPlan, PlanField> {
  const errors: FieldErrors<PlanField> = {};
  const start = text(raw['start']);
  if (!isMonth(start)) errors.start = MESSAGES.month;
  const pv = parseNumber(raw['pv']);
  if (pv === undefined || pv < 0) errors.pv = MESSAGES.nonNegative;
  const pmt = parseNumber(raw['pmt']);
  if (pmt === undefined || pmt < 0) errors.pmt = MESSAGES.nonNegative;
  const stepUp = percentField(raw['stepUp'], 0, 30);
  if (stepUp === undefined) errors.stepUp = MESSAGES.stepUp;
  const expectedReturn = percentField(raw['expectedReturn'], -50, 50);
  if (expectedReturn === undefined) errors.expectedReturn = MESSAGES.expectedReturn;
  const inflation = percentField(raw['inflation'], -5, 20);
  if (inflation === undefined) errors.inflation = MESSAGES.inflation;
  const years = parseNumber(raw['years']);
  if (years === undefined || !Number.isInteger(years) || years < 1 || years > 60) errors.years = MESSAGES.years;
  return finish(errors, () => ({
    start,
    pv: pv ?? 0,
    pmt: pmt ?? 0,
    stepUp: stepUp ?? 0,
    expectedReturn: expectedReturn ?? 0,
    inflation: inflation ?? 0,
    years: years ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// F3 windfall planner (Windfall page): the plan's start, its settings, the pace and the tiers
// ---------------------------------------------------------------------------

export interface PlanStartInput {
  totalTwd: number;
  startDate: string;
}

/** The windfall to deploy, in whole NT$, and the day the first tranche falls due. */
export function parsePlanStart(raw: RawForm): Parsed<PlanStartInput, 'totalTwd' | 'startDate'> {
  const errors: FieldErrors<'totalTwd' | 'startDate'> = {};
  const totalTwd = parseNumber(raw['totalTwd']);
  if (totalTwd === undefined || !Number.isInteger(totalTwd) || totalTwd <= 0) errors.totalTwd = MESSAGES.positiveWholeTwd;
  const startDate = text(raw['startDate']);
  if (!isIsoDate(startDate)) errors.startDate = MESSAGES.date;
  return finish(errors, () => ({ totalTwd: totalTwd ?? 0, startDate }));
}

/** Field name of a core class's windfall vehicle. */
export function vehicleField(classId: string): string {
  return `vehicle_${classId}`;
}

export interface WindfallSettingsInput {
  vehicles: Record<string, string>;
  cashReturn: number;
  fromYear: number;
  horizonMonths: number;
}

/** Each core class's windfall vehicle (blank: its benchmark; else one of its securities), and the backtest's settings. */
export function parseWindfallSettingsForm(raw: RawForm, classes: ReadonlyMap<string, readonly string[]>): Parsed<WindfallSettingsInput, string> {
  const errors: FieldErrors<string> = {};
  const vehicles: Record<string, string> = {};
  for (const [classId, tickers] of classes) {
    const ticker = text(raw[vehicleField(classId)]);
    if (ticker === '') continue;
    if (!tickers.includes(ticker)) errors[vehicleField(classId)] = MESSAGES.choice;
    else vehicles[classId] = ticker;
  }
  const cashReturn = ratePercent(raw['cashReturn'], -10, 20);
  if (cashReturn === undefined) errors['cashReturn'] = MESSAGES.cashReturn;
  const fromYear = parseNumber(raw['fromYear']);
  if (fromYear === undefined || !Number.isInteger(fromYear) || fromYear < 1871 || fromYear > 2100) errors['fromYear'] = MESSAGES.fromYear;
  const horizonMonths = parseNumber(raw['horizonMonths']);
  if (horizonMonths === undefined || !Number.isInteger(horizonMonths) || horizonMonths < 12 || horizonMonths > 240) errors['horizonMonths'] = MESSAGES.horizonMonths;
  return finish(errors, () => ({ vehicles, cashReturn: cashReturn ?? 0, fromYear: fromYear ?? 1900, horizonMonths: horizonMonths ?? 60 }));
}

export const PACE_FIELDS = ['cutLow', 'cutHigh', 'tranchesLow', 'tranchesMid', 'tranchesHigh', 'tier1', 'tier2', 'tier2Share', 'tier3', 'tier3Share'] as const;

export type PaceField = (typeof PACE_FIELDS)[number];

export interface PaceInput {
  cutoffs: [number, number];
  tranches: [number, number, number];
  /** Three tiers, shallowest first: the first pulls the next tranche forward, the others deploy a share of the cash waiting. */
  tiers: [{ drawdown: number }, { drawdown: number; share: number }, { drawdown: number; share: number }];
}

/** The pace's CAPE cutoffs (percentiles) and tranche counts, and the three acceleration tiers in percent. */
export function parsePaceForm(raw: RawForm): Parsed<PaceInput, PaceField> {
  const errors: FieldErrors<PaceField> = {};
  const percentile = (name: PaceField) => {
    const value = parseNumber(raw[name]);
    if (value === undefined || value < 0 || value > 100) errors[name] = MESSAGES.percentile;
    return value ?? 0;
  };
  const count = (name: PaceField) => {
    const value = parseNumber(raw[name]);
    if (value === undefined || !Number.isInteger(value) || value < 1 || value > 120) errors[name] = MESSAGES.trancheCount;
    return value ?? 1;
  };
  const share = (name: PaceField, max: number) => {
    const value = ratePercent(raw[name], 0, max);
    if (value === undefined || value <= 0) errors[name] = max < 100 ? MESSAGES.drawdown : MESSAGES.share;
    return value ?? 0;
  };
  const cutLow = percentile('cutLow');
  const cutHigh = percentile('cutHigh');
  if (!errors.cutLow && !errors.cutHigh && cutHigh < cutLow) errors.cutHigh = MESSAGES.ascending;
  const tranches: [number, number, number] = [count('tranchesLow'), count('tranchesMid'), count('tranchesHigh')];
  const tier1 = share('tier1', 99);
  const tier2 = share('tier2', 99);
  const tier3 = share('tier3', 99);
  if (!errors.tier1 && !errors.tier2 && tier2 <= tier1) errors.tier2 = MESSAGES.ascending;
  if (!errors.tier2 && !errors.tier3 && tier3 <= tier2) errors.tier3 = MESSAGES.ascending;
  const tier2Share = share('tier2Share', 100);
  const tier3Share = share('tier3Share', 100);
  return finish(errors, () => ({
    cutoffs: [cutLow, cutHigh],
    tranches,
    tiers: [{ drawdown: tier1 }, { drawdown: tier2, share: tier2Share }, { drawdown: tier3, share: tier3Share }],
  }));
}

// ---------------------------------------------------------------------------
// Monte Carlo (F5)
// ---------------------------------------------------------------------------

export type McField = 'target' | 'windfallAmount' | 'windfallMonth' | 'windfallTranches';

/** config monte_carlo's goal in today's money and the expected windfall; the rest of the row stays as it is. */
export function parseMonteCarloForm(raw: RawForm, current: McSettings): Parsed<McSettings, McField> {
  const errors: FieldErrors<McField> = {};
  const blank = (name: string) => text(raw[name]) === '';
  let target: number | null = null;
  if (!blank('target')) {
    const value = wholeTwd(raw['target']);
    if (value === undefined || value <= 0) errors.target = MESSAGES.mcTarget;
    else target = value;
  }
  let amount: number | null = null;
  if (!blank('windfallAmount')) {
    const value = wholeTwd(raw['windfallAmount']);
    if (value === undefined || value <= 0) errors.windfallAmount = MESSAGES.mcWindfallAmount;
    else amount = value;
  }
  const month = text(raw['windfallMonth']);
  if (amount !== null && !isMonth(month)) errors.windfallMonth = MESSAGES.mcWindfallMonth;
  if (amount === null && month !== '' && !isMonth(month)) errors.windfallMonth = MESSAGES.mcWindfallMonth;
  // Blank follows F3's pace at today's CAPE percentile.
  const tranches = blank('windfallTranches') ? null : parseNumber(raw['windfallTranches']);
  if (tranches !== null && (tranches === undefined || !Number.isInteger(tranches) || tranches < 1 || tranches > 120)) errors.windfallTranches = MESSAGES.trancheCount;
  return finish(errors, () => ({
    ...current,
    targetTwd: target,
    windfall: { amountTwd: amount, month: isMonth(month) ? month : null, tranches: tranches ?? null },
  }));
}

// ---------------------------------------------------------------------------
// Life timeline (F1)
// ---------------------------------------------------------------------------

export type TimelineField = 'goals';

/** config timeline: "2045-06 | 3,000,000 | House" per line. */
export function parseTimelineForm(raw: RawForm): Parsed<TimelineSettings, TimelineField> {
  const errors: FieldErrors<TimelineField> = {};
  const goals: Goal[] = [];
  const lines = (raw['goals'] ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_GOALS) errors.goals = MESSAGES.goalCount;
  for (const line of lines) {
    const [month = '', amount = '', ...rest] = line.split('|').map((part) => part.trim());
    const name = rest.join('|').trim();
    const value = amount === '' ? null : wholeTwd(amount);
    if (!isMonth(month) || value === undefined || value === 0 || name === '' || name.length > 60) {
      errors.goals = MESSAGES.goals;
      break;
    }
    goals.push({ month, amountTwd: value, name });
  }
  return finish(errors, () => ({ goals: goals.sort((a, b) => a.month.localeCompare(b.month)) }));
}
