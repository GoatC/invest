'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { FxRateHint, FxTypoWarning } from '@/components/fx-rate';
import type { HoldingsData } from '@/lib/data';
import { isIsoDate } from '@/lib/dates';
import { twd } from '@/lib/format';
import { bi, FLOW_TYPE, LABELS, POOL, type Bilingual } from '@/lib/i18n';
import { rateHistory, rateOn, suggestedRate } from '@/lib/models/fx';
import { buildPositions } from '@/lib/models/positions';
import { restateTrades } from '@/lib/models/splits';
import type { FlowType, FxQuote } from '@/lib/models/types';
import { latestFx } from '@/lib/models/valuation';
import { FLOW_TYPES, parseCashFlow, parseNumber, type CashFlowField } from '@/lib/validation';

import { saveCashFlow, type CashFlowFormState } from './actions';

/** The form's fields as typed, before parsing. */
export type CashFlowValues = Record<CashFlowField, string>;

const INITIAL_STATE: CashFlowFormState = { errors: {}, message: null };

const TYPE_HINT: Record<FlowType, Bilingual> = {
  contribution: {
    en: 'Money you put in, such as the monthly DCA debit; record the shares it buys as trades too.',
    zh: '你投入的資金，例如每月定期定額扣款；買到的股數另外記成交易。',
  },
  windfall: { en: 'The windfall arriving; it always goes to the windfall pool.', zh: '大額資金入帳，一律計入大額資金池。' },
  dividend: { en: 'Cash a holding paid out, after any tax withheld.', zh: '持股發放的現金股利，填扣除預扣稅後實際收到的金額。' },
  withdrawal: { en: 'Money taken out of the portfolio.', zh: '從投資組合提領出去的資金。' },
};

function isFlowType(value: string): value is FlowType {
  return (FLOW_TYPES as readonly string[]).includes(value);
}

