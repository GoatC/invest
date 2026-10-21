/** Describing audit-log rows (N5: every entry can be edited or deleted, with an audit log). */
import { quantity } from './format';
import { SIDE, type Bilingual } from './i18n';

/** The tables whose edits and deletes the database logs, by what they hold. */
export const TABLE_LABELS: Record<string, Bilingual> = {
  transactions: { en: 'Trade', zh: '交易' },
  manual_assets: { en: 'Non-listed asset', zh: '非上市資產' },
  securities: { en: 'Security', zh: '證券' },
  asset_classes: { en: 'Asset class', zh: '資產類別' },
  cash_flows: { en: 'Cash flow', zh: '現金流' },
  config: { en: 'Setting', zh: '設定' },
  watchlist: { en: 'Watchlist', zh: '觀察清單' },
};

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function same(value: string): Bilingual {
  return { en: value, zh: value };
}

/** A short name for a logged row, so a deleted entry can still be recognised. */
export function describeRow(table: string, row: Record<string, unknown> | null, rowKey: string): Bilingual {
  if (!row) return same(rowKey);
  switch (table) {
    case 'transactions': {
      const side = row['side'] === 'sell' ? SIDE.sell : SIDE.buy;
      const qty = Number(row['qty']);
      const amount = Number.isFinite(qty) ? quantity(qty) : text(row['qty']);
      const at = `${text(row['price'])} ${text(row['currency'])}`;
      return {
        en: `${text(row['trade_date'])} ${side.en.toLowerCase()} ${amount} ${text(row['ticker'])} at ${at}`,
        zh: `${text(row['trade_date'])} ${side.zh} ${text(row['ticker'])} ${amount} 單位，價格 ${at}`,
      };
    }
    case 'securities':
      return same(`${text(row['ticker'])} ${text(row['name'])}`.trim());
    case 'asset_classes':
      return { en: text(row['name_en']) || rowKey, zh: text(row['name_zh']) || rowKey };
    case 'cash_flows':
      return same(`${text(row['flow_date'])} ${text(row['type'])} ${text(row['amount'])} ${text(row['currency'])}`.trim());
    case 'manual_assets':
      return same(text(row['name']) || rowKey);
    case 'config':
      return same(text(row['key']) || rowKey);
    default:
      return same(text(row['ticker']) || rowKey);
  }
}
