import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { strToU8, zipSync } from 'fflate';

import {
  dayMonthYearToIso,
  decodeEntities,
  decodeText,
  extractLinks,
  findUrls,
  headTail,
  htmlTableRows,
  htmlToText,
  isoDaysAgo,
  jsonPreview,
  parseCsv,
  printableStrings,
  sniff,
  spreadsheetMlSheets,
  toIsoDate,
  truncate,
  unzip,
  xlsxPeek,
} from './payload.ts';

describe('decodeText', () => {
  it('strips a UTF-8 byte-order mark', () => {
    assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), 'A');
  });

  it('falls back to Big5 when the bytes are not UTF-8', () => {
    // "十年期" in Big5.
    assert.equal(decodeText(Uint8Array.from([0xa4, 0x51, 0xa6, 0x7e, 0xb4, 0xc1])), '十年期');
  });

  it('honours a declared charset', () => {
    assert.equal(decodeText(Uint8Array.from([0xa4, 0x51]), 'text/csv; charset=big5'), '十');
  });
});

describe('parseCsv', () => {
  it('handles quoted fields, doubled quotes and CRLF line ends', () => {
    assert.deepEqual(parseCsv('a,"b,c","say ""hi"""\r\n1,2,3\n'), [
      ['a', 'b,c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps a last line without a newline and empty fields', () => {
    assert.deepEqual(parseCsv('x,,z\n4,5,'), [
      ['x', '', 'z'],
      ['4', '5', ''],
    ]);
  });
});

describe('HTML helpers', () => {
  it('decodes named and numeric entities', () => {
    assert.equal(decodeEntities('A&amp;B &lt;3 &#21488;&#x7063; &bogus;'), 'A&B <3 台灣 &bogus;');
  });

  it('turns a page into visible text without scripts', () => {
    const html = '<html><head><script>var x = 1;</script><style>p{}</style></head><body><p>Implied ERP on October 1, 2026&nbsp;= 4.20%</p><div>Next</div></body></html>';
    assert.equal(htmlToText(html), 'Implied ERP on October 1, 2026 = 4.20%\nNext');
  });

  it('drops inline tags without a gap, as in Damodaran’s markup', () => {
    const html = '<p><strong>Implied ERP on October 1, 2026 </strong>= 4.<span class="MsoNormal" style="x"></span><span class="MsoNormal">20% (Trailing)</span></p>';
    assert.equal(htmlToText(html), 'Implied ERP on October 1, 2026 = 4.20% (Trailing)');
  });

  it('resolves links against the page and skips anchors and scripts', () => {
    const html = '<a href="/data/ie_data.xls?ver=1&amp;x=2">x</a><a href="#top">t</a><a href="javascript:void(0)">j</a><a href="https://cdn.test/a.csv">c</a>';
    assert.deepEqual(extractLinks(html, 'https://shillerdata.com/page'), ['https://shillerdata.com/data/ie_data.xls?ver=1&x=2', 'https://cdn.test/a.csv']);
  });

  it('finds URLs in JSON even when slashes are escaped', () => {
    const json = '{"result":{"distribution":[{"resourceDownloadUrl":"https:\\/\\/www.cbc.gov.tw\\/public\\/data\\/rates.csv"},{"note":"see https://data.gov.tw/dataset/10840 now"}]}}';
    assert.deepEqual(findUrls(json), ['https://www.cbc.gov.tw/public/data/rates.csv', 'https://data.gov.tw/dataset/10840']);
    assert.deepEqual(findUrls('<a href="https://x.test/a.csv">'), ['https://x.test/a.csv']);
  });

  it('reads table rows cell by cell', () => {
    const html = '<table><tr><th>日期</th><th>本行買入</th></tr><tr><td>2026/10/20</td><td> 3,050 </td></tr></table>';
    assert.deepEqual(htmlTableRows(html), [
      ['日期', '本行買入'],
      ['2026/10/20', '3,050'],
    ]);
  });
});

describe('binary files', () => {
  it('identifies zip, legacy xls and pdf by magic bytes', () => {
    assert.equal(sniff(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0])), 'zip');
    assert.equal(sniff(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0])), 'ole2');
    assert.equal(sniff(strToU8('%PDF-1.7')), 'pdf');
    assert.equal(sniff(strToU8('{"a":1}')), 'other');
  });

  it('finds printable runs inside binary data', () => {
    const bytes = Uint8Array.from([0, ...strToU8('CAPE'), 1, 2, ...strToU8('ab'), 0, ...strToU8('Date')]);
    assert.deepEqual(printableStrings(bytes), ['CAPE', 'Date']);
  });

  it('unzips a CSV entry', () => {
    const zip = zipSync({ 'F-F_Research_Data_5_Factors_2x3.csv': strToU8(',Mkt-RF,SMB\n202608, 1.10, -0.20\n'), 'readme.txt': strToU8('x') });
    const files = unzip(zip, (name) => name.endsWith('.csv'));
    assert.deepEqual(Object.keys(files), ['F-F_Research_Data_5_Factors_2x3.csv']);
    assert.match(decodeText(files['F-F_Research_Data_5_Factors_2x3.csv'] ?? new Uint8Array()), /202608/);
  });

  it('peeks at sheet names, first-sheet rows and short shared strings of an xlsx', () => {
    const disclaimer = 'Investing involves risk. '.repeat(10);
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="holdings" sheetId="1"/><sheet name="Notes &amp; terms" sheetId="2"/></sheets></workbook>'),
      'xl/sharedStrings.xml': strToU8(`<sst><si><t>Fund Name:</t></si><si><t>${disclaimer}</t></si><si><t xml:space="preserve">As of 19-Oct-2026 </t></si></sst>`),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"/><row r="2"/><row r="3"/></sheetData></worksheet>'),
    });
    assert.deepEqual(xlsxPeek(xlsx), { sheets: ['holdings', 'Notes & terms'], firstSheetRows: 3, strings: ['Fund Name:', 'As of 19-Oct-2026'] });
  });

  it('reads SpreadsheetML worksheets as rows of cells', () => {
    const xml = [
      '<?xml version="1.0"?><ss:Workbook xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<ss:Worksheet ss:Name="Historical NAVs"><ss:Table>',
      '<ss:Row><ss:Cell><ss:Data ss:Type="String">Historical NAVs</ss:Data></ss:Cell></ss:Row>',
      '<ss:Row><ss:Cell><ss:Data ss:Type="String">19/Oct/2026</ss:Data></ss:Cell><ss:Cell><ss:Data ss:Type="Number">5.76</ss:Data></ss:Cell></ss:Row>',
      '</ss:Table></ss:Worksheet>',
      '<ss:Worksheet ss:Name="Holdings &amp; more"><ss:Table><ss:Row><ss:Cell><ss:Data ss:Type="String">A &amp; B</ss:Data></ss:Cell></ss:Row></ss:Table></ss:Worksheet>',
      '</ss:Workbook>',
    ].join('\n');
    const sheets = spreadsheetMlSheets(xml);
    assert.deepEqual([...sheets.keys()], ['Historical NAVs', 'Holdings & more']);
    assert.deepEqual(sheets.get('Historical NAVs'), [['Historical NAVs'], ['19/Oct/2026', '5.76']]);
    assert.deepEqual(sheets.get('Holdings & more'), [['A & B']]);
  });
});

