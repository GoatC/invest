import { unzipSync } from 'fflate';

const BOM = '﻿';

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/** Decodes bytes with the declared charset, else UTF-8, falling back to Big5 (common in older Taiwanese files). */
export function decodeText(bytes: Uint8Array, contentType?: string): string {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (declared) {
    try {
      return stripBom(new TextDecoder(declared).decode(bytes));
    } catch {
      // Unknown charset label: fall through to detection.
    }
  }
  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return stripBom(new TextDecoder('big5').decode(bytes));
  }
}

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#')) {
      const n = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

/**
 * Visible text of an HTML page, one block element per line. Inline tags vanish without a gap,
 * so "4.<span></span>20%" (as Damodaran's page writes it) reads "4.20%".
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/?(?:a|abbr|b|em|font|i|small|span|strong|sub|sup|u)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

/** Absolute URLs of every href on the page, in page order, without duplicates. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href || href.startsWith('#') || /^(?:javascript|mailto):/i.test(href)) continue;
    try {
      links.add(new URL(decodeEntities(href), baseUrl).href);
    } catch {
      // Malformed href: ignore it.
    }
  }
  return [...links];
}

/**
 * Every http(s) URL in a JSON document, read from the parsed values so escaped slashes
 * ("https:\/\/...") are found too; falls back to scanning the raw text if it is not JSON.
 */
export function findUrls(text: string): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === 'string') for (const match of node.matchAll(/https?:\/\/[^\s"'<>]+/g)) found.add(match[0]);
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && typeof node === 'object') Object.values(node).forEach(visit);
  };
  try {
    visit(JSON.parse(text));
  } catch {
    visit(text);
  }
  return [...found];
}

