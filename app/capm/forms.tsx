'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { useFields } from '@/components/use-fields';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { parseCapmForm } from '@/lib/validation/research';

import { saveCapmSettings, type CapmFormState } from './actions';

const INITIAL: CapmFormState = { errors: {}, message: null };

/** The cost of equity's settings, checked as typed with the server's parser. */
export function CapmSettingsForm({
  markets,
  initial,
  today,
  checkedOn,
}: {
  markets: ReadonlyArray<{ market: string; name: Bilingual }>;
  initial: Record<string, string>;
  today: string;
  checkedOn: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveCapmSettings, INITIAL);
  const { select, input, reset } = useFields(initial, (values) => parseCapmForm(values, markets.map((entry) => entry.market), today), state.errors);
  return (
    <form action={formAction} onSubmit={reset} className="form">
      <div className="form-grid">
        {select('beta', { en: 'β', zh: 'β' }, [
          { value: 'adjusted', label: { en: "Blume's adjusted", zh: 'Blume 調整後' } },
          { value: 'raw', label: { en: 'Raw slope', zh: '原始 β' } },
        ])}
        {select('erpSource', { en: 'ERP from', zh: '風險溢酬來源' }, [
          { value: 'damodaran', label: { en: "Damodaran's newest month", zh: 'Damodaran 最新月份' } },
          { value: 'manual', label: { en: 'The value below', zh: '下方自訂值' } },
        ])}
        {input('erpManual', { en: 'ERP typed, % a year', zh: '自訂風險溢酬（年 %）' })}
        {markets.flatMap(({ market, name }) => [
          input(`rf_${market}`, { en: `R_f ${name.en} until loaded, %`, zh: `${name.zh} R_f（資料載入前，%）` }),
          input(`crp_${market}`, { en: `Country premium ${name.en}, %`, zh: `${name.zh}國家風險溢酬（%）` }),
        ])}
      </div>
      <label className="row">
        <input type="checkbox" name="checked" />
        <Bi en={`Inputs checked today${checkedOn ? ` (last ${checkedOn})` : ''}`} zh={`今天已確認輸入值${checkedOn ? `（上次 ${checkedOn}）` : ''}`} />
      </label>
      {checkedOn && <input type="hidden" name="checkedOn" value={checkedOn} />}
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
