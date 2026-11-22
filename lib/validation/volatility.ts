/**
 * N8 volatility alert: the score's settings, a calendar event and breaking news.
 */
import { isIsoDate } from '../dates';
import type { Bilingual } from '../i18n';
import { EVENT_KINDS, KIND_NAMES, type MarketEvent } from '../models/events';
import type { NewsSettings } from '../models/news';
import { COMPONENT_UNIT, type ComponentSetting, type VolatilitySettings } from '../models/volatility';
import { finish, MESSAGES, oneOf, parseNumber, previouslyChecked, text, type FieldErrors, type Parsed, type RawForm } from './core';

// ---------------------------------------------------------------------------
// N8 volatility score
// ---------------------------------------------------------------------------

const VOLATILITY_MESSAGES = {
  figure: { en: 'Enter a number.', zh: '請輸入數字。' },
  order: { en: 'Panic must be above calm.', zh: '恐慌值必須高於平靜值。' },
  weight: { en: 'Enter a weight of 0 or more; at least one above 0.', zh: '請輸入 0 或以上的權重，至少一個大於 0。' },
  maxAge: { en: 'Enter whole days from 1 to 30.', zh: '請輸入 1 到 30 的整數天數。' },
  coverage: { en: 'Enter a share from 1% to 100%.', zh: '請輸入 1% 到 100% 的比例。' },
  lead: { en: 'Enter whole days from 1 to 14.', zh: '請輸入 1 到 14 的整數天數。' },
} as const satisfies Record<string, Bilingual>;

/**
 * config volatility: each component's calm and panic figures and weight (fields `<id>_calm`,
 * `<id>_panic`, `<id>_weight`; a fall is typed in percent and kept as a share), the age past which
 * a figure is left out and the share of the weight a score needs; the rest of the row stays.
 */
