/**
 * F15 fee and tax drag (costs page): fees, tax thresholds, brokers and fund costs.
 */
import { isIsoDate } from '../dates';
import type { Bilingual } from '../i18n';
import type { Broker, FeeSchedule, FeeSettings, FundCost, TaxSettings } from '../models/costs';
import { finish, MESSAGES, oneOf, optionalRate, parseNumber, previouslyChecked, ratePercent, text, wholeTwd, type FieldErrors, type Parsed, type RawForm } from './core';

/** US$ with at most two decimals; blank is null. */
function optionalUsd(raw: string | undefined): number | null | undefined {
  if (text(raw) === '') return null;
  const value = parseNumber(raw);
  return value === undefined || value < 0 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6 ? undefined : Math.round(value * 100) / 100;
}

export type FeeField = 'broker' | 'twRate' | 'twDiscount' | 'twMin' | 'fxSpread';

/** config fees: the 複委託 broker the estimates use, the Taiwan commission (rate, discount in 折, minimum) and the default FX spread. */
export function parseFeeForm(raw: RawForm, brokerIds: readonly string[]): Parsed<FeeSettings, FeeField> {
  const errors: FieldErrors<FeeField> = {};
  const broker = text(raw['broker']);
  if (broker !== '' && !brokerIds.includes(broker)) errors.broker = MESSAGES.choice;
  const rate = ratePercent(raw['twRate'], 0, 1);
  if (rate === undefined) errors.twRate = MESSAGES.rate;
  const discount = parseNumber(raw['twDiscount']);
  if (discount === undefined || discount <= 0 || discount > 10) errors.twDiscount = MESSAGES.discount;
  const minTwd = wholeTwd(raw['twMin']);
  if (minTwd === undefined) errors.twMin = MESSAGES.wholeTwdAmount;
  const fxSpread = ratePercent(raw['fxSpread'], 0, 5);
  if (fxSpread === undefined) errors.fxSpread = MESSAGES.rate;
  return finish(errors, () => ({
    brokerId: broker === '' ? null : broker,
    tw: { rate: rate ?? 0, discount: Math.round((discount ?? 10) * 1000) / 10_000, minTwd: minTwd ?? 0 },
    fxSpread: fxSpread ?? 0,
  }));
}

/** Field name of a domicile's withholding rate. */
export function withholdingField(domicile: string): string {
  return `withholding_${domicile}`;
}

export const TAX_FIELDS = ['twStock', 'twEtf', 'twBondEtf', 'amtFloor', 'amtExemption', 'amtRate', 'nhiRate', 'nhiSingle', 'nhiMax', 'estateMin', 'estateMax'] as const;

/** config tax: withholding per domicile already in it, then the Taiwan and US thresholds; `checked` stamps last_verified. */
export function parseTaxForm(raw: RawForm, domiciles: readonly string[]): Parsed<{ tax: TaxSettings; checked: boolean }, string> {
  const errors: FieldErrors<string> = {};
  const withholding: Record<string, number> = {};
  for (const domicile of domiciles) {
    const rate = ratePercent(raw[withholdingField(domicile)]);
    if (rate === undefined) errors[withholdingField(domicile)] = MESSAGES.rate;
    else withholding[domicile] = rate;
  }
  const rate = (name: string, max = 100) => {
    const value = ratePercent(raw[name], 0, max);
    if (value === undefined) errors[name] = MESSAGES.rate;
    return value ?? 0;
  };
  const amount = (name: string) => {
    const value = wholeTwd(raw[name]);
    if (value === undefined) errors[name] = MESSAGES.wholeTwdAmount;
    return value ?? 0;
  };
  const tax: TaxSettings = {
    withholding,
    twTransactionTax: { stock: rate('twStock', 10), etf: rate('twEtf', 10), bondEtf: rate('twBondEtf', 10) },
    amt: { overseasFloorTwd: amount('amtFloor'), exemptionTwd: amount('amtExemption'), rate: rate('amtRate', 99) },
    nhi: { rate: rate('nhiRate', 99), singlePaymentTwd: amount('nhiSingle'), maxPaymentTwd: amount('nhiMax') },
    usEstate: { minRate: rate('estateMin', 99), maxRate: rate('estateMax', 99) },
  };
  if (!errors['estateMax'] && !errors['estateMin'] && tax.usEstate.maxRate < tax.usEstate.minRate) errors['estateMax'] = MESSAGES.rateRange;
  return finish(errors, () => ({ tax, checked: raw['checked'] === 'on' }));
}

/** A schedule from its fields: a flat fee, or a rate with an optional minimum and maximum; all blank is none. */
function scheduleFrom(raw: RawForm, names: { rate?: string; min?: string; max?: string; flat?: string }, errors: FieldErrors<string>): FeeSchedule | null {
  const read = (name: string | undefined, parse: (value: string | undefined) => number | null | undefined, message: Bilingual) => {
    if (!name) return null;
    const value = parse(raw[name]);
    if (value === undefined) errors[name] = message;
    return value ?? null;
  };
  const flat = read(names.flat, optionalUsd, MESSAGES.usd);
  const rate = read(names.rate, (value) => optionalRate(value, 0, 10), MESSAGES.rate);
  const min = read(names.min, optionalUsd, MESSAGES.usd);
  const max = read(names.max, optionalUsd, MESSAGES.usd);
  if (flat !== null) return { rate: 0, min: 0, max: null, flat };
  if (rate === null) return null;
  return { rate, min: min ?? 0, max, flat: null };
}

