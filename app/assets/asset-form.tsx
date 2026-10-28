'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { Bi } from '@/components/bi';
import { Info } from '@/components/info';
import { Field } from '@/components/field';
import { twd } from '@/lib/format';
import { bi, LABELS, POOL, PRODUCT, SLEEVE, type Bilingual } from '@/lib/i18n';
import type { AssetClass, FxQuote } from '@/lib/models/types';
import { GRAMS_PER_TROY_OUNCE } from '@/lib/models/valuation';
import { parseManualAsset, parseNumber, type ManualAssetField } from '@/lib/validation';

import { saveAsset, type AssetFormState } from './actions';

/** The form's fields as typed, before parsing. */
export type AssetValues = Record<ManualAssetField, string>;

type Kind = 'gold' | 'cash_mmf';

const INITIAL_STATE: AssetFormState = { errors: {}, message: null };

function isKind(value: string): value is Kind {
  return value === 'gold' || value === 'cash_mmf';
}

export function AssetForm({
  assetClasses,
  defaultClass,
  goldPrice,
  today,
  id,
  initial,
}: {
  assetClasses: AssetClass[];
  /** The class each kind starts on, from the securities of the same kind. */
  defaultClass: Record<Kind, string>;
  /** The newest XAU/TWD (TWD per troy ounce) the nightly job loaded. */
  goldPrice: FxQuote | undefined;
  today: string;
  id?: number;
  initial: AssetValues;
}) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<ManualAssetField>>(new Set());
  // Price per gram is a helper for the value; only the value is stored. It starts at the loaded gold price.
  const perGram = goldPrice ? Math.round(goldPrice.rate / GRAMS_PER_TROY_OUNCE) : undefined;
  const [gramPrice, setGramPrice] = useState(perGram === undefined ? '' : String(perGram));
  const [state, formAction, pending] = useActionState(saveAsset, INITIAL_STATE);
  const classMap = useMemo(() => new Map(assetClasses.map((assetClass) => [assetClass.id, assetClass])), [assetClasses]);
  const isGold = values.productType === 'gold';

  function goldValue(grams: string, perGram: string): string | undefined {
    const g = parseNumber(grams);
    const price = parseNumber(perGram);
    return g === undefined || price === undefined ? undefined : String(Math.round(g * price));
  }

  function change(field: ManualAssetField, value: string) {
    setEdited((previous) => new Set(previous).add(field));
    setValues((previous) => {
      const next = { ...previous, [field]: value };
      // Switching between gold and cash moves the class along, unless it was picked by hand.
      if (field === 'productType' && isKind(value) && isKind(previous.productType) && previous.assetClassId === defaultClass[previous.productType]) {
        next.assetClassId = defaultClass[value];
      }
      if (field === 'quantity' && previous.productType === 'gold' && gramPrice) next.lastValueTwd = goldValue(value, gramPrice) ?? previous.lastValueTwd;
      // A new balance or value is as of today unless a date is picked.
      const revalued = field === 'quantity' || field === 'lastValueTwd';
      if (revalued && !edited.has('valuedOn') && next.valuedOn !== today) next.valuedOn = today;
      return next;
    });
  }

  function changeGramPrice(price: string) {
    setGramPrice(price);
    const value = goldValue(values.quantity, price);
    if (value !== undefined) change('lastValueTwd', value);
  }

  const parsed = parseManualAsset(values, classMap, today);

  function error(field: ManualAssetField): Bilingual | null {
    const server = edited.has(field) ? undefined : state.errors[field];
    const live = edited.has(field) && values[field] !== '' && !parsed.ok ? parsed.errors[field] : undefined;
    return server ?? live ?? null;
  }

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      <div className="form-grid">
        <Field label={LABELS.name} error={error('name')} hint={<Bi en="e.g. Gold bar, bank savings" zh="例如：金條、銀行活存" />}>
          <input name="name" maxLength={120} required value={values.name} onChange={(e) => change('name', e.target.value)} />
        </Field>
        <Field label={LABELS.productType} error={error('productType')}>
          <select name="productType" value={values.productType} onChange={(e) => change('productType', e.target.value)}>
            <option value="gold">{bi({ en: 'Physical gold', zh: '實體黃金' })}</option>
            <option value="cash_mmf">{bi(PRODUCT.cash_mmf)}</option>
          </select>
        </Field>
        <Field label={LABELS.assetClass} error={error('assetClassId')}>
          <select name="assetClassId" value={values.assetClassId} onChange={(e) => change('assetClassId', e.target.value)}>
            {assetClasses.map((assetClass) => (
              <option key={assetClass.id} value={assetClass.id}>
                {`${assetClass.nameEn} ${assetClass.nameZh} · ${bi(SLEEVE[assetClass.sleeve])}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label={isGold ? { en: 'Grams', zh: '克數' } : { en: 'Balance (TWD)', zh: '餘額（台幣）' }} error={error('quantity')}>
          <input name="quantity" inputMode="decimal" required value={values.quantity} onChange={(e) => change('quantity', e.target.value)} />
        </Field>
        {isGold && (
          <>
            <Field
              label={{ en: 'Gold price per gram (TWD)', zh: '每克金價（台幣）' }}
              hint={
                goldPrice && perGram !== undefined ? (
                  <Bi en={`${twd(perGram)} on ${goldPrice.date}, loaded nightly; fills in the value`} zh={`${goldPrice.date} 為 ${twd(perGram)}（每夜載入），自動算出估值`} />
                ) : (
                  <Bi en="Optional; fills in the value" zh="選填，自動算出估值" />
                )
              }
            >
              <input inputMode="decimal" value={gramPrice} onChange={(e) => changeGramPrice(e.target.value)} />
            </Field>
            <Field
              label={LABELS.lastValue}
              error={error('lastValueTwd')}
              hint={<Bi en="Until a gold price loads" zh="金價載入前使用" />}
            >
              <input name="lastValueTwd" inputMode="decimal" value={values.lastValueTwd} onChange={(e) => change('lastValueTwd', e.target.value)} />
            </Field>
          </>
        )}
        <Field
          label={isGold ? LABELS.valuedOn : { en: 'Balance as of', zh: '餘額日期' }}
          error={error('valuedOn')}
          hint={<Bi en="Blank means today" zh="空白表示今天" />}
        >
          <input type="date" name="valuedOn" max={today} value={values.valuedOn} onChange={(e) => change('valuedOn', e.target.value)} />
        </Field>
        <Field label={LABELS.pool} error={error('pool')}>
          <select name="pool" value={values.pool} onChange={(e) => change('pool', e.target.value)}>
            <option value="regular">{bi(POOL.regular)}</option>
            <option value="windfall">{bi(POOL.windfall)}</option>
          </select>
        </Field>
      </div>
      {isGold && (
        <Info>
          <Bi
            en="The holdings page values gold every night at grams × the international gold price in TWD (the US dollar price at the Bank of Taiwan rate); the value entered here counts only until the nightly job has loaded a gold price."
            zh="持倉頁每夜以「克數 × 國際金價換算台幣」（美元金價乘以臺灣銀行匯率）計算黃金市值；這裡輸入的估值只在每夜排程尚未載入金價時使用。"
          />
        </Info>
      )}
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
        <Link href="/holdings" className="button">
          <Bi {...LABELS.cancel} />
        </Link>
      </div>
    </form>
  );
}
