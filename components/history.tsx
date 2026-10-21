import type { AuditEntry } from '@/lib/data';
import { LABELS, type Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

const ACTION: Record<AuditEntry['action'], Bilingual> = {
  insert: { en: 'Added', zh: '新增' },
  update: { en: 'Changed', zh: '修改' },
  delete: { en: 'Deleted', zh: '刪除' },
};

/** Database column names shown with the labels the forms use. */
const COLUMN: Record<string, Bilingual> = {
  trade_date: LABELS.tradeDate,
  ticker: LABELS.ticker,
  side: LABELS.side,
  qty: LABELS.qty,
  price: LABELS.price,
  currency: LABELS.currency,
  fee: LABELS.fee,
  tax: LABELS.tax,
  fx_rate: LABELS.fxRate,
  pool: LABELS.pool,
  note: LABELS.note,
  source: LABELS.source,
  name: LABELS.name,
  quantity: LABELS.quantityHeld,
  last_value_twd: LABELS.lastValue,
  valued_on: LABELS.valuedOn,
  asset_class_id: LABELS.assetClass,
  product_type: LABELS.productType,
  unit: LABELS.unit,
  valuation_method: { en: 'Valuation method', zh: '估值方式' },
  market: LABELS.market,
  sleeve: LABELS.sleeve,
  domicile: LABELS.domicile,
};

function shown(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

const TAIPEI_TIME = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short', hour12: false });

/** The audit log of one entry, newest first. */
export function History({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="muted">
        <Bi en="No edits yet." zh="尚無修改紀錄。" />
      </p>
    );
  }
  return (
    <ul className="form">
      {entries.map((entry) => (
        <li key={entry.id}>
          <strong>
            <Bi {...ACTION[entry.action]} />
          </strong>{' '}
          <span className="muted small">{TAIPEI_TIME.format(new Date(entry.changedAt))} (Taipei)</span>
          {entry.action === 'update' && (
            <ul>
              {entry.changes.map((change) => (
                <li key={change.column}>
                  <Bi {...(COLUMN[change.column] ?? { en: change.column, zh: change.column })} />: {shown(change.before)} → {shown(change.after)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
