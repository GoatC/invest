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
        <Field label={{ en: 'Cooldown, days', zh: '冷卻期（天）' }} error={error('cooldownDays')} hint={<Bi en="Fires at most once in this many days unless its state changes." zh="除非狀態改變，這段天數內最多觸發一次。" />}>
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
};

/** config dca (amount, debit day) and proposal_expiry_days. */
export function SettingsForm({ initial }: { initial: Record<EngineSettingsField, string> }) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<EngineSettingsField>>(new Set());
  const [state, formAction, pending] = useActionState(saveEngineSettings, SETTINGS_STATE);
  const parsed = parseEngineSettings(values);
  const hints: Record<EngineSettingsField, Bilingual> = {
    dcaAmountTwd: { en: 'The contribution the monthly rule and the calculator start from.', zh: '每月投入規則與複利計算機使用的金額。' },
    dcaDay: { en: 'The monthly-contribution rule fires the day after; leave it blank to keep it waiting.', zh: '每月投入規則在扣款日隔天觸發；留白則暫不觸發。' },
    expiryDays: { en: 'Unactioned proposals close after this, and the rule is checked again.', zh: '未處理的提案在這段天數後關閉，並重新檢查規則。' },
  };

  function error(field: EngineSettingsField): Bilingual | null {
    if (!edited.has(field)) return state.errors[field] ?? null;
    return parsed.ok ? null : (parsed.errors[field] ?? null);
  }

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      <div className="form-grid">
        {(Object.keys(SETTING_LABELS) as EngineSettingsField[]).map((field) => (
          <Field key={field} label={SETTING_LABELS[field]} error={error(field)} hint={<Bi {...hints[field]} />}>
            <input
              name={field}
              inputMode="numeric"
              autoComplete="off"
              value={values[field]}
              onChange={(e) => {
                setEdited((previous) => new Set(previous).add(field));
                setValues((previous) => ({ ...previous, [field]: e.target.value }));
              }}
            />
          </Field>
        ))}
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
