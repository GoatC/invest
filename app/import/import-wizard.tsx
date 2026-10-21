'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useMemo, useState, useTransition } from 'react';

import { Bi } from '@/components/bi';
import { Field } from '@/components/field';
import { MAX_STATEMENT_BYTES } from '@/lib/csv/limits';
import { guessMapping, missingColumns, reconcile, type CsvMapping, type SavedMapping } from '@/lib/csv/mapping';
import { planImport, readStatement, tradesToImport, type ImportRow, type RowStatus } from '@/lib/csv/plan';
import { decodeCsv, detectDelimiter, guessHeaderRow, parseCsv, type Delimiter, type EncodingChoice } from '@/lib/csv/read';
import { guessDateFormat, wordList, type DateFormat } from '@/lib/csv/values';
import type { HoldingsData } from '@/lib/data';
import { quantity } from '@/lib/format';
import { shortfallMessage } from '@/lib/forms';
import { bi, LABELS, POOL, SIDE, type Bilingual } from '@/lib/i18n';
import { previewImport } from '@/lib/models/portfolio';
import type { Pool } from '@/lib/models/types';
import { latestFx } from '@/lib/models/valuation';
import { breachText } from '@/lib/rule-text';
import { parseNumber } from '@/lib/validation';

import { importTrades, type ImportState } from './actions';

const INITIAL_STATE: ImportState = { message: null };
/** The broker select's value for a broker without a saved mapping. */
const OTHER_BROKER = '';
/** The side select's value for "negative quantity means sell". */
const FROM_SIGN = '\u0000sign';
/** Rows shown in the preview table; the counts always cover the whole file. */
const PREVIEW_ROWS = 300;

const TOO_LARGE: Bilingual = { en: 'This file is too large; export a shorter period.', zh: '檔案太大，請匯出較短的期間。' };

const STATUS: Record<RowStatus, { label: Bilingual; badge: string }> = {
  new: { label: { en: 'New', zh: '新交易' }, badge: 'badge' },
  duplicate: { label: { en: 'Already saved', zh: '已存在' }, badge: 'badge' },
  unknown: { label: { en: 'Unknown ticker', zh: '未知代號' }, badge: 'badge warn' },
  invalid: { label: { en: 'Skipped', zh: '略過' }, badge: 'badge warn' },
};

const DATE_FORMAT_LABELS: Record<DateFormat, Bilingual> = {
  ymd: { en: 'Year first: 2026/10/07', zh: '年在前：2026/10/07' },
  roc: { en: 'ROC year: 115/10/07', zh: '民國年：115/10/07' },
  mdy: { en: 'Month first: 10/07/2026', zh: '月在前：10/07/2026' },
  dmy: { en: 'Day first: 07/10/2026', zh: '日在前：07/10/2026' },
};

interface LoadedFile {
  name: string;
  bytes: Uint8Array;
}

type FileSettings = Pick<CsvMapping, 'encoding' | 'delimiter' | 'headerRow'>;

/** Reads the file and guesses its layout and columns, with any settings already chosen. */
function guessFor(bytes: Uint8Array, settings: Partial<FileSettings>): { mapping: CsvMapping; headers: string[] } {
  const encoding = settings.encoding ?? 'auto';
  const { text } = decodeCsv(bytes, encoding);
  const delimiter = settings.delimiter ?? detectDelimiter(text);
  const headerRow = settings.headerRow ?? guessHeaderRow(parseCsv(text, delimiter)) + 1;
  const statement = readStatement(text, delimiter, headerRow);
  return { mapping: guessMapping(statement.headers, statement.rows.map((row) => row.cells), { encoding, delimiter, headerRow }), headers: statement.headers };
}

/**
 * The mapping for a newly chosen file: a saved one where the file still has its columns (trying
 * the saved layout, then a fresh look, and keeping whichever loses fewer), else a guess.
 */
function prepare(bytes: Uint8Array, saved: CsvMapping | undefined): { mapping: CsvMapping; lost: string[] } {
  if (!saved) return { mapping: guessFor(bytes, {}).mapping, lost: [] };
  const attempts = [guessFor(bytes, saved), guessFor(bytes, { encoding: saved.encoding })].map(({ mapping, headers }) => reconcile(saved, headers, mapping));
  const [first, second] = attempts as [ReturnType<typeof reconcile>, ReturnType<typeof reconcile>];
  return second.lost.length < first.lost.length ? second : first;
}

