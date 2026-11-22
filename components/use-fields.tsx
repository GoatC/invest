'use client';

import { useState, type ReactNode } from 'react';

import { bi, type Bilingual } from '@/lib/i18n';
import type { FieldErrors } from '@/lib/validation/core';

import { Field } from './field';

/**
 * A form checked as it is typed with the server action's own parser: a field shows the parser's error once it is
 * edited and the server's answer until then; `reset` (on submit) hands every field back to the server's answer.
 * `change(name, undefined)` removes a field (an unticked box). `input` and `select` draw a labelled field.
 */
export function useFields<V extends Record<string, string>, P extends { ok: boolean }>(initial: V | (() => V), parse: (values: V) => P, serverErrors: FieldErrors<string>) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const parsed = parse(values);
  const errors: FieldErrors<string> = parsed.ok ? {} : ((parsed as { errors?: FieldErrors<string> }).errors ?? {});
  const error = (name: string): Bilingual | null => (edited.has(name) ? (errors[name] ?? null) : (serverErrors[name] ?? null));
  const change = (name: string, value: string | undefined) => {
    setEdited((previous) => new Set(previous).add(name));
    setValues((previous) => {
      const next: Record<string, string> = { ...previous };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next as V;
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
  return { values, parsed, error, change, reset, input, select };
}
