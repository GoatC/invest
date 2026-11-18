'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { LABELS } from '@/lib/i18n';
import type { AutoCmaSettings } from '@/lib/models/auto-cma';

import { rescoreNow, saveAutoCma, type AutoCmaFormState } from './actions';

const INITIAL: AutoCmaFormState = { errors: {}, message: null };

/** config cma_auto: on or off, where each market's premium comes from, the years and the fewest months. */
export function AutoCmaForm({ settings }: { settings: AutoCmaSettings }) {
  const [state, action, pending] = useActionState(saveAutoCma, INITIAL);
  return (
    <form action={action} className="form">
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <label className="row">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
        <Bi en="Score blank satellite classes" zh="自動評分未設定的衛星類別" />
      </label>
      <fieldset className="form">
        <legend>
          <Bi en="Market premium" zh="市場溢酬" label />
        </legend>
        <label className="row">
          <input type="radio" name="premium" value="cma" defaultChecked={settings.premium === 'cma'} />
          <Bi en="Your core assumption − 10-year yield" zh="你的核心假設 − 10 年期殖利率" />
        </label>
        <label className="row">
          <input type="radio" name="premium" value="erp" defaultChecked={settings.premium === 'erp'} />
          <Bi en="F11 ERP + country premium" zh="F11 風險溢酬 ＋ 國家溢酬" />
        </label>
      </fieldset>
      <div className="form-grid">
        <Field label={{ en: 'Years of returns', zh: '報酬年數' }} error={state.errors.lookbackYears ?? null}>
          <input name="lookbackYears" inputMode="numeric" defaultValue={settings.lookbackYears} />
        </Field>
        <Field label={{ en: 'Fewest months', zh: '最少月數' }} error={state.errors.minMonths ?? null}>
          <input name="minMonths" inputMode="numeric" defaultValue={settings.minMonths} />
        </Field>
      </div>
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </form>
  );
}

/** Scores the satellite classes now, as tonight's job would. */
export function RescoreForm() {
  const [state, action, pending] = useActionState(rescoreNow, INITIAL);
  return (
    <form action={action} className="row">
      <button type="submit" className="button" disabled={pending}>
        <Bi {...(pending ? { en: 'Scoring…', zh: '評分中…' } : { en: 'Score now', zh: '立即評分' })} />
      </button>
      {state.message && (
        <span className="error" role="alert">
          <Bi {...state.message} />
        </span>
      )}
    </form>
  );
}