export const LSE_CHOICES = ['yes', 'no', 'unknown'] as const;

/** A 複委託 broker's prices; `editing` is its id when it is being edited, else a new id is required and must be free. */
export function parseBrokerForm(raw: RawForm, takenIds: readonly string[], editing: string | null, today: string): Parsed<Broker, string> {
  const errors: FieldErrors<string> = {};
  const id = editing ?? text(raw['id']);
  if (editing === null) {
    if (!/^[a-z0-9_]{1,20}$/.test(id)) errors['id'] = MESSAGES.brokerId;
    else if (takenIds.includes(id)) errors['id'] = MESSAGES.idTaken;
  }
  const nameEn = text(raw['nameEn']);
  if (nameEn === '') errors['nameEn'] = MESSAGES.required;
  const usStock = scheduleFrom(raw, { rate: 'usRate', min: 'usMin' }, errors);
  if (usStock === null && !errors['usRate']) errors['usRate'] = MESSAGES.required;
  const usEtf = scheduleFrom(raw, { flat: 'etfFlat' }, errors);
  const usDca = scheduleFrom(raw, { flat: 'dcaFlat', rate: 'dcaRate', max: 'dcaMax' }, errors);
  const uk = scheduleFrom(raw, { rate: 'ukRate', min: 'ukMin' }, errors);
  const lse = oneOf(raw['lseEtfs'], LSE_CHOICES);
  if (!lse) errors['lseEtfs'] = MESSAGES.choice;
  const custody = ratePercent(raw['custody'], 0, 5);
  if (custody === undefined) errors['custody'] = MESSAGES.rate;
  const fxSpread = optionalRate(raw['fxSpread'], 0, 5);
  if (fxSpread === undefined) errors['fxSpread'] = MESSAGES.rate;
  const promo = text(raw['promoUntil']);
  if (promo !== '' && !isIsoDate(promo)) errors['promoUntil'] = MESSAGES.date;
  const source = text(raw['source']);
  const notes = { noteEn: text(raw['noteEn']), noteZh: text(raw['noteZh']) };
  for (const [name, value] of [['source', source], ['noteEn', notes.noteEn], ['noteZh', notes.noteZh]] as const) {
    if (value.length > 500) errors[name] = MESSAGES.tooLong;
  }
  return finish(errors, () => ({
    id,
    nameEn,
    nameZh: text(raw['nameZh']) || nameEn,
    usStock,
    usEtf,
    usDca,
    uk,
    lseEtfs: lse === 'yes' ? true : lse === 'no' ? false : null,
    custodyRate: custody ?? 0,
    fxSpread: fxSpread ?? null,
    promoUntil: promo === '' ? null : promo,
    ...notes,
    source,
    checked: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}

/** One fund's costs; `editing` is its ticker when it is being edited, else the ticker is required and must be new. */
export function parseFundForm(raw: RawForm, takenTickers: readonly string[], editing: string | null, assetClasses: ReadonlySet<string>, today: string): Parsed<FundCost, string> {
  const errors: FieldErrors<string> = {};
  const ticker = editing ?? text(raw['ticker']).toUpperCase();
  if (editing === null) {
    if (!/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)) errors['ticker'] = MESSAGES.tickerFormat;
    else if (takenTickers.includes(ticker)) errors['ticker'] = MESSAGES.tickerTaken;
  }
  const assetClassId = text(raw['assetClass']);
  if (!assetClasses.has(assetClassId)) errors['assetClass'] = MESSAGES.choice;
  const domicile = text(raw['domicile']).toUpperCase();
  if (!/^[A-Z]{2}$/.test(domicile)) errors['domicile'] = MESSAGES.country;
  const market = oneOf(raw['market'], ['US', 'TW', 'UK'] as const);
  if (!market) errors['market'] = MESSAGES.choice;
  const distribution = oneOf(raw['distribution'], ['acc', 'dist'] as const);
  if (!distribution) errors['distribution'] = MESSAGES.choice;
  const ter = optionalRate(raw['ter'], 0, 10);
  if (ter === undefined) errors['ter'] = MESSAGES.rate;
  const fundYield = optionalRate(raw['yield'], 0, 50);
  if (fundYield === undefined) errors['yield'] = MESSAGES.rate;
  const withholding = optionalRate(raw['withholding']);
  if (withholding === undefined) errors['withholding'] = MESSAGES.rate;
  const trackingDifference = optionalRate(raw['trackingDifference'], -10, 10);
  if (trackingDifference === undefined) errors['trackingDifference'] = MESSAGES.trackingDifference;
  const name = text(raw['name']);
  const source = text(raw['source']);
  const notes = { noteEn: text(raw['noteEn']), noteZh: text(raw['noteZh']) };
  for (const [field, value] of [['name', name], ['source', source], ['noteEn', notes.noteEn], ['noteZh', notes.noteZh]] as const) {
    if (value.length > 500) errors[field] = MESSAGES.tooLong;
  }
  return finish(errors, () => ({
    ticker,
    name: name || ticker,
    assetClassId,
    domicile,
    market: market ?? 'US',
    distribution: distribution ?? 'dist',
    ter: ter ?? null,
    yield: fundYield ?? null,
    withholding: withholding ?? null,
    trackingDifference: trackingDifference ?? null,
    ...notes,
    source,
    checked: raw['checked'] === 'on' ? today : previouslyChecked(raw),
  }));
}
