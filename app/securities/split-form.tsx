'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { LABELS } from '@/lib/i18n';

import { addSplit, type SplitFormState } from './actions';

const INITIAL: SplitFormState = { errors: {}, message: null };

/** A split as "N old shares became M new ones" on its ex-date (N5). */
export function SplitForm({ ticker, today }: { ticker: string; today: string }) {
  const [state, action, pending] = useActionState(addSplit, INITIAL);
  const error = (name: string) => state.errors[name as keyof SplitFormState['errors']] ?? null;
  return (
    <form action={action} className="form">
      <input type="hidden" name="security" value={ticker} />
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="form-grid">
        <Field label={{ en: 'Ex-date', zh: '分割生效日' }} hint={<Bi en="The first day the shares trade split." zh="以新股數開始交易的第一天。" />} error={error('exDate')}>
          <input type="date" name="exDate" max={today} />
        </Field>
        <Field label={{ en: 'Old shares', zh: '原股數' }} error={error('oldShares')}>
          <input name="oldShares" inputMode="decimal" autoComplete="off" defaultValue="1" />
        </Field>
        <Field label={{ en: 'Became new shares', zh: '變為新股數' }} hint={<Bi en="1 → 4 for a 1-into-4 split; 10 → 1 for a 1-for-10 reverse split." zh="1 拆 4 填 1 → 4；10 股合 1 股填 10 → 1。" />} error={error('newShares')}>
          <input name="newShares" inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label={LABELS.note} error={error('note')}>
          <input name="note" autoComplete="off" maxLength={300} />
        </Field>
      </div>
      <div>
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : { en: 'Add split', zh: '新增分割' })} />
        </button>
      </div>
    </form>
  );
}
