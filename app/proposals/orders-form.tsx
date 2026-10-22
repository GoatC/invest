'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { twd } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';
import { orderTotals, resized, type DraftOrder } from '@/lib/models/engine';
import { orderLine } from '@/lib/proposal-text';
import { parseOrderSizes, sizeField } from '@/lib/validation';

import { saveOrders, type OrdersFormState } from './actions';

const INITIAL_STATE: OrdersFormState = { errors: {}, message: null };

/** Each draft order's size, shares or NT$, with the totals worked out as they change. */
export function OrdersForm({ id, orders }: { id: number; orders: DraftOrder[] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((order, index) => [sizeField(index), String(order.kind === 'trade' ? order.qty : Math.round(order.amountTwd))])),
  );
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [state, formAction, pending] = useActionState(saveOrders, INITIAL_STATE);
  const parsed = parseOrderSizes(values, orders);
  const kept = orders.flatMap((order, index) => resized(order, parsed.sizes[index] ?? 0) ?? []);
  const { sold, bought } = orderTotals(kept);

  function error(name: string): Bilingual | null {
    return (edited.has(name) ? parsed.errors[name] : state.errors[name]) ?? null;
  }

  return (
    <form action={formAction} onSubmit={() => setEdited(new Set())} className="form">
      <input type="hidden" name="id" value={id} />
      {orders.map((order, index) => {
        const name = sizeField(index);
        const line = orderLine(order);
        const label: Bilingual =
          order.kind === 'trade' ? { en: `${line.en}: shares`, zh: `${line.zh}：股數` } : { en: `${line.en}: NT$`, zh: `${line.zh}：台幣` };
        return (
          <Field key={name} label={label} error={error(name)}>
            <input
              name={name}
              inputMode={order.kind === 'trade' && order.decimals ? 'decimal' : 'numeric'}
              autoComplete="off"
              value={values[name] ?? ''}
              onChange={(e) => {
                setEdited((previous) => new Set(previous).add(name));
                setValues((previous) => ({ ...previous, [name]: e.target.value }));
              }}
            />
          </Field>
        );
      })}
      <p aria-live="polite">
        <Bi
          en={`Sales and money taken out: ${twd(sold)}; purchases and money put in: ${twd(bought)}; difference ${twd(sold - bought)}. 0 drops an order.`}
          zh={`賣出與轉出：${twd(sold)}；買進與存入：${twd(bought)}；差額 ${twd(sold - bought)}。填 0 代表刪除該筆。`}
        />
      </p>
      {state.message && (
        <p className="banner danger" role="alert">
          <Bi {...state.message} />
        </p>
      )}
      <div className="row">
        <button type="submit" className="button primary" disabled={pending}>
          <Bi {...(pending ? LABELS.saving : LABELS.save)} />
        </button>
        <Link href={`/proposals#proposal-${id}`} className="button">
          <Bi {...LABELS.cancel} />
        </Link>
      </div>
    </form>
  );
}
