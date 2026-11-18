'use client';

import { useActionState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { bi, LABELS } from '@/lib/i18n';
import { EVENT_KINDS, KIND_NAMES } from '@/lib/models/events';
import type { NewsSettings } from '@/lib/models/news';
import type { VolatilitySettings } from '@/lib/models/volatility';
import { COMPONENT_TEXT, formFigure, unitText } from '@/lib/volatility-text';

import { addMarketEvent, saveNewsSettings, saveVolatilitySettings, type VolatilityFormState } from './actions';

const INITIAL: VolatilityFormState = { errors: {}, message: null };

/** config volatility: each component's calm and panic figures and weight, the age limit and the coverage needed. */
export function VolatilitySettingsForm({ settings }: { settings: VolatilitySettings }) {
  const [state, action, pending] = useActionState(saveVolatilitySettings, INITIAL);
  const error = (name: string) => state.errors[name] ?? null;
  return (
    <form action={action} className="form">
      {settings.lastVerified && <input type="hidden" name="checkedOn" value={settings.lastVerified} />}
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      {settings.components.map((component) => {
        const unit = unitText(component.id);
        return (
          <fieldset key={component.id} className="row">
            <legend>
              <Bi {...COMPONENT_TEXT[component.id].name} />
            </legend>
            <Field label={{ en: `Calm (score 0)${unit ? `, ${unit}` : ''}`, zh: `平靜（0 分）${unit ? `，${unit}` : ''}` }} error={error(`${component.id}_calm`)}>
              <input name={`${component.id}_calm`} inputMode="decimal" defaultValue={formFigure(component.id, component.calm)} />
            </Field>
            <Field label={{ en: `Panic (score 10)${unit ? `, ${unit}` : ''}`, zh: `恐慌（10 分）${unit ? `，${unit}` : ''}` }} error={error(`${component.id}_panic`)}>
              <input name={`${component.id}_panic`} inputMode="decimal" defaultValue={formFigure(component.id, component.panic)} />
            </Field>
            <Field label={{ en: 'Weight', zh: '權重' }} error={error(`${component.id}_weight`)}>
              <input name={`${component.id}_weight`} inputMode="decimal" defaultValue={String(component.weight)} />
            </Field>
          </fieldset>
        );
      })}
      <div className="row">
        <Field label={{ en: 'Leave out figures older than (days)', zh: '超過幾天的數值不計入（天）' }} error={error('maxAgeDays')}>
          <input name="maxAgeDays" inputMode="numeric" defaultValue={String(settings.maxAgeDays)} />
        </Field>
        <Field label={{ en: 'Weight needed for a score, %', zh: '計分所需涵蓋權重，%' }} error={error('minCoverage')}>
          <input name="minCoverage" inputMode="decimal" defaultValue={String(Number((settings.minCoverage * 100).toFixed(2)))} />
        </Field>
      </div>
      <fieldset className="row">
        <legend>
          <Bi en="Event reminders" zh="事件提醒" />
        </legend>
        <Field label={{ en: 'Days before the event', zh: '事件前幾天提醒' }} error={error('eventLeadDays')}>
          <input name="eventLeadDays" inputMode="numeric" defaultValue={String(settings.events.leadDays)} />
        </Field>
        {EVENT_KINDS.map((kind) => (
          <label key={kind} className="row">
            <input type="checkbox" name={`remind_${kind}`} defaultChecked={settings.events.remind.includes(kind)} />
            <Bi {...KIND_NAMES[kind]} />
          </label>
        ))}
      </fieldset>
      <label className="row">
        <input type="checkbox" name="checked" />
        <Bi en={`Checked the figures today${settings.lastVerified ? ` (last ${settings.lastVerified})` : ''}`} zh={`今天已確認數值${settings.lastVerified ? `（上次 ${settings.lastVerified}）` : ''}`} />
      </label>
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </form>
  );
}

/** A typed event: Taiwan's central bank meeting (from its yearly press release) or another, such as an election. */
export function EventForm() {
  const [state, action, pending] = useActionState(addMarketEvent, INITIAL);
  const error = (name: string) => state.errors[name] ?? null;
  return (
    <form action={action} className="form" id="event-form">
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <Field label={{ en: 'Kind', zh: '類別' }} error={error('kind')}>
          <select name="kind" defaultValue="other">
            <option value="other">{bi(KIND_NAMES.other)}</option>
            <option value="cbc">{bi(KIND_NAMES.cbc)}</option>
          </select>
        </Field>
        <Field label={{ en: 'Date (Taipei)', zh: '日期（台北）' }} error={error('date')}>
          <input name="date" type="date" required />
        </Field>
        <Field label={{ en: 'Time (Taipei), optional', zh: '時間（台北），可留空' }} error={error('time')}>
          <input name="time" type="time" />
        </Field>
      </div>
      <Field
        label={{ en: 'Name', zh: '名稱' }}
        hint={<Bi en="e.g. 2028 presidential election; blank for a central bank meeting." zh="例如 2028 總統大選；央行理監事會議可留空。" />}
        error={error('name')}
      >
        <input name="name" maxLength={120} />
      </Field>
      <Field label={{ en: 'Note, optional', zh: '備註，可留空' }} error={error('note')}>
        <input name="note" maxLength={200} />
      </Field>
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : { en: 'Add event', zh: '新增事件' })} />
        </button>
      </div>
    </form>
  );
}

/** config news: the counts and the switch, and each topic's terms, one a line. */
export function NewsSettingsForm({ settings }: { settings: NewsSettings }) {
  const [state, action, pending] = useActionState(saveNewsSettings, INITIAL);
  const error = (name: string) => state.errors[name] ?? null;
  return (
    <form action={action} className="form" id="news-settings">
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <Field label={{ en: 'Outlets needed', zh: '最少媒體家數' }} error={error('minSources')}>
          <input name="minSources" inputMode="numeric" defaultValue={String(settings.minSources)} />
        </Field>
        <Field label={{ en: '× usual count', zh: '平常家數倍數' }} error={error('spike')}>
          <input name="spike" inputMode="decimal" defaultValue={String(settings.spike)} />
        </Field>
        <Field label={{ en: 'Window, hours', zh: '統計時窗（小時）' }} error={error('windowHours')}>
          <input name="windowHours" inputMode="numeric" defaultValue={String(settings.windowHours)} />
        </Field>
        <Field label={{ en: 'Again after, hours', zh: '再次通知間隔（小時）' }} error={error('cooldownHours')}>
          <input name="cooldownHours" inputMode="numeric" defaultValue={String(settings.cooldownHours)} />
        </Field>
      </div>
      <label className="row">
        <input type="checkbox" name="pushInQuietHours" defaultChecked={settings.pushInQuietHours} />
        <Bi en="Push in the quiet hours too" zh="安靜時段照樣推播" />
      </label>
      {settings.topics.map((topic) => (
        <Field key={topic.id} label={topic.name} error={error(`terms_${topic.id}`)}>
          <textarea name={`terms_${topic.id}`} rows={3} defaultValue={topic.terms.join('\n')} />
        </Field>
      ))}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
      </div>
    </form>
  );
}
