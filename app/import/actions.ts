'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth';
import { MAX_STATEMENT_BYTES } from '@/lib/csv/limits';
import { mappingKey, missingColumns, parseMapping } from '@/lib/csv/mapping';
import { planImport, readStatement, tradesToImport } from '@/lib/csv/plan';
import { DataError, loadHoldingsData, orDataError, transactionColumns } from '@/lib/data';
import { taipeiToday } from '@/lib/dates';
import { formFields, saveFailed, shortfallMessage } from '@/lib/forms';
import type { Bilingual } from '@/lib/i18n';
import { previewImport } from '@/lib/models/portfolio';
import { latestFx } from '@/lib/models/valuation';
import { parseNumber } from '@/lib/validation';

export interface ImportState {
  message: Bilingual | null;
}

const MESSAGES = {
  broker: { en: 'Name the broker, so its column mapping can be saved.', zh: '請填寫券商名稱，以便儲存欄位對應。' },
  mapping: { en: 'The column mapping is incomplete; check it and try again.', zh: '欄位對應不完整，請檢查後再試一次。' },
  nothing: { en: 'Nothing to import: every row is already saved or cannot be read.', zh: '沒有可匯入的交易：每一列都已存在或無法辨識。' },
  tooLarge: { en: 'This file is too large; export a shorter period.', zh: '檔案太大，請匯出較短的期間。' },
} as const satisfies Record<string, Bilingual>;

function json(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return undefined;
  }
}

/** Row numbers of duplicates the person chose to import anyway. */
function lines(text: string | undefined): number[] {
  const value = json(text);
  return Array.isArray(value) ? value.filter((line): line is number => Number.isInteger(line) && line > 0) : [];
}

/**
 * Imports a statement: reads it again with the submitted mapping, applies the trade form's
 * checks to every row, refuses the import if a sell would exceed its holding, then saves the
 * broker's mapping and every new trade in one insert (all or nothing).
 */
export async function importTrades(_previous: ImportState, formData: FormData): Promise<ImportState> {
  const { supabase } = await requireSession();
  const fields = formFields(formData);
  const csv = fields['csv'] ?? '';
  if (new TextEncoder().encode(csv).length > MAX_STATEMENT_BYTES) return { message: MESSAGES.tooLarge };
  const broker = (fields['broker'] ?? '').trim();
  if (!broker || broker.length > 60) return { message: MESSAGES.broker };
  const mapping = parseMapping(json(fields['mapping']));
  if (!mapping || missingColumns(mapping).length > 0) return { message: MESSAGES.mapping };
  const rate = parseNumber(fields['fixedFxRate']);
  const options = { pool: fields['pool'] === 'windfall' ? ('windfall' as const) : ('regular' as const), fixedFxRate: rate !== undefined && rate > 0 ? rate : null };

  const data = await orDataError(loadHoldingsData(supabase));
  if (data instanceof DataError) return { message: saveFailed(data.detail) };
  const rows = planImport(readStatement(csv, mapping.delimiter, mapping.headerRow), mapping, options, {
    securities: new Map(data.securities.map((security) => [security.ticker, security])),
    existing: data.trades,
    today: taipeiToday(),
    fx: latestFx(data.fx, data.trades),
    fxMaxGap: data.fxMaxGap,
  });
  const trades = tradesToImport(rows, new Set(lines(fields['keep'])));
  if (trades.length === 0) return { message: MESSAGES.nothing };
  const [shortfall] = previewImport(data, trades, data.caps).shortfalls;
  if (shortfall) return { message: shortfallMessage(shortfall) };

  const saved = await supabase.from('config').upsert({
    key: mappingKey(broker),
    value: { broker, mapping },
    desc_en: `CSV column mapping for ${broker}, saved by the import.`,
    desc_zh: `${broker} 的 CSV 欄位對應，由匯入功能儲存。`,
  });
  if (saved.error) return { message: saveFailed(saved.error.message) };
  const { error } = await supabase.from('transactions').insert(trades.map((trade) => ({ ...transactionColumns(trade), source: 'csv' })));
  if (error) return { message: saveFailed(error.message) };
  redirect(`/holdings?saved=imported&added=${trades.length}&skipped=${rows.length - trades.length}`);
}
