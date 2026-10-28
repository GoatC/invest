'use client';

import { useActionState, useState, type ReactNode } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { bi, LABELS, type Bilingual } from '@/lib/i18n';
import { parseAssumptionsForm, parseValuationSettingsForm, type FieldErrors } from '@/lib/validation';

import { saveAssumptions, saveValuationSettings, type ValuationFormState } from './actions';

const INITIAL: ValuationFormState = { errors: {}, message: null };

const MODELS: ReadonlyArray<{ value: string; label: Bilingual }> = [
  { value: 'dcf', label: { en: 'DCF (FCFF)', zh: '現金流折現（FCFF）' } },
  { value: 'ddm', label: { en: 'Gordon dividend model', zh: 'Gordon 股利折現' } },
  { value: 'multiples', label: { en: 'Multiples', zh: '倍數法' } },
];
const SCENARIOS: ReadonlyArray<{ key: string; label: Bilingual }> = [
  { key: 'bear', label: { en: 'bear', zh: '悲觀' } },
  { key: 'base', label: { en: 'base', zh: '基本' } },
  { key: 'bull', label: { en: 'bull', zh: '樂觀' } },
];

/** Values typed and edited, errors as typed from the shared parser, else the server's. */
function useFields(initial: Record<string, string>, parse: (values: Record<string, string>) => { ok: boolean; errors?: FieldErrors<string> }, state: ValuationFormState) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const parsed = parse(values);
  const errors: FieldErrors<string> = parsed.ok ? {} : (parsed.errors ?? {});
  const error = (name: string) => (edited.has(name) ? (errors[name] ?? null) : (state.errors[name] ?? null));
  const change = (name: string, value: string | undefined) => {
    setEdited((previous) => new Set(previous).add(name));
    setValues((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
  };
  const reset = () => setEdited(new Set());
  const input = (name: string, label: Bilingual, hint?: ReactNode) => (
    <Field key={name} label={label} hint={hint} error={error(name)}>
      <input name={name} inputMode="decimal" autoComplete="off" value={values[name] ?? ''} onChange={(e) => change(name, e.target.value)} />
    </Field>
  );
  const select = (name: string, label: Bilingual, options: ReadonlyArray<{ value: string; label: Bilingual }>) => (
    <Field label={label} error={error(name)}>
      <select name={name} value={values[name] ?? ''} onChange={(e) => change(name, e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {bi(option.label)}
          </option>
        ))}
      </select>
    </Field>
  );
  return { values, change, reset, input, select };
}

/** The three scenarios of a rate, side by side. */
function scenarioInputs(input: ReturnType<typeof useFields>['input'], prefix: string, label: Bilingual) {
  return SCENARIOS.map((scenario) => input(`${prefix}_${scenario.key}`, { en: `${label.en}, ${scenario.label.en}, %`, zh: `${label.zh}（${scenario.label.zh}，%）` }));
}

