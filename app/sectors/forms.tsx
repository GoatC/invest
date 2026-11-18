'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { bi, LABELS } from '@/lib/i18n';
import type { SectorSettings } from '@/lib/models/sectors';

import { saveSectorSettings, type SectorFormState } from './actions';

const INITIAL: SectorFormState = { errors: {}, message: null };

/** config sectors: the colour convention and each Taiwan industry index's GICS sector. */
export function SectorSettingsForm({ settings }: { settings: SectorSettings }) {
  const [state, action, pending] = useActionState(saveSectorSettings, INITIAL);
  const error = (name: string) => state.errors[name] ?? null;
  return (
    <form action={action} className="form">
      {settings.lastVerified && <input type="hidden" name="checkedOn" value={settings.lastVerified} />}
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <Field label={{ en: 'Colours', zh: '配色' }} error={error('colour')}>
        <select name="colour" defaultValue={settings.colour}>
          <option value="red_up">{bi({ en: 'Red up, green down (Taiwan)', zh: '紅漲綠跌（台灣慣例）' })}</option>
          <option value="green_up">{bi({ en: 'Green up, red down (US)', zh: '綠漲紅跌（美國慣例）' })}</option>
        </select>
      </Field>
      <Field
        label={{ en: 'TWSE industry index → GICS sector', zh: '證交所類股指數 → GICS 產業' }}
        hint={<Bi en="One per line, e.g. Electronic = Information Technology; delete a line to leave the index out." zh="每行一個，例如 Electronic = 資訊科技；刪除一行即不使用該指數。" />}
        error={error('tw')}
      >
        <textarea name="tw" rows={10} defaultValue={settings.proxies.filter((proxy) => proxy.market === 'TW').map((proxy) => `${proxy.symbol} = ${proxy.sector}`).join('\n')} />
      </Field>
      <p className="muted small">
        <Bi en={`US sectors: ${settings.proxies.filter((proxy) => proxy.market === 'US').map((proxy) => proxy.symbol).join(', ')}.`} zh={`美國產業：${settings.proxies.filter((proxy) => proxy.market === 'US').map((proxy) => proxy.symbol).join('、')}。`} />
      </p>
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