export function CashFlowForm({ data, rates, today, id, initial }: { data: HoldingsData; rates: FxQuote[]; today: string; id?: number; initial: CashFlowValues }) {
  const [values, setValues] = useState(initial);
  // Fields changed since the last submit: their server errors are stale, their live errors are fresh.
  const [edited, setEdited] = useState<ReadonlySet<CashFlowField>>(new Set());
  // A rate typed by hand, or saved with the entry being edited, is never replaced by a suggestion.
  const [ownRate, setOwnRate] = useState(id !== undefined);
  const [state, formAction, pending] = useActionState(saveCashFlow, INITIAL_STATE);

  const securities = useMemo(() => new Map(data.securities.map((security) => [security.ticker, security])), [data.securities]);
  const fx = useMemo(() => latestFx(data.fx, data.trades), [data.fx, data.trades]);
  const history = useMemo(() => rateHistory(rates), [rates]);
  const positions = useMemo(() => buildPositions(restateTrades(data.trades, data.splits)).positions, [data.trades, data.splits]);
  const type = isFlowType(values.type) ? values.type : 'contribution';
  const currency = values.currency.trim().toUpperCase();
  const security = type === 'dividend' ? securities.get(values.ticker.trim().toUpperCase()) : undefined;

  function change(field: CashFlowField, value: string) {
    setEdited((previous) => new Set(previous).add(field));
    const next = { ...values, [field]: value };
    if (field === 'type') {
      if (value === 'windfall') next.pool = 'windfall';
      // Only a dividend comes in a security's currency; the other types start in TWD.
      if (value !== 'dividend') next.currency = 'TWD';
      else next.currency = securities.get(next.ticker.trim().toUpperCase())?.currency ?? next.currency;
    }
    const match = field === 'ticker' ? securities.get(value.trim().toUpperCase()) : undefined;
    if (match) {
      next.currency = match.currency;
      // The pool that holds the security, when only one does.
      const pools = positions.filter((position) => position.ticker === match.ticker && position.qty > 0).map((position) => position.pool);
      if (pools.length === 1 && pools[0]) next.pool = pools[0];
    }
    const nextCurrency = next.currency.trim().toUpperCase();
    const currencyChanged = nextCurrency !== currency;
    // A new currency needs a new rate; a new date, the rate of that date unless one was typed.
    if (currencyChanged || (field === 'flowDate' && !ownRate)) {
      next.fxRate = String(suggestedRate(nextCurrency, next.flowDate, history, data.fxMaxAgeDays, fx) ?? '');
    }
    setValues(next);
    setOwnRate(field === 'fxRate' || (ownRate && !currencyChanged));
  }

  const parsed = parseCashFlow(values, securities, today);

  function error(field: CashFlowField): Bilingual | null {
    const server = edited.has(field) ? undefined : state.errors[field];
    const live = edited.has(field) && values[field] !== '' && !parsed.ok ? parsed.errors[field] : undefined;
    return server ?? live ?? null;
  }

  const foreign = currency !== '' && currency !== 'TWD';
  const latestRate = foreign ? fx.get(currency) : undefined;
  const datedRate = foreign && data.fxMaxAgeDays !== null && isIsoDate(values.flowDate) ? rateOn(history, currency, values.flowDate, data.fxMaxAgeDays) : undefined;
  const dated = datedRate ? { value: datedRate.rate, date: datedRate.date } : undefined;
  const amount = parseNumber(values.amount);
  const rate = currency === 'TWD' ? 1 : parseNumber(values.fxRate);
  const inTwd = amount !== undefined && amount > 0 && rate !== undefined && rate > 0 ? amount * rate : undefined;

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      <div className="form-grid">
        <Field label={LABELS.flowType} error={error('type')} hint={<Bi {...TYPE_HINT[type]} />}>
          <select name="type" value={values.type} onChange={(e) => change('type', e.target.value)}>
            {FLOW_TYPES.map((option) => (
              <option key={option} value={option}>
                {bi(FLOW_TYPE[option])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={LABELS.flowDate} error={error('flowDate')}>
          <input type="date" name="flowDate" value={values.flowDate} max={today} required onChange={(e) => change('flowDate', e.target.value)} />
        </Field>
        {type === 'dividend' && (
          <>
            <Field label={LABELS.ticker} error={error('ticker')} hint={security?.name}>
              <input name="ticker" list="flow-ticker-options" autoComplete="off" value={values.ticker} required onChange={(e) => change('ticker', e.target.value)} />
            </Field>
            <datalist id="flow-ticker-options">
              {data.securities.map((option) => (
                <option key={option.ticker} value={option.ticker}>
                  {option.name}
                </option>
              ))}
            </datalist>
          </>
        )}
        <Field
          label={LABELS.amount}
          error={error('amount')}
          hint={
            currency ? (
              <Bi en={`In ${currency}${inTwd !== undefined && foreign ? ` = ${twd(inTwd)}` : ''}`} zh={`以 ${currency} 計${inTwd !== undefined && foreign ? `，約 ${twd(inTwd)}` : ''}`} />
            ) : undefined
          }
        >
          <input name="amount" inputMode="decimal" value={values.amount} required onChange={(e) => change('amount', e.target.value)} />
        </Field>
        <Field label={LABELS.flowCurrency} error={error('currency')}>
          <input name="currency" maxLength={3} autoCapitalize="characters" value={values.currency} onChange={(e) => change('currency', e.target.value)} />
        </Field>
        <Field label={LABELS.fxRate} error={error('fxRate')} hint={<FxRateHint currency={currency} dated={dated} latest={latestRate} />}>
          <input name="fxRate" inputMode="decimal" value={values.fxRate} readOnly={currency === 'TWD'} required onChange={(e) => change('fxRate', e.target.value)} />
        </Field>
        <Field
          label={LABELS.pool}
          error={error('pool')}
          hint={type === 'windfall' ? <Bi en="The windfall always goes to the windfall pool" zh="大額資金一律計入大額資金池" /> : undefined}
        >
          <select name="pool" value={type === 'windfall' ? 'windfall' : values.pool} disabled={type === 'windfall'} onChange={(e) => change('pool', e.target.value)}>
            <option value="regular">{bi(POOL.regular)}</option>
            <option value="windfall">{bi(POOL.windfall)}</option>
          </select>
        </Field>
        <Field label={LABELS.note} error={error('note')}>
          <input name="note" maxLength={500} value={values.note} onChange={(e) => change('note', e.target.value)} />
        </Field>
      </div>
      <FxTypoWarning entered={Number(values.fxRate)} reference={dated ?? latestRate} maxGap={foreign ? data.fxMaxGap : null} />
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
        <Link href="/holdings#cash-flows" className="button">
          <Bi {...LABELS.cancel} />
        </Link>
      </div>
    </form>
  );
}
