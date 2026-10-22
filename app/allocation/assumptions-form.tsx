'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import type { AssetClassSettings } from '@/lib/data';
import { LABELS, SLEEVE, type Bilingual } from '@/lib/i18n';
import type { Assumptions } from '@/lib/models/cma';
import { assumptionFields, parseAssumptionForm } from '@/lib/validation';

import { saveAssumptions, type SettingsFormState } from './actions';

const INITIAL_STATE: SettingsFormState = { errors: {}, message: null };

function typedPercent(value: number): string {
  return String(Number((value * 100).toFixed(2)));
}

export function AssumptionsForm({ classes, assumptions }: { classes: AssetClassSettings[]; assumptions: Assumptions }) {
  const initial = useMemo(
    () =>
      Object.fromEntries(
        classes.flatMap((assetClass) => {
          const names = assumptionFields(assetClass.id);
          const saved = assumptions[assetClass.id];
          return [
            [names.expectedReturn, saved ? typedPercent(saved.expectedReturn) : ''],
            [names.volatility, saved ? typedPercent(saved.volatility) : ''],
            [names.source, saved?.source ?? ''],
          ];
        }),
      ),
    [classes, assumptions],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [state, formAction, pending] = useActionState(saveAssumptions, INITIAL_STATE);
  const parsed = parseAssumptionForm(values, classes);

  function change(field: string, value: string) {
    setEdited((previous) => new Set(previous).add(field));
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  /** A row's error shows once any of its three fields has been typed in. */
  function error(field: string, row: string[]): Bilingual | null {
    const typed = row.some((name) => edited.has(name));
    const server = typed ? undefined : state.errors[field];
    const live = typed && !parsed.ok ? parsed.errors[field] : undefined;
    return server ?? live ?? null;
  }

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      {(['core', 'satellite'] as const).map((sleeve) => (
        <fieldset key={sleeve} className="form">
          <legend>
            <Bi {...SLEEVE[sleeve]} />
          </legend>
          {sleeve === 'satellite' && (
            <p className="muted small">
              <Bi en="Optional: the spec asks for the core classes." zh="選填：規格只要求核心類別。" />
            </p>
          )}
          {classes
            .filter((assetClass) => assetClass.sleeve === sleeve)
            .map((assetClass) => {
              const names = assumptionFields(assetClass.id);
              const row = [names.expectedReturn, names.volatility, names.source];
              return (
                <div key={assetClass.id} className="form-grid">
                  <Field label={{ en: `${assetClass.nameEn}: expected return % a year`, zh: `${assetClass.nameZh}：預期年報酬 %` }} error={error(names.expectedReturn, row)}>
                    <input
                      name={names.expectedReturn}
                      inputMode="decimal"
                      autoComplete="off"
                      value={values[names.expectedReturn] ?? ''}
                      onChange={(e) => change(names.expectedReturn, e.target.value)}
                    />
                  </Field>
                  <Field label={{ en: 'Volatility % a year', zh: '年化波動度 %' }} error={error(names.volatility, row)}>
                    <input name={names.volatility} inputMode="decimal" autoComplete="off" value={values[names.volatility] ?? ''} onChange={(e) => change(names.volatility, e.target.value)} />
                  </Field>
                  <Field label={{ en: 'Source', zh: '來源' }} error={error(names.source, row)} hint={<Bi en="e.g. a published long-term outlook and its year" zh="例如：某機構公布的長期展望與年份" />}>
                    <input name={names.source} maxLength={200} autoComplete="off" value={values[names.source] ?? ''} onChange={(e) => change(names.source, e.target.value)} />
                  </Field>
                </div>
              );
            })}
        </fieldset>
      ))}
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
        <Link href="/allocation" className="button">
          <Bi {...LABELS.cancel} />
        </Link>
      </div>
    </form>
  );
}
