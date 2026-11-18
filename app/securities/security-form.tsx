'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { likelyAssetClass } from '@/lib/defaults';
import { bi, LABELS, MARKET, PRODUCT, SLEEVE, type Bilingual } from '@/lib/i18n';
import type { AssetClass, Market, ProductType, Security } from '@/lib/models/types';
import { parseSecurity, PRODUCT_TYPES, type SecurityField } from '@/lib/validation';

import { addSecurity, updateSecurity, type SecurityFormState } from './actions';

/** The form's fields as typed, before parsing. */
export type SecurityValues = Record<SecurityField, string>;

const INITIAL_STATE: SecurityFormState = { errors: {}, message: null };

/** Where a market's listings usually trade and are registered; London lines vary, so they start blank. */
const MARKET_DEFAULTS: Record<Market, { currency: string; domicile: string }> = {
  US: { currency: 'USD', domicile: 'US' },
  TW: { currency: 'TWD', domicile: 'TW' },
  UK: { currency: '', domicile: '' },
};

function isMarket(value: string): value is Market {
  return value === 'US' || value === 'TW' || value === 'UK';
}

function isProductType(value: string): value is ProductType {
  return (PRODUCT_TYPES as readonly string[]).includes(value);
}

export function SecurityForm({
  assetClasses,
  securities,
  next,
  initial,
  editing = false,
}: {
  assetClasses: AssetClass[];
  securities: Security[];
  next?: string;
  initial: SecurityValues;
  /** Editing a saved security: its ticker stays and nothing is filled in automatically. */
  editing?: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState<ReadonlySet<SecurityField>>(new Set());
  const [state, formAction, pending] = useActionState(editing ? updateSecurity : addSecurity, INITIAL_STATE);
  const classMap = useMemo(() => new Map(assetClasses.map((assetClass) => [assetClass.id, assetClass])), [assetClasses]);
  const tickers = useMemo(
    () => new Set(securities.map((security) => security.ticker).filter((ticker) => !editing || ticker !== initial.ticker)),
    [securities, editing, initial.ticker],
  );

  function change(field: SecurityField, value: string) {
    setEdited((previous) => new Set(previous).add(field));
    setValues((previous) => {
      const updated = { ...previous, [field]: value };
      if (editing) return updated;
      // Fields not typed by hand follow the market and product type.
      if (field === 'market' && isMarket(value)) {
        if (!edited.has('currency')) updated.currency = MARKET_DEFAULTS[value].currency;
        if (!edited.has('domicile')) updated.domicile = MARKET_DEFAULTS[value].domicile;
      }
      if ((field === 'market' || field === 'productType') && !edited.has('assetClassId') && isMarket(updated.market) && isProductType(updated.productType)) {
        updated.assetClassId = likelyAssetClass(securities, updated.productType, updated.market) ?? '';
      }
      return updated;
    });
  }

  const parsed = parseSecurity(values, tickers, classMap);
  const chosenClass = classMap.get(values.assetClassId);
  const refiled = editing && (values.productType !== initial.productType || values.assetClassId !== initial.assetClassId);

  function error(field: SecurityField): Bilingual | null {
    const server = edited.has(field) ? undefined : state.errors[field];
    const live = edited.has(field) && values[field] !== '' && !parsed.ok ? parsed.errors[field] : undefined;
    return server ?? live ?? null;
  }

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="form-grid">
        <Field
          label={LABELS.ticker}
          error={error('ticker')}
          hint={
            editing ? (
              <Bi en="Fixed: every trade refers to it" zh="代號不可修改：每筆交易都以它為準" />
            ) : (
              <Bi en="As your broker shows it, e.g. VT, 0050" zh="與券商顯示相同，例如 VT、0050" />
            )
          }
        >
          <input
            name="ticker"
            maxLength={12}
            autoCapitalize="characters"
            autoComplete="off"
            required
            readOnly={editing}
            value={values.ticker}
            onChange={(e) => change('ticker', e.target.value.toUpperCase())}
          />
        </Field>
        <Field label={LABELS.name} error={error('name')}>
          <input name="name" maxLength={120} required value={values.name} onChange={(e) => change('name', e.target.value)} />
        </Field>
        <Field label={LABELS.market} error={error('market')}>
          <select name="market" value={values.market} onChange={(e) => change('market', e.target.value)}>
            {(['US', 'TW', 'UK'] as const).map((market) => (
              <option key={market} value={market}>
                {bi(MARKET[market])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={LABELS.productType} error={error('productType')}>
          <select name="productType" value={values.productType} onChange={(e) => change('productType', e.target.value)}>
            {PRODUCT_TYPES.map((type) => (
              <option key={type} value={type}>
                {bi(PRODUCT[type])}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={LABELS.assetClass}
          error={error('assetClassId')}
          hint={chosenClass ? <Bi en={`Counts toward the ${SLEEVE[chosenClass.sleeve].en.toLowerCase()} sleeve`} zh={`計入${SLEEVE[chosenClass.sleeve].zh}部位`} /> : undefined}
        >
          <select name="assetClassId" value={values.assetClassId} onChange={(e) => change('assetClassId', e.target.value)}>
            <option value="">{bi({ en: 'Choose…', zh: '請選擇…' })}</option>
            {assetClasses.map((assetClass) => (
              <option key={assetClass.id} value={assetClass.id}>
                {`${assetClass.nameEn} ${assetClass.nameZh} · ${bi(SLEEVE[assetClass.sleeve])}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label={LABELS.currency} error={error('currency')} hint={<Bi en="The currency it trades in" zh="交易使用的幣別" />}>
          <input name="currency" maxLength={3} autoCapitalize="characters" required value={values.currency} onChange={(e) => change('currency', e.target.value.toUpperCase())} />
        </Field>
        <Field
          label={LABELS.domicile}
          error={error('domicile')}
          hint={<Bi en="Where the fund is registered: US for US ETFs, IE for Irish UCITS ETFs" zh="基金註冊地：美國 ETF 為 US，愛爾蘭 UCITS ETF 為 IE" />}
        >
          <input name="domicile" maxLength={2} autoCapitalize="characters" required value={values.domicile} onChange={(e) => change('domicile', e.target.value.toUpperCase())} />
        </Field>
      </div>
      {refiled && (
        <p className="banner info">
          <Bi
            en="This re-files every trade in this security: R1 checks only individual stocks, and the asset class decides the sleeve (R2) and the weights."
            zh="這會改變這檔證券所有交易的歸類：R1 只檢查個股，資產類別決定所屬部位（R2）與權重。"
          />
        </p>
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
        <Link href={editing ? '/holdings#securities' : next && next.startsWith('/holdings/') ? next : '/holdings'} className="button">
          <Bi {...LABELS.cancel} />
        </Link>
      </div>
    </form>
  );
}
