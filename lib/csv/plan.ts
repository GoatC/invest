/**
 * From a statement's text and a mapping to the trades and dividends an import would save. The
 * browser runs it for the preview and the server runs it again on import, with the same
 * validation as the trade and cash-flow forms (parseTrade, parseCashFlow), so nothing the browser
 * sends is taken on trust.
 */
import { percent } from '../format';
import { LABELS, type Bilingual } from '../i18n';
import { rateOn, type RateHistory } from '../models/fx';
import type { CashFlow, Pool, Security, Side, Trade } from '../models/types';
import type { Quote } from '../models/valuation';
import { MESSAGES, parseCashFlow, parseTrade, type CashFlowField, type CashFlowInput, type TradeField, type TradeInput } from '../validation';
import type { CsvMapping } from './mapping';
import { cleanCell, columnNames, parseCsv, type Delimiter } from './read';
import { isBlank, isDividend, parseAmount, parseDate, parseSide, resolveTicker } from './values';

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
  /** The trade as it would be saved; null when the row is a dividend or cannot be read. */
  trade: TradeInput | null;
  /** A dividend row as the cash flow it would save; null otherwise. */
  flow: CashFlowInput | null;
  /** The ticker as matched to a security, or as written when unknown. */
  ticker: string;
  /** Why the row cannot be imported. */
  problems: Bilingual[];
  /** Things to check that do not stop the import. */
  warnings: Bilingual[];
  /** The date of the loaded rate a foreign row took, when neither the file nor the person gave one. */
  fxRateDate?: string;
}

export interface ImportOptions {
  pool: Pool;
  /** TWD per unit of the trade currency for rows with no rate column or an empty one. */
  fixedFxRate: number | null;
}

