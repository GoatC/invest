'use client';

import { useActionState, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { taipeiToday } from '@/lib/dates';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { parseBrokerForm, parseFeeForm, parseFundForm, parseTaxForm, type FieldErrors } from '@/lib/validation';

import { saveBroker, saveFees, saveFund, saveTax, type CostFormState } from './actions';

const INITIAL: CostFormState = { errors: {}, message: null };

export type FormKind = 'fees' | 'tax' | 'broker' | 'fund';

/** One input of a costs-page form, described by the page (a server component). */
export interface FieldSpec {
  name: string;
  label: Bilingual;
  hint?: Bilingual;
  kind?: 'text' | 'select' | 'checkbox';
  options?: ReadonlyArray<{ value: string; label: Bilingual }>;
  /** Numbers get the decimal keypad on a phone. */
  numeric?: boolean;
}

/** What a form's parsing needs besides its values: the ids taken, the entry edited, the domiciles, the classes. */
export interface FormContext {
  brokerIds?: string[];
  domiciles?: string[];
  taken?: string[];
  editing?: string | null;
  classes?: string[];
}

const ACTIONS: Record<FormKind, (previous: CostFormState, formData: FormData) => Promise<CostFormState>> = { fees: saveFees, tax: saveTax, broker: saveBroker, fund: saveFund };

function parse(kind: FormKind, values: Record<string, string>, context: FormContext): FieldErrors<string> {
  const today = taipeiToday();
  const parsed =
    kind === 'fees'
      ? parseFeeForm(values, context.brokerIds ?? [])
      : kind === 'tax'
        ? parseTaxForm(values, context.domiciles ?? [])
        : kind === 'broker'
          ? parseBrokerForm(values, context.taken ?? [], context.editing ?? null, today)
          : parseFundForm(values, context.taken ?? [], context.editing ?? null, new Set(context.classes ?? []), today);
  return parsed.ok ? {} : (parsed.errors as FieldErrors<string>);
}

/**
 * A costs-page settings form: the fees, the tax thresholds, a broker or a fund. Each field is
 * checked as it is typed with the same parser the server action uses; the server decides.
 */
export function CostForm({ kind, fields, initial, context = {}, hidden = {}, submit }: { kind: FormKind; fields: readonly FieldSpec[]; initial: Record<string, string>; context?: FormContext; hidden?: Record<string, string>; submit?: Bilingual }) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [state, formAction, pending] = useActionState(ACTIONS[kind], INITIAL);
  const errors = parse(kind, values, context);

  function change(name: string, value: string) {
    setEdited((previous) => new Set(previous).add(name));
    setValues((previous) => ({ ...previous, [name]: value }));
  }

  function error(name: string): Bilingual | null {
    return edited.has(name) ? (errors[name] ?? null) : (state.errors[name] ?? null);
  }

  const boxes = fields.filter((field) => field.kind === 'checkbox');
  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="form-grid">
        {fields
          .filter((field) => field.kind !== 'checkbox')
          .map((field) => (
            <Field key={field.name} label={field.label} error={error(field.name)} hint={field.hint && <Bi {...field.hint} />}>
              {field.kind === 'select' ? (
                <select name={field.name} value={values[field.name] ?? ''} onChange={(e) => change(field.name, e.target.value)}>
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label.en === option.label.zh ? option.label.en : `${option.label.en} ${option.label.zh}`}
                    </option>
                  ))}
                </select>
              ) : (
                <input name={field.name} inputMode={field.numeric ? 'decimal' : 'text'} autoComplete="off" value={values[field.name] ?? ''} onChange={(e) => change(field.name, e.target.value)} />
              )}
            </Field>
          ))}
      </div>
      {boxes.map((field) => (
        <label key={field.name} className="row">
          <input type="checkbox" name={field.name} checked={values[field.name] === 'on'} onChange={(e) => change(field.name, e.target.checked ? 'on' : '')} />
          <Bi {...field.label} />
        </label>
      ))}
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : (submit ?? LABELS.save))} />
        </button>
      </div>
    </form>
  );
}
