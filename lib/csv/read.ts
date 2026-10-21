/**
 * Reading a broker statement file: its text encoding, its delimiter, the CSV grammar (RFC 4180:
 * quoted fields, doubled quotes, line breaks inside quotes) and where its header row is.
 */

export type Encoding = 'utf-8' | 'big5';
export type EncodingChoice = 'auto' | Encoding;
export type Delimiter = ',' | ';' | '\t';

export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t'];

/**
 * Taiwanese brokers often export Big5, most others UTF-8. "auto" takes UTF-8 when the bytes are
 * valid UTF-8 and Big5 otherwise; a byte-order mark is dropped either way.
 */
export function decodeCsv(bytes: Uint8Array, choice: EncodingChoice): { text: string; encoding: Encoding } {
  if (choice !== 'auto') return { text: new TextDecoder(choice).decode(bytes).replace(/^﻿/, ''), encoding: choice };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('big5').decode(bytes).replace(/^﻿/, ''), encoding: 'big5' };
  }
}

/** Rows of cells. A quote opens a quoted field only at the start of a field. */
export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function filledCells(row: readonly string[]): number {
  return row.filter((cell) => cell.trim() !== '').length;
}

/** The most common count of filled cells among rows with at least two; 0 for an empty table. */
function typicalWidth(rows: readonly string[][]): number {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const filled = filledCells(row);
    if (filled >= 2) counts.set(filled, (counts.get(filled) ?? 0) + 1);
  }
  let width = 0;
  for (const [filled, count] of counts) if (count > (counts.get(width) ?? 0) || (count === counts.get(width) && filled > width)) width = filled;
  return width;
}

/** The delimiter that gives the first lines the widest consistent rows. */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.split(/\r\n|\n|\r/).slice(0, 30).join('\n');
  let best: Delimiter = ',';
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const rows = parseCsv(sample, delimiter);
    const width = typicalWidth(rows);
    const score = width * rows.filter((row) => filledCells(row) === width).length;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Statements often open with title and account lines; the header is the first row with as many
 * filled cells as a typical row. Returns a 0-based index.
 */
export function guessHeaderRow(rows: readonly string[][]): number {
  const width = typicalWidth(rows);
  const index = rows.findIndex((row) => filledCells(row) >= width && width > 0);
  return index === -1 ? 0 : index;
}

/**
 * A cell as text: trimmed, and unwrapped from the ="00692" form spreadsheets use to keep
 * leading zeros.
 */
export function cleanCell(value: string | undefined): string {
  const text = (value ?? '').trim();
  const wrapped = /^="(.*)"$/.exec(text);
  return (wrapped ? (wrapped[1] ?? '') : text).trim();
}

/** Header names made unique and non-empty, so a mapping can refer to columns by name. */
export function columnNames(header: readonly string[]): string[] {
  const used = new Set<string>();
  return header.map((cell, index) => {
    const base = cleanCell(cell) || `(column ${index + 1} 第 ${index + 1} 欄)`;
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
    used.add(name);
    return name;
  });
}
