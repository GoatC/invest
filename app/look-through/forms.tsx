'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { LABELS } from '@/lib/i18n';
import type { LookThroughSettings } from '@/lib/models/look-through';

import { saveLookThroughSettings, type LookThroughFormState } from './actions';

const INITIAL: LookThroughFormState = { errors: {}, message: null };

/** config look_through: companies named, days between holdings files, TWSE industries' sectors, whole funds' countries. */
export function LookThroughSettingsForm({ settings }: { settings: LookThroughSettings }) {
  const [state, action, pending] = useActionState(saveLookThroughSettings, INITIAL);
  const error = (name: string) => state.errors[name] ?? null;
  return (
    <form action={action} className="form">
      {settings.lastVerified && <input type="hidden" name="checkedOn" value={settings.lastVerified} />}
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="form-grid">
        <Field label={{ en: 'Companies named', zh: '列出名稱的公司數' }} error={error('topCompanies')}>
          <input name="topCompanies" inputMode="numeric" autoComplete="off" defaultValue={settings.topCompanies} />
        </Field>
        <Field label={{ en: 'Days before a holdings file is read again', zh: '成分股重新讀取天數' }} error={error('refreshDays')}>
          <input name="refreshDays" inputMode="numeric" autoComplete="off" defaultValue={settings.refreshDays} />
        </Field>
      </div>
      <Field
        label={{ en: 'TWSE industry → GICS sector', zh: '證交所產業別 → GICS 產業' }}
        hint={<Bi en="One per line, e.g. 24 = Information Technology. A starting map: check it against your own view." zh="每行一個，例如 24 = 資訊科技。這是起始對應，請依你的看法確認。" />}
        error={error('twSectors')}
      >
        <textarea name="twSectors" rows={8} defaultValue={Object.entries(settings.twSectors).map(([code, sector]) => `${code} = ${sector}`).join('\n')} />
      </Field>
      <Field
        label={{ en: 'Country of a fund not looked through', zh: '未展開基金的國家' }}
        hint={<Bi en="One per line, e.g. BIL = US." zh="每行一個，例如 BIL = US。" />}
        error={error('fundCountry')}
      >
        <textarea name="fundCountry" rows={4} defaultValue={Object.entries(settings.fundCountry).map(([fund, country]) => `${fund} = ${country}`).join('\n')} />
      </Field>
      <label className="row">
        <input type="checkbox" name="checked" />
        <Bi en={`Checked the map today${settings.lastVerified ? ` (last ${settings.lastVerified})` : ''}`} zh={`今天已確認對應${settings.lastVerified ? `（上次 ${settings.lastVerified}）` : ''}`} />
      </label>
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </form>
  );
}