/** Cell texts of each <tr> in an HTML table, for simple server-rendered tables. */
export function htmlTableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const cells = [...tr[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => htmlToText(cell[1] ?? ''));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

export type FileKind = 'zip' | 'ole2' | 'pdf' | 'other';

/** Identifies binary formats by their magic bytes: zip (also .xlsx), OLE2 (legacy .xls) and PDF. */
export function sniff(bytes: Uint8Array): FileKind {
  const head = Array.from(bytes.subarray(0, 4));
  const starts = (...magic: number[]) => magic.every((byte, i) => head[i] === byte);
  if (starts(0x50, 0x4b, 0x03, 0x04)) return 'zip';
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return 'ole2';
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'pdf';
  return 'other';
}

/** Runs of printable ASCII, like the Unix `strings` tool: a cheap peek at labels inside a legacy .xls file. */
export function printableStrings(bytes: Uint8Array, minLength = 4): string[] {
  const found: string[] = [];
  let run = '';
  for (const byte of bytes) {
    if (byte >= 0x20 && byte <= 0x7e) run += String.fromCharCode(byte);
    else {
      if (run.length >= minLength) found.push(run);
      run = '';
    }
  }
  if (run.length >= minLength) found.push(run);
  return found;
}

/** Entries of a zip archive, optionally only those whose name passes `keep`. */
export function unzip(bytes: Uint8Array, keep?: (name: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(bytes, keep ? { filter: (file) => keep(file.name) } : undefined);
}

const XLSX_PARTS = new Set(['xl/workbook.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);

/**
 * Sheet names, the row count of the first sheet and its first short shared strings (long ones are
 * usually disclaimers) of an .xlsx workbook.
 */
export function xlsxPeek(bytes: Uint8Array, maxStrings = 30): { sheets: string[]; firstSheetRows: number; strings: string[] } {
  const files = unzip(bytes, (name) => XLSX_PARTS.has(name));
  const read = (name: string) => {
    const part = files[name];
    return part ? decodeText(part) : '';
  };
  const sheets = [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeEntities(m[1] ?? ''));
  const firstSheetRows = read('xl/worksheets/sheet1.xml').match(/<row\b/g)?.length ?? 0;
  const strings = [...read('xl/sharedStrings.xml').matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)]
    .map((m) => decodeEntities(m[1] ?? '').trim())
    .filter((text) => text !== '' && text.length <= 80)
    .slice(0, maxStrings);
  return { sheets, firstSheetRows, strings };
}

/** Worksheets of a SpreadsheetML 2003 workbook (the XML "xls" that iShares downloads), as rows of cell texts. */
export function spreadsheetMlSheets(xml: string): Map<string, string[][]> {
  const sheets = new Map<string, string[][]>();
  for (const sheet of xml.matchAll(/<(?:ss:)?Worksheet\b[^>]*?\b(?:ss:)?Name="([^"]*)"[^>]*>([\s\S]*?)<\/(?:ss:)?Worksheet>/g)) {
    const rows = [...(sheet[2] ?? '').matchAll(/<(?:ss:)?Row\b[\s\S]*?<\/(?:ss:)?Row>/g)].map((row) =>
      [...row[0].matchAll(/<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/g)].map((cell) => decodeEntities((cell[1] ?? '').replace(/<[^>]+>/g, '')).trim()),
    );
    sheets.set(decodeEntities(sheet[1] ?? ''), rows);
  }
  return sheets;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "19/Oct/2026" or "30/Sept/2026" (iShares style) → "2026-10-19"; undefined if it is not such a date. */
export function dayMonthYearToIso(text: string): string | undefined {
  const match = /^(\d{1,2})\/([A-Za-z]{3,5})\/(\d{4})$/.exec(text.trim());
  const month = match ? MONTHS[(match[2] ?? '').slice(0, 3).toLowerCase()] : undefined;
  if (!match || !month) return undefined;
  return `${match[3]}-${String(month).padStart(2, '0')}-${(match[1] ?? '').padStart(2, '0')}`;
}

export function truncate(text: string, maxChars = 1200): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n… (${text.length - maxChars} more characters)`;
}

/** First and last lines of a long text, with a count of what was left out. */
export function headTail(lines: readonly string[], head = 6, tail = 3): string {
  if (lines.length <= head + tail + 1) return lines.join('\n');
  return [...lines.slice(0, head), `… (${lines.length - head - tail} more lines) …`, ...lines.slice(-tail)].join('\n');
}

/** Pretty JSON with long arrays and wide objects cut down, so a sample stays readable. */
export function jsonPreview(value: unknown, maxItems = 2, maxKeys = 12, maxChars = 1500): string {
  const shrink = (node: unknown, depth: number): unknown => {
    if (Array.isArray(node)) {
      const items = node.slice(0, maxItems).map((item) => shrink(item, depth + 1));
      return node.length > maxItems ? [...items, `… ${node.length - maxItems} more items`] : items;
    }
    if (node !== null && typeof node === 'object') {
      if (depth >= 5) return '{…}';
      const entries = Object.entries(node);
      const kept = entries.slice(0, maxKeys).map(([key, child]) => [key, shrink(child, depth + 1)]);
      if (entries.length > maxKeys) kept.push(['…', `${entries.length - maxKeys} more keys`]);
      return Object.fromEntries(kept);
    }
    return node;
  };
  return truncate(JSON.stringify(shrink(value, 0), null, 2), maxChars);
}

/** "1151020" (ROC calendar, as TWSE writes dates) or "20261020" → "2026-10-20"; anything else unchanged. */
export function toIsoDate(raw: string): string {
  const digits = raw.trim();
  const roc = /^(\d{3})(\d{2})(\d{2})$/.exec(digits);
  if (roc) return `${Number(roc[1]) + 1911}-${roc[2]}-${roc[3]}`;
  const western = /^(\d{4})(\d{2})(\d{2})$/.exec(digits);
  if (western) return `${western[1]}-${western[2]}-${western[3]}`;
  return digits;
}

export function isoDaysAgo(days: number, from = new Date()): string {
  return new Date(from.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}
