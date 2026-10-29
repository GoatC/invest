'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { FxRateHint, FxTypoWarning } from '@/components/fx-rate';
import { RuleMath } from '@/components/rule-math';
import type { HoldingsData } from '@/lib/data';
import { isIsoDate } from '@/lib/dates';
import { shortfallMessage } from '@/lib/forms';
import { bi, LABELS, MARKET, POOL, SIDE, SLEEVE, type Bilingual } from '@/lib/i18n';
import { rateHistory, rateOn, suggestedRate } from '@/lib/models/fx';
import { previewTrade } from '@/lib/models/portfolio';
import type { FxQuote } from '@/lib/models/types';
import { latestFx } from '@/lib/models/valuation';
import { breachText } from '@/lib/rule-text';
import { parseTrade, type TradeField } from '@/lib/validation';

import { saveTrade, type TradeFormState } from './actions';

/** The form's fields as typed, before parsing. */
export type TradeValues = Record<TradeField, string>;

const INITIAL_STATE: TradeFormState = { errors: {}, message: null };

/** The fields a quick entry folds under "More fields": each is filled in from the security, or rarely changes. */
const MORE_FIELDS: readonly TradeField[] = ['currency', 'fee', 'tax', 'fxRate', 'pool', 'note'];

/** The add-security page, with the ticker typed so far; an edit comes back to its trade afterwards. */
function addSecurityHref(ticker: string, id: number | undefined): string {
  const query = new URLSearchParams();
  if (ticker.trim()) query.set('ticker', ticker.trim().toUpperCase());
  if (id !== undefined) query.set('next', `/holdings/${id}`);
  const text = query.toString();
  return text ? `/securities/new?${text}` : '/securities/new';
}