export function parseVolatilityForm(raw: RawForm, current: VolatilitySettings, today: string): Parsed<VolatilitySettings, string> {
  const errors: FieldErrors<string> = {};
  const components: ComponentSetting[] = current.components.map((component) => {
    const scale = COMPONENT_UNIT[component.id] === 'share' ? 100 : 1;
    const calm = parseNumber(raw[`${component.id}_calm`]);
    const panic = parseNumber(raw[`${component.id}_panic`]);
    const weight = parseNumber(raw[`${component.id}_weight`]);
    if (calm === undefined) errors[`${component.id}_calm`] = VOLATILITY_MESSAGES.figure;
    if (panic === undefined) errors[`${component.id}_panic`] = VOLATILITY_MESSAGES.figure;
    else if (calm !== undefined && panic <= calm) errors[`${component.id}_panic`] = VOLATILITY_MESSAGES.order;
    if (weight === undefined || weight < 0) errors[`${component.id}_weight`] = VOLATILITY_MESSAGES.weight;
    const round = (value: number) => Number((value / scale).toFixed(6));
    return { id: component.id, calm: round(calm ?? 0), panic: round(panic ?? 0), weight: weight ?? 0 };
  });
  if (!errors[`${components[0]?.id}_weight`] && components.every((component) => component.weight === 0)) errors[`${components[0]?.id}_weight`] = VOLATILITY_MESSAGES.weight;
  const maxAge = parseNumber(raw['maxAgeDays']);
  if (maxAge === undefined || !Number.isInteger(maxAge) || maxAge < 1 || maxAge > 30) errors['maxAgeDays'] = VOLATILITY_MESSAGES.maxAge;
  const coverage = parseNumber(raw['minCoverage']);
  if (coverage === undefined || coverage < 1 || coverage > 100) errors['minCoverage'] = VOLATILITY_MESSAGES.coverage;
  const lead = parseNumber(raw['eventLeadDays']);
  if (lead === undefined || !Number.isInteger(lead) || lead < 1 || lead > 14) errors['eventLeadDays'] = VOLATILITY_MESSAGES.lead;
  return finish(errors, () => ({
    ...current,
    components,
    events: { leadDays: lead as number, remind: EVENT_KINDS.filter((kind) => raw[`remind_${kind}`] === 'on') },
    maxAgeDays: maxAge as number,
    minCoverage: Number(((coverage as number) / 100).toFixed(4)),
    lastVerified: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

export type EventField = 'kind' | 'date' | 'time' | 'name' | 'note';

const EVENT_MESSAGES = {
  kind: { en: "Choose Taiwan's central bank or another event.", zh: '請選擇央行理監事會議或其他事件。' },
  time: { en: 'Enter a Taipei time as HH:MM, or leave it blank.', zh: '請以 HH:MM 輸入台北時間，或留空。' },
  name: { en: 'Enter a name of up to 120 characters.', zh: '請輸入 120 字以內的名稱。' },
  note: { en: 'Up to 200 characters.', zh: '最多 200 字。' },
} as const satisfies Record<string, Bilingual>;

/** A typed event (N8 step 2): Taiwan's central bank meeting (its name given) or another event named by Hugo, at a Taipei date and optional time. */
export function parseEventForm(raw: RawForm): Parsed<MarketEvent, EventField> {
  const errors: FieldErrors<EventField> = {};
  const kind = oneOf(raw['kind'], ['cbc', 'other'] as const);
  if (!kind) errors.kind = EVENT_MESSAGES.kind;
  const date = text(raw['date']);
  if (!isIsoDate(date)) errors.date = MESSAGES.date;
  const time = text(raw['time']);
  if (time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = EVENT_MESSAGES.time;
  const name = text(raw['name']);
  if ((kind === 'other' && name === '') || name.length > 120) errors.name = EVENT_MESSAGES.name;
  const note = text(raw['note']);
  if (note.length > 200) errors.note = EVENT_MESSAGES.note;
  return finish(errors, () => ({
    kind: kind as 'cbc' | 'other',
    date,
    time: time || null,
    name: name ? { en: name, zh: name } : KIND_NAMES[kind as 'cbc' | 'other'],
    source: 'typed' as const,
    note: note || null,
  }));
}

// ---------------------------------------------------------------------------
// N8 breaking news
// ---------------------------------------------------------------------------

const NEWS_MESSAGES = {
  count: { en: 'Enter a whole number from 1 to 500.', zh: '請輸入 1 到 500 的整數。' },
  spike: { en: 'Enter a number from 1 to 20.', zh: '請輸入 1 到 20 的數字。' },
  hours: { en: 'Enter whole hours from 1 to 72.', zh: '請輸入 1 到 72 的整數小時。' },
  terms: { en: 'One term per line, at least one, each under 60 characters.', zh: '每行一個詞，至少一個，每個少於 60 字。' },
} as const satisfies Record<string, Bilingual>;

/** config news: the outlets needed, the spike, the window, the cooldown, the quiet-hours switch, and each topic's terms (one a line, field `terms_<id>`). */
export function parseNewsForm(raw: RawForm, current: NewsSettings): Parsed<NewsSettings, string> {
  const errors: FieldErrors<string> = {};
  const whole = (name: string, min: number, max: number, message: Bilingual) => {
    const value = parseNumber(raw[name]);
    if (value === undefined || !Number.isInteger(value) || value < min || value > max) errors[name] = message;
    return value ?? 0;
  };
  const minSources = whole('minSources', 1, 500, NEWS_MESSAGES.count);
  const windowHours = whole('windowHours', 1, 72, NEWS_MESSAGES.hours);
  const cooldownHours = whole('cooldownHours', 1, 72, NEWS_MESSAGES.hours);
  const spike = parseNumber(raw['spike']);
  if (spike === undefined || spike < 1 || spike > 20) errors['spike'] = NEWS_MESSAGES.spike;
  const topics = current.topics.map((topic) => {
    const name = `terms_${topic.id}`;
    const terms = (raw[name] ?? '').split('\n').map((term) => term.trim()).filter(Boolean);
    if (terms.length === 0 || terms.some((term) => term.length >= 60)) errors[name] = NEWS_MESSAGES.terms;
    return { ...topic, terms };
  });
  return finish(errors, () => ({ ...current, topics, minSources, windowHours, cooldownHours, spike: spike as number, pushInQuietHours: raw['pushInQuietHours'] === 'on' }));
}
