'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { LABELS } from '@/lib/i18n';
import type { McSettings } from '@/lib/models/monte-carlo';

import { saveMonteCarlo, type McFormState } from './actions';

const INITIAL: McFormState = { errors: {}, message: null };

/** config monte_carlo: the goal in today's money and a windfall still to come. */
export function MonteCarloForm({ settings }: { settings: McSettings }) {
  const [state, action, pending] = useActionState(saveMonteCarlo, INITIAL);
  const error = (name: keyof McFormState['errors']) => state.errors[name] ?? null;
  return (
    <form action={action} className="form">
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <Field
        label={{ en: 'Goal in today’s money, NT$', zh: '目標（以今天幣值計），台幣' }}
        hint={<Bi en="The share of paths that reach it is shown for every year. Blank for none." zh="每一年都會顯示達成此目標的路徑比例。留白代表不設目標。" />}
        error={error('target')}
      >
        <input name="target" inputMode="numeric" defaultValue={settings.targetTwd ?? ''} />
      </Field>
      <Field
        label={{ en: 'Expected windfall, NT$', zh: '預期大額資金，台幣' }}
        hint={<Bi en="Used until an F3 plan is saved on the Windfall page, which then takes over. Blank for none." zh="在大額資金頁儲存 F3 計畫前使用，儲存後改用該計畫。留白代表沒有。" />}
        error={error('windfallAmount')}
      >
        <input name="windfallAmount" inputMode="numeric" defaultValue={settings.windfall.amountTwd ?? ''} />
      </Field>
      <Field label={{ en: 'It arrives in (YYYY-MM)', zh: '入帳月份（YYYY-MM）' }} error={error('windfallMonth')}>
        <input name="windfallMonth" placeholder="2030-06" defaultValue={settings.windfall.month ?? ''} />
      </Field>
      <Field label={{ en: 'Monthly tranches', zh: '分批月數' }} hint={<Bi en="Equal tranches from the month it arrives; the waiting cash earns the windfall cash return." zh="自入帳月份起等額分批；等待中的現金以大額資金的現金報酬計算。" />} error={error('windfallTranches')}>
        <input name="windfallTranches" inputMode="numeric" defaultValue={settings.windfall.tranches} />
      </Field>
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </form>
  );
}
