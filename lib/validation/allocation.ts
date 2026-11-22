/**
 * Allocation forms: F6 targets and capital market assumptions, the auto-scored classes, F7's settings.
 */
import type { AutoCmaSettings } from '../models/auto-cma';
import type { FrontierSettings } from '../models/frontier';
import type { AssetClass } from '../models/types';
import { finish, MESSAGES, parseNumber, percentField, previouslyChecked, text, type FieldErrors, type Parsed, type RawForm } from './core';

// ---------------------------------------------------------------------------
// F6: SAA targets and capital market assumptions, one row per asset class
// ---------------------------------------------------------------------------

export interface TargetInput {
  id: string;
  targetWeight: number;
  benchmarkTicker: string | null;
}

/** Fields are named target_<class id> and benchmark_<class id>; `total` carries the sum check. */
export function targetFields(id: string): { target: string; benchmark: string } {
  return { target: `target_${id}`, benchmark: `benchmark_${id}` };
}

/** Every class's target, as a percentage of the regular pool, adding up to 100%, and its benchmark ETF. */
export function parseTargets(raw: RawForm, classes: readonly AssetClass[], tickers: ReadonlySet<string>): Parsed<TargetInput[], string> {
  const errors: FieldErrors<string> = {};
  const rows: TargetInput[] = [];
  for (const assetClass of classes) {
    const names = targetFields(assetClass.id);
    const targetWeight = percentField(raw[names.target], 0, 100);
    if (targetWeight === undefined) errors[names.target] = MESSAGES.percent;
    const benchmark = text(raw[names.benchmark]).toUpperCase();
    if (benchmark && !tickers.has(benchmark)) errors[names.benchmark] = MESSAGES.unknownTicker;
    rows.push({ id: assetClass.id, targetWeight: targetWeight ?? 0, benchmarkTicker: benchmark || null });
  }
  const total = rows.reduce((sum, row) => sum + row.targetWeight, 0);
  if (Object.keys(errors).length === 0 && Math.abs(total - 1) > 1e-9) {
    const shown = `${Number((total * 100).toFixed(2))}%`;
    errors['total'] = { en: `The targets add up to ${shown}; they must add up to 100%.`, zh: `目標合計為 ${shown}，必須剛好是 100%。` };
  }
  return finish(errors, () => rows);
}

export interface AssumptionInput {
  id: string;
  expectedReturn: number;
  volatility: number;
  source: string;
}

/** Fields are named return_<class id>, volatility_<class id> and source_<class id>. */
export function assumptionFields(id: string): { expectedReturn: string; volatility: string; source: string } {
  return { expectedReturn: `return_${id}`, volatility: `volatility_${id}`, source: `source_${id}` };
}

/**
 * Each class's assumptions, in percent: a class left blank has none; one with any of the three
 * filled in needs all of them, the source included (PRD F6: "with a source note").
 */
export function parseAssumptionForm(raw: RawForm, classes: readonly AssetClass[]): Parsed<AssumptionInput[], string> {
  const errors: FieldErrors<string> = {};
  const rows: AssumptionInput[] = [];
  for (const assetClass of classes) {
    const names = assumptionFields(assetClass.id);
    const typed = [names.expectedReturn, names.volatility, names.source].some((name) => text(raw[name]) !== '');
    if (!typed) continue;
    const expectedReturn = percentField(raw[names.expectedReturn], -50, 50);
    if (expectedReturn === undefined) errors[names.expectedReturn] = MESSAGES.expectedReturn;
    const volatility = percentField(raw[names.volatility], 0, 100);
    if (volatility === undefined) errors[names.volatility] = MESSAGES.volatility;
    const source = text(raw[names.source]);
    if (!source) errors[names.source] = MESSAGES.source;
    else if (source.length > 200) errors[names.source] = MESSAGES.tooLong;
    rows.push({ id: assetClass.id, expectedReturn: expectedReturn ?? 0, volatility: volatility ?? 0, source });
  }
  return finish(errors, () => rows);
}

// ---------------------------------------------------------------------------
// Efficient frontier (F7)
// ---------------------------------------------------------------------------

export type FrontierField = 'riskFree' | 'lookbackYears' | 'bounds';

/** config frontier: the risk-free rate, the years of history and each class's weight bounds, "us_global_equity = 0 - 50" per line. */
export function parseFrontierForm(raw: RawForm, current: FrontierSettings, classIds: readonly string[], today: string): Parsed<FrontierSettings, FrontierField> {
  const errors: FieldErrors<FrontierField> = {};
  const riskFree = percentField(raw['riskFree'], -5, 30);
  if (riskFree === undefined) errors.riskFree = MESSAGES.riskFree;
  const years = parseNumber(raw['lookbackYears']);
  if (years === undefined || !Number.isInteger(years) || years < 1 || years > 30) errors.lookbackYears = MESSAGES.frontierYears;
  const known = new Set(classIds);
  const bounds: Record<string, [number, number]> = {};
  for (const line of (raw['bounds'] ?? '').split('\n').map((one) => one.trim()).filter(Boolean)) {
    const match = /^([a-z0-9_]+)\s*[=:：]\s*([\d.]+)\s*[-–—]\s*([\d.]+)$/.exec(line);
    const id = match?.[1];
    const min = match ? percentField(match[2], 0, 100) : undefined;
    const max = match ? percentField(match[3], 0, 100) : undefined;
    if (!id || !known.has(id) || min === undefined || max === undefined || min > max) {
      errors.bounds = MESSAGES.frontierBounds;
      break;
    }
    bounds[id] = [min, max];
  }
  const entries = Object.values(bounds);
  if (!errors.bounds && (entries.length === 0 || entries.reduce((sum, bound) => sum + bound[0], 0) > 1 + 1e-9 || entries.reduce((sum, bound) => sum + bound[1], 0) < 1 - 1e-9)) errors.bounds = MESSAGES.frontierBounds;
  return finish(errors, () => ({
    ...current,
    riskFree: riskFree ?? current.riskFree,
    lookbackYears: years ?? current.lookbackYears,
    bounds,
    lastVerified: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

// ---------------------------------------------------------------------------
// Auto-scored assumptions (F6, config cma_auto)
// ---------------------------------------------------------------------------

export type AutoCmaField = 'lookbackYears' | 'minMonths';

/** config cma_auto from its form: on or off, the premium's source, the years and the fewest months; the anchors stay. */
export function parseAutoCmaForm(raw: RawForm, current: AutoCmaSettings): Parsed<AutoCmaSettings, AutoCmaField> {
  const errors: FieldErrors<AutoCmaField> = {};
  const years = parseNumber(raw['lookbackYears']);
  if (years === undefined || !Number.isInteger(years) || years < 1 || years > 20) errors.lookbackYears = MESSAGES.autoYears;
  const minMonths = parseNumber(raw['minMonths']);
  if (minMonths === undefined || !Number.isInteger(minMonths) || minMonths < 12 || (years !== undefined && minMonths > years * 12)) errors.minMonths = MESSAGES.autoMonths;
  return finish(errors, () => ({
    ...current,
    enabled: raw['enabled'] === 'on',
    premium: raw['premium'] === 'erp' ? ('erp' as const) : ('cma' as const),
    lookbackYears: years ?? current.lookbackYears,
    minMonths: minMonths ?? current.minMonths,
  }));
}
