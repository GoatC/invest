/**
 * Which statement column feeds each trade field, and how to read it. A mapping is saved per
 * broker in the config table (key csv_mapping.<broker>), so the next statement from the same
 * broker maps itself. Columns are kept by header name, which survives a reordered export.
 */
import { DELIMITERS, type Delimiter, type EncodingChoice } from './read';
import { DATE_FORMATS, DEFAULT_DIVIDEND_WORDS, DEFAULT_SIDE_WORDS, guessDateFormat, type DateFormat } from './values';

export interface CsvMapping {
  encoding: EncodingChoice;
  delimiter: Delimiter;
  /** The header row, counted from 1 as a spreadsheet shows it. */
  headerRow: number;
  tradeDate: string | null;
  dateFormat: DateFormat;
  ticker: string | null;
  side: string | null;
  /** Read buy or sell from the quantity's sign (negative = sell) instead of a column. */
  sideFromSign: boolean;
  buyWords: string[];
  sellWords: string[];
  qty: string | null;
  price: string | null;
  /** null: each security's own currency. */
  currency: string | null;
  /** Columns added together; none means 0. */
  fee: string[];
  tax: string[];
  /** null: one rate entered for the whole import (TWD trades need none). */
  fxRate: string | null;
  note: string | null;
  /** The cash amount of a row, read for dividends only; null: dividends are skipped. */
  amount: string | null;
  /** Words in the buy / sell column that mark a cash dividend. */
  dividendWords: string[];
}

/** The fields that must come from a column; side may come from the quantity's sign instead. */
export type RequiredColumn = 'tradeDate' | 'ticker' | 'side' | 'qty' | 'price';

export function missingColumns(mapping: CsvMapping): RequiredColumn[] {
  const missing: RequiredColumn[] = [];
  if (!mapping.tradeDate) missing.push('tradeDate');
  if (!mapping.ticker) missing.push('ticker');
  if (!mapping.side && !mapping.sideFromSign) missing.push('side');
  if (!mapping.qty) missing.push('qty');
  if (!mapping.price) missing.push('price');
  return missing;
}

// ---------------------------------------------------------------------------
// A first guess from the header names
// ---------------------------------------------------------------------------

type SingleField = 'tradeDate' | 'ticker' | 'side' | 'qty' | 'price' | 'currency' | 'fxRate' | 'note' | 'amount';

/**
 * Header names brokers use, most specific first. A header matches when it equals a word or one of
 * the short exact-only words, or when it contains a word; "avoid" rules out look-alikes such as
 * the settlement date, a fee rate or an ordered (not filled) quantity.
 */
const HEADER_WORDS: Record<SingleField | 'fee' | 'tax', { words: string[]; exactOnly?: string[]; avoid?: string[] }> = {
  tradeDate: { words: ['trade date', 'transaction date', '成交日期', '交易日期', '成交日', '交易日', '日期'], exactOnly: ['date'], avoid: ['settle', '交割'] },
  ticker: { words: ['ticker', 'symbol', 'stock code', '股票代號', '證券代號', '商品代號', '代號', '代碼'], exactOnly: ['code'], avoid: ['currency', '幣'] },
  side: { words: ['buy/sell', 'buy or sell', 'transaction type', '買賣別', '買賣', '交易別', '交易類別'], exactOnly: ['side', 'action', 'type'] },
  qty: { words: ['quantity', 'qty', 'shares', 'units', '成交股數', '成交數量', '股數', '數量', '單位數'], avoid: ['委託', 'order'] },
  price: { words: ['trade price', 'execution price', 'price', '成交價格', '成交單價', '成交價', '單價', '價格'], avoid: ['amount', '金額', '委託', 'order'] },
  currency: { words: ['currency', '交易幣別', '幣別', '幣種'], exactOnly: ['ccy'] },
  fxRate: { words: ['fx rate', 'exchange rate', '成交匯率', '交割匯率', '匯率'], exactOnly: ['fx', 'rate'], avoid: ['fee', 'tax', '手續費', '稅'] },
  note: { words: ['note', 'memo', 'remark', 'order no', 'order number', 'reference', '備註', '委託書號', '委託單號', '成交序號'] },
  amount: { words: ['net amount', 'amount', '淨收付金額', '應收付金額', '收付金額', '成交金額', '淨額', '金額'], avoid: ['fee', 'tax', 'commission', '手續費', '稅', '費用'] },
  fee: { words: ['commission', 'fee', '手續費', '佣金', '其他費用'], avoid: ['rate', '率', '折讓'] },
  tax: { words: ['tax', '交易稅', '證交稅', '稅額', '稅'], avoid: ['after', 'amount', '後', '金額', 'rate', '率'] },
};

