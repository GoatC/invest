'use client';

import { useActionState, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { parseSchedule, WEEKDAYS, type ScheduleField } from '@/lib/validation';

import { saveSchedule, type ScheduleState } from './actions';

const INITIAL: ScheduleState = { errors: {}, message: null };

const DAY: Record<(typeof WEEKDAYS)[number], Bilingual> = {
  sunday: { en: 'Sunday', zh: '星期日' },
  monday: { en: 'Monday', zh: '星期一' },
  tuesday: { en: 'Tuesday', zh: '星期二' },
  wednesday: { en: 'Wednesday', zh: '星期三' },
  thursday: { en: 'Thursday', zh: '星期四' },
  friday: { en: 'Friday', zh: '星期五' },
  saturday: { en: 'Saturday', zh: '星期六' },
};

const LABEL: Record<ScheduleField, Bilingual> = {
  quietStart: { en: 'Quiet hours start', zh: '安靜時段開始' },
  quietEnd: { en: 'Quiet hours end', zh: '安靜時段結束' },
  weeklyDay: { en: 'Weekly review day', zh: '每週檢視的星期' },
  weeklyTime: { en: 'Weekly review time', zh: '每週檢視的時間' },
};

/** Quiet hours and the weekly review time (config quiet_hours, weekly_review), Taipei time. */
export function ScheduleForm({ initial }: { initial: Record<ScheduleField, string> }) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<ScheduleField>>(new Set());
  const [state, formAction, pending] = useActionState(saveSchedule, INITIAL);
  const parsed = parseSchedule(values);

  function change(field: ScheduleField, value: string) {
    setEdited((previous) => new Set(previous).add(field));
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  function error(field: ScheduleField): Bilingual | null {
    if (!edited.has(field)) return state.errors[field] ?? null;
    return parsed.ok ? null : (parsed.errors[field] ?? null);
  }

  const time = (field: ScheduleField) => (
    <Field label={LABEL[field]} error={error(field)}>
      <input name={field} type="time" value={values[field]} onChange={(e) => change(field, e.target.value)} />
    </Field>
  );

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      <div className="form-grid">
        {time('quietStart')}
        {time('quietEnd')}
        <Field label={LABEL.weeklyDay} error={error('weeklyDay')}>
          <select name="weeklyDay" value={values.weeklyDay} onChange={(e) => change('weeklyDay', e.target.value)}>
            {WEEKDAYS.map((day) => (
              <option key={day} value={day}>
                {`${DAY[day].en} ${DAY[day].zh}`}
              </option>
            ))}
          </select>
        </Field>
        {time('weeklyTime')}
      </div>
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
