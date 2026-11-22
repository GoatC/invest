'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { useFieldInputs } from '@/components/use-field-inputs';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { parseAssumptionsForm, parseEstimatesForm, parseValuationSettingsForm } from '@/lib/validation';

import { saveAssumptions, saveEstimates, saveValuationSettings, type ValuationFormState } from './actions';

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

/** The three scenarios of a rate, side by side. */
function scenarioInputs(input: ReturnType<typeof useFieldInputs>['input'], prefix: string, label: Bilingual) {
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
  const fields = useFieldInputs(initial, (values) => parseAssumptionsForm(values, stocks, ticker), state.errors);
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
  const fields = useFieldInputs(initial, (values) => parseValuationSettingsForm(values, markets, today), state.errors);
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

/** The analysts' consensus, typed in from a broker's or a news site's page (F12 forward P/E). */
export function EstimatesForm({ ticker, currency, initial }: { ticker: string; currency: string; initial: Record<string, string> }) {
  const [state, action, pending] = useActionState(saveEstimates, INITIAL);
  const fields = useFieldInputs(initial, parseEstimatesForm, state.errors);
  const { input } = fields;
  return (
    <form action={action} onSubmit={fields.reset} className="form">
      <input type="hidden" name="ticker" value={ticker} />
      <div className="form-grid">
        {input('fy1_end', { en: 'Fiscal year 1 ends (YYYY-MM-DD)', zh: '第一個會計年度結束日（YYYY-MM-DD）' })}
        {input('fy1_eps', { en: `EPS, mean, ${currency}`, zh: `每股盈餘平均（${currency}）` })}
        {input('analysts', { en: 'Analysts', zh: '分析師人數' })}
        {input('fy1_high', { en: `EPS, highest, ${currency}`, zh: `每股盈餘最高（${currency}）` })}
        {input('fy1_low', { en: `EPS, lowest, ${currency}`, zh: `每股盈餘最低（${currency}）` })}
        {input('target', { en: `Target price, mean, ${currency}`, zh: `平均目標價（${currency}）` })}
        {input('fy2_end', { en: 'Fiscal year 2 ends', zh: '第二個會計年度結束日' })}
        {input('fy2_eps', { en: `FY2 EPS, mean, ${currency}`, zh: `第二年每股盈餘平均（${currency}）` })}
      </div>
      <Submit pending={pending} message={state.message} />
    </form>
  );
}
