'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { RuleMath } from '@/components/rule-math';
import type { HoldingsData } from '@/lib/data';
import { percent } from '@/lib/format';
import { shortfallMessage } from '@/lib/forms';
import { bi, LABELS, MARKET, POOL, SIDE, SLEEVE, type Bilingual } from '@/lib/i18n';
import { previewTrade } from '@/lib/models/portfolio';
import { latestFx } from '@/lib/models/valuation';
import { breachText } from '@/lib/rule-text';
import { parseTrade, type TradeField } from '@/lib/validation';

import { saveTrade, type TradeFormState } from './actions';

/** The form's fields as typed, before parsing. */
export type TradeValues = Record<TradeField, string>;

const INITIAL_STATE: TradeFormState = { errors: {}, message: null };

/** The add-security page, with the ticker typed so far; an edit comes back to its trade afterwards. */
function addSecurityHref(ticker: string, id: number | undefined): string {
  const query = new URLSearchParams();
  if (ticker.trim()) query.set('ticker', ticker.trim().toUpperCase());
  if (id !== undefined) query.set('next', `/holdings/${id}`);
  const text = query.toString();
  return text ? `/securities/new?${text}` : '/securities/new';
}

export function TradeForm({ data, today, id, initial }: { data: HoldingsData; today: string; id?: number; initial: TradeValues }) {
  const [values, setValues] = useState(initial);
  // Fields changed since the last submit: their server errors are stale, their live errors are fresh.
  const [edited, setEdited] = useState<ReadonlySet<TradeField>>(new Set());
  const [state, formAction, pending] = useActionState(saveTrade, INITIAL_STATE);

  const securities = useMemo(() => new Map(data.securities.map((security) => [security.ticker, security])), [data.securities]);
  const fx = useMemo(() => latestFx(data.fx, data.trades), [data.fx, data.trades]);
  const security = securities.get(values.ticker.trim().toUpperCase());
  const currency = values.currency.trim().toUpperCase();

  function change(field: TradeField, value: string) {
    setEdited((previous) => new Set(previous).add(field));
    setValues((previous) => {
      const next = { ...previous, [field]: value };
      if (field === 'ticker') {
        // Picking a ticker fills in its currency and, for a foreign one, the newest known FX rate.
        const match = securities.get(value.trim().toUpperCase());
        if (match && match.currency !== previous.currency.trim().toUpperCase()) {
          next.currency = match.currency;
          next.fxRate = match.currency === 'TWD' ? '1' : String(fx.get(match.currency)?.value ?? '');
        }
      }
      if (field === 'currency' && value.trim().toUpperCase() === 'TWD') next.fxRate = '1';
      return next;
    });
  }

  const parsed = parseTrade(values, securities, today);
  const preview = parsed.ok ? previewTrade(data, { ...parsed.value, id }, data.caps) : null;

  function error(field: TradeField): Bilingual | null {
    const server = edited.has(field) ? undefined : state.errors[field];
    const live = edited.has(field) && values[field] !== '' && !parsed.ok ? parsed.errors[field] : undefined;
    return server ?? live ?? null;
  }

  // A rate far from the latest known one is probably a typo, e.g. 3.24 for 32.4 (config fx_rate_check).
  const latestRate = currency && currency !== 'TWD' ? fx.get(currency) : undefined;
  const enteredRate = Number(values.fxRate);
  const maxGap = data.fxMaxGap;
  const rateLooksOdd = maxGap !== null && latestRate !== undefined && enteredRate > 0 && Math.abs(enteredRate - latestRate.value) / latestRate.value > maxGap;

  return (
    <form
      action={formAction}
      onSubmit={() => setEdited(new Set())}
      className="form"
    >
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      <div className="form-grid">
        <Field label={LABELS.tradeDate} error={error('tradeDate')}>
          <input type="date" name="tradeDate" value={values.tradeDate} max={today} required onChange={(e) => change('tradeDate', e.target.value)} />
        </Field>
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
        <datalist id="ticker-options">
          {data.securities.map((option) => (
            <option key={option.ticker} value={option.ticker}>
              {option.name}
            </option>
          ))}
        </datalist>
        <Field label={LABELS.market} hint={<Bi en="From the security" zh="依證券自動帶入" />}>
          <input readOnly tabIndex={-1} value={security ? bi(MARKET[security.market]) : '—'} />
        </Field>
        <Field label={LABELS.side} error={error('side')}>
          <select name="side" value={values.side} onChange={(e) => change('side', e.target.value)}>
            <option value="buy">{bi(SIDE.buy)}</option>
            <option value="sell">{bi(SIDE.sell)}</option>
          </select>
        </Field>
        <Field label={LABELS.qty} error={error('qty')}>
          <input name="qty" inputMode="decimal" value={values.qty} required onChange={(e) => change('qty', e.target.value)} />
        </Field>
        <Field label={LABELS.price} error={error('price')} hint={currency ? <Bi en={`In ${currency}`} zh={`以 ${currency} 計`} /> : undefined}>
          <input name="price" inputMode="decimal" value={values.price} required onChange={(e) => change('price', e.target.value)} />
        </Field>
        <Field label={LABELS.currency} error={error('currency')}>
          <input name="currency" maxLength={3} autoCapitalize="characters" value={values.currency} onChange={(e) => change('currency', e.target.value)} />
        </Field>
        <Field label={LABELS.fee} error={error('fee')}>
          <input name="fee" inputMode="decimal" placeholder="0" value={values.fee} onChange={(e) => change('fee', e.target.value)} />
        </Field>
        <Field label={LABELS.tax} error={error('tax')}>
          <input name="tax" inputMode="decimal" placeholder="0" value={values.tax} onChange={(e) => change('tax', e.target.value)} />
        </Field>
        <Field
          label={LABELS.fxRate}
          error={error('fxRate')}
          hint={
            currency === 'TWD' ? (
              <Bi en="TWD needs no conversion" zh="台幣不需換算" />
            ) : latestRate ? (
              <Bi
                en={`Latest known ${latestRate.value} (${latestRate.date}${latestRate.estimated ? ', from a trade' : ''}); use your broker's rate`}
                zh={`最近一筆為 ${latestRate.value}（${latestRate.date}${latestRate.estimated ? '，取自交易紀錄' : ''}），請以券商成交匯率為準`}
              />
            ) : (
              <Bi en="Use the rate on your broker statement" zh="請填券商對帳單上的成交匯率" />
            )
          }
        >
          <input name="fxRate" inputMode="decimal" value={values.fxRate} readOnly={currency === 'TWD'} required onChange={(e) => change('fxRate', e.target.value)} />
        </Field>
        <Field label={LABELS.sleeve} hint={<Bi en="From the security" zh="依證券自動帶入" />}>
          <input readOnly tabIndex={-1} value={security ? bi(SLEEVE[security.sleeve]) : '—'} />
        </Field>
        <Field label={LABELS.pool} error={error('pool')}>
          <select name="pool" value={values.pool} onChange={(e) => change('pool', e.target.value)}>
            <option value="regular">{bi(POOL.regular)}</option>
            <option value="windfall">{bi(POOL.windfall)}</option>
          </select>
        </Field>
        <Field label={LABELS.note} error={error('note')}>
          <input name="note" maxLength={500} value={values.note} onChange={(e) => change('note', e.target.value)} />
        </Field>
      </div>

      {rateLooksOdd && (
        <p className="banner warn">
          <Bi
            en={`This FX rate is more than ${percent(maxGap, 0)} away from the latest known ${latestRate?.value}; check for a typo.`}
            zh={`這個匯率與最近一筆 ${latestRate?.value} 相差超過 ${percent(maxGap, 0)}，請確認是否輸入錯誤。`}
          />
        </p>
      )}
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
        <Link href="/holdings" className="button">
          <Bi {...LABELS.cancel} />
        </Link>
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