function squash(text: string): string {
  return text.toLowerCase().replace(/[\s_\-/()（）:：.]+/g, '');
}

function avoided(header: string, field: keyof typeof HEADER_WORDS): boolean {
  const name = squash(header);
  return (HEADER_WORDS[field].avoid ?? []).some((bad) => name.includes(squash(bad)));
}

/** Pass 1: a header equal to a word; pass 2: a header containing one. */
function guessOne(headers: readonly string[], field: SingleField, used: Set<string>): string | null {
  const { words, exactOnly = [] } = HEADER_WORDS[field];
  const passes: Array<[readonly string[], (name: string, word: string) => boolean]> = [
    [[...words, ...exactOnly], (name, word) => name === word],
    [words, (name, word) => name.includes(word)],
  ];
  for (const [candidates, test] of passes) {
    for (const word of candidates) {
      const header = headers.find((candidate) => !used.has(candidate) && !avoided(candidate, field) && test(squash(candidate), squash(word)));
      if (header !== undefined) {
        used.add(header);
        return header;
      }
    }
  }
  return null;
}

/** Every unused header that contains one of the words: fees often come in several columns. */
function guessMany(headers: readonly string[], field: 'fee' | 'tax', used: Set<string>): string[] {
  const found = headers.filter((header) => !used.has(header) && !avoided(header, field) && HEADER_WORDS[field].words.some((word) => squash(header).includes(squash(word))));
  for (const header of found) used.add(header);
  return found;
}

/**
 * A starting mapping from the header names and the first rows' values. It is only a guess: the
 * import page shows it for checking before anything is saved.
 */
export function guessMapping(headers: readonly string[], rows: ReadonlyArray<Record<string, string>>, file: Pick<CsvMapping, 'encoding' | 'delimiter' | 'headerRow'>): CsvMapping {
  const used = new Set<string>();
  const single = Object.fromEntries((['tradeDate', 'ticker', 'side', 'qty', 'price', 'currency', 'fxRate', 'note', 'amount'] as const).map((field) => [field, guessOne(headers, field, used)])) as Record<
    SingleField,
    string | null
  >;
  const fee = guessMany(headers, 'fee', used);
  const tax = guessMany(headers, 'tax', used);
  const dates = single.tradeDate === null ? [] : rows.map((row) => row[single.tradeDate as string] ?? '').filter((value) => value !== '');
  return {
    ...file,
    ...single,
    dateFormat: guessDateFormat(dates)?.format ?? 'ymd',
    sideFromSign: false,
    buyWords: [...DEFAULT_SIDE_WORDS.buy],
    sellWords: [...DEFAULT_SIDE_WORDS.sell],
    dividendWords: [...DEFAULT_DIVIDEND_WORDS],
    fee,
    tax,
  };
}

/**
 * A saved (or earlier) mapping applied to a file's headers: columns the file still has are kept,
 * the rest fall back to the guess for this file. `lost` names the columns that were missing.
 * A deliberate "none" (currency from the security, no FX or note column) stays as it was.
 */
