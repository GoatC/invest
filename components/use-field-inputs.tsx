'use client';

import type { ReactNode } from 'react';

import { bi, type Bilingual } from '@/lib/i18n';
import type { FieldErrors } from '@/lib/validation';

import { Field } from './field';
import { useFields } from './use-fields';

/** useFields with `input` and `select`, which draw a labelled field: apart, so a form that draws its own fields carries neither. */
export function useFieldInputs<V extends Record<string, string>, P extends { ok: boolean }>(initial: V | (() => V), parse: (values: V) => P, serverErrors: FieldErrors<string>) {
  const fields = useFields(initial, parse, serverErrors);
  const { values, error, change } = fields;
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
  return { ...fields, input, select };
}
