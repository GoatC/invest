'use client';

import { useActionState, useMemo, useState, type InputHTMLAttributes } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { ProjectionChart, type YearBar } from '@/components/plan-charts';
import { Stat } from '@/components/stat';
import { addMonths, isMonth, lastDayOf } from '@/lib/dates';
import { percent, twd } from '@/lib/format';
import { LABELS, PLAN_SERIES, type Bilingual } from '@/lib/i18n';
import { project, type SavedPlan } from '@/lib/models/projection';
import { parsePlanForm, type PlanField } from '@/lib/validation';

import { savePlan, type PlanFormState } from './actions';

const INITIAL_STATE: PlanFormState = { errors: {}, message: null };

/** The regular pool's value at each month end that has passed, for the starting value a start month implies. */
export interface StartValues {
  /** YYYY-MM → TWD at that month's end. */
  months: Record<string, number>;
  /** The series' first month; before it the pool held nothing. Null with no history. */
  first: string | null;
  /** This month, YYYY-MM, and the pool's value today. */
  current: string;
  today: number;
}

function startValue(start: string, values: StartValues): { value: number; note: Bilingual } {
  const before = addMonths(start, -1);
  if (before >= values.current) return { value: values.today, note: { en: `Your regular pool today: ${twd(values.today)}.`, zh: `一般投入資金池目前市值：${twd(values.today)}。` } };
  const value = values.months[before] ?? 0;
  return { value, note: { en: `Your regular pool on ${lastDayOf(before)}: ${twd(value)}.`, zh: `一般投入資金池在 ${lastDayOf(before)} 的市值：${twd(value)}。` } };
}

const FIELDS: Record<PlanField, Bilingual> = {
  start: { en: 'Start month', zh: '起始月份' },
  pv: { en: 'Value at the start (PV), NT$', zh: '起始金額（PV），台幣' },
  pmt: { en: 'Monthly contribution (PMT), NT$', zh: '每月投入（PMT），台幣' },
  stepUp: { en: 'Step-up % a year', zh: '每年調升 %' },
  expectedReturn: { en: 'Expected return % a year', zh: '預期年報酬 %' },
  inflation: { en: 'Inflation % a year', zh: '年通膨率 %' },
  years: { en: 'Years', zh: '年數' },
};

export function PlanForm({
  initial,
  starts,
  hints,
  savedStart,
}: {
  initial: Record<PlanField, string>;
  starts: StartValues;
  hints: Partial<Record<PlanField, Bilingual>>;
  /** The saved plan's start month; null with none saved. */
  savedStart: string | null;
}) {
  const [values, setValues] = useState<Record<PlanField, string>>(initial);
  const [edited, setEdited] = useState<ReadonlySet<PlanField>>(new Set());
  // The starting value follows the start month until one is typed.
  const [pvTyped, setPvTyped] = useState(savedStart !== null);
  const [state, formAction, pending] = useActionState(savePlan, INITIAL_STATE);
  const parsed = parsePlanForm(values);

  function change(field: PlanField, value: string) {
    setEdited((previous) => new Set(previous).add(field));
    if (field === 'pv') setPvTyped(true);
    setValues((previous) => {
      const next = { ...previous, [field]: value };
      if (field === 'start' && !pvTyped && isMonth(value)) next.pv = String(Math.round(startValue(value, starts).value));
      return next;
    });
  }

  function error(field: PlanField): Bilingual | null {
    if (!edited.has(field)) return state.errors[field] ?? null;
    return parsed.ok ? null : (parsed.errors[field] ?? null);
  }

  const atStart = isMonth(values.start) ? startValue(values.start, starts) : null;
  const pvHint = atStart ? { en: `${atStart.note.en}${pvTyped ? '' : ' Filled in until you type one.'}`, zh: `${atStart.note.zh}${pvTyped ? '' : '輸入金額前會自動帶入。'}` } : null;

  const input = (field: PlanField, props: InputHTMLAttributes<HTMLInputElement> = {}) => {
    const hint = field === 'pv' ? pvHint : hints[field];
    return (
      <Field label={FIELDS[field]} error={error(field)} hint={hint && <Bi {...hint} />}>
        <input name={field} inputMode="decimal" autoComplete="off" value={values[field]} onChange={(e) => change(field, e.target.value)} {...props} />
      </Field>
    );
  };

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      <div className="form-grid">
        {input('start', { type: 'month', inputMode: undefined, placeholder: 'YYYY-MM' })}
        {input('pv')}
        {input('pmt')}
        {input('stepUp')}
        {input('expectedReturn')}
        {input('inflation')}
        {input('years', { inputMode: 'numeric' })}
      </div>
      {parsed.ok ? (
        <Projection plan={parsed.value} />
      ) : (
        <p className="muted">
          <Bi en="Fix the highlighted fields to see the projection." zh="請修正標示的欄位，才能顯示預測。" />
        </p>
      )}
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : { en: 'Save as my plan', zh: '儲存為我的計畫' })} />
        </button>
        <span className="muted small">
          <Bi
            {...(savedStart
              ? { en: `Replaces the plan from ${savedStart} that your actual values are compared with.`, zh: `取代目前用來對照實際值的計畫（${savedStart} 起）。` }
              : { en: 'Your actual values are compared with the plan you save.', zh: '儲存後，實際值會與這個計畫對照。' })}
          />
        </span>
      </div>
    </form>
  );
}