describe('previews', () => {
  it('shortens long arrays and wide objects', () => {
    const preview = JSON.parse(jsonPreview({ data: [1, 2, 3, 4], wide: { a: 1, b: 2, c: 3 } }, 2, 2)) as unknown;
    assert.deepEqual(preview, { data: [1, 2, '… 2 more items'], wide: { a: 1, b: 2, '…': '1 more keys' } });
  });

  it('keeps the head and tail of long texts', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    assert.equal(headTail(lines, 2, 1), 'line 1\nline 2\n… (17 more lines) …\nline 20');
    assert.equal(headTail(['a', 'b'], 2, 1), 'a\nb');
    assert.equal(truncate('abcdef', 3), 'abc\n… (3 more characters)');
  });
});

describe('dates', () => {
  it('converts TWSE ROC dates and compact Gregorian dates', () => {
    assert.equal(toIsoDate('1151020'), '2026-10-20');
    assert.equal(toIsoDate('20261020'), '2026-10-20');
    assert.equal(toIsoDate('2026-10-20'), '2026-10-20');
  });

  it('reads iShares day/month/year dates, including "Sept"', () => {
    assert.equal(dayMonthYearToIso('19/Oct/2026'), '2026-10-19');
    assert.equal(dayMonthYearToIso('30/Sept/2026'), '2026-09-30');
    assert.equal(dayMonthYearToIso('5/May/2025'), '2025-05-05');
    assert.equal(dayMonthYearToIso('Historical NAVs'), undefined);
  });

  it('counts days back in UTC', () => {
    assert.equal(isoDaysAgo(14, new Date('2026-10-20T12:00:00Z')), '2026-10-06');
  });
});
