import type { Fact } from '@/components/facts';
import type { StockBench, WorkbenchData } from '@/lib/data';
import type { Bilingual } from '@/lib/i18n';
import { SCENARIOS, marginOfSafety, zoneOf, type ModelId, type Scenario } from '@/lib/models/intrinsic';
import { savedFor } from '@/lib/models/workbench';

/** What the valuation overview (on the holdings page) and each stock's workbench share. */

export const MODEL: Record<ModelId, Bilingual> = {
  dcf: { en: 'DCF (FCFF)', zh: '現金流折現' },
  ddm: { en: 'Gordon DDM', zh: '股利折現' },
  multiples: { en: 'Multiples', zh: '倍數法' },
};

export const ZONE: Record<'buy' | 'trim' | 'between', { label: Bilingual; tone: Fact['tone'] }> = {
  buy: { label: { en: 'Buy zone', zh: '買入區' }, tone: 'watch' },
  trim: { label: { en: 'Trim zone', zh: '減碼區' }, tone: 'alert' },
  between: { label: { en: 'Between zones', zh: '區間內' }, tone: 'ok' },
};

/** The model a stock's alerts use, its newest saved values, and the multiples that set its zones. */
export function alertBasis(bench: StockBench, rules: WorkbenchData['rules']) {
  const saved = savedFor(bench.saved, bench.security.ticker, bench.assumed.model)[0];
  const buy = bench.watch?.buy ?? rules.buy;
  const trim = bench.watch?.trim ?? rules.trim;
  const price = bench.input?.price ?? bench.series.closes[bench.series.closes.length - 1];
  const zone = saved && price && buy !== null && trim !== null ? zoneOf(price.close, saved.base, { buy, trim }) : undefined;
  return { saved, buy, trim, price, zone, margin: saved && price ? marginOfSafety(saved.base, price.close) : undefined };
}

export const percentField = (value: number) => String(Number((value * 100).toFixed(4)));
export const scenarioFields = (prefix: string, values: Record<Scenario, number>) => Object.fromEntries(SCENARIOS.map((scenario) => [`${prefix}_${scenario}`, percentField(values[scenario])]));
