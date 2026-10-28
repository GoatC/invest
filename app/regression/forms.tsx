'use client';

import { useActionState, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { bi, LABELS, type Bilingual } from '@/lib/i18n';
import { parseRegressionForm, type FieldErrors, type RegressionField } from '@/lib/validation';

import { saveRegressionSettings, type RegressionFormState } from './actions';

const INITIAL: RegressionFormState = { errors: {}, message: null };

export interface SettingsField {
  name: RegressionField;
  label: Bilingual;
  options?: ReadonlyArray<{ value: string; label: Bilingual }>;
}

/** The lab's settings, checked as typed with the server's parser. */
export function RegressionSettingsForm({ fields, initial, windows, today, checkedOn }: { fields: readonly SettingsField[]; initial: Record<string, string>; windows: readonly number[]; today: string; checkedOn: string | null }) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [state, formAction, pending] = useActionState(saveRegressionSettings, INITIAL);
  const parsed = parseRegressionForm(values, windows, today);
  const errors: FieldErrors<string> = parsed.ok ? {} : parsed.errors;
  const error = (name: string) => (edited.has(name) ? (errors[name] ?? null) : (state.errors[name] ?? null));
  const change = (name: string, value: string) => {
    setEdited((previous) => new Set(previous).add(name));
    setValues((previous) => ({ ...previous, [name]: value }));
  };
  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      <div className="form-grid">
        {fields.map((field) => (
          <Field key={field.name} label={field.label} error={error(field.name)}>
            {field.options ? (
              <select name={field.name} value={values[field.name] ?? ''} onChange={(e) => change(field.name, e.target.value)}>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {bi(option.label)}
                  </option>
                ))}
              </select>
            ) : (
              <input name={field.name} inputMode="decimal" autoComplete="off" value={values[field.name] ?? ''} onChange={(e) => change(field.name, e.target.value)} />
            )}
          </Field>
        ))}
      </div>
      <label className="row">
        <input type="checkbox" name="checked" />
        <Bi en={`Rates checked today${checkedOn ? ` (last ${checkedOn})` : ''}`} zh={`今天已確認利率${checkedOn ? `（上次 ${checkedOn}）` : ''}`} />
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