export function ImportWizard({ data, mappings, today }: { data: HoldingsData; mappings: SavedMapping[]; today: string }) {
  const router = useRouter();
  const [checking, startChecking] = useTransition();
  const [broker, setBroker] = useState(mappings[0]?.broker ?? OTHER_BROKER);
  const [brokerName, setBrokerName] = useState('');
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<Bilingual | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [lost, setLost] = useState<string[]>([]);
  const [pool, setPool] = useState<Pool>('regular');
  const [fixedFx, setFixedFx] = useState('');
  const [keep, setKeep] = useState<ReadonlySet<number>>(new Set());
  const [state, formAction, pending] = useActionState(importTrades, INITIAL_STATE);

  const saved = mappings.find((entry) => entry.broker === broker);
  const name = saved ? saved.broker : brokerName.trim();

  function load(next: LoadedFile, base: CsvMapping | undefined) {
    const prepared = prepare(next.bytes, base);
    setFile(next);
    setMapping(prepared.mapping);
    setLost(prepared.lost);
    setKeep(new Set());
  }

  async function chooseFile(input: HTMLInputElement) {
    const chosen = input.files?.[0];
    if (!chosen) return;
    if (chosen.size > MAX_STATEMENT_BYTES) {
      setFileError(TOO_LARGE);
      setFile(null);
      setMapping(null);
      return;
    }
    setFileError(null);
    load({ name: chosen.name, bytes: new Uint8Array(await chosen.arrayBuffer()) }, saved?.mapping);
  }

  function chooseBroker(value: string) {
    setBroker(value);
    if (file) load(file, mappings.find((entry) => entry.broker === value)?.mapping);
  }

  /** A new encoding, separator or header row: the columns are matched again, keeping choices that still fit. */
  function changeLayout(settings: Partial<FileSettings>) {
    if (!file || !mapping) return;
    const { mapping: guessed, headers } = guessFor(file.bytes, { encoding: mapping.encoding, delimiter: mapping.delimiter, headerRow: mapping.headerRow, ...settings });
    setMapping(reconcile(mapping, headers, guessed).mapping);
    setLost([]);
    setKeep(new Set());
  }

  function update(patch: Partial<CsvMapping>) {
    setMapping((current) => (current ? { ...current, ...patch } : current));
    setKeep(new Set());
  }

  const decoded = useMemo(() => (file && mapping ? decodeCsv(file.bytes, mapping.encoding) : null), [file, mapping?.encoding]);
  const statement = useMemo(
    () => (decoded && mapping ? readStatement(decoded.text, mapping.delimiter, mapping.headerRow) : null),
    [decoded, mapping?.delimiter, mapping?.headerRow],
  );
  const securities = useMemo(() => new Map(data.securities.map((security) => [security.ticker, security])), [data.securities]);
  const fx = useMemo(() => latestFx(data.fx, data.trades), [data.fx, data.trades]);

  const rate = parseNumber(fixedFx);
  const fixedFxRate = rate !== undefined && rate > 0 ? rate : null;
  const missing = mapping ? missingColumns(mapping) : [];
  const rows: ImportRow[] =
    statement && mapping && missing.length === 0
      ? planImport(statement, mapping, { pool, fixedFxRate }, { securities, existing: data.trades, today, fx, fxMaxGap: data.fxMaxGap })
      : [];
  const toImport = tradesToImport(rows, keep);
  const preview = toImport.length > 0 ? previewImport(data, toImport, data.caps) : null;
  const tooLarge = useMemo(() => (decoded ? new TextEncoder().encode(decoded.text).length > MAX_STATEMENT_BYTES : false), [decoded]);
  const blocked = Boolean(preview && preview.shortfalls.length > 0);
  const canImport = !pending && name !== '' && missing.length === 0 && toImport.length > 0 && !blocked && !tooLarge;

  return (
    <div className="form">
      <div className="form-grid">
        {mappings.length > 0 && (
          <Field label={{ en: 'Broker', zh: '券商' }}>
            <select value={broker} onChange={(e) => chooseBroker(e.target.value)}>
              {mappings.map((entry) => (
                <option key={entry.broker} value={entry.broker}>
                  {entry.broker}
                </option>
              ))}
              <option value={OTHER_BROKER}>{bi({ en: 'Another broker…', zh: '其他券商…' })}</option>
            </select>
          </Field>
        )}
        {!saved && (
          <Field label={{ en: 'Broker name', zh: '券商名稱' }} hint={<Bi en="The column mapping is saved under this name" zh="欄位對應會以此名稱儲存" />}>
            <input value={brokerName} maxLength={60} required onChange={(e) => setBrokerName(e.target.value)} />
          </Field>
        )}
        <Field
          label={{ en: 'Statement file (CSV)', zh: '對帳單檔案（CSV）' }}
          error={fileError}
          hint={decoded ? <Bi en={`Read as ${decoded.encoding === 'big5' ? 'Big5' : 'UTF-8'}`} zh={`以 ${decoded.encoding === 'big5' ? 'Big5' : 'UTF-8'} 讀取`} /> : undefined}
        >
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void chooseFile(e.currentTarget)} />
        </Field>
      </div>

      {file && mapping && statement && (
        <>
          <ColumnsStep mapping={mapping} headers={statement.headers} firstRow={statement.rows[0]?.cells ?? {}} lost={lost} update={update} changeLayout={changeLayout} />
          <div className="form-grid">
            <Field label={{ en: 'FX rate for rows without one', zh: '沒有匯率的列使用的匯率' }} hint={<Bi en="TWD per 1 unit; TWD trades need none" zh="每 1 單位兌台幣；台幣交易不需要" />}>
              <input inputMode="decimal" value={fixedFx} onChange={(e) => setFixedFx(e.target.value)} />
            </Field>
            <Field label={{ en: 'Pool for these trades', zh: '這些交易的資金池' }}>
              <select value={pool} onChange={(e) => setPool(e.target.value === 'windfall' ? 'windfall' : 'regular')}>
                <option value="regular">{bi(POOL.regular)}</option>
                <option value="windfall">{bi(POOL.windfall)}</option>
              </select>
            </Field>
          </div>

          <h2>
            <Bi en="Preview" zh="預覽" />
          </h2>
          {missing.length > 0 ? (
            <p className="banner info">
              <Bi
                en={`Choose a column for: ${missing.map((field) => LABELS[field].en).join(', ')}.`}
                zh={`請為以下項目選擇欄位：${missing.map((field) => LABELS[field].zh).join('、')}。`}
              />
            </p>
          ) : (
            <Preview
              rows={rows}
              keep={keep}
              setKeep={setKeep}
              preview={preview}
              caps={data.caps}
              checking={checking}
              checkAgain={() => startChecking(() => router.refresh())}
            />
          )}

          <form action={formAction} className="form">
            <input type="hidden" name="csv" value={decoded?.text ?? ''} />
            <input type="hidden" name="broker" value={name} />
            <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
            <input type="hidden" name="pool" value={pool} />
            <input type="hidden" name="fixedFxRate" value={fixedFx} />
            <input type="hidden" name="keep" value={JSON.stringify([...keep])} />
            {tooLarge && (
              <p className="banner danger" role="alert">
                <Bi {...TOO_LARGE} />
              </p>
            )}
            {name === '' && (
              <p className="muted small">
                <Bi en="Name the broker above to import." zh="請先在上方填寫券商名稱。" />
              </p>
            )}
            {state.message && (
              <p className="banner danger" role="alert">
                <Bi {...state.message} />
              </p>
            )}
            <div className="row">
              <button type="submit" className="button primary" disabled={!canImport}>
                {pending ? (
                  <Bi en="Importing…" zh="匯入中…" />
                ) : (
                  <Bi en={`Import ${toImport.length} trade${toImport.length === 1 ? '' : 's'}`} zh={`匯入 ${toImport.length} 筆交易`} />
                )}
              </button>
              <Link href="/holdings" className="button">
                <Bi {...LABELS.cancel} />
              </Link>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function ColumnSelect({ value, headers, onChange, none }: { value: string | null; headers: readonly string[]; onChange: (value: string | null) => void; none: Bilingual }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
      <option value="">{bi(none)}</option>
      {headers.map((header) => (
        <option key={header} value={header}>
          {header}
        </option>
      ))}
    </select>
  );
}

function ColumnChecks({ legend, chosen, headers, onChange }: { legend: Bilingual; chosen: readonly string[]; headers: readonly string[]; onChange: (value: string[]) => void }) {
  return (
    <fieldset>
      <legend>
        <Bi {...legend} />
      </legend>
      {headers.map((header) => (
        <label key={header} className="choice">
          <input
            type="checkbox"
            checked={chosen.includes(header)}
            onChange={(e) => onChange(e.target.checked ? headers.filter((h) => h === header || chosen.includes(h)) : chosen.filter((h) => h !== header))}
          />
          {header}
        </label>
      ))}
    </fieldset>
  );
}

function ColumnsStep({
  mapping,
  headers,
  firstRow,
  lost,
  update,
  changeLayout,
}: {
  mapping: CsvMapping;
  headers: string[];
  firstRow: Record<string, string>;
  lost: string[];
  update: (patch: Partial<CsvMapping>) => void;
  changeLayout: (settings: Partial<FileSettings>) => void;
}) {
  const sample = (column: string | null) =>
    column === null ? undefined : <Bi en={`First row: ${firstRow[column] || '(empty)'}`} zh={`第一列：${firstRow[column] || '（空白）'}`} />;
  const choose: Bilingual = { en: 'Choose a column…', zh: '請選擇欄位…' };
  const dates = mapping.tradeDate ? guessDateFormat([firstRow[mapping.tradeDate] ?? '']) : undefined;
  const ambiguous = Boolean(dates?.ambiguous) && (mapping.dateFormat === 'mdy' || mapping.dateFormat === 'dmy');

  return (
    <fieldset className="form">
      <legend>
        <Bi en="Columns" zh="欄位對應" />
      </legend>
      <div className="form-grid">
        <Field label={{ en: 'Encoding', zh: '文字編碼' }} hint={<Bi en="Try Big5 if Chinese looks garbled" zh="中文若顯示亂碼，請改選 Big5" />}>
          <select value={mapping.encoding} onChange={(e) => changeLayout({ encoding: e.target.value as EncodingChoice })}>
            <option value="auto">{bi({ en: 'Automatic', zh: '自動' })}</option>
            <option value="utf-8">UTF-8</option>
            <option value="big5">Big5</option>
          </select>
        </Field>
        <Field label={{ en: 'Separator', zh: '分隔符號' }}>
          <select value={mapping.delimiter} onChange={(e) => changeLayout({ delimiter: e.target.value as Delimiter })}>
            <option value=",">{bi({ en: 'Comma ,', zh: '逗號 ,' })}</option>
            <option value=";">{bi({ en: 'Semicolon ;', zh: '分號 ;' })}</option>
            <option value={'\t'}>{bi({ en: 'Tab', zh: '定位字元' })}</option>
          </select>
        </Field>
        <Field label={{ en: 'Header row', zh: '標題列' }} hint={<Bi en="The row holding the column names" zh="欄位名稱所在的列" />}>
          <input
            type="number"
            min={1}
            max={1000}
            value={mapping.headerRow}
            onChange={(e) => {
              const row = Number(e.target.value);
              if (Number.isInteger(row) && row >= 1 && row <= 1000) changeLayout({ headerRow: row });
            }}
          />
        </Field>
      </div>
      {lost.length > 0 && (
        <p className="banner warn">
          <Bi
            en={`The saved mapping uses columns this file does not have, so they were guessed again: ${lost.join(', ')}.`}
            zh={`已儲存的對應使用了此檔案沒有的欄位，已重新判斷：${lost.join('、')}。`}
          />
        </p>
      )}
      <div className="form-grid">
        <Field label={LABELS.tradeDate} hint={sample(mapping.tradeDate)}>
          <ColumnSelect value={mapping.tradeDate} headers={headers} none={choose} onChange={(tradeDate) => update({ tradeDate })} />
        </Field>
        <Field label={{ en: 'Date format', zh: '日期格式' }} hint={ambiguous ? <Bi en="Month and day both fit; check one date" zh="月與日都可能，請核對一筆日期" /> : undefined}>
          <select value={mapping.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as DateFormat })}>
            {(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map((format) => (
              <option key={format} value={format}>
                {bi(DATE_FORMAT_LABELS[format])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={LABELS.ticker} hint={sample(mapping.ticker)}>
          <ColumnSelect value={mapping.ticker} headers={headers} none={choose} onChange={(ticker) => update({ ticker })} />
        </Field>
        <Field label={LABELS.side} hint={mapping.sideFromSign ? <Bi en="A negative quantity is a sell" zh="數量為負即為賣出" /> : sample(mapping.side)}>
          <select
            value={mapping.sideFromSign ? FROM_SIGN : (mapping.side ?? '')}
            onChange={(e) => (e.target.value === FROM_SIGN ? update({ sideFromSign: true, side: null }) : update({ sideFromSign: false, side: e.target.value || null }))}
          >
            <option value="">{bi(choose)}</option>
            {headers.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
            <option value={FROM_SIGN}>{bi({ en: 'No column: negative quantity = sell', zh: '無此欄：數量為負即賣出' })}</option>
          </select>
        </Field>
        {!mapping.sideFromSign && (
          <>
            <Field label={{ en: 'Words for a buy', zh: '代表買進的字' }} hint={<Bi en="Separated by commas" zh="以逗號分隔" />}>
              {/* Edited as free text and read on leaving the field; the key resets it for another file or broker. */}
              <input key={mapping.buyWords.join('\u0000')} defaultValue={mapping.buyWords.join(', ')} onBlur={(e) => update({ buyWords: wordList(e.target.value) })} />
            </Field>
            <Field label={{ en: 'Words for a sell', zh: '代表賣出的字' }} hint={<Bi en="Separated by commas" zh="以逗號分隔" />}>
              <input key={mapping.sellWords.join('\u0000')} defaultValue={mapping.sellWords.join(', ')} onBlur={(e) => update({ sellWords: wordList(e.target.value) })} />
            </Field>
          </>
        )}
        <Field label={LABELS.qty} hint={sample(mapping.qty)}>
          <ColumnSelect value={mapping.qty} headers={headers} none={choose} onChange={(qty) => update({ qty })} />
        </Field>
        <Field label={LABELS.price} hint={sample(mapping.price)}>
          <ColumnSelect value={mapping.price} headers={headers} none={choose} onChange={(price) => update({ price })} />
        </Field>
        <Field label={LABELS.currency} hint={sample(mapping.currency)}>
          <ColumnSelect value={mapping.currency} headers={headers} none={{ en: "No column: the security's currency", zh: '無此欄：使用證券的幣別' }} onChange={(currency) => update({ currency })} />
        </Field>
        <Field label={LABELS.fxRate} hint={sample(mapping.fxRate)}>
          <ColumnSelect value={mapping.fxRate} headers={headers} none={{ en: 'No column: one rate for the file', zh: '無此欄：整份檔案使用同一匯率' }} onChange={(fxRate) => update({ fxRate })} />
        </Field>
        <Field label={LABELS.note} hint={sample(mapping.note)}>
          <ColumnSelect value={mapping.note} headers={headers} none={{ en: 'None', zh: '不使用' }} onChange={(note) => update({ note })} />
        </Field>
      </div>
      <ColumnChecks legend={{ en: 'Fee columns (added together)', zh: '手續費欄位（加總）' }} chosen={mapping.fee} headers={headers} onChange={(fee) => update({ fee })} />
      <ColumnChecks legend={{ en: 'Tax columns (added together)', zh: '稅額欄位（加總）' }} chosen={mapping.tax} headers={headers} onChange={(tax) => update({ tax })} />
    </fieldset>
  );
}

function Preview({
  rows,
  keep,
  setKeep,
  preview,
  caps,
  checking,
  checkAgain,
}: {
  rows: ImportRow[];
  keep: ReadonlySet<number>;
  setKeep: (keep: ReadonlySet<number>) => void;
  preview: ReturnType<typeof previewImport> | null;
  caps: HoldingsData['caps'];
  checking: boolean;
  checkAgain: () => void;
}) {
  const count = (status: RowStatus) => rows.filter((row) => row.status === status).length;
  const unknown = [...new Set(rows.filter((row) => row.status === 'unknown').map((row) => row.ticker))];
  const created = preview?.breaches.filter((breach) => breach.isNew) ?? [];
  const [shortfall] = preview?.shortfalls ?? [];

  return (
    <div className="form" aria-live="polite">
      <p>
        <Bi
          en={`${count('new')} new · ${count('duplicate')} already saved · ${count('unknown')} with an unknown ticker · ${count('invalid')} skipped`}
          zh={`新交易 ${count('new')} 筆 · 已存在 ${count('duplicate')} 筆 · 未知代號 ${count('unknown')} 筆 · 略過 ${count('invalid')} 列`}
        />
      </p>
      {unknown.length > 0 && (
        <div className="banner warn">
          <Bi en="Add these tickers as securities (each opens in a new tab), then check again:" zh="請新增這些證券（各在新分頁開啟），再重新檢查：" />
          <ul>
            {unknown.map((ticker) => (
              <li key={ticker}>
                <a href={`/securities/new?${new URLSearchParams({ ticker, next: 'tab' })}`} target="_blank" rel="noopener">
                  <Bi en={`Add ${ticker}`} zh={`新增 ${ticker}`} />
                </a>
              </li>
            ))}
          </ul>
          <button type="button" className="button" onClick={checkAgain} disabled={checking}>
            <Bi en="Check again" zh="重新檢查" />
          </button>
        </div>
      )}
      {shortfall && (
        <p className="banner danger" role="alert">
          <Bi
            en={`${shortfallMessage(shortfall).en} Add the missing buy first, or leave the sell out.`}
            zh={`${shortfallMessage(shortfall).zh}請先補上缺少的買進，或不要匯入這筆賣出。`}
          />
        </p>
      )}
      {created.length > 0 && (
        <div className="banner warn">
          <Bi en="You can import, but afterwards a rule is broken:" zh="可以匯入，但匯入後會違反規則：" />
          <ul>
            {created.map((breach) => (
              <li key={`${breach.rule}:${breach.subject}`}>
                <Bi {...breachText(breach, caps, 'after')} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">
                <Bi en="Row" zh="列" />
              </th>
              <th>
                <Bi en="Status" zh="狀態" />
              </th>
              <th>
                <Bi {...LABELS.tradeDate} />
              </th>
              <th>
                <Bi {...LABELS.ticker} />
              </th>
              <th>
                <Bi {...LABELS.side} />
              </th>
              <th className="num">
                <Bi {...LABELS.qty} />
              </th>
              <th className="num">
                <Bi {...LABELS.price} />
              </th>
              <th className="num">
                <Bi en="Fee + tax" zh="手續費＋稅" />
              </th>
              <th className="num">
                <Bi en="FX rate" zh="匯率" />
              </th>
              <th>
                <Bi en="Notes" zh="說明" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, PREVIEW_ROWS).map((row) => (
              <tr key={row.line}>
                <td className="num">{row.line}</td>
                <td>
                  <span className={STATUS[row.status].badge}>
                    <Bi {...STATUS[row.status].label} />
                  </span>
                  {row.status === 'duplicate' && (
                    <label className="choice small">
                      <input
                        type="checkbox"
                        checked={keep.has(row.line)}
                        onChange={(e) => {
                          const next = new Set(keep);
                          if (e.target.checked) next.add(row.line);
                          else next.delete(row.line);
                          setKeep(next);
                        }}
                      />
                      <Bi en="Import anyway" zh="仍要匯入" />
                    </label>
                  )}
                </td>
                <td>{row.trade?.tradeDate ?? '—'}</td>
                <td>{row.ticker || '—'}</td>
                <td>{row.trade ? <Bi {...SIDE[row.trade.side]} /> : '—'}</td>
                <td className="num">{row.trade ? quantity(row.trade.qty) : '—'}</td>
                <td className="num">{row.trade ? `${quantity(row.trade.price)} ${row.trade.currency}` : '—'}</td>
                <td className="num">{row.trade ? quantity(row.trade.fee + row.trade.tax) : '—'}</td>
                <td className="num">{row.trade ? (row.trade.currency === 'TWD' ? '—' : row.trade.fxRate) : '—'}</td>
                <td className="small">
                  {[...row.problems, ...row.warnings].map((note) => (
                    <div key={note.en}>
                      <Bi {...note} />
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > PREVIEW_ROWS && (
        <p className="muted small">
          <Bi en={`Showing the first ${PREVIEW_ROWS} of ${rows.length} rows; the counts above cover all of them.`} zh={`僅顯示 ${rows.length} 列中的前 ${PREVIEW_ROWS} 列；上方統計涵蓋全部。`} />
        </p>
      )}
    </div>
  );
}
