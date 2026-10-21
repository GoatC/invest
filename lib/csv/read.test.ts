import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanCell, columnNames, decodeCsv, detectDelimiter, guessHeaderRow, parseCsv } from './read';
import { TW_STATEMENT, US_STATEMENT } from './test-fixtures';

describe('parseCsv', () => {
  it('reads quoted cells with commas, doubled quotes and line breaks inside', () => {
    const text = 'a,"b, c","say ""hi""","two\nlines"\r\n1,,3,4\n';
    assert.deepEqual(parseCsv(text, ','), [
      ['a', 'b, c', 'say "hi"', 'two\nlines'],
      ['1', '', '3', '4'],
    ]);
  });

  it('keeps a quote in the middle of a cell as text', () => {
    assert.deepEqual(parseCsv('5" bar,x', ','), [['5" bar', 'x']]);
  });

  it('reads the last row without a final line break, and an empty last cell', () => {
    assert.deepEqual(parseCsv('a,b\n1,', ','), [
      ['a', 'b'],
      ['1', ''],
    ]);
  });
});

describe('decodeCsv', () => {
  // "成交日期,股票代號,買賣別\n2026/10/07,VT,買進\n" saved as Big5, the way many Taiwanese brokers export.
  const big5 = new Uint8Array([
    166, 168, 165, 230, 164, 233, 180, 193, 44, 170, 209, 178, 188, 165, 78, 184, 185, 44, 182, 82, 189, 230, 167, 79, 10, 50, 48, 50, 54, 47, 49, 48, 47, 48,
    55, 44, 86, 84, 44, 182, 82, 182, 105, 10,
  ]);

  it('falls back to Big5 when the bytes are not UTF-8', () => {
    assert.deepEqual(decodeCsv(big5, 'auto'), { text: '成交日期,股票代號,買賣別\n2026/10/07,VT,買進\n', encoding: 'big5' });
  });

  it('reads UTF-8 and drops the byte-order mark', () => {
    const bytes = new TextEncoder().encode('﻿成交日期,VT');
    assert.deepEqual(decodeCsv(bytes, 'auto'), { text: '成交日期,VT', encoding: 'utf-8' });
    assert.equal(decodeCsv(bytes, 'utf-8').text, '成交日期,VT');
  });
});

describe('detectDelimiter', () => {
  it('finds commas, semicolons and tabs', () => {
    assert.equal(detectDelimiter(US_STATEMENT), ',');
    assert.equal(detectDelimiter('Date;Symbol;Qty\n2026-10-07;VT;2\n2026-10-08;VT;1'), ';');
    assert.equal(detectDelimiter('Date\tSymbol\tQty\n2026-10-07\tVT\t2'), '\t');
  });

  it('is not fooled by commas inside quoted cells', () => {
    assert.equal(detectDelimiter('a;b;c\n"1,5";"2,5";"x, y"\n"3,5";"4,5";"z"'), ';');
  });
});

describe('guessHeaderRow', () => {
  it('skips the title lines above the header', () => {
    assert.equal(guessHeaderRow(parseCsv(TW_STATEMENT, ',')), 2);
  });

  it('takes the first row when the file starts with its header', () => {
    assert.equal(guessHeaderRow(parseCsv(US_STATEMENT, ',')), 0);
    assert.equal(guessHeaderRow([]), 0);
  });
});

describe('cleanCell and columnNames', () => {
  it('unwraps the ="00692" form spreadsheets use for leading zeros', () => {
    assert.equal(cleanCell(' ="00692" '), '00692');
    assert.equal(cleanCell(' VT '), 'VT');
    assert.equal(cleanCell(undefined), '');
  });

  it('names blank and repeated headers so each column can be told apart', () => {
    assert.deepEqual(columnNames(['Fee', '', 'Fee', 'Fee (2)', ' Fee ']), ['Fee', '(column 2 第 2 欄)', 'Fee (2)', 'Fee (2) (2)', 'Fee (3)']);
  });
});
