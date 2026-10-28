'use client';

import { useActionState, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { bi, LABELS, type Bilingual } from '@/lib/i18n';
import { parseCapmForm, type FieldErrors } from '@/lib/validation';

import { saveCapmSettings, type CapmFormState } from './actions';

const INITIAL: CapmFormState = { errors: {}, message: null };

/** The cost of equity's settings, checked as typed with the server's parser. */
export function CapmSettingsForm({
  markets,
  initial,
  today,
  checkedOn,
}: {
  markets: ReadonlyArray<{ market: string; name: Bilingual }>;
  initial: Record<string, string>;
  today: string;
  checkedOn: string | null;
}) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [state, formAction, pending] = useActionState(saveCapmSettings, INITIAL);
  const parsed = parseCapmForm(values, markets.map((entry) => entry.market), today);
  const errors: FieldErrors<string> = parsed.ok ? {} : parsed.errors;
  const error = (name: string) => (edited.has(name) ? (errors[name] ?? null) : (state.errors[name] ?? null));
  const change = (name: string, value: string) => {
    setEdited((previous) => new Set(previous).add(name));
    setValues((previous) => ({ ...previous, [name]: value }));
  };
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
  const input = (name: string, label: Bilingual) => (
    <Field key={name} label={label} error={error(name)}>
      <input name={name} inputMode="decimal" autoComplete="off" value={values[name] ?? ''} onChange={(e) => change(name, e.target.value)} />
    </Field>
  );
  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      <div className="form-grid">
        {select('beta', { en: 'β', zh: 'β' }, [
          { value: 'adjusted', label: { en: "Blume's adjusted", zh: 'Blume 調整後' } },
          { value: 'raw', label: { en: 'Raw slope', zh: '原始 β' } },
        ])}
        {select('erpSource', { en: 'ERP from', zh: '風險溢酬來源' }, [
          { value: 'damodaran', label: { en: "Damodaran's newest month", zh: 'Damodaran 最新月份' } },
          { value: 'manual', label: { en: 'The value below', zh: '下方自訂值' } },
        ])}
        {input('erpManual', { en: 'ERP typed, % a year', zh: '自訂風險溢酬（年 %）' })}
        {markets.flatMap(({ market, name }) => [
          input(`rf_${market}`, { en: `R_f ${name.en} until loaded, %`, zh: `${name.zh} R_f（資料載入前，%）` }),
          input(`crp_${market}`, { en: `Country premium ${name.en}, %`, zh: `${name.zh}國家風險溢酬（%）` }),
        ])}
      </div>
      <label className="row">
        <input type="checkbox" name="checked" />
        <Bi en={`Inputs checked today${checkedOn ? ` (last ${checkedOn})` : ''}`} zh={`今天已確認輸入值${checkedOn ? `（上次 ${checkedOn}）` : ''}`} />
      </label>
      {checkedOn && <input type="hidden" name="checkedOn" value={checkedOn} />}
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </form>
  );
}
