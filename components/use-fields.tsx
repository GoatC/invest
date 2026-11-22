'use client';

import { useState } from 'react';

import type { Bilingual } from '@/lib/i18n';
import type { FieldErrors } from '@/lib/validation';

/**
 * A form checked as it is typed with the server action's own parser: a field shows the parser's error once it is
 * edited and the server's answer until then; `reset` (on submit) hands every field back to the server's answer.
 * `change(name, undefined)` removes a field (an unticked box). components/use-field-inputs.tsx adds the drawers.
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
  return { values, parsed, error, change, reset };
}