export function reconcile(base: CsvMapping, headers: readonly string[], guessed: CsvMapping): { mapping: CsvMapping; lost: string[] } {
  const present = new Set(headers);
  const lost: string[] = [];
  const keep = (name: string | null, fallback: string | null, required: boolean): string | null => {
    if (name === null) return required ? fallback : null;
    if (present.has(name)) return name;
    lost.push(name);
    return fallback;
  };
  const keepAll = (names: readonly string[], fallback: string[]): string[] => {
    const kept = names.filter((name) => present.has(name));
    lost.push(...names.filter((name) => !present.has(name)));
    return kept.length === 0 && names.length > 0 ? fallback : kept;
  };
  const tradeDate = keep(base.tradeDate, guessed.tradeDate, true);
  const mapping: CsvMapping = {
    ...base,
    encoding: guessed.encoding,
    delimiter: guessed.delimiter,
    headerRow: guessed.headerRow,
    tradeDate,
    dateFormat: tradeDate === base.tradeDate ? base.dateFormat : guessed.dateFormat,
    ticker: keep(base.ticker, guessed.ticker, true),
    side: base.sideFromSign ? base.side : keep(base.side, guessed.side, true),
    qty: keep(base.qty, guessed.qty, true),
    price: keep(base.price, guessed.price, true),
    currency: keep(base.currency, guessed.currency, false),
    fee: keepAll(base.fee, guessed.fee),
    tax: keepAll(base.tax, guessed.tax),
    fxRate: keep(base.fxRate, guessed.fxRate, false),
    note: keep(base.note, guessed.note, false),
    // Guessed again when none is set, so a mapping saved before dividends were imported picks one up.
    amount: keep(base.amount, guessed.amount, true),
  };
  return { mapping, lost };
}

// ---------------------------------------------------------------------------
// Checking a mapping that comes from the browser or from the config table
// ---------------------------------------------------------------------------

const MAX_NAME = 200;

function column(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME ? value : undefined;
}

function columns(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= MAX_NAME) ? [...value] : undefined;
}

function words(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length <= 30 && value.every((item) => typeof item === 'string' && item.trim() !== '' && item.length <= 30) ? [...value] : undefined;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.find((option) => option === value);
}

/** A complete, well-formed mapping, or undefined; nothing else is trusted. */
export function parseMapping(value: unknown): CsvMapping | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const mapping = {
    encoding: oneOf(raw['encoding'], ['auto', 'utf-8', 'big5'] as const),
    delimiter: oneOf(raw['delimiter'], DELIMITERS),
    headerRow: Number.isInteger(raw['headerRow']) && (raw['headerRow'] as number) >= 1 && (raw['headerRow'] as number) <= 1000 ? (raw['headerRow'] as number) : undefined,
    tradeDate: column(raw['tradeDate']),
    dateFormat: oneOf(raw['dateFormat'], DATE_FORMATS),
    ticker: column(raw['ticker']),
    side: column(raw['side']),
    sideFromSign: typeof raw['sideFromSign'] === 'boolean' ? raw['sideFromSign'] : undefined,
    buyWords: words(raw['buyWords']),
    sellWords: words(raw['sellWords']),
    qty: column(raw['qty']),
    price: column(raw['price']),
    currency: column(raw['currency']),
    fee: columns(raw['fee']),
    tax: columns(raw['tax']),
    fxRate: column(raw['fxRate']),
    note: column(raw['note']),
    // Mappings saved before dividends were imported have neither field.
    amount: 'amount' in raw ? column(raw['amount']) : null,
    dividendWords: 'dividendWords' in raw ? words(raw['dividendWords']) : [...DEFAULT_DIVIDEND_WORDS],
  };
  return Object.values(mapping).some((field) => field === undefined) ? undefined : (mapping as CsvMapping);
}

// ---------------------------------------------------------------------------
// Saving per broker
// ---------------------------------------------------------------------------

export const MAPPING_PREFIX = 'csv_mapping.';

/**
 * The config key for a broker: csv_mapping.<name> for a plain ASCII name ("Firstrade" →
 * csv_mapping.firstrade), else the name's UTF-8 bytes in hex, since keys allow only a-z, 0-9,
 * "_" and ".". Names that differ only in case or spacing share a key.
 */
export function mappingKey(broker: string): string {
  const name = broker.trim().toLowerCase().replace(/\s+/g, ' ');
  const slug = name.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (/^[\x20-\x7e]+$/.test(name) && slug) return MAPPING_PREFIX + slug;
  return MAPPING_PREFIX + 'u' + [...new TextEncoder().encode(name)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface SavedMapping {
  broker: string;
  mapping: CsvMapping;
}

/** A config row's value as saved by the import, or undefined when it is not one. */
export function parseSavedMapping(value: unknown): SavedMapping | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const broker = raw['broker'];
  const mapping = parseMapping(raw['mapping']);
  return typeof broker === 'string' && broker.trim() !== '' && broker.length <= 60 && mapping ? { broker, mapping } : undefined;
}
