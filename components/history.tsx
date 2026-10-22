import { describeRow, TABLE_LABELS } from '@/lib/audit';
import type { AuditEntry, FieldChange, LogEntry } from '@/lib/data';
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
  flow_date: LABELS.flowDate,
  type: LABELS.flowType,
  amount: LABELS.amount,
  amount_twd: LABELS.amountTwd,
  target_weight: LABELS.target,
  benchmark_ticker: { en: 'Benchmark ETF', zh: '基準 ETF' },
  value: { en: 'Value', zh: '設定值' },
  last_verified: { en: 'Last reviewed', zh: '最後檢視日期' },
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

/** A column's label; "value.global_bonds" (a part of a JSON setting) as "Value › global_bonds". */
function columnLabel(column: string): Bilingual {
  const [name = column, ...part] = column.split('.');
  const label = COLUMN[name] ?? { en: name, zh: name };
  const suffix = part.length > 0 ? ` › ${part.join('.')}` : '';
  return { en: `${label.en}${suffix}`, zh: `${label.zh}${suffix}` };
}

/** What an edit changed, field by field. */
export function ChangeList({ changes }: { changes: FieldChange[] }) {
  return (
    <ul className="changes">
      {changes.map((change) => (
        <li key={change.column}>
          <Bi {...columnLabel(change.column)} />: {shown(change.before)} → {shown(change.after)}
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

/** Logged edits across rows, each named by the row it concerns, newest first. */
export function LogList({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="muted">
        <Bi en="No edits yet." zh="尚無修改紀錄。" />
      </p>
    );
  }
  return (
    <ul className="log">
      {entries.map((entry) => (
        <li key={entry.id}>
          <div className="row">
            <span className={entry.action === 'delete' ? 'badge warn' : 'badge'}>
              <Bi {...ACTION[entry.action]} />
            </span>
            <span className="muted small">
              <Bi {...(TABLE_LABELS[entry.table] ?? { en: entry.table, zh: entry.table })} />
            </span>
            <strong>
              <Bi {...describeRow(entry.table, entry.row, entry.rowKey)} />
            </strong>
            <TaipeiTime at={entry.changedAt} />
          </div>
          {entry.action === 'update' && <ChangeList changes={entry.changes} />}
        </li>
      ))}
    </ul>
  );
}
