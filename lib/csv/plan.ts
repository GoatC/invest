/**
 * From a statement's text and a mapping to the trades an import would save. The browser runs it
 * for the preview and the server runs it again on import, with the same validation as the trade
 * form (parseTrade), so nothing the browser sends is taken on trust.
 */
import { percent } from '../format';
import { LABELS, type Bilingual } from '../i18n';
import { rateOn, type RateHistory } from '../models/fx';
import type { Pool, Security, Side, Trade } from '../models/types';
import type { Quote } from '../models/valuation';
import { MESSAGES, parseTrade, type TradeField, type TradeInput } from '../validation';
import type { CsvMapping } from './mapping';
import { cleanCell, columnNames, parseCsv, type Delimiter } from './read';
import { isBlank, parseAmount, parseDate, parseSide, resolveTicker } from './values';

export interface Statement {
  headers: string[];
  /** Rows below the header with their row number as a spreadsheet shows it; blank rows are left out. */
  rows: Array<{ line: number; cells: Record<string, string> }>;
}

export function readStatement(text: string, delimiter: Delimiter, headerRow: number): Statement {
  const table = parseCsv(text, delimiter);
  const headerIndex = Math.min(Math.max(headerRow - 1, 0), Math.max(table.length - 1, 0));
  const headers = columnNames(table[headerIndex] ?? []);
  const rows = table.slice(headerIndex + 1).map((cells, offset) => ({
    line: headerIndex + 2 + offset,
    cells: Object.fromEntries(headers.map((header, index) => [header, cleanCell(cells[index])])),
  }));
  return { headers, rows: rows.filter((row) => Object.values(row.cells).some((cell) => cell !== '')) };
}

export type RowStatus = 'new' | 'duplicate' | 'unknown' | 'invalid';

export interface ImportRow {
  line: number;
  status: RowStatus;
  /** The trade as it would be saved; null when the row cannot be read. */
  trade: TradeInput | null;
  /** The ticker as matched to a security, or as written when unknown. */
  ticker: string;
  /** Why the row cannot be imported. */
  problems: Bilingual[];
  /** Things to check that do not stop the import. */
  warnings: Bilingual[];
  /** The date of the loaded rate a foreign trade took, when neither the file nor the person gave one. */
  fxRateDate?: string;
}

export interface ImportOptions {
  pool: Pool;
  /** TWD per unit of the trade currency for rows with no rate column or an empty one. */
  fixedFxRate: number | null;
}

export interface ImportContext {
  securities: ReadonlyMap<string, Security>;
  /** Trades already saved, to skip a statement imported twice. */
  existing: readonly Trade[];
  today: string;
  /** The newest known rate per currency and the config fx_rate_check margin, for the typo check. */
  fx: ReadonlyMap<string, Quote>;
  fxMaxGap: number | null;
  /** The rates the nightly job loaded, for each trade date's rate, and how old one may be (config fx_rate_check). */
  rates: RateHistory;
  fxMaxAgeDays: number | null;
}

function cantRead(label: Bilingual, value: string): Bilingual {
  return value === ''
    ? { en: `${label.en}: empty.`, zh: `${label.zh}：空白。` }
    : { en: `${label.en}: cannot read “${value}”.`, zh: `${label.zh}：無法辨識「${value}」。` };
}

function fieldError(field: TradeField, message: Bilingual): Bilingual {
  return { en: `${LABELS[field].en}: ${message.en}`, zh: `${LABELS[field].zh}：${message.zh}` };
}

/** Adds up the mapped fee or tax columns; blank or dash cells count as 0. */
function total(cells: Record<string, string>, names: readonly string[], label: Bilingual, problems: Bilingual[]): number {
  let sum = 0;
  for (const name of names) {
    const text = cells[name] ?? '';
    if (isBlank(text)) continue;
    const value = parseAmount(text);
    if (value === undefined) problems.push(cantRead({ en: `${label.en} (${name})`, zh: `${label.zh}（${name}）` }, text));
    else sum += Math.abs(value);
  }
  return sum;
}

/** A row as read, with the fill it repeats when its date, ticker, side, quantity and price are readable. */
type ReadRow = Omit<ImportRow, 'line'> & { fill: string | null };

