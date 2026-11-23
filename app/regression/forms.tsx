'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { useFields } from '@/components/use-fields';
import { type Bilingual, LABELS, zh } from '@/lib/i18n';
import { parseRegressionForm, type RegressionField } from '@/lib/validation';

import { saveRegressionSettings, type RegressionFormState } from './actions';

const INITIAL: RegressionFormState = { errors: {}, message: null };

export interface SettingsField {
  name: RegressionField;
  label: Bilingual;
  options?: ReadonlyArray<{ value: string; label: Bilingual }>;
}

/** The lab's settings, checked as typed with the server's parser. */
export function RegressionSettingsForm({ fields, initial, windows, today, checkedOn }: { fields: readonly SettingsField[]; initial: Record<string, string>; windows: readonly number[]; today: string; checkedOn: string | null }) {
  const [state, formAction, pending] = useActionState(saveRegressionSettings, INITIAL);
  const { values, error, change, reset } = useFields(initial, (typed) => parseRegressionForm(typed, windows, today), state.errors);
  return (
    <form action={formAction} onSubmit={reset} className="form">
      <div className="form-grid">
        {fields.map((field) => (
          <Field key={field.name} label={field.label} error={error(field.name)}>
            {field.options ? (
              <select name={field.name} value={values[field.name] ?? ''} onChange={(e) => change(field.name, e.target.value)}>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {zh(option.label)}
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
