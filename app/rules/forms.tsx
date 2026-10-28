'use client';

import { useActionState, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { percent } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { parseEngineSettings, parseRuleForm, thresholdField, type EngineSettingsField } from '@/lib/validation';

import { saveEngineSettings, saveRule, type RuleFormState, type SettingsFormState } from './actions';

const RULE_STATE: RuleFormState = { errors: {}, message: null };
const SETTINGS_STATE: SettingsFormState = { errors: {}, message: null };

/** Threshold keys in words; the stored key is shown too, as in the rules table. */
const KEYS: Record<string, Bilingual> = {
  max_weight: { en: 'Most a single stock may be', zh: '單一個股上限' },
  trigger_weight: { en: 'Satellite trigger', zh: '衛星觸發點' },
  target_weight: { en: 'Satellite target', zh: '衛星目標' },
  abs_drift: { en: 'Drift band, absolute', zh: '偏離門檻（絕對）' },
  rel_drift: { en: 'Drift band, share of the target', zh: '偏離門檻（目標的比例）' },
  max_classes: { en: 'Most classes one buy list spreads over', zh: '每份買進清單最多類別數' },
  satellite_share_with_buy_alert: { en: 'Satellite share of a contribution during a buy-zone alert', zh: '買入區警報時投入衛星的比例上限' },
  month: { en: 'Month', zh: '月份' },
  usd: { en: 'US-situs assets above, US$', zh: '美國資產超過（美元）' },
  multiple: { en: 'Multiple of the base value', zh: '基本情境內在價值的倍數' },
  sell_share: { en: 'Share of the holding sold', zh: '賣出持股的比例' },
  change: { en: 'Change in value that prompts a review', zh: '提醒檢視的價值變動幅度' },
};

function label(key: string): Bilingual {
  const words = KEYS[key];
  return words ? { en: `${words.en} (${key})`, zh: `${words.zh}（${key}）` } : { en: key, zh: key };
}

/** A rule's on/off, cooldown and the numbers in its threshold. */
export function RuleForm({ id, enabled, cooldownDays, threshold }: { id: string; enabled: boolean; cooldownDays: number; threshold: Record<string, unknown> }) {
  const numbers = Object.entries(threshold).filter((entry): entry is [string, number] => typeof entry[1] === 'number');
  const [values, setValues] = useState<Record<string, string>>(() => ({
    cooldownDays: String(cooldownDays),
    ...(enabled ? { enabled: 'on' } : {}),
    ...Object.fromEntries(numbers.map(([key, value]) => [thresholdField(key), String(value)])),
  }));
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [state, formAction, pending] = useActionState(saveRule, RULE_STATE);
  const parsed = parseRuleForm(values, threshold);

  function change(name: string, value: string | undefined) {
    setEdited((previous) => new Set(previous).add(name));
    setValues((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
  }

  function error(name: string): Bilingual | null {
    if (!edited.has(name)) return state.errors[name] ?? null;
    return parsed.ok ? null : (parsed.errors[name] ?? null);
  }

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      <input type="hidden" name="id" value={id} />
      <label className="row">
        <input type="checkbox" name="enabled" checked={values['enabled'] === 'on'} onChange={(e) => change('enabled', e.target.checked ? 'on' : undefined)} />
        <Bi en="On: the engine evaluates it" zh="啟用：規則引擎會評估這條規則" />
      </label>
      <div className="form-grid">
        <Field label={{ en: 'Cooldown, days', zh: '冷卻期（天）' }} error={error('cooldownDays')} hint={<Bi en="Once per this many days." zh="這段天數內最多一次。" />}>
          <input name="cooldownDays" inputMode="numeric" autoComplete="off" value={values['cooldownDays'] ?? ''} onChange={(e) => change('cooldownDays', e.target.value)} />
        </Field>
        {numbers.map(([key, was]) => {
          const name = thresholdField(key);
          const typed = Number(values[name]);
          const hint = was > 0 && was < 1 && Number.isFinite(typed) ? <Bi en={`= ${percent(typed, 2)}`} zh={`＝ ${percent(typed, 2)}`} /> : undefined;
          return (
            <Field key={key} label={label(key)} error={error(name)} hint={hint}>
              <input name={name} inputMode="decimal" autoComplete="off" value={values[name] ?? ''} onChange={(e) => change(name, e.target.value)} />
            </Field>
          );
        })}
      </div>
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : { en: `Save ${id}`, zh: `儲存 ${id}` })} />
        </button>
      </div>
    </form>
  );
}

const SETTING_LABELS: Record<EngineSettingsField, Bilingual> = {
  dcaAmountTwd: { en: 'Monthly DCA amount, NT$', zh: '每月定期定額金額，台幣' },
  dcaDay: { en: 'DCA debit day of the month', zh: '每月扣款日' },
  expiryDays: { en: 'Days a proposal stays open', zh: '提案保留天數' },
  fractionalUs: { en: 'US shares in fractions (複委託 零股)', zh: '美股以零股（小數股）下單' },
  fractionalUk: { en: 'UK shares in fractions', zh: '英股以零股（小數股）下單' },
  shareDecimals: { en: 'Decimals of a share', zh: '股數小數位數' },
};

const TEXT_FIELDS: readonly EngineSettingsField[] = ['dcaAmountTwd', 'dcaDay', 'expiryDays', 'shareDecimals'];
const CHECKBOXES: readonly EngineSettingsField[] = ['fractionalUs', 'fractionalUk'];

/** config dca (amount, debit day), proposal_expiry_days, and how orders round shares (config orders). */
export function SettingsForm({ initial }: { initial: Record<EngineSettingsField, string> }) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<EngineSettingsField>>(new Set());
  const [state, formAction, pending] = useActionState(saveEngineSettings, SETTINGS_STATE);
  const parsed = parseEngineSettings(values);
  const hints: Partial<Record<EngineSettingsField, Bilingual>> = {
    dcaDay: { en: 'Blank: the monthly rule waits.', zh: '留白：每月規則暫停。' },
    shareDecimals: { en: 'Taiwan: whole shares.', zh: '台股以整股計。' },
  };

  function change(field: EngineSettingsField, value: string) {
    setEdited((previous) => new Set(previous).add(field));
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  function error(field: EngineSettingsField): Bilingual | null {
    if (!edited.has(field)) return state.errors[field] ?? null;
    return parsed.ok ? null : (parsed.errors[field] ?? null);
  }

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      <div className="form-grid">
        {TEXT_FIELDS.map((field) => (
          <Field key={field} label={SETTING_LABELS[field]} error={error(field)} hint={hints[field] && <Bi {...hints[field]} />}>
            <input name={field} inputMode="numeric" autoComplete="off" value={values[field]} onChange={(e) => change(field, e.target.value)} />
          </Field>
        ))}
      </div>
      <fieldset className="form">
        <legend>
          <Bi en="Orders in fractions of a share" zh="以零股（小數股）下單" />
        </legend>
        {CHECKBOXES.map((field) => (
          <label key={field} className="row">
            <input type="checkbox" name={field} checked={values[field] === 'on'} onChange={(e) => change(field, e.target.checked ? 'on' : '')} />
            <Bi {...SETTING_LABELS[field]} />
          </label>
        ))}
      </fieldset>
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