function readRow(cells: Record<string, string>, mapping: CsvMapping, options: ImportOptions, context: ImportContext): ReadRow {
  const problems: Bilingual[] = [];
  const warnings: Bilingual[] = [];
  const cell = (name: string | null) => (name === null ? '' : (cells[name] ?? ''));

  const tickerText = cell(mapping.ticker);
  const { ticker, known } = resolveTicker(tickerText, new Set(context.securities.keys()));
  const qtyText = cell(mapping.qty);
  const signedQty = parseAmount(qtyText);

  // Statements also list dividends, transfers and totals; a row that is not a buy or a sell says
  // only that, rather than every field it lacks.
  let side: Side | undefined;
  if (mapping.sideFromSign) {
    side = signedQty === undefined ? undefined : signedQty < 0 ? 'sell' : 'buy';
  } else {
    const sideText = cell(mapping.side);
    side = parseSide(sideText, { buy: mapping.buyWords, sell: mapping.sellWords });
    if (!side) {
      const problem = isBlank(sideText)
        ? { en: `No ${LABELS.side.en.toLowerCase()} value: not a trade row (a total or a note?).`, zh: `沒有${LABELS.side.zh}：不是交易列（可能是合計或備註）。` }
        : {
            en: `Not a buy or a sell (${LABELS.side.en}: “${sideText}”); dividends and transfers are not trades.`,
            zh: `不是買進或賣出（${LABELS.side.zh}：「${sideText}」）；股利與轉帳不屬於交易。`,
          };
      return { status: 'invalid', trade: null, ticker, problems: [problem], warnings, fill: null };
    }
  }

  const dateText = cell(mapping.tradeDate);
  const tradeDate = parseDate(dateText, mapping.dateFormat);
  if (!tradeDate) problems.push(cantRead(LABELS.tradeDate, dateText));
  if (!ticker) problems.push(cantRead(LABELS.ticker, tickerText));
  if (signedQty === undefined) problems.push(cantRead(LABELS.qty, qtyText));

  const priceText = cell(mapping.price);
  const price = parseAmount(priceText);
  if (price === undefined) problems.push(cantRead(LABELS.price, priceText));
  const fee = total(cells, mapping.fee, LABELS.fee, problems);
  const tax = total(cells, mapping.tax, LABELS.tax, problems);
  // A saved trade is recognised even when this row lacks something only a new trade needs, such as its FX rate.
  const fill = tradeDate && known && side && signedQty !== undefined && price !== undefined ? fillKey({ tradeDate, ticker, side, qty: Math.abs(signedQty), price }) : null;

  const security = context.securities.get(ticker);
  const currency = (mapping.currency ? cell(mapping.currency) : (security?.currency ?? '')).trim().toUpperCase();
  // The rate on the trade date, as loaded by the nightly job: the default, and the typo check's yardstick.
  const dated = tradeDate && currency && context.fxMaxAgeDays !== null ? rateOn(context.rates, currency, tradeDate, context.fxMaxAgeDays) : undefined;
  let fxRate: number | undefined;
  let fxRateDate: string | undefined;
  if (currency === 'TWD') fxRate = 1;
  else {
    const rateText = cell(mapping.fxRate);
    const fromColumn = mapping.fxRate && !isBlank(rateText) ? parseAmount(rateText) : undefined;
    if (mapping.fxRate && !isBlank(rateText) && fromColumn === undefined) problems.push(cantRead(LABELS.fxRate, rateText));
    fxRate = fromColumn ?? options.fixedFxRate ?? undefined;
    if (fxRate === undefined && dated) {
      fxRate = dated.rate;
      fxRateDate = dated.date;
    }
    if (fxRate === undefined && problems.length === 0 && currency) {
      problems.push({
        en: `${LABELS.fxRate.en}: none for this ${currency} trade, and no rate loaded for its date; map a rate column or enter one rate for the file.`,
        zh: `${LABELS.fxRate.zh}：這筆 ${currency} 交易沒有匯率，也還沒有交易日當天的匯率；請對應匯率欄位，或為整份檔案輸入一個匯率。`,
      });
    }
  }

  if (!known && ticker) {
    const unknown = { en: `Unknown ticker ${ticker}: add it as a security, then check again.`, zh: `找不到代號 ${ticker}：請先新增證券，再重新檢查。` };
    return { status: problems.length > 0 ? 'invalid' : 'unknown', trade: null, ticker, problems: [unknown, ...problems], warnings, fill: null };
  }
  if (problems.length > 0) return { status: 'invalid', trade: null, ticker, problems, warnings, fill };

  // The same checks as the trade form: dates not in the future, amounts, currency codes.
  const parsed = parseTrade(
    {
      tradeDate: tradeDate ?? '',
      ticker,
      side,
      qty: String(Math.abs(signedQty ?? 0)),
      price: String(price),
      currency,
      fee: String(fee),
      tax: String(tax),
      fxRate: String(fxRate),
      pool: options.pool,
      note: cell(mapping.note).slice(0, 500),
    },
    context.securities,
    context.today,
  );
  if (!parsed.ok) {
    return {
      status: 'invalid',
      trade: null,
      ticker,
      problems: Object.entries(parsed.errors).map(([field, message]) => fieldError(field as TradeField, message ?? MESSAGES.required)),
      warnings,
      fill,
    };
  }

  const reference = dated ? { value: dated.rate, date: dated.date } : context.fx.get(parsed.value.currency);
  const gap = context.fxMaxGap;
  if (gap !== null && parsed.value.currency !== 'TWD' && reference && Math.abs(parsed.value.fxRate - reference.value) / reference.value > gap) {
    warnings.push({
      en: `FX rate ${parsed.value.fxRate} is more than ${percent(gap, 0)} away from ${reference.value} (${reference.date}); check it.`,
      zh: `匯率 ${parsed.value.fxRate} 與 ${reference.value}（${reference.date}）相差超過 ${percent(gap, 0)}，請確認。`,
    });
  }
  return { status: 'new', trade: parsed.value, ticker, problems, warnings, fill, ...(fxRateDate ? { fxRateDate } : {}) };
}