export interface ImportContext {
  securities: ReadonlyMap<string, Security>;
  /** Trades and cash flows already saved, to skip a statement imported twice. */
  existing: readonly Trade[];
  existingFlows: readonly CashFlow[];
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

function fieldError(label: Bilingual, message: Bilingual): Bilingual {
  return { en: `${label.en}: ${message.en}`, zh: `${label.zh}：${message.zh}` };
}

const FLOW_LABELS: Record<CashFlowField, Bilingual> = {
  flowDate: LABELS.tradeDate,
  type: LABELS.flowType,
  amount: LABELS.amount,
  currency: LABELS.currency,
  fxRate: LABELS.fxRate,
  pool: LABELS.pool,
  ticker: LABELS.ticker,
  note: LABELS.note,
};

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

interface RowRate {
  fxRate: number | undefined;
  /** Set when the rate is the date's loaded one rather than the file's or the person's. */
  fxRateDate?: string;
  /** What a typed rate is checked against: the date's loaded rate, else the newest known one. */
  reference: { value: number; date: string } | undefined;
}

/** What a row holds, for the messages about it. */
const KIND = { trade: { en: 'trade', zh: '交易' }, dividend: { en: 'dividend', zh: '股利' } } as const satisfies Record<string, Bilingual>;

/** A foreign row's FX rate: from its column, else the one typed for the file, else the date's loaded rate. */
function rowRate(
  kind: Bilingual,
  currency: string,
  date: string | undefined,
  rateText: string,
  mapping: CsvMapping,
  options: ImportOptions,
  context: ImportContext,
  problems: Bilingual[],
): RowRate {
  // The rate on the date, as loaded by the nightly job: the default, and the typo check's yardstick.
  const dated = date && currency && context.fxMaxAgeDays !== null ? rateOn(context.rates, currency, date, context.fxMaxAgeDays) : undefined;
  const reference = dated ? { value: dated.rate, date: dated.date } : context.fx.get(currency);
  if (currency === 'TWD') return { fxRate: 1, reference };
  const fromColumn = mapping.fxRate && !isBlank(rateText) ? parseAmount(rateText) : undefined;
  if (mapping.fxRate && !isBlank(rateText) && fromColumn === undefined) problems.push(cantRead(LABELS.fxRate, rateText));
  const given = fromColumn ?? options.fixedFxRate ?? undefined;
  if (given !== undefined) return { fxRate: given, reference };
  if (dated) return { fxRate: dated.rate, fxRateDate: dated.date, reference };
  if (problems.length === 0 && currency) {
    problems.push({
      en: `${LABELS.fxRate.en}: none for this ${currency} ${kind.en}, and no rate loaded for its date; map a rate column or enter one rate for the file.`,
      zh: `${LABELS.fxRate.zh}：這筆 ${currency} ${kind.zh}沒有匯率，也還沒有當天的匯率；請對應匯率欄位，或為整份檔案輸入一個匯率。`,
    });
  }
  return { fxRate: undefined, reference };
}

/** A rate far from the date's (else the newest) is probably a typo; it is flagged, not refused. */
function rateWarning(fxRate: number, currency: string, reference: RowRate['reference'], context: ImportContext): Bilingual[] {
  const gap = context.fxMaxGap;
  if (gap === null || currency === 'TWD' || !reference || Math.abs(fxRate - reference.value) / reference.value <= gap) return [];
  return [
    {
      en: `FX rate ${fxRate} is more than ${percent(gap, 0)} away from ${reference.value} (${reference.date}); check it.`,
      zh: `匯率 ${fxRate} 與 ${reference.value}（${reference.date}）相差超過 ${percent(gap, 0)}，請確認。`,
    },
  ];
}

function unknownTicker(ticker: string): Bilingual {
  return { en: `Unknown ticker ${ticker}: add it as a security, then check again.`, zh: `找不到代號 ${ticker}：請先新增證券，再重新檢查。` };
}

/** A row as read, with the saved entry it repeats when the fields that identify one are readable. */
type ReadRow = Omit<ImportRow, 'line'> & { fill: string | null };

function readRow(cells: Record<string, string>, mapping: CsvMapping, options: ImportOptions, context: ImportContext): ReadRow {
  const problems: Bilingual[] = [];
  const warnings: Bilingual[] = [];
  const cell = (name: string | null) => (name === null ? '' : (cells[name] ?? ''));

  const tickerText = cell(mapping.ticker);
  const { ticker, known } = resolveTicker(tickerText, new Set(context.securities.keys()));
  const qtyText = cell(mapping.qty);
  const signedQty = parseAmount(qtyText);

  // Statements also list dividends, transfers and totals. A dividend becomes a cash flow; any other
  // row that is not a buy or a sell says only that, rather than every field it lacks.
  let side: Side | undefined;
  if (mapping.sideFromSign) {
    side = signedQty === undefined ? undefined : signedQty < 0 ? 'sell' : 'buy';
  } else {
    const sideText = cell(mapping.side);
    side = parseSide(sideText, { buy: mapping.buyWords, sell: mapping.sellWords });
    if (!side && isDividend(sideText, mapping.dividendWords)) return readDividend(cell, mapping, options, context, { ticker, known, tickerText });
    if (!side) {
      const problem = isBlank(sideText)
        ? { en: `No ${LABELS.side.en.toLowerCase()} value: not a trade row (a total or a note?).`, zh: `沒有${LABELS.side.zh}：不是交易列（可能是合計或備註）。` }
        : {
            en: `Not a buy, a sell or a dividend (${LABELS.side.en}: “${sideText}”); transfers and other entries are not imported.`,
            zh: `不是買進、賣出或股利（${LABELS.side.zh}：「${sideText}」）；轉帳等其他項目不會匯入。`,
          };
      return { status: 'invalid', trade: null, flow: null, ticker, problems: [problem], warnings, fill: null };
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
  const { fxRate, fxRateDate, reference } = rowRate(KIND.trade, currency, tradeDate, cell(mapping.fxRate), mapping, options, context, problems);

  if (!known && ticker) {
    return { status: problems.length > 0 ? 'invalid' : 'unknown', trade: null, flow: null, ticker, problems: [unknownTicker(ticker), ...problems], warnings, fill: null };
  }
  if (problems.length > 0) return { status: 'invalid', trade: null, flow: null, ticker, problems, warnings, fill };

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
      flow: null,
      ticker,
      problems: Object.entries(parsed.errors).map(([field, message]) => fieldError(LABELS[field as TradeField], message ?? MESSAGES.required)),
      warnings,
      fill,
    };
  }
  warnings.push(...rateWarning(parsed.value.fxRate, parsed.value.currency, reference, context));
  return { status: 'new', trade: parsed.value, flow: null, ticker, problems, warnings, fill, ...(fxRateDate ? { fxRateDate } : {}) };
}

/**
 * A cash dividend: its date, its security and the amount column, in the security's currency (or
 * the currency column's), at the same FX rate a trade on that day would take.
 */
function readDividend(
  cell: (name: string | null) => string,
  mapping: CsvMapping,
  options: ImportOptions,
  context: ImportContext,
  { ticker, known, tickerText }: { ticker: string; known: boolean; tickerText: string },
): ReadRow {
  const problems: Bilingual[] = [];
  const warnings: Bilingual[] = [];
  const dateText = cell(mapping.tradeDate);
  const flowDate = parseDate(dateText, mapping.dateFormat);
  if (!flowDate) problems.push(cantRead(LABELS.tradeDate, dateText));
  if (!ticker) problems.push(cantRead(LABELS.ticker, tickerText));
  let amount: number | undefined;
  if (!mapping.amount) {
    problems.push({ en: 'A dividend: choose the amount column above to import it.', zh: '這是股利：請在上方選擇金額欄位，才能匯入。' });
  } else {
    const amountText = cell(mapping.amount);
    const value = parseAmount(amountText);
    if (value === undefined || value === 0) problems.push(cantRead(LABELS.amount, amountText));
    else amount = Math.abs(value);
  }
  // A saved dividend is recognised even when this row lacks its FX rate.
  const fill = flowDate && known && amount !== undefined ? dividendKey({ flowDate, ticker, amount }) : null;

  const security = context.securities.get(ticker);
  const currency = (mapping.currency ? cell(mapping.currency) : (security?.currency ?? '')).trim().toUpperCase();
  const { fxRate, fxRateDate, reference } = rowRate(KIND.dividend, currency, flowDate, cell(mapping.fxRate), mapping, options, context, problems);

  if (!known && ticker) {
    return { status: problems.length > 0 ? 'invalid' : 'unknown', trade: null, flow: null, ticker, problems: [unknownTicker(ticker), ...problems], warnings, fill: null };
  }
  if (problems.length > 0) return { status: 'invalid', trade: null, flow: null, ticker, problems, warnings, fill };

  // The same checks as the cash-flow form.
  const parsed = parseCashFlow(
    { flowDate: flowDate ?? '', type: 'dividend', amount: String(amount), currency, fxRate: String(fxRate), pool: options.pool, ticker, note: cell(mapping.note).slice(0, 500) },
    context.securities,
    context.today,
  );
  if (!parsed.ok) {
    return {
      status: 'invalid',
      trade: null,
      flow: null,
      ticker,
      problems: Object.entries(parsed.errors).map(([field, message]) => fieldError(FLOW_LABELS[field as CashFlowField], message ?? MESSAGES.required)),
      warnings,
      fill,
    };
  }
  warnings.push(...rateWarning(parsed.value.fxRate, parsed.value.currency, reference, context));
  return { status: 'new', trade: null, flow: parsed.value, ticker, problems, warnings, fill, ...(fxRateDate ? { fxRateDate } : {}) };
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** The same fill: date, ticker, side, quantity and price (fees may have been corrected since). */
function fillKey(trade: Pick<Trade, 'tradeDate' | 'ticker' | 'side' | 'qty' | 'price'>): string {
  return `${trade.tradeDate}|${trade.ticker}|${trade.side}|${round(trade.qty)}|${round(trade.price)}`;
}

/** The same dividend: date, security and amount. */
function dividendKey(flow: { flowDate: string; ticker: string; amount: number }): string {
  return `${flow.flowDate}|${flow.ticker}|dividend|${round(flow.amount)}`;
}

/**
 * Every row of the statement with what an import would do with it. A row that repeats a saved
 * trade or dividend is a duplicate, counted one for one: two identical saved fills cover two
 * identical rows. A duplicate that could not be imported anyway (no FX rate, say) carries nothing
 * to keep.
 */
export function planImport(statement: Statement, mapping: CsvMapping, options: ImportOptions, context: ImportContext): ImportRow[] {
  const saved = new Map<string, number>();
  const count = (key: string) => saved.set(key, (saved.get(key) ?? 0) + 1);
  for (const trade of context.existing) count(fillKey(trade));
  for (const flow of context.existingFlows) {
    if (flow.type === 'dividend' && flow.ticker) count(dividendKey({ flowDate: flow.flowDate, ticker: flow.ticker, amount: flow.amount }));
  }
  return statement.rows.map(({ line, cells }) => {
    const { fill, ...row } = readRow(cells, mapping, options, context);
    const left = fill === null ? 0 : (saved.get(fill) ?? 0);
    if (fill !== null && left > 0) {
      saved.set(fill, left - 1);
      return { line, ...row, status: 'duplicate', problems: [] };
    }
    return { line, ...row };
  });
}

function chosen(row: ImportRow, keepDuplicates: ReadonlySet<number>): boolean {
  return row.status === 'new' || (row.status === 'duplicate' && keepDuplicates.has(row.line));
}

/**
 * The trades to save: new rows, plus duplicates the person chose to keep, in date order with a
 * day's buys before its sells, since statements often list the newest first. Saving in this
 * order gives them ids that replay correctly.
 */
export function tradesToImport(rows: readonly ImportRow[], keepDuplicates: ReadonlySet<number>): TradeInput[] {
  const ordered = rows
    .filter((row) => row.trade && chosen(row, keepDuplicates))
    .map((row, index) => ({ trade: row.trade as TradeInput, index }))
    .sort((a, b) => a.trade.tradeDate.localeCompare(b.trade.tradeDate) || (a.trade.side === b.trade.side ? 0 : a.trade.side === 'buy' ? -1 : 1) || a.index - b.index);
  return ordered.map((entry) => entry.trade);
}

/** The dividends to save, by the same choice, oldest first. */
export function flowsToImport(rows: readonly ImportRow[], keepDuplicates: ReadonlySet<number>): CashFlowInput[] {
  const flows = rows.filter((row) => row.flow && chosen(row, keepDuplicates)).map((row) => row.flow as CashFlowInput);
  return flows.sort((a, b) => a.flowDate.localeCompare(b.flowDate));
}
