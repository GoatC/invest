import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_DIVIDEND_WORDS, DEFAULT_SIDE_WORDS, guessDateFormat, isBlank, isDividend, parseAmount, parseDate, parseSide, resolveTicker, wordList } from './values';

describe('parseAmount', () => {
  it('reads grouped numbers with currency signs and codes', () => {
    assert.equal(parseAmount('1,234.50'), 1234.5);
    assert.equal(parseAmount('$1,234.50'), 1234.5);
    assert.equal(parseAmount('NT$1,000'), 1000);
    assert.equal(parseAmount('1,234.50 USD'), 1234.5);
    assert.equal(parseAmount('.5'), 0.5);
  });

  it('reads negatives written with a minus sign or in brackets', () => {
    assert.equal(parseAmount('-$301.00'), -301);
    assert.equal(parseAmount('−12.3'), -12.3);
    assert.equal(parseAmount('(12.30)'), -12.3);
  });

  it('gives undefined for blanks, dashes and text', () => {
    for (const raw of ['', ' ', '-', '—', 'n/a', '1.2.3', '12abc34']) assert.equal(parseAmount(raw), undefined, raw);
  });

  it('treats blank and dash cells as "none"', () => {
    assert.equal(isBlank(' - '), true);
    assert.equal(isBlank('—'), true);
    assert.equal(isBlank('0'), false);
  });
});

describe('parseDate', () => {
  it('reads year-first dates with any separator, compact or with a time', () => {
    for (const raw of ['2026/10/07', '2026-10-07', '2026.10.7', '20261007', '2026年10月7日', '2026/10/07 09:30:00', '2026-10-07T09:30']) {
      assert.equal(parseDate(raw, 'ymd'), '2026-10-07', raw);
    }
  });

  it('reads ROC (民國) years: 115 is 2026', () => {
    assert.equal(parseDate('115/10/07', 'roc'), '2026-10-07');
    assert.equal(parseDate('1151007', 'roc'), '2026-10-07');
    assert.equal(parseDate('115年10月7日', 'roc'), '2026-10-07');
  });

  it('reads month-first and day-first dates', () => {
    assert.equal(parseDate('10/07/2026', 'mdy'), '2026-10-07');
    assert.equal(parseDate('07/10/2026', 'dmy'), '2026-10-07');
  });

  it('refuses impossible dates and the wrong format', () => {
    assert.equal(parseDate('2026/02/30', 'ymd'), undefined);
    assert.equal(parseDate('2026/13/01', 'ymd'), undefined);
    assert.equal(parseDate('115/10/07', 'ymd'), undefined);
    assert.equal(parseDate('2026/10/07', 'roc'), undefined);
    assert.equal(parseDate('10/07/26', 'mdy'), undefined);
    assert.equal(parseDate('合計', 'ymd'), undefined);
  });
});

describe('guessDateFormat', () => {
  it('tells year-first, ROC and day-first apart', () => {
    assert.deepEqual(guessDateFormat(['2026/10/07', '2026/10/08']), { format: 'ymd', ambiguous: false });
    assert.deepEqual(guessDateFormat(['115/10/07']), { format: 'roc', ambiguous: false });
    assert.deepEqual(guessDateFormat(['25/10/2026', '07/10/2026']), { format: 'dmy', ambiguous: false });
    assert.deepEqual(guessDateFormat(['10/25/2026']), { format: 'mdy', ambiguous: false });
  });

  it('says when month-first was only a guess', () => {
    assert.deepEqual(guessDateFormat(['10/07/2026', '11/08/2026']), { format: 'mdy', ambiguous: true });
  });

  it('ignores cells that are not dates, and gives up when none are', () => {
    assert.deepEqual(guessDateFormat(['2026/10/07', '合計']), { format: 'ymd', ambiguous: false });
    assert.equal(guessDateFormat(['合計', '']), undefined);
  });
});

describe('isDividend', () => {
  it('recognises cash dividends in English and Chinese, inside longer cells too', () => {
    for (const cell of ['Dividend', 'QUALIFIED DIVIDEND', '股利', '現金股利', '配息']) assert.ok(isDividend(cell, DEFAULT_DIVIDEND_WORDS), cell);
  });

  it('leaves trades, interest and blank cells alone', () => {
    for (const cell of ['買進', 'Sell', '利息', 'Interest', '']) assert.ok(!isDividend(cell, DEFAULT_DIVIDEND_WORDS), cell);
  });
});

describe('parseSide', () => {
  it('matches the buy and sell words, ignoring case and spaces', () => {
    assert.equal(parseSide(' BUY ', DEFAULT_SIDE_WORDS), 'buy');
    assert.equal(parseSide('s', DEFAULT_SIDE_WORDS), 'sell');
    assert.equal(parseSide('買進', DEFAULT_SIDE_WORDS), 'buy');
    assert.equal(parseSide('賣', DEFAULT_SIDE_WORDS), 'sell');
  });

  it('finds a word inside a longer cell', () => {
    assert.equal(parseSide('現股買進', DEFAULT_SIDE_WORDS), 'buy');
    assert.equal(parseSide('現股賣出', DEFAULT_SIDE_WORDS), 'sell');
    assert.equal(parseSide('Sell to close', DEFAULT_SIDE_WORDS), 'sell');
  });

  it('refuses cells that match both or neither', () => {
    assert.equal(parseSide('買賣', DEFAULT_SIDE_WORDS), undefined);
    assert.equal(parseSide('Dividend', DEFAULT_SIDE_WORDS), undefined);
    assert.equal(parseSide('', DEFAULT_SIDE_WORDS), undefined);
    // A one-letter word only matches a whole cell: "Bonus" is not a buy.
    assert.equal(parseSide('Bonus', DEFAULT_SIDE_WORDS), undefined);
  });

  it('takes the word lists a person types', () => {
    assert.deepEqual(wordList('buy, 買進，申購、 '), ['buy', '買進', '申購']);
    assert.equal(parseSide('申購', { buy: wordList('申購'), sell: wordList('贖回') }), 'buy');
  });
});

describe('resolveTicker', () => {
  const known = new Set(['VT', 'BRK.B', '2330', '0050', '00692']);

  it('matches as written, by first word, or without a market suffix', () => {
    assert.deepEqual(resolveTicker(' vt ', known), { ticker: 'VT', known: true });
    assert.deepEqual(resolveTicker('VT US', known), { ticker: 'VT', known: true });
    assert.deepEqual(resolveTicker('2330.TW', known), { ticker: '2330', known: true });
    assert.deepEqual(resolveTicker('BRK.B', known), { ticker: 'BRK.B', known: true });
  });

  it('restores leading zeros a spreadsheet dropped, when only one code fits', () => {
    assert.deepEqual(resolveTicker('692', known), { ticker: '00692', known: true });
    assert.deepEqual(resolveTicker('50', known), { ticker: '0050', known: true });
  });

  it('returns unknown tickers upper-cased', () => {
    assert.deepEqual(resolveTicker('msft', known), { ticker: 'MSFT', known: false });
    assert.deepEqual(resolveTicker('', known), { ticker: '', known: false });
  });
});
