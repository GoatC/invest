'use client';

import { useActionState, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { percent, twd } from '@/lib/format';
import { bi, LABELS, type Bilingual } from '@/lib/i18n';
import { capePercentile, schedule, trancheCount, type MonthValue, type Pace } from '@/lib/models/windfall';
import { parsePaceForm, parsePlanStart, parseWindfallSettingsForm, type FieldErrors } from '@/lib/validation';

import { savePace, saveWindfallSettings, startPlan, type WindfallFormState } from './actions';

const INITIAL: WindfallFormState = { errors: {}, message: null };

/** One input of a windfall form, described by the page (a server component). */
export interface FieldSpec {
  name: string;
  label: Bilingual;
  hint?: Bilingual;
  options?: ReadonlyArray<{ value: string; label: Bilingual }>;
}

function Problem({ message }: { message: Bilingual | null }) {
  return message ? (
    <p className="banner danger" role="alert">
      <Bi {...message} />
    </p>
  ) : null;
}

/**
 * Starts (or replaces) the plan: the windfall in NT$ and the first tranche's date. The CAPE
 * percentile of that month and the tranche count it sets are shown as they are typed; the server
 * works them out again on saving.
 */
export function PlanForm({ capes, pace, initial, replacing }: { capes: readonly MonthValue[]; pace: Pace | null; initial: { totalTwd: string; startDate: string }; replacing: boolean }) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [state, formAction, pending] = useActionState(startPlan, INITIAL);
  const parsed = parsePlanStart(values);
  const errors: FieldErrors<string> = parsed.ok ? {} : parsed.errors;
  const gauge = parsed.ok ? capePercentile(capes, parsed.value.startDate.slice(0, 7)) : null;
  const count = gauge && pace ? trancheCount(gauge.percentile, pace) : null;
  const first = parsed.ok && count ? schedule(parsed.value.totalTwd, parsed.value.startDate, count) : [];
  const error = (name: 'totalTwd' | 'startDate') => (edited.has(name) ? (errors[name] ?? null) : (state.errors[name] ?? null));
  const change = (name: 'totalTwd' | 'startDate', value: string) => {
    setEdited((previous) => new Set(previous).add(name));
    setValues((previous) => ({ ...previous, [name]: value }));
  };
  const confirmText: Bilingual = { en: 'Replace the plan? Its tranches are replaced; proposals already drafted stay.', zh: '要取代目前的計畫嗎？分批會重新排定；已產生的提案保留不變。' };
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        setEdited(new Set());
        if (replacing && !window.confirm(bi(confirmText))) event.preventDefault();
      }}
      className="form"
    >
      <div className="form-grid">
        <Field label={{ en: 'Windfall to deploy, NT$', zh: '要投入的大額資金（台幣）' }} error={error('totalTwd')} hint={<Bi en="Defaults to the windfall cash flows recorded." zh="預設為已登錄的大額資金入帳金額。" />}>
          <input name="totalTwd" inputMode="numeric" autoComplete="off" value={values.totalTwd} onChange={(e) => change('totalTwd', e.target.value)} />
        </Field>
        <Field label={{ en: 'First tranche due (YYYY-MM-DD)', zh: '第一批到期日（YYYY-MM-DD）' }} error={error('startDate')} hint={<Bi en="Then the same day each month." zh="之後每月同一天到期。" />}>
          <input name="startDate" autoComplete="off" value={values.startDate} onChange={(e) => change('startDate', e.target.value)} />
        </Field>
      </div>
      <p className="muted" role="status">
        {gauge && count && first[0] ? (
          <Bi
            en={`CAPE ${gauge.cape.toFixed(1)} in ${gauge.month}, the ${percent(gauge.percentile / 100, 0)} percentile of ${gauge.months.toLocaleString('en-US')} months: ${count} monthly tranches of about ${twd(first[0].amountTwd)}, ${first[0].dueDate} to ${first[first.length - 1]?.dueDate ?? ''}.`}
            zh={`${gauge.month} 的 CAPE 為 ${gauge.cape.toFixed(1)}，在 ${gauge.months.toLocaleString('en-US')} 個月中位於第 ${Math.round(gauge.percentile)} 百分位：分 ${count} 個月，每批約 ${twd(first[0].amountTwd)}，${first[0].dueDate} 至 ${first[first.length - 1]?.dueDate ?? ''}。`}
          />
        ) : !pace ? (
          <Bi en="The pace setting is malformed: fix it below." zh="分批節奏設定格式錯誤：請在下方修正。" />
        ) : capes.length === 0 ? (
          <Bi en="No CAPE loaded yet: the nightly job loads it." zh="尚未載入 CAPE：每夜排程會載入。" />
        ) : (
          <Bi en="Enter the amount and the date to see the pace." zh="輸入金額與日期即可看到分批節奏。" />
        )}
      </p>
      <Problem message={state.message} />
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : replacing ? { en: 'Replace the plan', zh: '取代計畫' } : { en: 'Start the plan', zh: '建立計畫' })} />
        </button>
      </div>
    </form>
  );
}

type Kind = 'settings' | 'pace';

const ACTIONS: Record<Kind, (previous: WindfallFormState, formData: FormData) => Promise<WindfallFormState>> = { settings: saveWindfallSettings, pace: savePace };

/** The windfall settings (each class's vehicle, the backtest) or the pace and its tiers, checked as typed with the server's parser. */
export function WindfallForm({ kind, fields, initial, classes = {} }: { kind: Kind; fields: readonly FieldSpec[]; initial: Record<string, string>; classes?: Record<string, string[]> }) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [state, formAction, pending] = useActionState(ACTIONS[kind], INITIAL);
  const parsed = kind === 'settings' ? parseWindfallSettingsForm(values, new Map(Object.entries(classes))) : parsePaceForm(values);
  const errors: FieldErrors<string> = parsed.ok ? {} : (parsed.errors as FieldErrors<string>);
  const error = (name: string) => (edited.has(name) ? (errors[name] ?? null) : (state.errors[name] ?? null));
  const change = (name: string, value: string) => {
    setEdited((previous) => new Set(previous).add(name));
    setValues((previous) => ({ ...previous, [name]: value }));
  };
  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      <div className="form-grid">
        {fields.map((field) => (
          <Field key={field.name} label={field.label} error={error(field.name)} hint={field.hint && <Bi {...field.hint} />}>
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
      <Problem message={state.message} />
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </form>
  );
}