export function TradeForm({
  data,
  rates,
  today,
  id,
  initial,
  proposal,
  compact = false,
}: {
  data: HoldingsData;
  rates: FxQuote[];
  today: string;
  id?: number;
  initial: TradeValues;
  /** The approved proposal this trade fills, to return to it once saved. */
  proposal?: number;
  /** A quick entry at the top of the holdings page: date, ticker, side, quantity and price in a row, the rest folded. */
  compact?: boolean;
}) {
  const [values, setValues] = useState(initial);
  // Fields changed since the last submit: their server errors are stale, their live errors are fresh.
  const [edited, setEdited] = useState<ReadonlySet<TradeField>>(new Set());
  // A rate typed by hand, or saved with the trade being edited, is never replaced by a suggestion.
  const [ownRate, setOwnRate] = useState(id !== undefined);
  const [state, formAction, pending] = useActionState(saveTrade, INITIAL_STATE);
  // A trade from a proposal shows every field, since its fee, tax and rate need checking.
  const [moreOpen, setMoreOpen] = useState(proposal !== undefined);

  const securities = useMemo(() => new Map(data.securities.map((security) => [security.ticker, security])), [data.securities]);
  const fx = useMemo(() => latestFx(data.fx, data.trades), [data.fx, data.trades]);
  const history = useMemo(() => rateHistory(rates), [rates]);
  const security = securities.get(values.ticker.trim().toUpperCase());
  const currency = values.currency.trim().toUpperCase();

  function change(field: TradeField, value: string) {
    setEdited((previous) => new Set(previous).add(field));
    const next = { ...values, [field]: value };
    // Picking a ticker fills in its currency.
    const match = field === 'ticker' ? securities.get(value.trim().toUpperCase()) : undefined;
    if (match) next.currency = match.currency;
    const nextCurrency = next.currency.trim().toUpperCase();
    const currencyChanged = nextCurrency !== currency;
    // A new currency needs a new rate; a new date, the rate of that date unless one was typed.
    if (currencyChanged || (field === 'tradeDate' && !ownRate)) {
      next.fxRate = String(suggestedRate(nextCurrency, next.tradeDate, history, data.fxMaxAgeDays, fx) ?? '');
    }
    setValues(next);
    setOwnRate(field === 'fxRate' || (ownRate && !currencyChanged));
  }

  const parsed = parseTrade(values, securities, today);
  const preview = parsed.ok ? previewTrade(data, { ...parsed.value, id }, data.caps) : null;

  function error(field: TradeField): Bilingual | null {
    const server = edited.has(field) ? undefined : state.errors[field];
    const live = edited.has(field) && values[field] !== '' && !parsed.ok ? parsed.errors[field] : undefined;
    return server ?? live ?? null;
  }

  // The trade date's rate, else the newest known one, is what a typed rate is checked against.
  const foreign = currency !== '' && currency !== 'TWD';
  const latestRate = foreign ? fx.get(currency) : undefined;
  const datedRate = foreign && data.fxMaxAgeDays !== null && isIsoDate(values.tradeDate) ? rateOn(history, currency, values.tradeDate, data.fxMaxAgeDays) : undefined;
  const dated = datedRate ? { value: datedRate.rate, date: datedRate.date } : undefined;
  // A field with an error, or a ticker with no rate to suggest, opens the folded fields.
  const moreError = compact && (MORE_FIELDS.some((field) => error(field) !== null) || (security !== undefined && values.fxRate.trim() === ''));

  const tradeDateField = (
    <Field label={LABELS.tradeDate} error={error('tradeDate')}>
      <input type="date" name="tradeDate" value={values.tradeDate} max={today} required onChange={(e) => change('tradeDate', e.target.value)} />
    </Field>
  );
  const tickerField = (
    <Field
      label={LABELS.ticker}
      error={error('ticker')}
      hint={
        security ? (
          security.name
        ) : (
          <Link href={addSecurityHref(values.ticker, id)}>
            <Bi en="Not listed? Add a security" zh="找不到？新增證券" />
          </Link>
        )
      }
    >
      <input name="ticker" list="ticker-options" autoComplete="off" value={values.ticker} required onChange={(e) => change('ticker', e.target.value)} />
    </Field>
  );
  const datalistField = (
    <datalist id="ticker-options">
      {data.securities.map((option) => (
        <option key={option.ticker} value={option.ticker}>
          {option.name}
        </option>
      ))}
    </datalist>
  );
  const marketField = (
    <Field label={LABELS.market} hint={<Bi en="From the security" zh="依證券自動帶入" />}>
      <input readOnly tabIndex={-1} value={security ? bi(MARKET[security.market]) : '—'} />
    </Field>
  );
  const sideField = (
    <Field label={LABELS.side} error={error('side')}>
      <select name="side" value={values.side} onChange={(e) => change('side', e.target.value)}>
        <option value="buy">{bi(SIDE.buy)}</option>
        <option value="sell">{bi(SIDE.sell)}</option>
      </select>
    </Field>
  );
  const qtyField = (
    <Field label={LABELS.qty} error={error('qty')}>
      <input name="qty" inputMode="decimal" value={values.qty} required onChange={(e) => change('qty', e.target.value)} />
    </Field>
  );
  const priceField = (
    <Field label={LABELS.price} error={error('price')} hint={currency ? <Bi en={`In ${currency}`} zh={`以 ${currency} 計`} /> : undefined}>
      <input name="price" inputMode="decimal" value={values.price} required onChange={(e) => change('price', e.target.value)} />
    </Field>
  );
  const currencyField = (
    <Field label={LABELS.currency} error={error('currency')}>
      <input name="currency" maxLength={3} autoCapitalize="characters" value={values.currency} onChange={(e) => change('currency', e.target.value)} />
    </Field>
  );
  const feeField = (
    <Field label={LABELS.fee} error={error('fee')}>
      <input name="fee" inputMode="decimal" placeholder="0" value={values.fee} onChange={(e) => change('fee', e.target.value)} />
    </Field>
  );
  const taxField = (
    <Field label={LABELS.tax} error={error('tax')}>
      <input name="tax" inputMode="decimal" placeholder="0" value={values.tax} onChange={(e) => change('tax', e.target.value)} />
    </Field>
  );
  const fxRateField = (
    <Field
      label={LABELS.fxRate}
      error={error('fxRate')}
      hint={<FxRateHint currency={currency} dated={dated} latest={latestRate} />}
    >
      <input name="fxRate" inputMode="decimal" value={values.fxRate} readOnly={currency === 'TWD'} required onChange={(e) => change('fxRate', e.target.value)} />
    </Field>
  );
  const sleeveField = (
    <Field label={LABELS.sleeve} hint={<Bi en="From the security" zh="依證券自動帶入" />}>
      <input readOnly tabIndex={-1} value={security ? bi(SLEEVE[security.sleeve]) : '—'} />
    </Field>
  );
  const poolField = (
    <Field label={LABELS.pool} error={error('pool')}>
      <select name="pool" value={values.pool} onChange={(e) => change('pool', e.target.value)}>
        <option value="regular">{bi(POOL.regular)}</option>
        <option value="windfall">{bi(POOL.windfall)}</option>
      </select>
    </Field>
  );
  const noteField = (
    <Field label={LABELS.note} error={error('note')}>
      <input name="note" maxLength={500} value={values.note} onChange={(e) => change('note', e.target.value)} />
    </Field>
  );

  return (
    <form
      action={formAction}
      onSubmit={() => setEdited(new Set())}
      className="form"
    >
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      {proposal !== undefined && <input type="hidden" name="proposal" value={proposal} />}
      {compact ? (
        <>
          <div className="form-grid quick-entry">
            {tradeDateField}
            {tickerField}
            {datalistField}
            {sideField}
            {qtyField}
            {priceField}
          </div>
          <details className="more-fields" open={moreOpen || moreError} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
            <summary>
              <Bi en="More fields" zh="更多欄位" />
              <span className="muted small">
                {' · '}
                <Bi
                  en={`${currency || '—'} · FX ${values.fxRate || '—'} · fee ${values.fee || '0'} · ${POOL[values.pool === 'windfall' ? 'windfall' : 'regular'].en} pool`}
                  zh={`${currency || '—'} · 匯率 ${values.fxRate || '—'} · 手續費 ${values.fee || '0'} · ${POOL[values.pool === 'windfall' ? 'windfall' : 'regular'].zh}資金池`}
                />
              </span>
            </summary>
            <div className="form-grid">
              {marketField}
              {currencyField}
              {feeField}
              {taxField}
              {fxRateField}
              {sleeveField}
              {poolField}
              {noteField}
            </div>
          </details>
        </>
      ) : (
        <div className="form-grid">
          {tradeDateField}
          {tickerField}
          {datalistField}
          {marketField}
          {sideField}
          {qtyField}
          {priceField}
          {currencyField}
          {feeField}
          {taxField}
          {fxRateField}
          {sleeveField}
          {poolField}
          {noteField}
        </div>
      )}

      <FxTypoWarning entered={Number(values.fxRate)} reference={dated ?? latestRate} maxGap={data.fxMaxGap} />
      <TradeEffect preview={preview} caps={data.caps} pool={values.pool} />
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
        {!compact && (
          <Link href="/holdings" className="button">
            <Bi {...LABELS.cancel} />
          </Link>
        )}
      </div>
    </form>
  );
}

