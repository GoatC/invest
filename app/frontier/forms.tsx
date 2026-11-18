'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { LABELS } from '@/lib/i18n';
import type { FrontierSettings } from '@/lib/models/frontier';

import { saveFrontier, type FrontierFormState } from './actions';

const INITIAL: FrontierFormState = { errors: {}, message: null };

const percentText = (value: number) => String(Number((value * 100).toFixed(2)));

/** config frontier: the risk-free rate, the years of history and each class's weight bounds. */
export function FrontierForm({ settings }: { settings: FrontierSettings }) {
  const [state, action, pending] = useActionState(saveFrontier, INITIAL);
  const bounds = Object.entries(settings.bounds)
    .map(([id, [min, max]]) => `${id} = ${percentText(min)} - ${percentText(max)}`)
    .join('\n');
  return (
    <form action={action} className="form">
      {settings.lastVerified && <input type="hidden" name="checkedOn" value={settings.lastVerified} />}
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <Field label={{ en: 'Risk-free rate % a year', zh: '無風險利率 % 每年' }} hint={<Bi en="Where the capital market line starts, e.g. a TWD time deposit." zh="資本市場線的起點，例如台幣定存利率。" />} error={state.errors.riskFree ?? null}>
        <input name="riskFree" inputMode="decimal" defaultValue={percentText(settings.riskFree)} />
      </Field>
      <Field label={{ en: 'Years of history', zh: '歷史年數' }} hint={<Bi en="The covariance reads this many years of monthly returns; the nightly job loads them, so a longer span fills in over a night." zh="共變異數取這麼多年的月報酬；由每夜排程載入，延長年數需要一晚才會補齊。" />} error={state.errors.lookbackYears ?? null}>
        <input name="lookbackYears" inputMode="numeric" defaultValue={settings.lookbackYears} />
      </Field>
      <Field label={{ en: 'Weight bounds per class', zh: '各類別權重上下限' }} hint={<Bi en="One per line: class id = minimum - maximum, in percent." zh="每行一個：類別代號 = 最小 - 最大，以百分比表示。" />} error={state.errors.bounds ?? null}>
        <textarea name="bounds" rows={9} defaultValue={bounds} />
      </Field>
      <label className="row">
        <input type="checkbox" name="checked" />
        <Bi en={`Checked the bounds and the rate today${settings.lastVerified ? ` (last ${settings.lastVerified})` : ''}`} zh={`今天已確認上下限與利率${settings.lastVerified ? `（上次 ${settings.lastVerified}）` : ''}`} />
      </label>
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </form>
  );
}
