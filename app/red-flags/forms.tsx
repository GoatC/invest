'use client';

import { useActionState, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { bi, LABELS, type Bilingual } from '@/lib/i18n';
import { GOVERNANCE_TIERS, MANUAL_INDICATORS, type ManualIndicator, type RedFlagSettings } from '@/lib/models/red-flags';
import { INDICATOR } from '@/lib/red-flag-text';

import { addFlagEntry, saveFlagSettings, type FlagFormState } from './actions';

const INITIAL: FlagFormState = { errors: {}, message: null };

/** The tiers' names as TWSE publishes them: 前 5%, 6%～20%, …, 81%～100%. */
function tierName(edge: number, index: number): Bilingual {
  const from = index === 0 ? null : (GOVERNANCE_TIERS[index - 1] as number) + 1;
  return from === null ? { en: `Top ${edge}%`, zh: `前 ${edge}%` } : { en: `${from}% to ${edge}%`, zh: `${from}%～${edge}%` };
}

function Message({ state }: { state: FlagFormState }) {
  return state.message ? (
    <p className="banner danger" role="alert">
      <Bi {...state.message} />
    </p>
  ) : null;
}

/** One entry for a company: what you found where no feed reaches, as of a date. */
export function EntryForm({ ticker, market, today }: { ticker: string; market: string; today: string }) {
  const [state, action, pending] = useActionState(addFlagEntry, INITIAL);
  const choices = MANUAL_INDICATORS.filter((indicator) => indicator !== 'governance_rating' || market === 'TW');
  const [indicator, setIndicator] = useState<ManualIndicator>(choices[0] as ManualIndicator);
  const error = (name: string) => state.errors[name] ?? null;
  return (
    <form action={action} className="form">
      <input type="hidden" name="ticker" value={ticker} />
      <Message state={state} />
      <div className="form-grid">
        <Field label={{ en: 'Indicator', zh: '指標' }} error={error('indicator')}>
          <select name="indicator" value={indicator} onChange={(event) => setIndicator(event.target.value as ManualIndicator)}>
            {choices.map((one) => (
              <option key={one} value={one}>
                {bi(INDICATOR[one])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={{ en: 'As of', zh: '查詢日期' }} error={error('asOf')}>
          <input type="date" name="asOf" defaultValue={today} max={today} />
        </Field>
        {indicator === 'governance_rating' ? (
          <Field label={{ en: 'Tier', zh: '評鑑級距' }} error={error('value')}>
            <select name="value" defaultValue="5">
              {GOVERNANCE_TIERS.map((edge, index) => (
                <option key={edge} value={edge}>
                  {bi(tierName(edge, index))}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field
            label={{ en: 'Events found in the window', zh: '期間內找到的事件數' }}
            hint={<Bi en="0 when you checked and found none." zh="查過但沒有找到請填 0。" />}
            error={error('value')}
          >
            <input name="value" inputMode="numeric" autoComplete="off" defaultValue="0" />
          </Field>
        )}
        <Field label={LABELS.note} hint={<Bi en="Where you looked, e.g. EPA ECHO or MOPS." zh="查詢來源，例如 EPA ECHO 或公開資訊觀測站。" />} error={error('note')}>
          <input name="note" autoComplete="off" maxLength={300} />
        </Field>
      </div>
      <div>
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : { en: 'Add entry', zh: '新增紀錄' })} />
        </button>
      </div>
    </form>
  );
}

/** config red_flags: thresholds, industries and the exclusion list. */
export function FlagSettingsForm({ settings }: { settings: RedFlagSettings }) {
  const [state, action, pending] = useActionState(saveFlagSettings, INITIAL);
  const error = (name: string) => state.errors[name] ?? null;
  const input = (name: string, label: Bilingual, value: string | number, hint?: Bilingual) => (
    <Field key={name} label={label} hint={hint ? <Bi {...hint} /> : undefined} error={error(name)}>
      <input name={name} inputMode="decimal" autoComplete="off" defaultValue={String(value)} />
    </Field>
  );
  const list = (name: string, label: Bilingual, value: readonly string[], hint: Bilingual) => (
    <Field key={name} label={label} hint={<Bi {...hint} />} error={error(name)}>
      <textarea name={name} rows={2} defaultValue={value.join(', ')} />
    </Field>
  );
  return (
    <form action={action} className="form">
      {settings.lastVerified && <input type="hidden" name="checkedOn" value={settings.lastVerified} />}
      <Message state={state} />
      <div className="form-grid">
        {input('lookbackYears', { en: 'Years events count for', zh: '事件計入年數' }, settings.lookbackYears)}
        {input('scanDays', { en: 'Days between scans', zh: '掃描間隔天數' }, settings.scanDays)}
        {input('beneish', { en: 'Beneish M: red above', zh: 'Beneish M：高於此為紅燈' }, settings.beneish.redAbove)}
        {input('cashFlowYears', { en: 'Years of cash flow below earnings', zh: '現金流低於盈餘的年數' }, settings.cashFlowYears)}
        {input('zRed', { en: 'Altman Z: red below', zh: 'Altman Z：低於此為紅燈' }, settings.altman.z.redBelow)}
        {input('zAmber', { en: 'Altman Z: amber below', zh: 'Altman Z：低於此為黃燈' }, settings.altman.z.amberBelow)}
        {input('z2Red', { en: 'Altman Z″: red below', zh: 'Altman Z″：低於此為紅燈' }, settings.altman.z2.redBelow)}
        {input('z2Amber', { en: 'Altman Z″: amber below', zh: 'Altman Z″：低於此為黃燈' }, settings.altman.z2.amberBelow)}
        {input('governance', { en: 'Governance: bottom share, %', zh: '公司治理：後段比例（%）' }, Math.round(settings.governanceBottomShare * 10_000) / 100)}
      </div>
      {list('manufacturing', { en: 'TWSE industries counted as manufacturers (Altman Z)', zh: '視為製造業的證交所產業別（Altman Z）' }, settings.manufacturing.twIndustries, {
        en: `Two-digit codes. US companies: SIC ${settings.manufacturing.sic.map(([low, high]) => `${low}–${high}`).join(', ')}.`,
        zh: `兩位數代碼。美股依 SIC ${settings.manufacturing.sic.map(([low, high]) => `${low}–${high}`).join('、')}。`,
      })}
      {list('financial', { en: 'TWSE industries counted as financial (no Beneish or Altman)', zh: '視為金融業的證交所產業別（不計 Beneish、Altman）' }, settings.financial.twIndustries, {
        en: `US companies: SIC ${settings.financial.sic.map(([low, high]) => `${low}–${high}`).join(', ')}.`,
        zh: `美股依 SIC ${settings.financial.sic.map(([low, high]) => `${low}–${high}`).join('、')}。`,
      })}
      {list('industries', { en: 'Excluded industries', zh: '排除產業' }, settings.excluded.industries, {
        en: 'An industry code, or part of its name (e.g. Tobacco, 菸), one per line or separated by commas.',
        zh: '產業代碼或名稱的一部分（例如 Tobacco、菸），每行一個或以逗號分隔。',
      })}
      {list('tickers', { en: 'Excluded tickers', zh: '排除個股' }, settings.excluded.tickers, { en: 'Tickers, separated by commas.', zh: '代號，以逗號分隔。' })}
      <label className="row">
        <input type="checkbox" name="checked" />
        <Bi en={`Checked these against the sources today${settings.lastVerified ? ` (last ${settings.lastVerified})` : ''}`} zh={`今天已對照來源確認${settings.lastVerified ? `（上次 ${settings.lastVerified}）` : ''}`} />
      </label>
      <div>
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </form>
  );
}
