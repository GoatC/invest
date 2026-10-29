'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { LABELS } from '@/lib/i18n';
import { MAX_GOALS, type TimelineSettings } from '@/lib/models/timeline';

import { saveTimeline, type TimelineFormState } from './actions';

const INITIAL: TimelineFormState = { errors: {}, message: null };

/** config timeline: one goal per line, "2045-06 | 3,000,000 | House". */
export function GoalsForm({ settings }: { settings: TimelineSettings }) {
  const [state, action, pending] = useActionState(saveTimeline, INITIAL);
  const text = settings.goals.map((goal) => `${goal.month} | ${goal.amountTwd ?? ''} | ${goal.name}`).join('\n');
  return (
    <form action={action} className="form">
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <Field
        label={{ en: 'Later goals', zh: '後續目標' }}
        hint={
          <Bi
            en={`One per line: month | amount in today's money (blank for a milestone) | name, e.g. 2045-06 | 3,000,000 | House. Up to ${MAX_GOALS}.`}
            zh={`每行一個：月份 | 以今天幣值計的金額（里程碑可留白）| 名稱，例如 2045-06 | 3,000,000 | 購屋頭期款。最多 ${MAX_GOALS} 個。`}
          />
        }
        error={state.errors.goals ?? null}
      >
        <textarea name="goals" rows={5} defaultValue={text} />
      </Field>
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </form>
  );
}
