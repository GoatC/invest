/** Describing audit-log rows (N5: every entry can be edited or deleted, with an audit log). */
import { quantity, twd } from './format';
import { FLOW_TYPE, SIDE, TRANCHE_STATUS, type Bilingual } from './i18n';

/** The tables whose edits and deletes the database logs, by what they hold. */
export const TABLE_LABELS: Record<string, Bilingual> = {
  transactions: { en: 'Trade', zh: '交易' },
  manual_assets: { en: 'Non-listed asset', zh: '非上市資產' },
  securities: { en: 'Security', zh: '證券' },
  asset_classes: { en: 'Asset class', zh: '資產類別' },
  cash_flows: { en: 'Cash flow', zh: '現金流' },
  config: { en: 'Setting', zh: '設定' },
  watchlist: { en: 'Watchlist', zh: '觀察清單' },
  proposals: { en: 'Proposal', zh: '提案' },
  windfall_plan: { en: 'Windfall plan', zh: '大額資金計畫' },
  windfall_tranches: { en: 'Windfall tranche', zh: '大額資金分批' },
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
    case 'cash_flows': {
      const type = FLOW_TYPE[text(row['type']) as keyof typeof FLOW_TYPE] ?? same(text(row['type']));
      const amount = `${text(row['amount'])} ${text(row['currency'])}`;
      const ticker = row['ticker'] ? ` ${text(row['ticker'])}` : '';
      return {
        en: `${text(row['flow_date'])} ${type.en.toLowerCase()}${ticker} ${amount}`,
        zh: `${text(row['flow_date'])} ${type.zh}${ticker} ${amount}`,
      };
    }
    case 'manual_assets':
      return same(text(row['name']) || rowKey);
    case 'config':
      return same(text(row['key']) || rowKey);
    case 'proposals': {
      // A state lists what fired, "2330,NVDA": spaced so a phone can wrap it.
      const state = text(row['state']).split(',').join(', ');
      return { en: `#${rowKey} ${text(row['rule_id'])} ${state}`.trim(), zh: `第 ${rowKey} 號 ${text(row['rule_id'])} ${state}`.trim() };
    }
    case 'windfall_plan': {
      const total = Number(row['total_twd']);
      const amount = Number.isFinite(total) ? twd(total) : text(row['total_twd']);
      return { en: `${amount} from ${text(row['received_on'])}`, zh: `${amount}，自 ${text(row['received_on'])} 起` };
    }
    case 'windfall_tranches': {
      const planned = Number(row['amount_twd']);
      const amount = Number.isFinite(planned) ? twd(planned) : text(row['amount_twd']);
      const status = TRANCHE_STATUS[text(row['status'])] ?? same(text(row['status']));
      return { en: `${text(row['due_date'])} ${amount} ${status.en.toLowerCase()}`, zh: `${text(row['due_date'])} ${amount} ${status.zh}` };
    }
    default:
      return same(text(row['ticker']) || rowKey);
  }
}