function Projection({ plan }: { plan: SavedPlan }) {
  // Parsed afresh on every render; worked out again, and the chart redrawn, only when a value changes.
  const key = JSON.stringify(plan);
  const projection = useMemo(() => project(JSON.parse(key) as SavedPlan), [key]);
  const years: YearBar[] = useMemo(() => projection.years.map((year) => ({ ...year, ends: addMonths(plan.start, 12 * year.year - 1) })), [projection, plan.start]);
  const bars = useMemo(() => years.slice(1), [years]);
  const { final } = projection;
  const end = lastDayOf(addMonths(plan.start, 12 * plan.years - 1));
  const months = plan.years * 12;
  const stats: Array<{ label: Bilingual; value: string; note: Bilingual }> = [
    {
      label: { en: `Value after ${plan.years} years`, zh: `${plan.years} 年後的資產` },
      value: twd(final.value),
      note: { en: `On ${end}, in nominal NT$`, zh: `${end}，名目台幣` },
    },
    {
      label: PLAN_SERIES.real,
      value: twd(final.real),
      note: { en: `At ${percent(plan.inflation, 2)} inflation a year`, zh: `以年通膨率 ${percent(plan.inflation, 2)} 換算` },
    },
    {
      label: PLAN_SERIES.contributed,
      value: twd(final.contributed),
      note: { en: `The start and ${months} contributions`, zh: `起始金額與 ${months} 次投入` },
    },
    {
      label: PLAN_SERIES.growth,
      value: twd(final.growth),
      note: { en: `${percent(final.value > 0 ? final.growth / final.value : null)} of the value`, zh: `占資產的 ${percent(final.value > 0 ? final.growth / final.value : null)}` },
    },
    {
      label: { en: 'Real return a year', zh: '實質年報酬' },
      value: percent(projection.realReturn, 2),
      note: { en: '(1 + return) ÷ (1 + inflation) − 1', zh: '(1 + 報酬) ÷ (1 + 通膨) − 1' },
    },
    {
      label: { en: 'Last monthly contribution', zh: '最後一個月的投入' },
      value: twd(projection.lastPayment),
      note: { en: `Stepped up ${percent(plan.stepUp, 2)} a year`, zh: `每年調升 ${percent(plan.stepUp, 2)}` },
    },
  ];
  const label: Bilingual = {
    en: `The plan year by year to ${end}: ${twd(final.value)}, of which ${twd(final.contributed)} put in and ${twd(final.growth)} growth; ${twd(final.real)} in today's money. The table below lists every year.`,
    zh: `計畫逐年資產至 ${end}：${twd(final.value)}，其中投入 ${twd(final.contributed)}、成長 ${twd(final.growth)}；換算今天的幣值為 ${twd(final.real)}。下方表格列出每一年。`,
  };
  return (
    <div className="form">
      <div className="grid-cards" aria-live="polite">
        {stats.map((stat) => (
          <Stat key={stat.label.en} {...stat} />
        ))}
      </div>
      <ProjectionChart years={bars} label={label} />
      <details>
        <summary>
          <Bi en="Show as a table" zh="以表格顯示" />
        </summary>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>
                  <Bi en="Year" zh="年" />
                </th>
                <th>
                  <Bi en="Ends" zh="結束月份" />
                </th>
                <th className="num">
                  <Bi {...PLAN_SERIES.value} />
                </th>
                <th className="num">
                  <Bi {...PLAN_SERIES.contributed} />
                </th>
                <th className="num">
                  <Bi {...PLAN_SERIES.growth} />
                </th>
                <th className="num">
                  <Bi {...PLAN_SERIES.real} />
                </th>
              </tr>
            </thead>
            <tbody>
              {years.map((year) => (
                <tr key={year.year}>
                  <td className="num">{year.year === 0 ? <Bi en="Start" zh="起點" /> : year.year}</td>
                  <td className="nowrap">{year.ends}</td>
                  <td className="num">{twd(year.value)}</td>
                  <td className="num">{twd(year.contributed)}</td>
                  <td className="num">{twd(year.growth)}</td>
                  <td className="num">{twd(year.real)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
