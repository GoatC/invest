import type { AuditEntry, FieldChange } from '@/lib/data';
import { taipeiDateTime } from '@/lib/format';
import { LABELS, type Bilingual } from '@/lib/i18n';

import { Bi } from './bi';

export const ACTION: Record<AuditEntry['action'], Bilingual> = {
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
  listing_country: { en: 'Listing country', zh: '上市國家' },
};

function shown(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function TaipeiTime({ at }: { at: string }) {
  return (
    <span className="muted small">
      {taipeiDateTime(at)} <Bi en="Taipei time" zh="台北時間" />
    </span>
  );
}

/** What an edit changed, field by field. */
export function ChangeList({ changes }: { changes: FieldChange[] }) {
  return (
    <ul>
      {changes.map((change) => (
        <li key={change.column}>
          <Bi {...(COLUMN[change.column] ?? { en: change.column, zh: change.column })} />: {shown(change.before)} → {shown(change.after)}
        </li>
      ))}
    </ul>
  );
}

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
          <TaipeiTime at={entry.changedAt} />
          {entry.action === 'update' && <ChangeList changes={entry.changes} />}
        </li>
      ))}
    </ul>
  );
}