/** The same fill: date, ticker, side, quantity and price (fees may have been corrected since). */
function fillKey(trade: Pick<Trade, 'tradeDate' | 'ticker' | 'side' | 'qty' | 'price'>): string {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return `${trade.tradeDate}|${trade.ticker}|${trade.side}|${round(trade.qty)}|${round(trade.price)}`;
}

/**
 * Every row of the statement with what an import would do with it. A row that repeats a saved
 * trade is a duplicate, counted one for one: two identical saved fills cover two identical rows.
 * A duplicate that could not be imported anyway (no FX rate, say) carries no trade to keep.
 */
export function planImport(statement: Statement, mapping: CsvMapping, options: ImportOptions, context: ImportContext): ImportRow[] {
  const saved = new Map<string, number>();
  for (const trade of context.existing) saved.set(fillKey(trade), (saved.get(fillKey(trade)) ?? 0) + 1);
  return statement.rows.map(({ line, cells }) => {
    const { fill, ...row } = readRow(cells, mapping, options, context);
    const count = fill === null ? 0 : (saved.get(fill) ?? 0);
    if (fill !== null && count > 0) {
      saved.set(fill, count - 1);
      return { line, ...row, status: 'duplicate', problems: [] };
    }
    return { line, ...row };
  });
}

/**
 * The trades to save: new rows, plus duplicates the person chose to keep, in date order with a
 * day's buys before its sells, since statements often list the newest first. Saving in this
 * order gives them ids that replay correctly.
 */
export function tradesToImport(rows: readonly ImportRow[], keepDuplicates: ReadonlySet<number>): TradeInput[] {
  const chosen = rows.filter((row) => row.trade && (row.status === 'new' || (row.status === 'duplicate' && keepDuplicates.has(row.line))));
  const ordered = chosen
    .map((row, index) => ({ trade: row.trade as TradeInput, index }))
    .sort((a, b) => a.trade.tradeDate.localeCompare(b.trade.tradeDate) || (a.trade.side === b.trade.side ? 0 : a.trade.side === 'buy' ? -1 : 1) || a.index - b.index);
  return ordered.map((entry) => entry.trade);
}