function Submit({ pending, message }: { pending: boolean; message: Bilingual | null }) {
  return (
    <>
      {message && (
        <p className="banner danger" role="alert">
          <Bi {...message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </>
  );
}

/** A stock's model, scenarios, typed figures, peers and alert multiples; saving also saves its valuation. */
export function AssumptionsForm({ ticker, stocks, currency, initial, ruleMultiples }: { ticker: string; stocks: readonly string[]; currency: string; initial: Record<string, string>; ruleMultiples: { buy: number | null; trim: number | null } }) {
  const [state, formAction, pending] = useActionState(saveAssumptions, INITIAL);
  const fields = useFields(initial, (values) => parseAssumptionsForm(values, stocks, ticker), state);
  const { input, select } = fields;
  return (
    <form action={formAction} onSubmit={fields.reset} className="form">
      <input type="hidden" name="ticker" value={ticker} />
      <div className="form-grid">
        {select('model', { en: 'Alerts use', zh: '警報採用' }, MODELS)}
        {input('years', { en: 'Forecast years', zh: '預測年數' })}
        {scenarioInputs(input, 'growth', { en: 'FCFF growth', zh: 'FCFF 成長率' })}
        {scenarioInputs(input, 'terminal', { en: 'Terminal growth', zh: '永續成長率' })}
      </div>
      <h3>
        <Bi en={`In place of the filings (millions of ${currency}; blank uses the filings)`} zh={`取代財報數字（百萬 ${currency}；留白使用財報）`} />
      </h3>
      <div className="form-grid">
        {input('fcff', { en: 'Starting FCFF', zh: '起始 FCFF' })}
        {input('netDebt', { en: 'Net debt', zh: '淨負債' })}
        {input('shares', { en: 'Diluted shares', zh: '稀釋後股數' })}
        {input('taxRate', { en: 'Tax rate, %', zh: '稅率（%）' })}
        {input('costOfDebt', { en: 'Cost of debt R_d, %', zh: '負債成本 R_d（%）' })}
      </div>
      <div className="form-grid">
        {input('peers', { en: 'Peers, by ticker', zh: '同業代號' }, <Bi en="Comma-separated single stocks" zh="以逗號分隔的個股" />)}
        {input('buy', { en: 'Buy multiple', zh: '買入倍數' }, <Bi en={`Blank: the rule's ${ruleMultiples.buy ?? '—'}`} zh={`留白：規則的 ${ruleMultiples.buy ?? '—'}`} />)}
        {input('trim', { en: 'Trim multiple', zh: '減碼倍數' }, <Bi en={`Blank: the rule's ${ruleMultiples.trim ?? '—'}`} zh={`留白：規則的 ${ruleMultiples.trim ?? '—'}`} />)}
      </div>
      <label className="row">
        <input type="checkbox" name="active" checked={fields.values['active'] === 'on'} onChange={(e) => fields.change('active', e.target.checked ? 'on' : undefined)} />
        <Bi en="Alerts on (watched)" zh="開啟警報（觀察中）" />
      </label>
      <Submit pending={pending} message={state.message} />
    </form>
  );
}

/** config valuation: the defaults a stock starts from. */
export function ValuationSettingsForm({ markets, initial, today, checkedOn }: { markets: readonly string[]; initial: Record<string, string>; today: string; checkedOn: string | null }) {
  const [state, formAction, pending] = useActionState(saveValuationSettings, INITIAL);
  const fields = useFields(initial, (values) => parseValuationSettingsForm(values, markets, today), state);
  const { input, select } = fields;
  return (
    <form action={formAction} onSubmit={fields.reset} className="form">
      <div className="form-grid">
        {select('model', { en: 'Alerts use', zh: '警報採用' }, MODELS)}
        {input('years', { en: 'Forecast years', zh: '預測年數' })}
        {scenarioInputs(input, 'growth', { en: 'FCFF growth', zh: 'FCFF 成長率' })}
        {scenarioInputs(input, 'terminal', { en: 'Terminal growth', zh: '永續成長率' })}
        {input('debtSpread', { en: 'R_d over R_f without reported interest, %', zh: '未揭露利息時 R_d 高於 R_f 的利差（%）' })}
        {markets.map((market) => input(`tax_${market}`, { en: `Tax rate ${market} without filings, %`, zh: `${market} 無財報稅率時的稅率（%）` }))}
        {input('historyYears', { en: 'Own range, years', zh: '自身區間年數' })}
        {input('minQuarters', { en: 'Own range, fewest quarters', zh: '自身區間最少季數' })}
      </div>
      <label className="row">
        <input type="checkbox" name="checked" />
        <Bi en={`Defaults checked today${checkedOn ? ` (last ${checkedOn})` : ''}`} zh={`今天已確認預設值${checkedOn ? `（上次 ${checkedOn}）` : ''}`} />
      </label>
      {checkedOn && <input type="hidden" name="checkedOn" value={checkedOn} />}
      <Submit pending={pending} message={state.message} />
    </form>
  );
}