/** What saving this trade would do to R1 and R2: warnings never block the save (PRD N5). */
function TradeEffect({ preview, caps, pool }: { preview: ReturnType<typeof previewTrade> | null; caps: HoldingsData['caps']; pool: string }) {
  if (!preview) return null;
  const [shortfall] = preview.shortfalls;
  if (shortfall) {
    return (
      <p className="banner danger" role="alert">
        <Bi {...shortfallMessage(shortfall)} />
      </p>
    );
  }
  const created = preview.breaches.filter((breach) => breach.isNew);
  const existing = preview.breaches.filter((breach) => !breach.isNew);
  return (
    <div className="form" aria-live="polite">
      {created.length > 0 && (
        <div className="banner warn">
          <Bi en="You can save, but this trade breaks a rule:" zh="可以儲存，但這筆交易會違反規則：" />
          <ul>
            {created.map((breach) => (
              <li key={`${breach.rule}:${breach.subject}`}>
                <Bi {...breachText(breach, caps, 'after')} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {existing.length > 0 && (
        <div className="banner info">
          <Bi en="Already above a limit before this trade:" zh="這筆交易之前就已超過限制：" />
          <ul>
            {existing.map((breach) => (
              <li key={`${breach.rule}:${breach.subject}`}>
                <Bi {...breachText(breach, caps, 'after')} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <RuleMath caps={caps} pool={preview.after} title={{ en: 'How R1 and R2 are worked out after this trade', zh: '這筆交易後 R1 與 R2 的計算方式' }} />
      {preview.breaches.length === 0 && (caps.singleStock || caps.satellite) && (
        <p className="banner ok">
          {pool === 'windfall' ? (
            <Bi en="Windfall money is left out of R1 and R2." zh="大額資金不計入 R1 與 R2。" />
          ) : (
            <Bi en="R1 and R2 stay within their limits after this trade." zh="這筆交易後，R1 與 R2 都在限制內。" />
          )}
        </p>
      )}
    </div>
  );
}
